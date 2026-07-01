#!/usr/bin/env node
// Phase 4: test whether a walk-forward team/landing-spot signal adds validated
// predictive value beyond the already-shipped Phase 1 ridge model.
//
// IMPORTANT CONSTRAINT regardless of result: `team` (the drafting franchise) is only
// known POST-draft. This feature can never be used for the app's primary use case --
// scoring/ranking prospects BEFORE the draft ("2027 QBs", Class Rankings for
// undrafted players) -- only for post-draft context (e.g. "this player was just
// picked by Team X, adjust the outlook given their track record"). Whether this is
// worth building at all depends on both the result below AND that narrower
// applicability being acceptable for how it'd actually be used.
//
// Methodology: same walk-forward CV (fold years, alpha grid, bias penalty) and held-
// out 2016-2020 confirmation as scripts/fit-calibration-model.mts, but comparing WITH
// vs WITHOUT an added team-quality feature on the exact same rows, for a true
// apples-to-apples read. Same go/no-go bar as Phases 2 and 3.
//
// RESULT: NO-GO, not wired into production. Confirmation-window rho barely moved in
// EITHER direction for any group: global +0.000, QB -0.006, SKILL -0.003, OL +0.004,
// FRONT -0.000, DB +0.001 -- all comfortably inside noise. A team's historical
// tendency to out/under-perform its draft slot, pooled across positions and shrunk
// toward league average, carries no validated signal on this dataset. This is
// consistent with a well-documented finding elsewhere in sports analytics: evidence
// for persistent "front office drafting skill" beyond noise is weak -- GMs and
// scouting staffs turn over, and the sample sizes involved (a handful of picks per
// team per year) are small relative to the variance in outcomes. It's also the fourth
// independent test this session (Phase 1 ridge, Phase 2 raw-target GBM, Phase 3
// residual architecture, and this team-context feature) landing on the same
// conclusion. And as noted above, even a positive result here would only have applied
// to post-draft context, not the app's primary pre-draft prospect scoring -- so the
// ceiling on this particular lead was capped either way.
//
// Usage: node --experimental-strip-types scripts/fit-team-signal-test.mts

import { clean } from '../src/model.ts'
import type { ModelSignal } from '../src/model.ts'
import { loadEvalData, spearman, mae, bias as computeBias } from './lib/eval-data.mts'
import { ridgeFit, predictRidge, type FittedRidge } from './lib/ridge.mts'
import { buildTrainingRows, GROUP_FEATURES, GLOBAL_FEATURES, GROUPS, type Grp, type TrainingRow as Row } from './lib/training-rows.mts'

const DATA = new URL('../public/data/', import.meta.url).pathname

console.log('Loading data...')
const evalData = loadEvalData(DATA)
console.log('Computing walk-forward features...')
const rows: Row[] = buildTrainingRows(evalData, 2000, 2020, (done, total) => process.stdout.write(`  ${done}/${total}\r`))
console.log(`  ${rows.length} rows done`)

// ── Walk-forward shrunk team-quality signal ───────────────────────────────────────
// For each row: the empirical-Bayes-shrunk average (actual AV - pick-bucket-expected
// AV) for that TEAM's picks from STRICTLY EARLIER draft years, pooled across all
// positions (a front office's evaluation process isn't obviously position-specific,
// and pooling gives each team more history to draw on). Shrunk toward 0 surplus by k
// -- a team needs ~k historical picks before its own track record dominates over
// "average team." Processed year-by-year, same leakage discipline as the Phase 3
// college encoding: a team's own current-year picks never leak into their own value.
function bucketOf(pick: number): string {
  return pick <= 32 ? '1' : pick <= 64 ? '2' : pick <= 100 ? '3' : pick <= 160 ? '4' : '5'
}

function computeTeamQuality(allRows: Row[], k = 20): number[] {
  const rowsByYear = new Map<number, number[]>()
  allRows.forEach((r, i) => {
    if (!rowsByYear.has(r.year)) rowsByYear.set(r.year, [])
    rowsByYear.get(r.year)!.push(i)
  })
  const years = [...rowsByYear.keys()].sort((a, b) => a - b)
  const bucketStats = new Map<string, { sum: number; n: number }>()
  const teamStats = new Map<string, { sum: number; n: number }>()
  const globalMean = allRows.reduce((s, r) => s + r.av, 0) / allRows.length
  const out = new Array(allRows.length).fill(0)

  for (const y of years) {
    const idxs = rowsByYear.get(y)!
    const bucketExpectedThisYear = new Map<string, number>()
    for (const i of idxs) {
      const b = bucketOf(allRows[i].pick)
      if (!bucketExpectedThisYear.has(b)) {
        const bs = bucketStats.get(b)
        bucketExpectedThisYear.set(b, bs && bs.n > 0 ? bs.sum / bs.n : globalMean)
      }
    }
    for (const i of idxs) {
      const team = clean(allRows[i].team)
      const ts = teamStats.get(team)
      const n = ts?.n ?? 0
      const sum = ts?.sum ?? 0
      out[i] = sum / (n + k)   // shrink toward 0 (average team = no surplus/deficit)
    }
    for (const i of idxs) {
      const b = bucketOf(allRows[i].pick)
      const expected = bucketExpectedThisYear.get(b)!
      const delta = allRows[i].av - expected
      const team = clean(allRows[i].team)
      const ts = teamStats.get(team) ?? { sum: 0, n: 0 }
      ts.sum += delta; ts.n += 1
      teamStats.set(team, ts)
      const bs = bucketStats.get(b) ?? { sum: 0, n: 0 }
      bs.sum += allRows[i].av; bs.n += 1
      bucketStats.set(b, bs)
    }
  }
  return out
}

const teamQuality = computeTeamQuality(rows)
const teamQualityByRow = new Map(rows.map((r, i) => [r, teamQuality[i]]))
const withoutTeam = rows.filter((r) => !clean(r.team)).length
console.log(`  team-quality computed (${rows.length - withoutTeam}/${rows.length} rows have a known team)`)

// ── Ridge fitting/scoring, identical to fit-calibration-model.mts's methodology ────

function toMatrix(subset: Row[], featureNames: ModelSignal[], withTeam: boolean): { X: number[][]; y: number[] } {
  return {
    X: subset.map((r) => {
      const base = featureNames.map((f) => r.features[f])
      return withTeam ? [...base, teamQualityByRow.get(r)!] : base
    }),
    y: subset.map((r) => Math.log1p(Math.max(0, r.av))),
  }
}

function fitWithSmearing(X: number[][], y: number[], alpha: number): FittedRidge {
  const fit = ridgeFit(X, y, alpha)
  const residuals = X.map((x, i) => y[i] - predictRidge(fit, x))
  const smearLog = Math.log(residuals.reduce((s, r) => s + Math.exp(r), 0) / residuals.length)
  return { ...fit, intercept: fit.intercept + smearLog }
}

function fitAndScore(train: Row[], test: Row[], featureNames: ModelSignal[], withTeam: boolean, alpha: number): { rho: number; maeAv: number; biasAv: number } | null {
  if (train.length < featureNames.length * 5 || test.length < 5) return null
  const { X, y } = toMatrix(train, featureNames, withTeam)
  const fit = fitWithSmearing(X, y, alpha)
  const testX = toMatrix(test, featureNames, withTeam).X
  const predAv = testX.map((x) => Math.max(0, Math.expm1(predictRidge(fit, x))))
  const actual = test.map((r) => r.av)
  return { rho: spearman(predAv, actual), maeAv: mae(predAv, actual), biasAv: computeBias(predAv, actual) }
}

const ALPHAS = [0.3, 1, 3, 10, 30, 100, 300]
const TUNE_FOLD_YEARS = Array.from({ length: 2015 - 2007 + 1 }, (_, i) => 2007 + i)
const BIAS_PENALTY = 0.006

function tuneAlpha(subset: Row[], featureNames: ModelSignal[], withTeam: boolean): number {
  let best = { alpha: ALPHAS[0], score: -Infinity }
  for (const alpha of ALPHAS) {
    const rhos: number[] = []
    const biases: number[] = []
    for (const foldYear of TUNE_FOLD_YEARS) {
      const train = subset.filter((r) => r.year < foldYear)
      const test = subset.filter((r) => r.year === foldYear)
      const scored = fitAndScore(train, test, featureNames, withTeam, alpha)
      if (scored && !isNaN(scored.rho)) { rhos.push(scored.rho); biases.push(scored.biasAv) }
    }
    if (!rhos.length) continue
    const meanRho = rhos.reduce((s, r) => s + r, 0) / rhos.length
    const meanBias = biases.reduce((s, b) => s + b, 0) / biases.length
    const score = meanRho - BIAS_PENALTY * Math.abs(meanBias)
    if (score > best.score) best = { alpha, score }
  }
  return best.alpha
}

function confirm(subset: Row[], featureNames: ModelSignal[], withTeam: boolean, alpha: number) {
  const train = subset.filter((r) => r.year <= 2015)
  const test = subset.filter((r) => r.year >= 2016 && r.year <= 2020)
  return fitAndScore(train, test, featureNames, withTeam, alpha)
}

console.log('\n── WITHOUT team vs WITH team-quality (walk-forward CV alpha, confirmed on untouched 2016-2020) ──\n')

function testGroup(subset: Row[], featureNames: ModelSignal[], label: string) {
  const alphaNo = tuneAlpha(subset, featureNames, false)
  const alphaYes = tuneAlpha(subset, featureNames, true)
  const no = confirm(subset, featureNames, false, alphaNo)
  const yes = confirm(subset, featureNames, true, alphaYes)
  if (!no || !yes) { console.log(`  [${label}] insufficient data`); return }
  const delta = yes.rho - no.rho
  const sign = delta >= 0 ? '+' : ''
  console.log(`  [${label}]  without-team rho=${no.rho.toFixed(3)} (alpha=${alphaNo})   with-team rho=${yes.rho.toFixed(3)} (alpha=${alphaYes})   Δρ=${sign}${delta.toFixed(3)}`)
}

testGroup(rows, GLOBAL_FEATURES, 'global')
for (const g of GROUPS) testGroup(rows.filter((r) => r.grp === g), GROUP_FEATURES, g)
