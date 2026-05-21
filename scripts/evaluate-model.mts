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
import { gunzipSync } from 'node:zlib'
import type { Historical, PffProfile, Prospect, Category } from '../src/model.ts'
import { clean, project, calibratedExpectedAv, matureOutcomeCutoff, outcomeOrder } from '../src/model.ts'

// ── CLI flags ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const filterPos    = args.includes('--pos')           ? args[args.indexOf('--pos')           + 1] : null
const yearMax      = args.includes('--year-max')      ? parseInt(args[args.indexOf('--year-max') + 1]) : matureOutcomeCutoff - 3
const verbose      = args.includes('--verbose')
const doAblation   = args.includes('--ablation')
const walkForward  = args.includes('--walk-forward')

// ── Data paths ────────────────────────────────────────────────────────────────

const DATA = new URL('../public/data/', import.meta.url).pathname

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1]
    if (ch === '"') {
      if (quoted && next === '"') { cell += '"'; i++ } else quoted = !quoted
    } else if (ch === ',' && !quoted) {
      row.push(cell); cell = ''
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else {
      cell += ch
    }
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [head, ...body] = rows.filter((r) => r.some(Boolean))
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i]?.trim() || ''])))
}

function n(s: string | undefined): number | null {
  if (!s || s.trim() === '') return null
  const x = parseFloat(s.replace(/,/g, ''))
  return isFinite(x) ? x : null
}

function ht(s: string | undefined): number | null {
  if (!s) return null
  const m = s.match(/^(\d+)-(\d+)$/)
  if (m) return parseInt(m[1]) * 12 + parseInt(m[2])
  const v = parseFloat(s)
  return isFinite(v) ? v : null
}

function norm(p: string): string {
  const x = p.toUpperCase().trim()
  if (['OT', 'G', 'T', 'LT', 'RT', 'OG', 'C', 'OL', 'IOL', 'OC'].includes(x)) return 'OL'
  if (['DE', 'DT', 'NT', 'DL', 'IDL', 'DI', 'OLB', 'EDGE', 'ED'].includes(x)) return 'DL'
  if (['ILB', 'MLB', 'WILL', 'MIKE', 'SAM'].includes(x)) return 'LB'
  if (['FS', 'SS', 'DB'].includes(x)) return 'S'
  if (x === 'FB') return 'RB'
  return x
}

function avToCat(av: number, games: number, starts: number, pb: number, ap: number): Category {
  if (ap || pb >= 2 || av >= 70) return 'Star'
  if (pb || av >= 45 || (starts >= 5 && av >= 35)) return 'High-end starter'
  if (av >= 24 || starts >= 3 || (games >= 64 && av >= 18)) return 'Starter'
  if (av >= 10 || games >= 48) return 'Role'
  if (av >= 4 || games >= 17) return 'Reserve'
  return 'Bust'
}

// ── Position defaults (mirrors App.tsx positionDefaults) ─────────────────────

const positionDefaults: Record<string, Partial<Prospect>> = {
  QB: { height: 75, weight: 220, forty: 4.75, vertical: 32, broad: 112, cone: 7.15, shuttle: 4.35 },
  RB: { height: 70, weight: 214, forty: 4.5,  vertical: 35, broad: 121, cone: 7.05, shuttle: 4.25 },
  WR: { height: 73, weight: 202, forty: 4.5,  vertical: 36, broad: 123, cone: 6.95, shuttle: 4.22 },
  TE: { height: 77, weight: 250, forty: 4.72, vertical: 34, broad: 119, cone: 7.15, shuttle: 4.35 },
  OL: { height: 77, weight: 313, forty: 5.20, vertical: 29, broad: 104, cone: 7.79, shuttle: 4.75 },
  DL: { height: 76, weight: 278, forty: 4.90, vertical: 32, broad: 112, cone: 7.40, shuttle: 4.50 },
  LB: { height: 74, weight: 235, forty: 4.65, vertical: 34, broad: 118, cone: 7.12, shuttle: 4.3  },
  CB: { height: 71, weight: 195, forty: 4.48, vertical: 36, broad: 122, cone: 6.95, shuttle: 4.18 },
  S:  { height: 72, weight: 205, forty: 4.55, vertical: 35, broad: 120, cone: 7.0,  shuttle: 4.22 },
}

// ── Build historical pool ─────────────────────────────────────────────────────

const KNOWN_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S'])

function buildPool(combine: Record<string, string>[], draft: Record<string, string>[]): Historical[] {
  const byPfr      = new Map(draft.filter((r) => r.pfr_player_id).map((r) => [r.pfr_player_id, r]))
  const byNameYear = new Map(draft.map((r) => [`${r.season}-${clean(r.pfr_player_name)}`, r]))
  const usedDraft  = new Set<Record<string, string>>()

  const fromCombine = combine.map((r, i) => {
    const year = n(r.draft_year) || n(r.season) || 0
    const d = byPfr.get(r.pfr_id) || byNameYear.get(`${year}-${clean(r.player_name)}`)
    if (d) usedDraft.add(d)
    return toHistorical(r, d, i, year)
  })
  const fromDraftOnly = draft
    .filter((r) => !usedDraft.has(r))
    .map((r, i) => toHistorical({}, r, combine.length + i, n(r.season) || 0))

  return [...fromCombine, ...fromDraftOnly]
    .filter((p) => p.year >= 2000 && p.name !== 'Unknown' && KNOWN_POSITIONS.has(p.pos))
}

function toHistorical(cr: Record<string, string>, dr: Record<string, string> | undefined, idx: number, year: number): Historical {
  const av      = n(dr?.w_av) || n(dr?.car_av) || 0
  const games   = n(dr?.games) || 0
  const starts  = n(dr?.seasons_started) || 0
  const proBowls = n(dr?.probowls) || 0
  const allPros  = n(dr?.allpro) || 0
  return {
    id:       `${year}-${cr.player_name || dr?.pfr_player_name || 'unknown'}-${idx}`,
    name:     cr.player_name || dr?.pfr_player_name || 'Unknown',
    school:   cr.school || dr?.college || '',
    year,
    pos:      norm(cr.pos || dr?.position || ''),
    pick:     n(cr.draft_ovr) || n(dr?.pick) || 260,
    age:      n(dr?.age),
    height:   ht(cr.ht),
    weight:   n(cr.wt),
    forty:    n(cr.forty),
    vertical: n(cr.vertical),
    broad:    n(cr.broad_jump),
    cone:     n(cr.cone),
    shuttle:  n(cr.shuttle),
    bench:    n(cr.bench),
    games, av, starts, proBowls, allPros,
    category: avToCat(av, games, starts, proBowls, allPros),
  }
}

// ── Normalize PFF profiles ────────────────────────────────────────────────────

type CompactPffOutcome = [number, number, number, number, number, number, Category, number?]
type CompactPffProfile = [string, string, string, number, number, number, number, number, number, CompactPffOutcome | null]
type RawPff = PffProfile | CompactPffProfile
type PffPayload = { profiles: RawPff[] }

function normalizePff(profiles: RawPff[]): PffProfile[] {
  return profiles.flatMap((p) => {
    if (!Array.isArray(p)) return [{ ...p, position: norm(p.position) }]
    const [name, college, rawPos, draftSeason, composite, grade, production, efficiency, cleanPlay, nfl] = p
    const position = norm(rawPos)
    if (!KNOWN_POSITIONS.has(position)) return []
    return [{
      id: `${clean(name)}|${draftSeason}|${position}`,
      name, college, position, draftSeason, games: 0,
      pff: { composite, grade, production, efficiency, clean: cleanPlay },
      nfl: nfl ? {
        draftPick: nfl[0], games: nfl[1], starts: nfl[2], snaps: nfl[3],
        awards: nfl[4], score: nfl[5], category: nfl[6],
        av: nfl[7] ?? nfl[5] * 0.82,
      } : null,
    }]
  })
}

// ── Build Prospect from Historical ────────────────────────────────────────────

function toProspect(player: Historical, pff?: PffProfile): Prospect {
  const def = positionDefaults[player.pos] ?? {}
  // Film defaults at neutral 70 regardless of pick; pick-correlated defaults
  // duplicate the draft signal and add noise (confirmed by signal ablation).
  // PFF grades replace the neutral default when a match is found.
  return {
    name: player.name, school: player.school, pos: player.pos,
    draftSeason: player.year, pick: player.pick < 260 ? player.pick : 200,
    age:      player.age      ?? 22,
    height:   player.height   ?? def.height   ?? 73,
    weight:   player.weight   ?? def.weight   ?? 220,
    forty:    player.forty    ?? def.forty    ?? 4.6,
    vertical: player.vertical ?? def.vertical ?? 33,
    broad:    player.broad    ?? def.broad    ?? 118,
    cone:     player.cone     ?? def.cone     ?? 7.1,
    shuttle:  player.shuttle  ?? def.shuttle  ?? 4.3,
    bench:    player.bench    ?? 0,
    pffProfileId:   pff?.id ?? '',
    pffComposite:   pff?.pff.composite  ?? 70,
    pffGrade:       pff?.pff.grade      ?? 70,
    pffProduction:  pff?.pff.production ?? 70,
    pffEfficiency:  pff?.pff.efficiency ?? 70,
    pffClean:       pff?.pff.clean      ?? 70,
    schemeTag: '',
  }
}

// ── Statistical metrics ───────────────────────────────────────────────────────

function rankArray(arr: number[]): number[] {
  const indexed = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const ranks = new Array(arr.length)
  let i = 0
  while (i < indexed.length) {
    let j = i
    while (j < indexed.length - 1 && indexed[j + 1].v === indexed[j].v) j++
    const avgRank = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank
    i = j + 1
  }
  return ranks
}

function spearman(xs: number[], ys: number[]): number {
  if (xs.length < 3) return NaN
  const rx = rankArray(xs), ry = rankArray(ys)
  const nd = xs.length
  const d2 = rx.reduce((s, r, i) => s + (r - ry[i]) ** 2, 0)
  return 1 - 6 * d2 / (nd * (nd * nd - 1))
}

function mae(pred: number[], actual: number[]): number {
  return pred.reduce((s, p, i) => s + Math.abs(p - actual[i]), 0) / pred.length
}

function rmse(pred: number[], actual: number[]): number {
  return Math.sqrt(pred.reduce((s, p, i) => s + (p - actual[i]) ** 2, 0) / pred.length)
}

function bias(pred: number[], actual: number[]): number {
  return pred.reduce((s, p, i) => s + (p - actual[i]), 0) / pred.length
}

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function fmt(x: number, dp = 3): string {
  return isNaN(x) ? ' N/A ' : x.toFixed(dp)
}

function fmtBias(x: number, dp = 1): string {
  if (isNaN(x)) return '  N/A'
  const s = x >= 0 ? '+' : ''
  return `${s}${x.toFixed(dp)}`
}

// ── Load data ─────────────────────────────────────────────────────────────────

process.stdout.write('Loading data... ')

const combine    = parseCsv(readFileSync(DATA + 'combine.csv', 'utf-8'))
const draft      = parseCsv(readFileSync(DATA + 'draft_picks.csv', 'utf-8'))
const b64        = readFileSync(DATA + 'pff_comparison_profiles.json.gz.b64', 'utf-8').replace(/\s/g, '')
const pffPayload = JSON.parse(gunzipSync(Buffer.from(b64, 'base64')).toString('utf-8')) as PffPayload

const pool        = buildPool(combine, draft)
const pffProfiles = normalizePff(pffPayload.profiles)

const pffByKey = new Map<string, PffProfile>()
for (const p of pffProfiles) pffByKey.set(`${clean(p.name)}|${p.draftSeason}`, p)

console.log(`✓  pool=${pool.length} pff=${pffProfiles.length}`)

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
  hasPff:       boolean
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
  const prospect = toProspect(player, pff)
  // Walk-forward: restrict BOTH comp pool and pff profiles to prior years only.
  // preDraft=true disables tierWeight/snapBoost/experienceBonus in pffSim so comp
  // selection is based purely on pre-draft signals, not known NFL outcomes.
  const evalPool       = walkForward ? pool.filter((p) => p.year < player.year) : pool
  const evalPffProfiles = walkForward ? pffProfiles.filter((p) => p.draftSeason < player.year) : pffProfiles
  const proj           = project(prospect, evalPool, evalPffProfiles, player.id, undefined, undefined, undefined, undefined, walkForward)

  // Predicted category = highest-odds outcome
  const projCategory = outcomeOrder.reduce((best, cat) =>
    (proj.odds[cat] ?? 0) > (proj.odds[best] ?? 0) ? cat : best
  , outcomeOrder[0])

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
    hasPff:       !!pff,
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

console.log('\n══════════════════════════════════════════════════════════════')
console.log(` OVERALL${walkForward ? '  [quasi-walk-forward: comps+PFF time-filtered, calibration coefs static]' : ''}`)
console.log('══════════════════════════════════════════════════════════════')
const overall = metrics(results)
console.log(`  Full model  n=${overall.n}  ρ=${fmt(overall.rho)}  MAE=${fmt(overall.maeAv, 1)}  RMSE=${fmt(overall.rmseAv, 1)}  bias=${fmtBias(overall.biasAv)} AV`)

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
console.log(`  Pick-only   n=${overall.n}  ρ=${fmt(pickRho)}  MAE=${fmt(pickMae, 1)}  RMSE=${fmt(pickRmse, 1)}  bias=${fmtBias(pickBias)} AV`)
const rhoLift = overall.rho - pickRho
const maeLift = pickMae - overall.maeAv
const rmseLift = pickRmse - overall.rmseAv
console.log(`  Model lift        Δρ=${rhoLift >= 0 ? '+' : ''}${fmt(rhoLift)}  ΔMAE=${maeLift >= 0 ? '+' : ''}${fmt(maeLift, 1)}  ΔRMSE=${rmseLift >= 0 ? '+' : ''}${fmt(rmseLift, 1)}`)

console.log('\n── By position ───────────────────────────────────────────────')
const byPos: Record<string, EvalRow[]> = {}
for (const r of results) (byPos[r.player.pos] ??= []).push(r)
for (const pos of ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S']) {
  const rows = byPos[pos]
  if (!rows || rows.length < 5) continue
  const m = metrics(rows)
  console.log(`  ${pos.padEnd(3)} n=${String(m.n).padStart(3)}  ρ=${fmt(m.rho)}  MAE=${fmt(m.maeAv, 1)}  RMSE=${fmt(m.rmseAv, 1)}  bias=${fmtBias(m.biasAv)}`)
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

// ── 2. CATEGORY CONFUSION MATRIX ─────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════')
console.log(' CATEGORY CONFUSION MATRIX  (predicted row → actual column)')
console.log('══════════════════════════════════════════════════════════════')

// 3-tier grouping for readability
function tier(cat: Category): 'Low' | 'Mid' | 'High' {
  if (cat === 'Bust' || cat === 'Reserve') return 'Low'
  if (cat === 'Role' || cat === 'Starter') return 'Mid'
  return 'High'  // High-end starter, Star
}

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

// ── 3. TOP BOARD HIT RATE ─────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════')
console.log(' TOP BOARD HIT RATE  (per-year board quality)')
console.log(' Model sorts each draft class by projScore; reports how often')
console.log(' top-N selections are actually High-tier (star/HES) vs busts.')
console.log('══════════════════════════════════════════════════════════════')

const byYear: Record<number, EvalRow[]> = {}
for (const r of results) (byYear[r.player.year] ??= []).push(r)

type BoardStats = { highHits: number; bustHits: number; total: number; years: number }
const boardN = [16, 32, 64, 100]
const boardStats: Record<number, BoardStats> = Object.fromEntries(boardN.map((n) => [n, { highHits: 0, bustHits: 0, total: 0, years: 0 }]))

// Actual top-N by AV within each year (the "oracle" answer)
const oracleStats: Record<number, BoardStats> = Object.fromEntries(boardN.map((n) => [n, { highHits: 0, bustHits: 0, total: 0, years: 0 }]))

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
    const o  = oracleStats[n]; o.highHits += oracleTop.filter((r) => tier(r.actualCategory) === 'High').length
    o.bustHits += oracleTop.filter((r) => tier(r.actualCategory) === 'Low').length
    o.total += n; o.years++
  }
}

const pct2 = (n: number, d: number) => d ? (n / d * 100).toFixed(1) + '%' : ' N/A'
console.log(`  ${'Top-N'.padEnd(8)} ${'Star/HES%'.padStart(10)} ${'Bust%'.padStart(8)} ${'Years'.padStart(7)}   (oracle Star/HES%)`)
for (const n of boardN) {
  const s = boardStats[n], o = oracleStats[n]
  if (s.years === 0) continue
  console.log(`  Top-${String(n).padEnd(4)} ${pct2(s.highHits, s.total).padStart(10)} ${pct2(s.bustHits, s.total).padStart(8)} ${String(s.years).padStart(7)}   (oracle: ${pct2(o.highHits, o.total)})`)
}

// ── 4. FLOOR / MEDIAN / CEILING CALIBRATION ──────────────────────────────────

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

// ── 5. SIGNAL ABLATION ────────────────────────────────────────────────────────

if (doAblation) {
  console.log('\n══════════════════════════════════════════════════════════════')
  console.log(' SIGNAL ABLATION  (each signal neutralized → Δρ vs baseline)')
  console.log(' Methodology: replace signal inputs with position-neutral values')
  console.log('══════════════════════════════════════════════════════════════')

  const baseRho = overall.rho

  type AblationSpec = {
    name: string
    modify: (p: Prospect) => Prospect
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
      const proj = project(modified, ablPool, ablPffProfiles, r.player.id, undefined, undefined, undefined, undefined, walkForward)
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

// ── 6. VERBOSE: WORST MISSES ──────────────────────────────────────────────────

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
    console.log(
      `  ${r.player.name.padEnd(22)} ${r.player.pos} ${r.player.year}` +
      ` pick ${String(r.player.pick).padStart(3)}` +
      `  actual=${String(r.actualAv).padStart(3)}` +
      `  proj=${r.projAv.toFixed(1).padStart(5)}` +
      `  err=${sign}${err}`
    )
  }
}

console.log('')
