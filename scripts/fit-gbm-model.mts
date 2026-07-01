#!/usr/bin/env node
// Phase 2: fit gradient-boosted regression trees on the exact same walk-forward
// training rows as scripts/fit-calibration-model.mts (via scripts/lib/training-rows.mts)
// and compare directly against the already-shipped ridge models on the same untouched
// 2016-2020 confirmation window. This is a go/no-go trial, not an assumed upgrade --
// GBM adds real complexity (tree JSON + a JS evaluator in model.ts, a new class of
// train/inference bug to guard against) and should only ship if it clearly wins.
//
// Methodology mirrors fit-calibration-model.mts:
//   1. Tune hyperparameters via walk-forward CV restricted to years <=2015 only.
//      numTrees is evaluated via checkpointing (one fit up to MAX_TREES records CV
//      metrics at every checkpoint tree count, since boosting is additive) --
//      maxDepth and learningRate are grid-searched.
//   2. With chosen params, fit on years <=2015 and evaluate ONCE on 2016-2020.
//   3. Compare that confirmation number directly against the ridge confirmation
//      numbers already reported by fit-calibration-model.mts, plus pick-only and
//      current production, on the SAME rows.
//
// RESULT (see chat/PR for the run this recorded): NO-GO. On the 2016-2020 confirmation
// window, GBM's rank correlation (rho) was slightly WORSE than ridge in every single
// position group -- global 0.611 vs ridge 0.618, QB 0.716 vs 0.725, SKILL 0.628 vs
// 0.636, OL 0.562 vs 0.587, FRONT 0.591 vs 0.607, DB 0.515 vs 0.525. A follow-up wider
// grid search on the global model (depth up to 5, up to 500 trees, learning rates up
// to 0.2) never exceeded rho=0.616 -- more capacity consistently made it worse
// (overfitting on training sets this small; QB alone is ~260 rows). GBM did produce
// tighter AV calibration (MAE/bias) in several groups, but rank quality is the primary
// metric this tool needs and ridge already wins there. NOT wired into production --
// this script and scripts/lib/gbm.mts are kept as a documented, reproducible negative
// result so a future session doesn't have to redo this trial from scratch.
//
// Usage: node --experimental-strip-types scripts/fit-gbm-model.mts

import { compCutoffForGroup } from '../src/model.ts'
import type { ModelSignal } from '../src/model.ts'
import { loadEvalData, spearman, mae, bias as computeBias } from './lib/eval-data.mts'
import { fitGbm, predictGbm, type GbmModel, type GbmParams } from './lib/gbm.mts'
import { buildTrainingRows, GROUP_FEATURES, GLOBAL_FEATURES, GROUPS, type Grp, type TrainingRow as Row } from './lib/training-rows.mts'

const DATA = new URL('../public/data/', import.meta.url).pathname

console.log('Loading data...')
const evalData = loadEvalData(DATA)
console.log('Computing walk-forward features (shared with fit-calibration-model.mts)...')
const rows: Row[] = buildTrainingRows(evalData, 2000, 2020, (done, total) => process.stdout.write(`  ${done}/${total}\r`))
console.log(`  ${rows.length} rows done`)

function toMatrix(subset: Row[], featureNames: ModelSignal[]): { X: number[][]; y: number[] } {
  return {
    X: subset.map((r) => featureNames.map((f) => r.features[f])),
    y: subset.map((r) => Math.log1p(Math.max(0, r.av))),
  }
}

// Same retransformation-bias fix as ridge (see fit-calibration-model.mts) -- applies to
// any log1p/expm1-target model regardless of the underlying function class. Computed
// fresh per checkpoint tree count since residuals change as trees are added.
function smearingCorrect(model: GbmModel, trainX: number[][], trainY: number[]): GbmModel {
  const residuals = trainX.map((x, i) => trainY[i] - predictGbm(model, x))
  const smearLog = Math.log(residuals.reduce((s, r) => s + Math.exp(r), 0) / residuals.length)
  return { ...model, initialValue: model.initialValue + smearLog }
}

function evalModel(model: GbmModel, trainX: number[][], trainY: number[], testX: number[][], testActualAv: number[]) {
  const corrected = smearingCorrect(model, trainX, trainY)
  const predAv = testX.map((x) => Math.max(0, Math.expm1(predictGbm(corrected, x))))
  return { rho: spearman(predAv, testActualAv), maeAv: mae(predAv, testActualAv), biasAv: computeBias(predAv, testActualAv) }
}

// ── Hyperparameter grid ────────────────────────────────────────────────────────

const DEPTHS = [2, 3]
const LEARNING_RATES = [0.03, 0.1]
const MAX_TREES = 200
const CHECKPOINTS = [25, 50, 100, 150, 200]
const MIN_LEAF_SIZE = 8
const ROW_SUBSAMPLE = 0.7
const COL_SUBSAMPLE = 0.8
const BIAS_PENALTY = 0.006   // same objective shape as the ridge alpha search

const TUNE_FOLD_YEARS = Array.from({ length: 2015 - 2007 + 1 }, (_, i) => 2007 + i) // 2007..2015

type ParamCandidate = GbmParams & { key: string }

function candidates(): ParamCandidate[] {
  const out: ParamCandidate[] = []
  for (const maxDepth of DEPTHS) {
    for (const learningRate of LEARNING_RATES) {
      out.push({
        numTrees: MAX_TREES, maxDepth, learningRate, minLeafSize: MIN_LEAF_SIZE,
        rowSubsample: ROW_SUBSAMPLE, colSubsample: COL_SUBSAMPLE,
        key: `depth=${maxDepth},lr=${learningRate}`,
      })
    }
  }
  return out
}

function tuneParams(subset: Row[], featureNames: ModelSignal[], label: string): { params: GbmParams; numTrees: number } {
  // score[key][numTrees] -> {rhoSum, biasSum, n}
  const agg = new Map<string, Map<number, { rhoSum: number; biasSum: number; n: number }>>()

  for (const cand of candidates()) {
    const byTrees = new Map<number, { rhoSum: number; biasSum: number; n: number }>()
    for (const foldYear of TUNE_FOLD_YEARS) {
      const train = subset.filter((r) => r.year < foldYear)
      const test  = subset.filter((r) => r.year === foldYear)
      if (train.length < featureNames.length * 8 || test.length < 5) continue
      const { X: trainX, y: trainY } = toMatrix(train, featureNames)
      const { X: testX } = toMatrix(test, featureNames)
      const testActualAv = test.map((r) => r.av)
      fitGbm(trainX, trainY, cand, (treeIndex, modelSoFar) => {
        const numTrees = treeIndex + 1
        if (!CHECKPOINTS.includes(numTrees)) return
        const scored = evalModel(modelSoFar, trainX, trainY, testX, testActualAv)
        if (isNaN(scored.rho)) return
        if (!byTrees.has(numTrees)) byTrees.set(numTrees, { rhoSum: 0, biasSum: 0, n: 0 })
        const a = byTrees.get(numTrees)!
        a.rhoSum += scored.rho; a.biasSum += scored.biasAv; a.n++
      })
    }
    agg.set(cand.key, byTrees)
  }

  let best = { key: '', numTrees: CHECKPOINTS[0], score: -Infinity, rho: 0, biasAv: 0 }
  for (const cand of candidates()) {
    const byTrees = agg.get(cand.key)!
    for (const numTrees of CHECKPOINTS) {
      const a = byTrees.get(numTrees)
      if (!a || a.n === 0) continue
      const meanRho = a.rhoSum / a.n
      const meanBias = a.biasSum / a.n
      const score = meanRho - BIAS_PENALTY * Math.abs(meanBias)
      if (score > best.score) best = { key: cand.key, numTrees, score, rho: meanRho, biasAv: meanBias }
    }
  }

  console.log(`  [${label}] chosen ${best.key},numTrees=${best.numTrees}  (mean CV rho=${best.rho.toFixed(3)}, mean CV bias=${best.biasAv.toFixed(1)} AV, over ${TUNE_FOLD_YEARS.length} folds, years<=2015 only)`)
  const [depthStr, lrStr] = best.key.split(',')
  const maxDepth = parseInt(depthStr.split('=')[1])
  const learningRate = parseFloat(lrStr.split('=')[1])
  return { params: { numTrees: best.numTrees, maxDepth, learningRate, minLeafSize: MIN_LEAF_SIZE, rowSubsample: ROW_SUBSAMPLE, colSubsample: COL_SUBSAMPLE }, numTrees: best.numTrees }
}

console.log('\n── Tuning GBM hyperparameters (walk-forward CV, years <=2015 only) ──')
const globalTuned = tuneParams(rows, GLOBAL_FEATURES, 'global')
const groupTuned = {} as Record<Grp, { params: GbmParams; numTrees: number }>
for (const g of GROUPS) {
  groupTuned[g] = tuneParams(rows.filter((r) => r.grp === g), GROUP_FEATURES, g)
}

// ── Confirmation: train <=2015, evaluate ONCE on untouched 2016-2020 ──────────

console.log('\n── Confirmation (train <=2015, evaluate on untouched 2016-2020) ──')

function confirm(subset: Row[], featureNames: ModelSignal[], tuned: { params: GbmParams }, label: string) {
  const train = subset.filter((r) => r.year <= 2015)
  const test  = subset.filter((r) => r.year >= 2016 && r.year <= 2020)
  if (train.length < featureNames.length * 8 || test.length < 5) { console.log(`  [${label}] insufficient data`); return }
  const { X: trainX, y: trainY } = toMatrix(train, featureNames)
  const { X: testX } = toMatrix(test, featureNames)
  const testActualAv = test.map((r) => r.av)
  const model = fitGbm(trainX, trainY, tuned.params)
  const scored = evalModel(model, trainX, trainY, testX, testActualAv)
  console.log(`  [${label}] n_train=${train.length} n_test=${test.length}  rho=${scored.rho.toFixed(3)}  MAE=${scored.maeAv.toFixed(1)}  bias=${scored.biasAv.toFixed(1)}`)
}

confirm(rows, GLOBAL_FEATURES, globalTuned, 'global (GBM)')
for (const g of GROUPS) confirm(rows.filter((r) => r.grp === g), GROUP_FEATURES, groupTuned[g], `${g} (GBM)`)

{
  const test = rows.filter((r) => r.year >= 2016 && r.year <= 2020)
  const actual = test.map((r) => r.av)
  const pickOnlyScore = test.map((r) => 100 * Math.pow(1 - (r.pick - 1) / 259, 0.58))
  const currentModelScore = test.map((r) => r.currentModelScore)
  console.log(`  [pick-only]          rho=${spearman(pickOnlyScore, actual).toFixed(3)}`)
  console.log(`  [current production] rho=${spearman(currentModelScore, actual).toFixed(3)}  (full pipeline, same rows)`)
  console.log(`  (ridge confirmation numbers are reported by fit-calibration-model.mts on these same rows -- compare against its most recent run)`)
}
