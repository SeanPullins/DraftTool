#!/usr/bin/env node
// Phase 3: two-stage residual architecture, replacing the single blended calibration
// regression (Phase 1) with:
//   1. An isotonic (PAVA) pick -> log1p(AV) market baseline, fit per position group.
//   2. A residual model (ridge OR a regularized bagged GBM, whichever validates better
//      per group) trained on NON-pick features only (athletic/size/age/strength/PFF) --
//      the baseline already owns all the pick-derived signal, so the residual model's
//      whole job is to explain what's left over.
//   3. A per-group shrinkage weight on the residual (tunable to exactly 0), so a group
//      where the residual model adds nothing just falls back to the pure baseline
//      instead of being dragged down by noise -- this is the structural fix for the
//      "blended pipeline underperforms pick-only" problem that persisted through
//      Phase 1: the old design had no way to say "don't use this feature here."
//
// This mirrors the architecture of an independently-built NFL draft model (APEX) whose
// own holdout testing found naive feature-stacking loses to draft capital, exactly the
// failure mode diagnosed in DraftTool earlier this session, and fixed it the same way.
//
// Methodology (same walk-forward discipline as Phase 1):
//   1. For each candidate residual-model config (ridge alpha, or GBM hyperparams) and
//      each shrinkage weight, compute mean walk-forward CV combined-score rho across
//      folds restricted to years <=2015. Pick the (config, shrinkage) combo -- and
//      residual-model TYPE -- that maximizes a bias-penalized score, per group.
//   2. With the chosen config, fit on years <=2015 and evaluate ONCE on the untouched
//      2016-2020 confirmation window.
//   3. Refit final coefficients/trees on all mature data (per compCutoffForGroup) for
//      shipping; bag the final GBM choice over multiple seeds for stability.
//
// RESULT (see chat/PR for the run this recorded): NO-GO -- not wired into production.
// 4 of 5 groups (QB, OL, FRONT, DB) tuned to shrinkage=0: the residual model (both ridge
// AND a regularized bagged GBM were tried, including a shrunk college-quality encoding --
// APEX's README specifically flags this as a signal, and it's genuinely new information
// DraftTool didn't have elsewhere) contributed exactly nothing validated beyond the
// isotonic pick baseline. Since Spearman rho is invariant to monotonic transforms,
// shrinkage=0 is mathematically identical to sorting those groups by pick alone --
// confirmed exactly: QB's confirmation rho (0.733) equals QB's plain pick-only rho
// (0.733) to 3 decimals. Only SKILL got a small nonzero weight (shrinkage=0.1, a bagged
// GBM, +0.007 rho over pick-only). Against the already-shipped Phase 1 ridge model, this
// architecture is a wash-to-slightly-worse in every group (QB +0.008, others -0.003 to
// -0.015). This is architecturally sound and correctly implemented (self-checks on
// isotonic.mts and gbm.mts both pass, the same walk-forward discipline as everything
// else this session) -- it's a genuine, well-supported finding that non-pick pre-draft
// signals carry little to no incremental predictive value for this outcome on this
// dataset, not evidence of a bug. It's the third independent architecture this session
// (Phase 1 ridge, Phase 2 raw-target GBM, this residual design) to converge on that
// conclusion. See scripts/reference/fitted-residual-model.reference.ts for the fitted
// artifact (kept outside src/ so it's not picked up by tsc -b, since it isn't compiled).
//
// Usage: node --experimental-strip-types scripts/fit-residual-model.mts

import { compCutoffForGroup, clean } from '../src/model.ts'
import type { ModelSignal } from '../src/model.ts'
import { loadEvalData, spearman, mae, bias as computeBias } from './lib/eval-data.mts'
import { fitIsotonic, predictIsotonic, type IsotonicFit } from './lib/isotonic.mts'
import { ridgeFit, predictRidge, type FittedRidge } from './lib/ridge.mts'
import { fitGbm, predictGbm, fitBaggedGbm, predictBaggedGbm, type BaggedGbmModel, type GbmParams } from './lib/gbm.mts'
import { buildTrainingRows, GROUPS, type Grp, type TrainingRow as Row } from './lib/training-rows.mts'

const DATA = new URL('../public/data/', import.meta.url).pathname

console.log('Loading data...')
const evalData = loadEvalData(DATA)
console.log('Computing walk-forward features (shared with fit-calibration-model.mts)...')
const rows: Row[] = buildTrainingRows(evalData, 2000, 2020, (done, total) => process.stdout.write(`  ${done}/${total}\r`))
console.log(`  ${rows.length} rows done`)

// Shrunk (empirical-Bayes) walk-forward encoding of school quality: for each row, the
// average log1p(AV) of that school's players from STRICTLY earlier draft years, shrunk
// toward the global mean by k (a school needs ~k historical picks before its own average
// dominates the estimate). APEX's README specifically calls out a "shrunken college
// encoding" as one of its residual-model features -- DraftTool's only college-quality
// signal elsewhere is a coarse Tier1/Tier2 static list, so this is new information, not a
// duplicate of an existing feature. Processed year-by-year so a school's own current-year
// classmates never leak into their own encoding (their AV outcomes lie in the future
// relative to the draft-evaluation moment, exactly like the row's own AV).
function computeCollegeEncoding(allRows: Row[], k = 10): number[] {
  const globalMean = allRows.reduce((s, r) => s + Math.log1p(Math.max(0, r.av)), 0) / allRows.length
  const bySchool = new Map<string, { sum: number; n: number }>()
  const rowsByYear = new Map<number, number[]>()
  allRows.forEach((r, i) => {
    if (!rowsByYear.has(r.year)) rowsByYear.set(r.year, [])
    rowsByYear.get(r.year)!.push(i)
  })
  const years = [...rowsByYear.keys()].sort((a, b) => a - b)
  const encoding = new Array(allRows.length).fill(globalMean)
  for (const y of years) {
    const idxs = rowsByYear.get(y)!
    for (const i of idxs) {
      const stats = bySchool.get(clean(allRows[i].school))
      const n = stats?.n ?? 0
      const sum = stats?.sum ?? 0
      encoding[i] = (sum + k * globalMean) / (n + k)
    }
    for (const i of idxs) {
      const stats = bySchool.get(clean(allRows[i].school)) ?? { sum: 0, n: 0 }
      stats.sum += Math.log1p(Math.max(0, allRows[i].av))
      stats.n += 1
      bySchool.set(clean(allRows[i].school), stats)
    }
  }
  return encoding
}
const collegeEnc = computeCollegeEncoding(rows)
const collegeEncByRow = new Map(rows.map((r, i) => [r, collegeEnc[i]]))

// ── Residual feature set: everything EXCEPT draftScore/logPick -- the isotonic baseline
// already owns the pick signal, so re-including it here would just let the residual
// model re-derive (and dilute) what the baseline already does cleanly. ─────────────────
const RESIDUAL_FEATURES: ModelSignal[] = ['pffComp', 'pffGrade', 'pffProd', 'pffEff', 'pffClean', 'hasPff', 'ageScore', 'athletic', 'size', 'strength']

function residualX(subset: Row[]): number[][] {
  return subset.map((r) => [...RESIDUAL_FEATURES.map((f) => r.features[f]), collegeEncByRow.get(r)!])
}
function logAv(subset: Row[]): number[] {
  return subset.map((r) => Math.log1p(Math.max(0, r.av)))
}

function fitBaseline(subset: Row[]): IsotonicFit {
  return fitIsotonic(subset.map((r) => r.pick), logAv(subset), 'decreasing')
}

// ── Residual model: ridge or bagged GBM, picked per group by walk-forward evidence ────

type ResidualModel = { kind: 'ridge'; fit: FittedRidge } | { kind: 'gbm'; fit: BaggedGbmModel }

function predictResidual(model: ResidualModel, x: number[]): number {
  return model.kind === 'ridge' ? predictRidge(model.fit, x) : predictBaggedGbm(model.fit, x)
}

const RIDGE_ALPHAS = [1, 3, 10, 30, 100]
const GBM_DEPTHS = [2, 3]
const GBM_LRS = [0.05, 0.15]
const GBM_LAMBDAS = [2, 10]
const GBM_MAX_TREES = 150
const GBM_CHECKPOINTS = [25, 50, 100, 150]
const SHRINKAGE_GRID = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
const BIAS_PENALTY = 0.006
const TUNE_FOLD_YEARS = Array.from({ length: 2015 - 2007 + 1 }, (_, i) => 2007 + i) // 2007..2015

function gbmMinLeaf(n: number): number {
  return Math.max(10, Math.round(n * 0.04))
}

// For one fold: fit baseline + a residual-model config on `train`, predict baseline+
// residual on `test`, and return per-shrinkage combined-score metrics (baseline itself
// is fixed for the fold; only the residual's contribution varies with shrinkage, so this
// is computed once per (fold, config) and then cheaply swept over all shrinkage values).
type FoldResult = { baselinePred: number[]; residualPred: number[]; actualAv: number[] }

function evalFold(train: Row[], test: Row[], residualFit: (trainX: number[][], trainY: number[]) => ResidualModel): FoldResult | null {
  if (train.length < RESIDUAL_FEATURES.length * 8 || test.length < 5) return null
  const baseline = fitBaseline(train)
  const baselinePredTrain = train.map((r) => predictIsotonic(baseline, r.pick))
  const trainResid = train.map((r, i) => Math.log1p(Math.max(0, r.av)) - baselinePredTrain[i])
  const model = residualFit(residualX(train), trainResid)
  const baselinePred = test.map((r) => predictIsotonic(baseline, r.pick))
  const residualPred = residualX(test).map((x) => predictResidual(model, x))
  return { baselinePred, residualPred, actualAv: test.map((r) => r.av) }
}

function combinedScoreForShrinkage(fold: FoldResult, shrinkage: number): { rho: number; biasAv: number } {
  const predAv = fold.baselinePred.map((b, i) => Math.max(0, Math.expm1(b + shrinkage * fold.residualPred[i])))
  return { rho: spearman(predAv, fold.actualAv), biasAv: computeBias(predAv, fold.actualAv) }
}

function meanScore(folds: FoldResult[], shrinkage: number): { score: number; rho: number; biasAv: number } {
  const rhos: number[] = []
  const biases: number[] = []
  for (const f of folds) {
    const s = combinedScoreForShrinkage(f, shrinkage)
    if (!isNaN(s.rho)) { rhos.push(s.rho); biases.push(s.biasAv) }
  }
  if (!rhos.length) return { score: -Infinity, rho: NaN, biasAv: NaN }
  const rho = rhos.reduce((s, r) => s + r, 0) / rhos.length
  const biasAv = biases.reduce((s, b) => s + b, 0) / biases.length
  return { score: rho - BIAS_PENALTY * Math.abs(biasAv), rho, biasAv }
}

type TunedResult = { kind: 'ridge' | 'gbm'; alpha?: number; gbmParams?: GbmParams; numTrees?: number; shrinkage: number; score: number; rho: number; biasAv: number }

function tuneGroup(subset: Row[], label: string): TunedResult {
  const folds = TUNE_FOLD_YEARS
    .map((y) => ({ train: subset.filter((r) => r.year < y), test: subset.filter((r) => r.year === y) }))

  let best: TunedResult = { kind: 'ridge', alpha: RIDGE_ALPHAS[0], shrinkage: 0, score: -Infinity, rho: 0, biasAv: 0 }

  // Ridge candidates
  for (const alpha of RIDGE_ALPHAS) {
    const foldResults = folds
      .map(({ train, test }) => evalFold(train, test, (X, y) => ({ kind: 'ridge', fit: ridgeFit(X, y, alpha) })))
      .filter((f): f is FoldResult => f !== null)
    if (!foldResults.length) continue
    for (const shrinkage of SHRINKAGE_GRID) {
      const { score, rho, biasAv } = meanScore(foldResults, shrinkage)
      if (score > best.score) best = { kind: 'ridge', alpha, shrinkage, score, rho, biasAv }
    }
  }

  // GBM candidates (checkpointed over numTrees within one fit per fold+combo)
  for (const maxDepth of GBM_DEPTHS) {
    for (const learningRate of GBM_LRS) {
      for (const lambdaL2 of GBM_LAMBDAS) {
        // byTrees[numTrees] -> FoldResult[] (one per fold, using that checkpoint's model)
        const byTrees = new Map<number, FoldResult[]>()
        for (const { train, test } of folds) {
          if (train.length < RESIDUAL_FEATURES.length * 8 || test.length < 5) continue
          const baseline = fitBaseline(train)
          const baselinePredTrain = train.map((r) => predictIsotonic(baseline, r.pick))
          const trainResid = train.map((r, i) => Math.log1p(Math.max(0, r.av)) - baselinePredTrain[i])
          const trainX = residualX(train)
          const testX = residualX(test)
          const baselinePredTest = test.map((r) => predictIsotonic(baseline, r.pick))
          const actualAv = test.map((r) => r.av)
          const params: GbmParams = { numTrees: GBM_MAX_TREES, maxDepth, learningRate, minLeafSize: gbmMinLeaf(train.length), rowSubsample: 0.75, colSubsample: 0.85, lambdaL2 }
          fitGbm(trainX, trainResid, params, (treeIndex, modelSoFar) => {
            const numTrees = treeIndex + 1
            if (!GBM_CHECKPOINTS.includes(numTrees)) return
            const residualPred = testX.map((x) => predictGbm(modelSoFar, x))
            if (!byTrees.has(numTrees)) byTrees.set(numTrees, [])
            byTrees.get(numTrees)!.push({ baselinePred: baselinePredTest, residualPred, actualAv })
          })
        }
        for (const numTrees of GBM_CHECKPOINTS) {
          const foldResults = byTrees.get(numTrees)
          if (!foldResults || !foldResults.length) continue
          for (const shrinkage of SHRINKAGE_GRID) {
            const { score, rho, biasAv } = meanScore(foldResults, shrinkage)
            if (score > best.score) {
              best = { kind: 'gbm', gbmParams: { numTrees, maxDepth, learningRate, minLeafSize: gbmMinLeaf(subset.length), rowSubsample: 0.75, colSubsample: 0.85, lambdaL2 }, numTrees, shrinkage, score, rho, biasAv }
            }
          }
        }
      }
    }
  }

  const desc = best.kind === 'ridge' ? `ridge alpha=${best.alpha}` : `gbm depth=${best.gbmParams!.maxDepth},lr=${best.gbmParams!.learningRate},lambda=${best.gbmParams!.lambdaL2},trees=${best.numTrees}`
  console.log(`  [${label}] chosen ${desc}  shrinkage=${best.shrinkage}  (mean CV rho=${best.rho.toFixed(3)}, bias=${best.biasAv.toFixed(1)} AV, over ${TUNE_FOLD_YEARS.length} folds, years<=2015 only)`)
  return best
}

console.log('\n── Tuning residual model + shrinkage per group (walk-forward CV, years <=2015 only) ──')
const tuned: Record<Grp, TunedResult> = {} as any
for (const g of GROUPS) tuned[g] = tuneGroup(rows.filter((r) => r.grp === g), g)

// ── Confirmation: train <=2015, evaluate ONCE on untouched 2016-2020 ──────────────────

console.log('\n── Confirmation (train <=2015, evaluate on untouched 2016-2020) ──')

function fitResidualModel(kind: 'ridge' | 'gbm', X: number[][], y: number[], tunedCfg: TunedResult, bag = false): ResidualModel {
  if (kind === 'ridge') return { kind: 'ridge', fit: ridgeFit(X, y, tunedCfg.alpha!) }
  return { kind: 'gbm', fit: bag ? fitBaggedGbm(X, y, tunedCfg.gbmParams!, 5) : fitBaggedGbm(X, y, tunedCfg.gbmParams!, 1) }
}

function confirmGroup(subset: Row[], cfg: TunedResult, label: string) {
  const train = subset.filter((r) => r.year <= 2015)
  const test = subset.filter((r) => r.year >= 2016 && r.year <= 2020)
  if (train.length < RESIDUAL_FEATURES.length * 8 || test.length < 5) { console.log(`  [${label}] insufficient data`); return }
  const baseline = fitBaseline(train)
  const baselinePredTrain = train.map((r) => predictIsotonic(baseline, r.pick))
  const trainResid = train.map((r, i) => Math.log1p(Math.max(0, r.av)) - baselinePredTrain[i])
  const model = fitResidualModel(cfg.kind, residualX(train), trainResid, cfg)
  const baselinePredTest = test.map((r) => predictIsotonic(baseline, r.pick))
  const residualPredTest = residualX(test).map((x) => predictResidual(model, x))
  const fold: FoldResult = { baselinePred: baselinePredTest, residualPred: residualPredTest, actualAv: test.map((r) => r.av) }
  const { rho, biasAv } = combinedScoreForShrinkage(fold, cfg.shrinkage)
  const predAv = fold.baselinePred.map((b, i) => Math.max(0, Math.expm1(b + cfg.shrinkage * fold.residualPred[i])))
  console.log(`  [${label}] n_train=${train.length} n_test=${test.length}  rho=${rho.toFixed(3)}  MAE=${mae(predAv, fold.actualAv).toFixed(1)}  bias=${biasAv.toFixed(1)}`)
}

for (const g of GROUPS) confirmGroup(rows.filter((r) => r.grp === g), tuned[g], g)

{
  const test = rows.filter((r) => r.year >= 2016 && r.year <= 2020)
  const actual = test.map((r) => r.av)
  const pickOnlyScore = test.map((r) => 100 * Math.pow(1 - (r.pick - 1) / 259, 0.58))
  const currentModelScore = test.map((r) => r.currentModelScore)
  console.log(`  [pick-only]          rho=${spearman(pickOnlyScore, actual).toFixed(3)}`)
  console.log(`  [current production] rho=${spearman(currentModelScore, actual).toFixed(3)}  (full pipeline, same rows)`)
  console.log(`  (Phase 1 ridge-only regression numbers are reported by fit-calibration-model.mts on these same rows)`)
}

// Runtime (project()) needs to compute collegeEnc for a NEW prospect too, not just
// historical training rows -- ship a school -> encoded-value lookup (built from ALL
// available data, not walk-forward, since at serving time "now" is later than every
// row in the corpus) plus a default for schools with no drafted alumni on record.
function computeFinalCollegeEncoding(allRows: Row[], k = 10): { bySchool: Record<string, number>; globalMean: number } {
  const globalMean = allRows.reduce((s, r) => s + Math.log1p(Math.max(0, r.av)), 0) / allRows.length
  const bySchool = new Map<string, { sum: number; n: number }>()
  for (const r of allRows) {
    const stats = bySchool.get(clean(r.school)) ?? { sum: 0, n: 0 }
    stats.sum += Math.log1p(Math.max(0, r.av))
    stats.n += 1
    bySchool.set(clean(r.school), stats)
  }
  const out: Record<string, number> = {}
  for (const [school, stats] of bySchool) out[school] = (stats.sum + k * globalMean) / (stats.n + k)
  return { bySchool: out, globalMean }
}
const finalCollegeEncoding = computeFinalCollegeEncoding(rows)
console.log(`\nComputed final school-quality encoding for ${Object.keys(finalCollegeEncoding.bySchool).length} schools (global mean=${finalCollegeEncoding.globalMean.toFixed(3)})`)

// ── Final refit on all mature data (per compCutoffForGroup), for shipping ─────────────

console.log('\n── Final refit on all mature data (this is what ships) ──')

type FinalGroupModel = {
  baseline: IsotonicFit
  shrinkage: number
  smearingLog: number
  kind: 'ridge' | 'gbm'
  ridge?: { intercept: number; coefs: number[]; means: number[]; sds: number[] }
  gbm?: BaggedGbmModel
}

const finalModels: Partial<Record<Grp, FinalGroupModel>> = {}

for (const g of GROUPS) {
  const cutoff = compCutoffForGroup[g] ?? 2021
  const subset = rows.filter((r) => r.grp === g && r.year <= cutoff)
  if (subset.length < RESIDUAL_FEATURES.length * 8) {
    console.log(`  [${g}] too little mature data (n=${subset.length}) -- skipping`)
    continue
  }
  const cfg = tuned[g]
  const baseline = fitBaseline(subset)
  const baselinePred = subset.map((r) => predictIsotonic(baseline, r.pick))
  const trainResid = subset.map((r, i) => Math.log1p(Math.max(0, r.av)) - baselinePred[i])
  const X = residualX(subset)

  const modelPart: FinalGroupModel = { kind: cfg.kind, baseline, shrinkage: cfg.shrinkage, smearingLog: 0 }
  let residualPred: number[]
  if (cfg.kind === 'ridge') {
    const fit = ridgeFit(X, trainResid, cfg.alpha!)
    modelPart.ridge = fit
    residualPred = X.map((x) => predictRidge(fit, x))
  } else {
    const fit = fitBaggedGbm(X, trainResid, cfg.gbmParams!, 5)
    modelPart.gbm = fit
    residualPred = X.map((x) => predictBaggedGbm(fit, x))
  }

  // Duan's smearing correction on the FINAL combined prediction (baseline + shrinkage*residual)
  const combinedPred = baselinePred.map((b, i) => b + cfg.shrinkage * residualPred[i])
  const smearResiduals = subset.map((r, i) => Math.log1p(Math.max(0, r.av)) - combinedPred[i])
  modelPart.smearingLog = Math.log(smearResiduals.reduce((s, r) => s + Math.exp(r), 0) / smearResiduals.length)

  finalModels[g] = modelPart
  console.log(`  [${g}] fit on n=${subset.length} (year<=${cutoff}), kind=${cfg.kind}, shrinkage=${cfg.shrinkage}, smearingLog=${modelPart.smearingLog.toFixed(4)}`)
}

// ── Emit as TS source ──────────────────────────────────────────────────────────────────

function fmtIsotonic(fit: IsotonicFit): string {
  return `{ xs: [${fit.xs.join(', ')}], values: [${fit.values.join(', ')}] }`
}
function fmtRidge(r: NonNullable<FinalGroupModel['ridge']>): string {
  return `{ intercept: ${r.intercept}, coefs: [${r.coefs.join(', ')}], means: [${r.means.join(', ')}], sds: [${r.sds.join(', ')}] }`
}
function fmtTree(node: import('./lib/gbm.mts').TreeNode): string {
  if (node.leaf) return `{ leaf: true, value: ${node.value} }`
  return `{ leaf: false, featureIndex: ${node.featureIndex}, threshold: ${node.threshold}, left: ${fmtTree(node.left)}, right: ${fmtTree(node.right)} }`
}
function fmtGbm(g: BaggedGbmModel): string {
  const models = g.models.map((m) => `{ initialValue: ${m.initialValue}, learningRate: ${m.learningRate}, trees: [${m.trees.map(fmtTree).join(', ')}] }`)
  return `{ models: [${models.join(', ')}] }`
}

const lines: string[] = []
lines.push('// AUTO-GENERATED by scripts/fit-residual-model.mts -- reference artifact only.')
lines.push('// Two-stage residual architecture (Phase 3): isotonic pick baseline + a per-group')
lines.push('// residual model (ridge or bagged GBM, chosen by walk-forward validation) + a')
lines.push('// per-group shrinkage weight. See that script\'s header comment for the walk-forward')
lines.push('// confirmation result (NO-GO -- not wired into production) at the time this was fit.')
lines.push('// Deliberately written outside src/ so it is not picked up by tsc -b.')
lines.push('')
lines.push('// Order matches residualX() above: the ModelSignal columns, then collegeEnc last.')
lines.push('export const residualFeatureNames = ' + JSON.stringify([...RESIDUAL_FEATURES, 'collegeEnc']) + ' as const')
lines.push('')
lines.push('export const fittedResidualModel = {')
for (const g of GROUPS) {
  const m = finalModels[g]
  if (!m) continue
  lines.push(`  ${g}: {`)
  lines.push(`    kind: '${m.kind}',`)
  lines.push(`    baseline: ${fmtIsotonic(m.baseline)},`)
  lines.push(`    shrinkage: ${m.shrinkage},`)
  lines.push(`    smearingLog: ${m.smearingLog},`)
  if (m.kind === 'ridge') lines.push(`    ridge: ${fmtRidge(m.ridge!)},`)
  else lines.push(`    gbm: ${fmtGbm(m.gbm!)},`)
  lines.push('  },')
}
lines.push('}')
lines.push('')
lines.push('// School-quality lookup for scoring NEW prospects at runtime (project() can\'t compute')
lines.push('// a walk-forward encoding per-query -- this is built from all available historical')
lines.push('// data, not walk-forward, since "now" is later than every training row).')
lines.push(`export const collegeEncodingDefault = ${finalCollegeEncoding.globalMean}`)
lines.push('export const collegeEncodingBySchool: Record<string, number> = ' + JSON.stringify(finalCollegeEncoding.bySchool))

const fs = await import('node:fs')
fs.mkdirSync(new URL('reference/', import.meta.url), { recursive: true })
const outPath = new URL('reference/fitted-residual-model.reference.ts', import.meta.url)
fs.writeFileSync(outPath, lines.join('\n') + '\n')
console.log(`\nWrote ${outPath.pathname}`)
const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(1)
console.log(`  file size: ${sizeKb} KB`)
