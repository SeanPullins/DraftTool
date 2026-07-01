#!/usr/bin/env node
// Evaluation harness for src/model.ts
// Runs time-split backtests on historical players and computes:
//   Spearman ρ, MAE, RMSE, signed bias, confusion matrix, calibration, signal ablation
//
// Usage:
//   node --experimental-strip-types scripts/evaluate-model.mts
//   node --experimental-strip-types scripts/evaluate-model.mts --pos WR
//   node --experimental-strip-types scripts/evaluate-model.mts --year-max 2016
//   node --experimental-strip-types scripts/evaluate-model.mts --ablation
//   node --experimental-strip-types scripts/evaluate-model.mts --verbose
//   node --experimental-strip-types scripts/evaluate-model.mts --walk-forward
//
// Walk-forward mode (--walk-forward):
//   For each player drafted in year Y, the comp pool is restricted to years < Y
//   AND pff profiles are restricted to draftSeason < Y. preDraft mode disables
//   NFL-outcome weighting in pffSim (tierWeight/snapBoost/experienceBonus = 1.0).
//   Calibration coefficients are still globally trained — label: "quasi-walk-forward".

import { readFileSync } from 'node:fs'
import { clean, project, calibratedExpectedAv, calibratedExpectedAvFromModel, matureOutcomeCutoff, outcomeOrder, group } from '../src/model.ts'
import type { Historical, Prospect, Category, ProjectOpts, QbTrajectoryLabel } from '../src/model.ts'
import {
  toProspect, loadEvalData, getRas, computeSlotBaselines, getSlotBaseline,
  spearman, mae, rmse, bias, bootstrapCI, median, fmt, fmtBias,
  KNOWN_POSITIONS, positionDefaults,
} from './lib/eval-data.mts'

// ── CLI flags ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const filterPos            = args.includes('--pos')                     ? args[args.indexOf('--pos')                     + 1] : null
const yearMax              = args.includes('--year-max')                ? parseInt(args[args.indexOf('--year-max')         + 1]) : matureOutcomeCutoff - 3
const verbose              = args.includes('--verbose')
const doAblation           = args.includes('--ablation')
const walkForward          = args.includes('--walk-forward')
const doQbTrajectoryAblation = args.includes('--qb-trajectory-ablation')

// ── Data paths ────────────────────────────────────────────────────────────────

const DATA = new URL('../public/data/', import.meta.url).pathname

// ── Load data ─────────────────────────────────────────────────────────────────

process.stdout.write('Loading data... ')

const { pool, pffProfiles, pffByKey, rasLookup, rasRowCount, qbPffSeasons, y1NflStats } = loadEvalData(DATA)

// NOTE: this used to load public/data/calibration_models.json (a set of per-draft-year
// refits from the old, now-removed scripts/fit-calibration-models.py) and thread a
// different calibration model per evaluation year through walk-forward mode. That file
// used a stale, mismatched feature set (no athletic/size) and was never what production
// actually runs -- App.tsx never loaded it either. Production always calls project()
// with calibModels=null and gets whatever project() defaults to internally
// (src/fittedCalibrationModels.ts, walk-forward-CV-fit -- see scripts/fit-calibration-model.mts).
// Passing null everywhere below makes this harness test that actual default instead of
// a parallel, unused calibration path.

const y1NflTotal = y1NflStats.qb.length + y1NflStats.wr.length + y1NflStats.rb.length + y1NflStats.te.length
console.log(`  qb_pff=${qbPffSeasons.length} y1_nfl=${y1NflTotal} ras=${rasRowCount}`)

console.log(`✓  pool=${pool.length} pff=${pffProfiles.length} ras=${rasRowCount}`)

// Pre-compute true walk-forward slot baselines for each eval year (Phase 1).
// For year Y, baselines are trained on pool players with year < Y — no leakage.
const yearSlotBaselines = new Map<number, Map<string, number>>()
if (walkForward) {
  const evalYears = [...new Set(pool.filter((p) => p.year >= 2000 && p.year <= yearMax).map((p) => p.year))].sort((a, b) => a - b)
  for (const y of evalYears) {
    const trainRows = pool.filter((p) => p.year < y && p.year >= 2000)
    yearSlotBaselines.set(y, computeSlotBaselines(trainRows))
  }
} else {
  // Non-WF: use the full pool as baseline (honest only for global eval, not per-player)
  yearSlotBaselines.set(0, computeSlotBaselines(pool.filter((p) => p.year >= 2000 && p.year <= yearMax)))
}

// ── Run evaluation ────────────────────────────────────────────────────────────

type EvalRow = {
  player:       Historical
  prospect:     Prospect
  projScore:    number
  projAv:       number
  projFloor:    number
  projMedian:   number
  projCeiling:  number
  projCategory: Category   // argmax of odds
  actualAv:     number
  actualCategory: Category
  hasPff:          boolean
  hasOfficialRas:  boolean
  trueWfPickAv: number   // pick-only AV from position-group baselines trained on prior years
  slotBaseline: number   // expected AV for this pick range × position group
  hasQbTrajectory: boolean
  trajectoryLabel: QbTrajectoryLabel | null
  trajectoryScoreMoved: number  // how much the trajectory adj moved the score (for miss analysis)
}

const evalSet = pool.filter((p) =>
  p.year >= 2000 && p.year <= yearMax && p.pick < 260 &&
  KNOWN_POSITIONS.has(p.pos) && (!filterPos || p.pos === filterPos)
)

const modeLabel = walkForward ? ' walk-forward' : ''
console.log(`Evaluating ${evalSet.length} players (year ≤ ${yearMax}${filterPos ? `, pos=${filterPos}` : ''}${modeLabel})...`)

const results: EvalRow[] = []
let done = 0
const start = Date.now()

for (const player of evalSet) {
  const pff      = pffByKey.get(`${clean(player.name)}|${player.year}`)
  const rasRec   = getRas(player.name, player.year, player.pos, rasLookup)
  const prospect = toProspect(player, qbPffSeasons, pff, rasRec)
  // Walk-forward: restrict BOTH comp pool and pff profiles to prior years only.
  // preDraft=true disables tierWeight/snapBoost/experienceBonus in pffSim so comp
  // selection is based purely on pre-draft signals, not known NFL outcomes.
  const evalPool       = walkForward ? pool.filter((p) => p.year < player.year) : pool
  const evalPffProfiles = walkForward ? pffProfiles.filter((p) => p.draftSeason < player.year) : pffProfiles
  // calibModels=null -> project() uses its real production default (see note above).
  const proj           = project(prospect, evalPool, evalPffProfiles, player.id, undefined, undefined, undefined, prospect.qbTrajectory?.gradeDelta ?? null, walkForward, undefined, y1NflStats, null)

  // Predicted category = highest-odds outcome
  const projCategory = outcomeOrder.reduce((best, cat) =>
    (proj.odds[cat] ?? 0) > (proj.odds[best] ?? 0) ? cat : best
  , outcomeOrder[0])

  const posGroup = group[player.pos] ?? 'SKILL'
  const slotBL   = walkForward
    ? getSlotBaseline(yearSlotBaselines.get(player.year) ?? new Map(), posGroup, player.pick)
    : getSlotBaseline(yearSlotBaselines.get(0) ?? new Map(), posGroup, player.pick)
  // True WF pick-only AV: slot baseline computed from prior-year data only (no model signals)
  const trueWfPickAv = slotBL

  const traj = prospect.qbTrajectory ?? null
  // Compute how much the trajectory signal moved the score (for miss analysis)
  let trajectoryScoreMoved = 0
  if (traj != null && traj.gradeDelta != null) {
    const projNoTraj = project(prospect, evalPool, evalPffProfiles, player.id, undefined, undefined, undefined, null, walkForward, undefined, y1NflStats, null)
    trajectoryScoreMoved = proj.score - projNoTraj.score
  }

  results.push({
    player, prospect,
    projScore:    proj.score,
    projAv:       proj.expectedAv,
    projFloor:    proj.floor,
    projMedian:   proj.median,
    projCeiling:  proj.ceiling,
    projCategory,
    actualAv:     player.av,
    actualCategory: player.category,
    hasPff:          !!pff,
    hasOfficialRas:  !!(rasRec?.ras != null),
    hasQbTrajectory: !!traj,
    trajectoryLabel: traj?.trajectoryLabel ?? null,
    trajectoryScoreMoved,
    trueWfPickAv,
    slotBaseline: slotBL,
  })

  done++
  if (done % 200 === 0) {
    process.stdout.write(`  ${done}/${evalSet.length} (${((Date.now() - start) / 1000).toFixed(1)}s)\r`)
  }
}

console.log(`  Done in ${((Date.now() - start) / 1000).toFixed(1)}s                    `)

// ── Core metrics helper ───────────────────────────────────────────────────────

type Metrics = { rho: number; maeAv: number; rmseAv: number; biasAv: number; n: number; medAv: number }

function metrics(rows: EvalRow[]): Metrics {
  if (rows.length < 3) return { rho: NaN, maeAv: NaN, rmseAv: NaN, biasAv: NaN, n: rows.length, medAv: NaN }
  const scores  = rows.map((r) => r.projScore)
  const projAvs = rows.map((r) => r.projAv)
  const actuals = rows.map((r) => r.actualAv)
  return {
    rho:    spearman(scores, actuals),
    maeAv:  mae(projAvs, actuals),
    rmseAv: rmse(projAvs, actuals),
    biasAv: bias(projAvs, actuals),
    n:      rows.length,
    medAv:  median(actuals),
  }
}

// ── 1. OVERALL & BREAKDOWNS ───────────────────────────────────────────────────

// 3-tier grouping — defined here so it can be used across OVERALL and later sections
function tier(cat: Category): 'Low' | 'Mid' | 'High' {
  if (cat === 'Bust' || cat === 'Reserve') return 'Low'
  if (cat === 'Role' || cat === 'Starter') return 'Mid'
  return 'High'  // High-end starter, Star
}

console.log('\n══════════════════════════════════════════════════════════════')
console.log(` OVERALL${walkForward ? '  [quasi-walk-forward: comps+PFF time-filtered, calibration coefs static]' : ''}`)
console.log('══════════════════════════════════════════════════════════════')
const overall = metrics(results)
const [ciLo, ciHi] = bootstrapCI(results.map((r) => r.projScore), results.map((r) => r.actualAv))
console.log(`  Full model  n=${overall.n}  ρ=${fmt(overall.rho)}  [95% CI ${fmt(ciLo)}–${fmt(ciHi)}]  MAE=${fmt(overall.maeAv, 1)}  RMSE=${fmt(overall.rmseAv, 1)}  bias=${fmtBias(overall.biasAv)} AV`)

// Pick-only baseline: draft capital alone, plus calibrated AV from pick
const pickScores   = results.map((r) => 100 * Math.pow(1 - (r.player.pick - 1) / 259, 0.58))
const pickAvs      = results.map((r) => {
  const draft = 100 * Math.pow(1 - (r.player.pick - 1) / 259, 0.58)
  return calibratedExpectedAv(r.prospect, { draft, athletic: 50, size: 50, age: 50 })
})
const actuals      = results.map((r) => r.actualAv)
const pickRho      = spearman(pickScores, actuals)
const pickMae      = mae(pickAvs, actuals)
const pickRmse     = rmse(pickAvs, actuals)
const pickBias     = bias(pickAvs, actuals)
const [pkCiLo, pkCiHi] = bootstrapCI(pickScores, actuals)
console.log(`  Pick-only   n=${overall.n}  ρ=${fmt(pickRho)}  [95% CI ${fmt(pkCiLo)}–${fmt(pkCiHi)}]  MAE=${fmt(pickMae, 1)}  RMSE=${fmt(pickRmse, 1)}  bias=${fmtBias(pickBias)} AV`)
if (walkForward) {
  const trueWfAvs = results.map((r) => r.trueWfPickAv)
  const trueWfRho = spearman(results.map((r) => r.trueWfPickAv), actuals)
  const trueWfMae = mae(trueWfAvs, actuals)
  const trueWfRmse = rmse(trueWfAvs, actuals)
  const trueWfBias = bias(trueWfAvs, actuals)
  console.log(`  TrueWF pk-only n=${overall.n}  ρ=${fmt(trueWfRho)}  MAE=${fmt(trueWfMae, 1)}  RMSE=${fmt(trueWfRmse, 1)}  bias=${fmtBias(trueWfBias)} AV  (pos-group×pick baselines from prior years)`)
}
const rhoLift = overall.rho - pickRho
const maeLift = pickMae - overall.maeAv
const rmseLift = pickRmse - overall.rmseAv
console.log(`  Model lift        Δρ=${rhoLift >= 0 ? '+' : ''}${fmt(rhoLift)}  ΔMAE=${maeLift >= 0 ? '+' : ''}${fmt(maeLift, 1)}  ΔRMSE=${rmseLift >= 0 ? '+' : ''}${fmt(rmseLift, 1)}`)

console.log('\n── By position (model vs pick-only lift) ─────────────────')
const byPos: Record<string, EvalRow[]> = {}
for (const r of results) (byPos[r.player.pos] ??= []).push(r)
const posPickScoresMap = new Map<string, { pickRhos: number[]; pickAvs_: number[]; actuals_: number[] }>()
for (const pos of ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S']) {
  const rows = byPos[pos]
  if (!rows || rows.length < 5) continue
  const m = metrics(rows)
  const pScores = rows.map((r) => 100 * Math.pow(1 - (r.player.pick - 1) / 259, 0.58))
  const pAvs    = rows.map((r) => { const d = 100 * Math.pow(1 - (r.player.pick - 1) / 259, 0.58); return calibratedExpectedAv(r.prospect, { draft: d, athletic: 50, size: 50, age: 50 }) })
  const acts    = rows.map((r) => r.actualAv)
  const pRho    = spearman(pScores, acts)
  const pMae    = mae(pAvs, acts)
  const dRho    = m.rho - pRho
  const dMae    = pMae - m.maeAv
  const dRhoStr = (dRho >= 0 ? '+' : '') + fmt(dRho)
  const dMaeStr = (dMae >= 0 ? '+' : '') + fmt(dMae, 1)
  const liftTag = dRho < -0.02 ? ' ⚠ below pk-only' : ''
  console.log(`  ${pos.padEnd(3)} n=${String(m.n).padStart(3)}  ρ=${fmt(m.rho)} (pk:${fmt(pRho)} Δ${dRhoStr})  MAE=${fmt(m.maeAv, 1)} (ΔM ${dMaeStr})  bias=${fmtBias(m.biasAv)}${liftTag}`)
  posPickScoresMap.set(pos, { pickRhos: pScores, pickAvs_: pAvs, actuals_: acts })
}

const pickRanges = [
  { label: 'Rd 1  (1-32)',     lo: 1,   hi: 32  },
  { label: 'Rd 2  (33-64)',    lo: 33,  hi: 64  },
  { label: 'Rd 3  (65-100)',   lo: 65,  hi: 100 },
  { label: 'Rd 4-5 (101-160)', lo: 101, hi: 160 },
  { label: 'Rd 6-7 (161+)',    lo: 161, hi: 999 },
]
console.log('\n── By pick range (with signed bias) ──────────────────────────')
for (const { label, lo, hi } of pickRanges) {
  const rows = results.filter((r) => r.player.pick >= lo && r.player.pick <= hi)
  if (rows.length < 5) continue
  const m = metrics(rows)
  console.log(`  ${label.padEnd(22)} n=${String(m.n).padStart(3)}  ρ=${fmt(m.rho)}  MAE=${fmt(m.maeAv, 1)}  bias=${fmtBias(m.biasAv)}`)
}

const withPff    = results.filter((r) => r.hasPff)
const withoutPff = results.filter((r) => !r.hasPff)
if (withPff.length >= 10 && withoutPff.length >= 10) {
  console.log('\n── PFF data availability ─────────────────────────────────────')
  const mp = metrics(withPff), mn = metrics(withoutPff)
  console.log(`  With PFF    n=${String(mp.n).padStart(3)}  ρ=${fmt(mp.rho)}  MAE=${fmt(mp.maeAv, 1)}  bias=${fmtBias(mp.biasAv)}`)
  console.log(`  Without PFF n=${String(mn.n).padStart(3)}  ρ=${fmt(mn.rho)}  MAE=${fmt(mn.maeAv, 1)}  bias=${fmtBias(mn.biasAv)}`)
}

console.log('\n── By draft year ─────────────────────────────────────────────')
const yearBands = [
  { label: '2000-2006', lo: 2000, hi: 2006 },
  { label: '2007-2012', lo: 2007, hi: 2012 },
  { label: '2013-2018', lo: 2013, hi: 2018 },
  { label: `2019-${yearMax}`, lo: 2019, hi: yearMax },
]
for (const { label, lo, hi } of yearBands) {
  const rows = results.filter((r) => r.player.year >= lo && r.player.year <= hi)
  if (rows.length < 5) continue
  const m = metrics(rows)
  console.log(`  ${label.padEnd(12)} n=${String(m.n).padStart(3)}  ρ=${fmt(m.rho)}  MAE=${fmt(m.maeAv, 1)}  bias=${fmtBias(m.biasAv)}`)
}

// ── MODEL JOB BREAKDOWN ───────────────────────────────────────────────────────

console.log('\n── Model job breakdown ───────────────────────────────────')
console.log('  ┌ Rank quality     ρ=' + fmt(overall.rho) + '  (full model score vs actualAV)')
const actualHighBkd  = results.filter((r) => tier(r.actualCategory) === 'High')
const hiRecallBkd    = actualHighBkd.length ? actualHighBkd.filter((r) => tier(r.projCategory) === 'High').length / actualHighBkd.length : NaN
const predLowBkd     = results.filter((r) => tier(r.projCategory) === 'Low')
const bustPrecBkd    = predLowBkd.length ? predLowBkd.filter((r) => tier(r.actualCategory) === 'Low').length / predLowBkd.length : NaN
console.log('  ├ AV calibration  MAE=' + fmt(overall.maeAv, 1) + '  RMSE=' + fmt(overall.rmseAv, 1) + '  bias=' + fmtBias(overall.biasAv))
console.log('  ├ Star/HES recall ' + (hiRecallBkd * 100).toFixed(1) + '%  (actual High → predicted High,  n=' + actualHighBkd.length + ')')
console.log('  └ Bust precision  ' + (bustPrecBkd * 100).toFixed(1) + '%  (predicted Low → actual Low,    n=' + predLowBkd.length + ')')

// ── 2. CATEGORY CONFUSION MATRIX ─────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════')
console.log(' CATEGORY CONFUSION MATRIX  (predicted row → actual column)')
console.log('══════════════════════════════════════════════════════════════')

const tiers = ['Low', 'Mid', 'High'] as const
type Tier = typeof tiers[number]

// 3×3 matrix
const confMatrix: Record<Tier, Record<Tier, number>> = {
  Low:  { Low: 0, Mid: 0, High: 0 },
  Mid:  { Low: 0, Mid: 0, High: 0 },
  High: { Low: 0, Mid: 0, High: 0 },
}
for (const r of results) {
  confMatrix[tier(r.projCategory)][tier(r.actualCategory)]++
}

const colW = 8
const hdr = `  ${'Pred \\ Actual'.padEnd(12)} ${'Low'.padStart(colW)} ${'Mid'.padStart(colW)} ${'High'.padStart(colW)}  ${'Total'.padStart(colW)}`
console.log(hdr)
for (const pred of tiers) {
  const row = confMatrix[pred]
  const total = row.Low + row.Mid + row.High
  const pctLow  = total ? (row.Low  / total * 100).toFixed(0) + '%' : '-'
  const pctMid  = total ? (row.Mid  / total * 100).toFixed(0) + '%' : '-'
  const pctHigh = total ? (row.High / total * 100).toFixed(0) + '%' : '-'
  console.log(`  ${'→'+pred.padEnd(11)} ${(row.Low  + ' ('+pctLow+')').padStart(colW)} ${(row.Mid  + ' ('+pctMid+')').padStart(colW)} ${(row.High + ' ('+pctHigh+')').padStart(colW)}  ${String(total).padStart(colW)}`)
}

// Column totals
const actLow  = results.filter((r) => tier(r.actualCategory)  === 'Low').length
const actMid  = results.filter((r) => tier(r.actualCategory)  === 'Mid').length
const actHigh = results.filter((r) => tier(r.actualCategory)  === 'High').length
console.log(`  ${'Actual total'.padEnd(12)} ${String(actLow).padStart(colW)} ${String(actMid).padStart(colW)} ${String(actHigh).padStart(colW)}  ${String(results.length).padStart(colW)}`)

// Category-level accuracy
const correct = results.filter((r) => tier(r.projCategory) === tier(r.actualCategory)).length
console.log(`\n  Tier accuracy: ${correct}/${results.length} = ${(correct / results.length * 100).toFixed(1)}%`)

// High-value recall: how often do actual Stars/HES get predicted High?
const actualHigh  = results.filter((r) => tier(r.actualCategory) === 'High')
const hiRecall    = actualHigh.length ? actualHigh.filter((r) => tier(r.projCategory) === 'High').length / actualHigh.length : NaN
console.log(`  Star/HES recall (actual High → predicted High): ${(hiRecall * 100).toFixed(1)}%  (n=${actualHigh.length})`)

// Bust precision: of "Low" predictions, how many actually busted?
const predLow     = results.filter((r) => tier(r.projCategory) === 'Low')
const bustPrec    = predLow.length ? predLow.filter((r) => tier(r.actualCategory) === 'Low').length / predLow.length : NaN
console.log(`  Bust precision  (predicted Low → actual Low):   ${(bustPrec * 100).toFixed(1)}%  (n=${predLow.length})`)

// ── Build byYear index (used by SLOT VALUE and TOP BOARD sections) ────────────
const byYear: Record<number, EvalRow[]> = {}
for (const r of results) (byYear[r.player.year] ??= []).push(r)

// ── RAS COVERAGE ──────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════')
console.log(' RAS COVERAGE  (official RAS availability in evaluation set)')
console.log('══════════════════════════════════════════════════════════════')

const rasCovPct = (n: number, d: number) => d ? `${(n / d * 100).toFixed(0)}%` : 'N/A'
const rasPresent = results.filter((r) => r.hasOfficialRas).length
console.log(`\n  Overall: ${rasPresent}/${results.length} players have official RAS  (${rasCovPct(rasPresent, results.length)})`)
console.log(`\n  By position:`)
for (const pos of ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S']) {
  const rows = byPos[pos]
  if (!rows?.length) continue
  const cov = rows.filter((r) => r.hasOfficialRas).length
  console.log(`    ${pos.padEnd(3)}  ${String(cov).padStart(4)}/${rows.length}  (${rasCovPct(cov, rows.length)})`)
}
console.log(`\n  By pick range:`)
for (const { label, lo, hi } of pickRanges) {
  const rows = results.filter((r) => r.player.pick >= lo && r.player.pick <= hi)
  const cov  = rows.filter((r) => r.hasOfficialRas).length
  console.log(`    ${label.padEnd(22)}  ${String(cov).padStart(4)}/${rows.length}  (${rasCovPct(cov, rows.length)})`)
}
console.log(`\n  By draft year (sample):`)
const rasYears = Object.entries(byYear).sort((a, b) => Number(a[0]) - Number(b[0]))
for (const [yr, rows] of rasYears.filter((_, i) => i % 3 === 0).slice(0, 12)) {
  const cov = rows.filter((r) => r.hasOfficialRas).length
  console.log(`    ${yr}  ${String(cov).padStart(4)}/${rows.length}  (${rasCovPct(cov, rows.length)})`)
}

// ── RAS LIFT  (compare full model with and without official RAS) ──────────────

console.log('\n══════════════════════════════════════════════════════════════')
console.log(' RAS LIFT  (walk-forward model vs same model with RAS disabled)')
console.log(' Restricted to players that have an official RAS value.')
console.log('══════════════════════════════════════════════════════════════')

const rasSubset = results.filter((r) => r.hasOfficialRas)
if (rasSubset.length >= 30) {
  // Variant A: current model (with official RAS blended in)
  const varAScores  = rasSubset.map((r) => r.projScore)
  const varAActuals = rasSubset.map((r) => r.actualAv)
  const varARho  = spearman(varAScores, varAActuals)
  const varAMae  = mae(rasSubset.map((r) => r.projAv), varAActuals)
  const varABias = bias(rasSubset.map((r) => r.projAv), varAActuals)

  // Variant B: re-run without official RAS for same players
  const rasOffScores: number[] = []
  const rasOffAvs:    number[] = []
  for (const r of rasSubset) {
    const ablPool        = walkForward ? pool.filter((p) => p.year < r.player.year) : pool
    const ablPffProfiles = walkForward ? pffProfiles.filter((p) => p.draftSeason < r.player.year) : pffProfiles
    const proj = project(r.prospect, ablPool, ablPffProfiles, r.player.id, undefined, undefined, undefined, undefined, walkForward, { disableOfficialRas: true }, y1NflStats, null)
    rasOffScores.push(proj.score)
    rasOffAvs.push(proj.expectedAv)
  }
  const varBRho  = spearman(rasOffScores, varAActuals)
  const varBMae  = mae(rasOffAvs, varAActuals)
  const varBBias = bias(rasOffAvs, varAActuals)

  const dsign = (d: number) => (d >= 0 ? '+' : '') + d.toFixed(3)
  console.log(`\n  Players with official RAS: n=${rasSubset.length}`)
  console.log(`\n  ${'Variant'.padEnd(22)} ${'ρ'.padStart(7)} ${'MAE'.padStart(7)} ${'bias'.padStart(8)}`)
  console.log(`  ${'With official RAS'.padEnd(22)} ${fmt(varARho).padStart(7)} ${varAMae.toFixed(1).padStart(7)} ${(varABias >= 0 ? '+' : '') + varABias.toFixed(1).padStart(7)} AV`)
  console.log(`  ${'Without official RAS'.padEnd(22)} ${fmt(varBRho).padStart(7)} ${varBMae.toFixed(1).padStart(7)} ${(varBBias >= 0 ? '+' : '') + varBBias.toFixed(1).padStart(7)} AV`)
  const dRho = varARho - varBRho
  const dMae = varAMae - varBMae
  console.log(`  ${'RAS Δ (with − without)'.padEnd(22)} ${dsign(dRho).padStart(7)} ${(dMae >= 0 ? '+' : '') + dMae.toFixed(1).padStart(7)}`)
  console.log(`\n  Positive Δρ = RAS helps ranking; positive ΔMAE = RAS hurts AV calibration.`)

  // By position
  console.log(`\n  By position:`)
  console.log(`  ${'Pos'.padEnd(4)} ${'n'.padStart(5)} ${'ρ(+RAS)'.padStart(9)} ${'ρ(−RAS)'.padStart(9)} ${'Δρ'.padStart(7)} ${'MAE(+)'.padStart(8)} ${'MAE(-)'.padStart(8)} ${'ΔMAE'.padStart(7)}`)
  let rasIdx = 0
  for (const pos of ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S']) {
    const posRows = rasSubset.filter((r) => r.player.pos === pos)
    if (posRows.length < 10) continue
    const posScores = posRows.map((r) => r.projScore)
    const posActuals = posRows.map((r) => r.actualAv)
    const posRhoA = spearman(posScores, posActuals)
    const posMaeA = mae(posRows.map((r) => r.projAv), posActuals)
    // Get the corresponding rasOff scores for this position subset
    // We need to map posRows back to indices in rasSubset
    const posOffScores: number[] = []
    const posOffAvs: number[]    = []
    for (const r of posRows) {
      const idx = rasSubset.indexOf(r)
      posOffScores.push(rasOffScores[idx])
      posOffAvs.push(rasOffAvs[idx])
    }
    const posRhoB = spearman(posOffScores, posActuals)
    const posMaeB = mae(posOffAvs, posActuals)
    const posSign = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(3)
    const dMaeSign = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(1)
    console.log(`  ${pos.padEnd(4)} ${String(posRows.length).padStart(5)} ${fmt(posRhoA).padStart(9)} ${fmt(posRhoB).padStart(9)} ${posSign(posRhoA - posRhoB).padStart(7)} ${posMaeA.toFixed(1).padStart(8)} ${posMaeB.toFixed(1).padStart(8)} ${dMaeSign(posMaeA - posMaeB).padStart(7)}`)
  }
} else {
  console.log(`\n  Insufficient players with official RAS for comparison (n=${rasSubset.length} < 30).`)
}

// ── 3. SLOT VALUE DIAGNOSTICS ────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════')
console.log(' SLOT VALUE DIAGNOSTICS  (Phase 3: good/bad pick classification)')
console.log(' slotValueRatio = actualAV / expectedAV-for-slot-position.')
console.log(' goodPick ≥ 1.15×slot  |  badPick ≤ 0.60×slot  |  neutral otherwise')
console.log('══════════════════════════════════════════════════════════════')

// Attach slot labels to results
type SlotLabel = 'good' | 'neutral' | 'bad'
function slotLabel(r: EvalRow): SlotLabel {
  if (r.slotBaseline <= 0) return 'neutral'
  const ratio = r.actualAv / r.slotBaseline
  return ratio >= 1.15 ? 'good' : ratio <= 0.60 ? 'bad' : 'neutral'
}

function slotStats(rows: EvalRow[]): string {
  if (!rows.length) return 'n/a'
  const good    = rows.filter((r) => slotLabel(r) === 'good').length
  const bad     = rows.filter((r) => slotLabel(r) === 'bad').length
  const neutral = rows.length - good - bad
  return `goodPick=${(good / rows.length * 100).toFixed(0)}%  neutral=${(neutral / rows.length * 100).toFixed(0)}%  badPick=${(bad / rows.length * 100).toFixed(0)}%`
}

console.log('\n  Overall:  ' + slotStats(results))
console.log('\n  By position:')
for (const pos of ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S']) {
  const rows = byPos[pos]
  if (!rows || rows.length < 5) continue
  console.log(`    ${pos.padEnd(3)}  ${slotStats(rows)}`)
}
console.log('\n  By pick range:')
for (const { label, lo, hi } of pickRanges) {
  const rows = results.filter((r) => r.player.pick >= lo && r.player.pick <= hi)
  if (rows.length < 5) continue
  console.log(`    ${label.padEnd(22)}  ${slotStats(rows)}`)
}

// Model top-32/64 board: what fraction are good picks?
console.log('\n  Top-board slot value (per-year top-N sorted by projScore):')
console.log(`  ${'Top-N'.padEnd(8)} ${'Model good%'.padStart(12)} ${'Model bad%'.padStart(11)} ${'Pick-only good%'.padStart(16)} ${'Oracle good%'.padStart(13)}`)
const svYears = Object.entries(byYear)
for (const boardSz of [32, 64, 100]) {
  let mGood = 0, mBad = 0, mTotal = 0, pkGood = 0, pkTotal = 0, orGood = 0
  for (const [, yearRows] of svYears) {
    if (yearRows.length < boardSz) continue
    const byScore = [...yearRows].sort((a, b) => b.projScore - a.projScore).slice(0, boardSz)
    const byPick  = [...yearRows].sort((a, b) => a.player.pick - b.player.pick).slice(0, boardSz)
    const byAv    = [...yearRows].sort((a, b) => b.actualAv - a.actualAv).slice(0, boardSz)
    mGood  += byScore.filter((r) => slotLabel(r) === 'good').length
    mBad   += byScore.filter((r) => slotLabel(r) === 'bad').length
    mTotal += boardSz
    pkGood += byPick.filter((r) => slotLabel(r) === 'good').length
    pkTotal += boardSz
    orGood += byAv.filter((r) => slotLabel(r) === 'good').length
  }
  const p = (n: number, d: number) => d ? (n / d * 100).toFixed(1) + '%' : 'N/A'
  console.log(`  Top-${String(boardSz).padEnd(4)} ${p(mGood, mTotal).padStart(12)} ${p(mBad, mTotal).padStart(11)} ${p(pkGood, pkTotal).padStart(16)} ${p(orGood, mTotal).padStart(13)}`)
}

// ── 4. TOP BOARD HIT RATE ─────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════')
console.log(' TOP BOARD HIT RATE  (per-year board quality)')
console.log(' Model sorts each draft class by projScore; reports how often')
console.log(' top-N selections are actually High-tier (star/HES) vs busts.')
console.log('══════════════════════════════════════════════════════════════')

type BoardStats = { highHits: number; bustHits: number; total: number; years: number; avCapture: number; avTotal: number }
const boardN = [16, 32, 64, 100]
const boardStats: Record<number, BoardStats> = Object.fromEntries(boardN.map((n) => [n, { highHits: 0, bustHits: 0, total: 0, years: 0, avCapture: 0, avTotal: 0 }]))

// Actual top-N by AV within each year (the "oracle" answer)
const oracleStats: Record<number, BoardStats> = Object.fromEntries(boardN.map((n) => [n, { highHits: 0, bustHits: 0, total: 0, years: 0, avCapture: 0, avTotal: 0 }]))

for (const [, yearRows] of Object.entries(byYear)) {
  const sorted     = [...yearRows].sort((a, b) => b.projScore - a.projScore)
  const byActualAv = [...yearRows].sort((a, b) => b.actualAv - a.actualAv)
  for (const n of boardN) {
    if (yearRows.length < n) continue
    const modelTop  = sorted.slice(0, n)
    const oracleTop = byActualAv.slice(0, n)
    const s  = boardStats[n];  s.highHits += modelTop.filter((r) => tier(r.actualCategory)  === 'High').length
    s.bustHits += modelTop.filter((r) => tier(r.actualCategory) === 'Low').length
    s.total += n; s.years++
    s.avCapture += modelTop.reduce((sum, r) => sum + r.actualAv, 0)
    s.avTotal   += oracleTop.reduce((sum, r) => sum + r.actualAv, 0)
    const o  = oracleStats[n]; o.highHits += oracleTop.filter((r) => tier(r.actualCategory) === 'High').length
    o.bustHits += oracleTop.filter((r) => tier(r.actualCategory) === 'Low').length
    o.total += n; o.years++
    o.avCapture += oracleTop.reduce((sum, r) => sum + r.actualAv, 0)
    o.avTotal   += oracleTop.reduce((sum, r) => sum + r.actualAv, 0)
  }
}

const pct2 = (n: number, d: number) => d ? (n / d * 100).toFixed(1) + '%' : ' N/A'
console.log(`  ${'Top-N'.padEnd(8)} ${'Star/HES%'.padStart(10)} ${'Bust%'.padStart(8)} ${'AV cap%'.padStart(8)} ${'Years'.padStart(7)}   (oracle Star/HES%  oracle AV cap%)`)
for (const n of boardN) {
  const s = boardStats[n], o = oracleStats[n]
  if (s.years === 0) continue
  const avCapPct   = s.avTotal  ? (s.avCapture  / s.avTotal  * 100).toFixed(1) + '%' : 'N/A'
  const oAvCapPct  = o.avTotal  ? (o.avCapture  / o.avTotal  * 100).toFixed(1) + '%' : 'N/A'
  console.log(`  Top-${String(n).padEnd(4)} ${pct2(s.highHits, s.total).padStart(10)} ${pct2(s.bustHits, s.total).padStart(8)} ${avCapPct.padStart(8)} ${String(s.years).padStart(7)}   (oracle: ${pct2(o.highHits, o.total)}  ${oAvCapPct})`)
}

// ── 5. FLOOR / MEDIAN / CEILING CALIBRATION ──────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════')
console.log(' CALIBRATION  (where actual AV falls relative to projections)')
console.log('══════════════════════════════════════════════════════════════')
console.log('  Ideal: ~10% below floor, ~40% floor→median, ~40% median→ceiling, ~10% above ceiling')
console.log()

function calibrate(rows: EvalRow[], label: string) {
  if (rows.length < 5) return
  let belowFloor = 0, floorToMed = 0, medToCeil = 0, aboveCeil = 0
  for (const r of rows) {
    const av = r.actualAv
    if      (av < r.projFloor)                        belowFloor++
    else if (av < r.projMedian)                       floorToMed++
    else if (av <= r.projCeiling)                     medToCeil++
    else                                               aboveCeil++
  }
  const tot = rows.length
  const pct = (x: number) => (x / tot * 100).toFixed(0).padStart(3) + '%'
  console.log(`  ${label.padEnd(22)} n=${String(tot).padStart(4)}  below-floor=${pct(belowFloor)}  floor↔med=${pct(floorToMed)}  med↔ceil=${pct(medToCeil)}  above-ceil=${pct(aboveCeil)}`)
}

calibrate(results, 'Overall')
for (const pos of ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S']) {
  const rows = byPos[pos]
  if (rows && rows.length >= 5) calibrate(rows, pos)
}
console.log()
for (const { label, lo, hi } of pickRanges) {
  calibrate(results.filter((r) => r.player.pick >= lo && r.player.pick <= hi), label)
}

// ── 6. SIGNAL ABLATION ────────────────────────────────────────────────────────

if (doAblation) {
  console.log('\n══════════════════════════════════════════════════════════════')
  console.log(' SIGNAL ABLATION  (each signal neutralized → Δρ vs baseline)')
  console.log(' Methodology: replace signal inputs with position-neutral values')
  console.log('══════════════════════════════════════════════════════════════')

  const baseRho = overall.rho

  type AblationSpec = {
    name: string
    modify: (p: Prospect) => Prospect
    opts?: ProjectOpts
  }

  const ablations: AblationSpec[] = [
    {
      name: 'Athletic (combine)',
      modify: (p) => {
        const def = positionDefaults[p.pos] ?? {}
        return { ...p, forty: def.forty ?? 4.6, vertical: def.vertical ?? 33,
          broad: def.broad ?? 118, cone: def.cone ?? 7.1, shuttle: def.shuttle ?? 4.3 }
      },
    },
    {
      name: 'Size (ht/wt)',
      modify: (p) => {
        const def = positionDefaults[p.pos] ?? {}
        return { ...p, height: def.height ?? 73, weight: def.weight ?? 220 }
      },
    },
    {
      name: 'PFF grades',
      modify: (p) => ({ ...p, pffComposite: 70, pffGrade: 70, pffProduction: 70, pffEfficiency: 70, pffClean: 70 }),
    },
    {
      name: 'Age signal',
      modify: (p) => ({ ...p, age: 22 }),
    },
    {
      name: 'Bench/strength',
      modify: (p) => ({ ...p, bench: 0 }),
    },
    {
      name: 'School tier',
      modify: (p) => ({ ...p, school: '' }),
    },
    {
      name: 'Elite premium',
      modify: (p) => p,
      opts: { disableElitePremium: true },
    },
    {
      name: 'Comps only (calib=0)',
      modify: (p) => p,
      opts: { calibBlendOverride: 0 },
    },
    {
      name: 'Calib only (calib=1)',
      modify: (p) => p,
      opts: { calibBlendOverride: 1 },
    },
    {
      name: 'Age-adj PFF off',
      modify: (p) => p,
      opts: { disableAgeAdjPff: true },
    },
    {
      name: 'Official RAS off',
      modify: (p) => p,
      opts: { disableOfficialRas: true },
    },
  ]

  // Limit ablation to a sample for speed if large eval set
  const ablSample = results.length > 1500 ? results.filter((_, i) => i % 3 === 0) : results
  console.log(`  (running on ${ablSample.length} players — ${results.length > 1500 ? 'sampled 1-in-3 for speed' : 'full set'})`)
  console.log(`  Baseline ρ = ${fmt(baseRho)}\n`)

  for (const abl of ablations) {
    const ablStart = Date.now()
    const ablScores: number[] = []
    const actuals: number[] = []

    for (const r of ablSample) {
      const modified = abl.modify(r.prospect)
      const ablPool        = walkForward ? pool.filter((p) => p.year < r.player.year) : pool
      const ablPffProfiles = walkForward ? pffProfiles.filter((p) => p.draftSeason < r.player.year) : pffProfiles
      const proj = project(modified, ablPool, ablPffProfiles, r.player.id, undefined, undefined, undefined, undefined, walkForward, abl.opts, y1NflStats, null)
      ablScores.push(proj.score)
      actuals.push(r.actualAv)
    }

    const ablRho = spearman(ablScores, actuals)
    const delta  = ablRho - baseRho
    const elapsed2 = ((Date.now() - ablStart) / 1000).toFixed(1)
    const sign = delta >= 0 ? '+' : ''
    console.log(`  ${abl.name.padEnd(20)} ρ=${fmt(ablRho)}  Δρ=${sign}${fmt(delta)}  (${elapsed2}s)`)
  }
  console.log(`\n  Positive Δρ = signal hurts; negative Δρ = signal helps.`)
}

// ── 7. VERBOSE: WORST MISSES ──────────────────────────────────────────────────

if (verbose) {
  console.log('\n══════════════════════════════════════════════════════════════')
  console.log(' WORST MISSES  (|expectedAv − actualAv|, top 20)')
  console.log('══════════════════════════════════════════════════════════════')
  const sorted = [...results]
    .sort((a, b) => Math.abs(b.projAv - b.actualAv) - Math.abs(a.projAv - a.actualAv))
    .slice(0, 20)
  for (const r of sorted) {
    const err  = (r.projAv - r.actualAv).toFixed(1)
    const sign = r.projAv > r.actualAv ? '+' : ''
    const tags: string[] = []
    if ((r.prospect.age ?? 22) > 23.5)          tags.push('late-age')
    if (!r.hasPff)                                tags.push('no-PFF')
    if (r.player.pick <= 40 && r.actualAv < 12)  tags.push('top-pick-bust')
    if (r.player.pick <= 40 && r.projAv < r.actualAv * 0.6) tags.push('top-pick-underproj')
    if (r.projAv > r.projCeiling + 5 && r.actualAv > r.projCeiling) tags.push('above-ceiling')
    const slotRatio = r.slotBaseline > 0 ? r.actualAv / r.slotBaseline : 1
    if (slotRatio >= 2.5 && r.projAv < r.actualAv * 0.5) tags.push('slot-outlier-under')
    if (slotRatio <= 0.2 && r.projAv > r.actualAv * 2.0) tags.push('slot-outlier-over')
    console.log(
      `  ${r.player.name.padEnd(22)} ${r.player.pos} ${r.player.year}` +
      ` pick ${String(r.player.pick).padStart(3)}` +
      `  actual=${String(r.actualAv).padStart(3)}` +
      `  proj=${r.projAv.toFixed(1).padStart(5)}` +
      `  err=${sign}${err}` +
      (tags.length ? `  [${tags.join(', ')}]` : '')
    )
  }
}

// ── 8. QB TRAJECTORY REPORT ──────────────────────────────────────────────────

const qbResults = results.filter((r) => r.player.pos === 'QB')
const qbWithTraj = qbResults.filter((r) => r.hasQbTrajectory)
const qbPct = qbResults.length ? ((qbWithTraj.length / qbResults.length) * 100).toFixed(1) : '0.0'

console.log('\n══════════════════════════════════════════════════════════════')
console.log(' QB TRAJECTORY COVERAGE  (PFF season lookup for historical QBs)')
console.log('══════════════════════════════════════════════════════════════')
console.log(`  QBs in eval set:      ${qbResults.length}`)
console.log(`  With trajectory data: ${qbWithTraj.length} (${qbPct}%)`)

const labelCounts: Partial<Record<QbTrajectoryLabel, number>> = {}
for (const r of qbWithTraj) {
  if (r.trajectoryLabel) labelCounts[r.trajectoryLabel] = (labelCounts[r.trajectoryLabel] ?? 0) + 1
}
const labelOrder: QbTrajectoryLabel[] = ['elite_breakout', 'rising', 'stable_good', 'stable_limited', 'volatile_spike', 'regressing', 'unknown']
const labelStr = labelOrder.map((l) => `${l}=${labelCounts[l] ?? 0}`).join(', ')
console.log(`  By label: ${labelStr}`)

if (doQbTrajectoryAblation && qbResults.length >= 5) {
  console.log('\n QB TRAJECTORY ABLATION')
  console.log('══════════════════════════════════════════════════════════════')

  // With trajectory: use existing results (gradeDelta already applied in main eval loop)
  const qbScoresWithTraj  = qbResults.map((r) => r.projScore)
  const qbActuals         = qbResults.map((r) => r.actualAv)
  const qbRhoWith         = spearman(qbScoresWithTraj, qbActuals)
  const qbMaeWith         = mae(qbResults.map((r) => r.projAv), qbActuals)
  const qbBiasWithVal     = bias(qbResults.map((r) => r.projAv), qbActuals)

  // Without trajectory: re-run project() with gradeDelta=null for QB results
  const qbScoresNoTraj: number[] = []
  const qbAvsNoTraj:    number[] = []
  for (const r of qbResults) {
    const ablPool        = walkForward ? pool.filter((p) => p.year < r.player.year) : pool
    const ablPffProfiles = walkForward ? pffProfiles.filter((p) => p.draftSeason < r.player.year) : pffProfiles
    const projNoTraj = project(r.prospect, ablPool, ablPffProfiles, r.player.id, undefined, undefined, undefined, null, walkForward, undefined, y1NflStats, null)
    qbScoresNoTraj.push(projNoTraj.score)
    qbAvsNoTraj.push(projNoTraj.expectedAv)
  }
  const qbRhoWithout    = spearman(qbScoresNoTraj, qbActuals)
  const qbMaeWithout    = mae(qbAvsNoTraj, qbActuals)
  const qbBiasWithoutVal = bias(qbAvsNoTraj, qbActuals)

  const dsign = (d: number) => (d >= 0 ? '+' : '') + d.toFixed(3)
  const bsign = (d: number) => (d >= 0 ? '+' : '') + d.toFixed(1)
  console.log(`  With trajectory:    n=${qbResults.length} ρ=${fmt(qbRhoWith)}  MAE=${qbMaeWith.toFixed(1)}  bias=${bsign(qbBiasWithVal)}`)
  console.log(`  Without trajectory: n=${qbResults.length} ρ=${fmt(qbRhoWithout)}  MAE=${qbMaeWithout.toFixed(1)}  bias=${bsign(qbBiasWithoutVal)}`)
  const deltaRho = qbRhoWith - qbRhoWithout
  console.log(`  Δρ = ${dsign(deltaRho)} (positive = trajectory helps)`)

  // Per-label breakdown of ρ
  console.log('\n  By trajectory label:')
  console.log(`  ${'Label'.padEnd(18)} ${'n'.padStart(5)} ${'ρ'.padStart(8)} ${'MAE'.padStart(8)} ${'bias'.padStart(8)}`)
  for (const label of labelOrder) {
    const labelRows = qbWithTraj.filter((r) => r.trajectoryLabel === label)
    if (labelRows.length < 3) continue
    const lScores  = labelRows.map((r) => r.projScore)
    const lActuals = labelRows.map((r) => r.actualAv)
    const lRho     = spearman(lScores, lActuals)
    const lMae     = mae(labelRows.map((r) => r.projAv), lActuals)
    const lBias    = bias(labelRows.map((r) => r.projAv), lActuals)
    console.log(`  ${label.padEnd(18)} ${String(labelRows.length).padStart(5)} ${fmt(lRho).padStart(8)} ${lMae.toFixed(1).padStart(8)} ${bsign(lBias).padStart(8)}`)
  }

  // Trajectory miss analysis — QBs where trajectory moved score most and was wrong
  console.log('\n TRAJECTORY MISS ANALYSIS  (worst trajectory-driven misprojections)')
  const trajMisses = qbResults
    .filter((r) => r.hasQbTrajectory && Math.abs(r.trajectoryScoreMoved) >= 0.5)
    .map((r) => ({
      r,
      // Wrong if trajectory boosted score but actual AV was low, or depressed score and AV was high
      wrongness: Math.abs(r.trajectoryScoreMoved) * Math.abs(r.projAv - r.actualAv),
    }))
    .sort((a, b) => b.wrongness - a.wrongness)
    .slice(0, 10)

  if (trajMisses.length) {
    console.log(`  ${'Player'.padEnd(22)} ${'Yr'.padStart(5)} ${'Pick'.padStart(5)} ${'Label'.padEnd(16)} ${'ScoreMoved'.padStart(11)} ${'ActualAV'.padStart(9)} ${'ProjAV'.padStart(8)}`)
    for (const { r } of trajMisses) {
      const sign = r.trajectoryScoreMoved >= 0 ? '+' : ''
      console.log(
        `  ${r.player.name.padEnd(22)} ${String(r.player.year).padStart(5)} ${String(r.player.pick).padStart(5)}` +
        ` ${(r.trajectoryLabel ?? 'unknown').padEnd(16)}` +
        ` ${(sign + r.trajectoryScoreMoved.toFixed(2)).padStart(11)}` +
        ` ${String(r.actualAv).padStart(9)}` +
        ` ${r.projAv.toFixed(1).padStart(8)}`
      )
    }
  } else {
    console.log('  No significant trajectory-driven misprojections found.')
  }
}

console.log('')
