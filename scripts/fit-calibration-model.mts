#!/usr/bin/env node
// Walk-forward cross-validated refit of the calibration regression that produces
// calibratedAv inside project() (src/model.ts). Replaces the single hand-fit global
// model with per-position-group models chosen via proper walk-forward CV, using the
// exact same feature computation as production (via project()'s own `signals` output
// and buildCalibrationFeatureValues()) so there is no train/serve skew.
//
// Methodology (see the "Phase 1" scoping discussed in chat):
//   1. Compute features for every eligible historical player ONCE, walk-forward
//      (each player's features only see data from strictly earlier draft years).
//   2. Tune ridge alpha via walk-forward CV restricted to years <= 2015 only.
//   3. With the chosen alpha(s), fit on years <= 2015 and evaluate ONCE on the
//      untouched 2016-2020 confirmation window. This is the honest, leakage-free
//      estimate of what the new model should do on future draft classes.
//   4. Refit final coefficients on ALL mature data (per compCutoffForGroup) with the
//      confirmed alpha -- this is what ships. Its own eval number will look better
//      than step 3 because it was trained on more/overlapping data; step 3's number
//      is the one to trust.
//
// Usage: node --experimental-strip-types scripts/fit-calibration-model.mts

import { clean, project, buildCalibrationFeatureValues, group, compCutoffForGroup } from '../src/model.ts'
import type { Historical, Prospect, ModelSignal, CalibrationModel, CalibrationModelSet } from '../src/model.ts'
import { loadEvalData, toProspect, getRas, KNOWN_POSITIONS, spearman, mae } from './lib/eval-data.mts'
import { ridgeFit, predictRidge, type FittedRidge } from './lib/ridge.mts'

const DATA = new URL('../public/data/', import.meta.url).pathname

// ── Feature schema ────────────────────────────────────────────────────────────

// Position dummies only make sense in the global (cross-position) model; a
// per-group model trains on a single group so they'd just be constant columns.
const GROUP_FEATURES: ModelSignal[] = ['draftScore', 'logPick', 'pffComp', 'pffGrade', 'pffProd', 'pffEff', 'pffClean', 'hasPff', 'ageScore', 'athletic', 'size', 'strength']
const GLOBAL_FEATURES: ModelSignal[] = [...GROUP_FEATURES, 'isQB', 'isSkill', 'isOL', 'isFront', 'isDB']

const GROUPS = ['QB', 'SKILL', 'OL', 'FRONT', 'DB'] as const
type Grp = typeof GROUPS[number]

// ── Build the training corpus (features computed walk-forward, once) ─────────

type Row = { year: number; grp: Grp; pick: number; av: number; currentModelScore: number; features: Record<ModelSignal, number> }

console.log('Loading data...')
const { pool, pffProfiles, pffByKey, rasLookup, qbPffSeasons, y1NflStats } = loadEvalData(DATA)

const evalSet = pool.filter((p) => p.year >= 2000 && p.year <= 2020 && p.pick < 260 && KNOWN_POSITIONS.has(p.pos))
console.log(`Computing walk-forward features for ${evalSet.length} players...`)

const rows: Row[] = []
let done = 0
for (const player of evalSet) {
  const pff      = pffByKey.get(`${clean(player.name)}|${player.year}`)
  const rasRec   = getRas(player.name, player.year, player.pos, rasLookup)
  const prospect = toProspect(player, qbPffSeasons, pff, rasRec)
  // Walk-forward: this player's features only ever see strictly-earlier draft years,
  // exactly like scripts/evaluate-model.mts --walk-forward and exactly like a real
  // "score a new prospect today" call would only ever see the past.
  const wfPool        = pool.filter((p) => p.year < player.year)
  const wfPffProfiles = pffProfiles.filter((p) => p.draftSeason < player.year)
  // calibModels=null here means project() falls back to the CURRENT hand-fit
  // calibratedAvModel -- so proj.score below doubles as "what production does today"
  // for the same walk-forward row, letting us compare the new regression fairly
  // against the currently-deployed full scoring pipeline (comps + rawScore + this).
  const proj = project(prospect, wfPool, wfPffProfiles, player.id, undefined, undefined, undefined, prospect.qbTrajectory?.gradeDelta ?? null, true, undefined, y1NflStats, null)
  const features = buildCalibrationFeatureValues(prospect, proj.signals)
  rows.push({ year: player.year, grp: (group[player.pos] ?? 'SKILL') as Grp, pick: player.pick, av: player.av, currentModelScore: proj.score, features })
  done++
  if (done % 1000 === 0) process.stdout.write(`  ${done}/${evalSet.length}\r`)
}
console.log(`  ${done}/${evalSet.length} done`)

function toMatrix(subset: Row[], featureNames: ModelSignal[]): { X: number[][]; y: number[] } {
  return {
    X: subset.map((r) => featureNames.map((f) => r.features[f])),
    y: subset.map((r) => Math.log1p(Math.max(0, r.av))),
  }
}

function fitAndScore(train: Row[], test: Row[], featureNames: ModelSignal[], alpha: number): { rho: number; maeAv: number } | null {
  if (train.length < featureNames.length * 5 || test.length < 5) return null
  const { X, y } = toMatrix(train, featureNames)
  const fit = ridgeFit(X, y, alpha)
  const testX = toMatrix(test, featureNames).X
  const predAv = testX.map((x) => Math.max(0, Math.expm1(predictRidge(fit, x))))
  const actual = test.map((r) => r.av)
  return { rho: spearman(predAv, actual), maeAv: mae(predAv, actual) }
}

// ── Step 1-2: walk-forward alpha search, tuning years only (<=2015) ──────────

const ALPHAS = [0.3, 1, 3, 10, 30, 100, 300]
const TUNE_FOLD_YEARS = Array.from({ length: 2015 - 2007 + 1 }, (_, i) => 2007 + i) // 2007..2015

function tuneAlpha(subset: Row[], featureNames: ModelSignal[], label: string): number {
  let best = { alpha: ALPHAS[0], rho: -Infinity }
  for (const alpha of ALPHAS) {
    const rhos: number[] = []
    for (const foldYear of TUNE_FOLD_YEARS) {
      const train = subset.filter((r) => r.year < foldYear)
      const test  = subset.filter((r) => r.year === foldYear)
      const scored = fitAndScore(train, test, featureNames, alpha)
      if (scored && !isNaN(scored.rho)) rhos.push(scored.rho)
    }
    if (!rhos.length) continue
    const meanRho = rhos.reduce((s, r) => s + r, 0) / rhos.length
    if (meanRho > best.rho) best = { alpha, rho: meanRho }
  }
  console.log(`  [${label}] chosen alpha=${best.alpha}  (mean walk-forward CV rho=${best.rho.toFixed(3)} over ${TUNE_FOLD_YEARS.length} folds, years<=2015 only)`)
  return best.alpha
}

console.log('\n── Tuning ridge alpha (walk-forward CV, years <=2015 only) ──')
const globalAlpha = tuneAlpha(rows, GLOBAL_FEATURES, 'global')
const groupAlphas = {} as Record<Grp, number>
for (const g of GROUPS) {
  const subset = rows.filter((r) => r.grp === g)
  groupAlphas[g] = tuneAlpha(subset, GROUP_FEATURES, g)
}

// ── Step 3: confirmation — train on <=2015, evaluate ONCE on 2016-2020 ───────

console.log('\n── Confirmation (train <=2015, evaluate on untouched 2016-2020) ──')

function confirm(subset: Row[], featureNames: ModelSignal[], alpha: number, label: string) {
  const train = subset.filter((r) => r.year <= 2015)
  const test  = subset.filter((r) => r.year >= 2016 && r.year <= 2020)
  const scored = fitAndScore(train, test, featureNames, alpha)
  if (!scored) { console.log(`  [${label}] insufficient data (train=${train.length} test=${test.length})`); return }
  console.log(`  [${label}] n_train=${train.length} n_test=${test.length}  rho=${scored.rho.toFixed(3)}  MAE=${scored.maeAv.toFixed(1)}`)
}

confirm(rows, GLOBAL_FEATURES, globalAlpha, 'global')
for (const g of GROUPS) confirm(rows.filter((r) => r.grp === g), GROUP_FEATURES, groupAlphas[g], g)

// Compare against the pick-only baseline AND the currently-deployed full scoring
// pipeline (comps + rawScore + old hand-fit calibratedAvModel), on the exact same
// confirmation rows, for an apples-to-apples read.
{
  const test = rows.filter((r) => r.year >= 2016 && r.year <= 2020)
  const actual = test.map((r) => r.av)
  const pickOnlyScore = test.map((r) => 100 * Math.pow(1 - (r.pick - 1) / 259, 0.58))
  const currentModelScore = test.map((r) => r.currentModelScore)
  console.log(`  [pick-only]         rho=${spearman(pickOnlyScore, actual).toFixed(3)}`)
  console.log(`  [current production] rho=${spearman(currentModelScore, actual).toFixed(3)}  (full pipeline: comps+rawScore+old calibratedAvModel, same rows)`)
}

// ── Step 4: final refit on ALL mature data (per compCutoffForGroup), for shipping ──

console.log('\n── Final refit on all mature data (this is what ships) ──')

function buildModel(subset: Row[], featureNames: ModelSignal[], alpha: number): CalibrationModel {
  const { X, y } = toMatrix(subset, featureNames)
  const fit: FittedRidge = ridgeFit(X, y, alpha)
  return {
    intercept: fit.intercept,
    features: featureNames.map((name, i) => ({ name, coef: fit.coefs[i], mean: fit.means[i], sd: fit.sds[i] })),
  }
}

const globalMature = rows.filter((r) => r.year <= (compCutoffForGroup[r.grp] ?? 2021))
const finalGlobal = buildModel(globalMature, GLOBAL_FEATURES, globalAlpha)

const finalPerGroup: Partial<Record<Grp, CalibrationModel>> = {}
for (const g of GROUPS) {
  const cutoff = compCutoffForGroup[g] ?? 2021
  const subset = rows.filter((r) => r.grp === g && r.year <= cutoff)
  if (subset.length < GROUP_FEATURES.length * 8) {
    console.log(`  [${g}] too little mature data (n=${subset.length}) -- falling back to global model in production`)
    continue
  }
  finalPerGroup[g] = buildModel(subset, GROUP_FEATURES, groupAlphas[g])
  console.log(`  [${g}] fit on n=${subset.length} (year<=${cutoff}), alpha=${groupAlphas[g]}`)
}

const finalSet: CalibrationModelSet = { global: finalGlobal, ...finalPerGroup }

// ── Emit as TS source ─────────────────────────────────────────────────────────

function fmtModel(m: CalibrationModel, indent = '  '): string {
  const feats = m.features.map((f) => `${indent}  { name: '${f.name}', coef: ${f.coef}, mean: ${f.mean}, sd: ${f.sd} },`).join('\n')
  return `{\n${indent}  intercept: ${m.intercept},\n${indent}  features: [\n${feats}\n${indent}  ],\n${indent}}`
}

const lines: string[] = []
lines.push('// AUTO-GENERATED by scripts/fit-calibration-model.mts -- do not hand-edit.')
lines.push('// Walk-forward CV confirmation numbers (train <=2015, test 2016-2020) are logged')
lines.push('// by the fitting script; see git history / commit message for the values at fit time.')
lines.push(`import type { CalibrationModelSet } from './model.ts'`)
lines.push('')
lines.push('export const fittedCalibrationModels: CalibrationModelSet = {')
lines.push(`  global: ${fmtModel(finalGlobal)},`)
for (const g of GROUPS) {
  if (finalPerGroup[g]) lines.push(`  ${g}: ${fmtModel(finalPerGroup[g]!)},`)
}
lines.push('}')

const fs = await import('node:fs')
const outPath = new URL('../src/fittedCalibrationModels.ts', import.meta.url)
fs.writeFileSync(outPath, lines.join('\n') + '\n')
console.log(`\nWrote ${outPath.pathname}`)
