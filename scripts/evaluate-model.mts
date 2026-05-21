#!/usr/bin/env node
// Evaluation harness for src/model.ts
// Runs time-split backtests on historical players and computes Spearman ρ, MAE, RMSE.
//
// Usage:
//   node --experimental-strip-types scripts/evaluate-model.mts
//   node --experimental-strip-types scripts/evaluate-model.mts --pos WR
//   node --experimental-strip-types scripts/evaluate-model.mts --year-max 2018

import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import type { Historical, PffProfile, Prospect, Category } from '../src/model.ts'
import { clean, project, matureOutcomeCutoff } from '../src/model.ts'

// ── CLI flags ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const filterPos = args.includes('--pos') ? args[args.indexOf('--pos') + 1] : null
const yearMax = args.includes('--year-max') ? parseInt(args[args.indexOf('--year-max') + 1]) : matureOutcomeCutoff - 3
const verbose = args.includes('--verbose')

// ── Data paths ────────────────────────────────────────────────────────────────

const DATA = new URL('../public/data/', import.meta.url).pathname

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]
    if (ch === '"') {
      if (quoted && next === '"') { cell += '"'; i++ }
      else quoted = !quoted
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

function cat(av: number, games: number, starts: number, pb: number, ap: number): Category {
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
  const byPfr = new Map(draft.filter((r) => r.pfr_player_id).map((r) => [r.pfr_player_id, r]))
  const byNameYear = new Map(draft.map((r) => [`${r.season}-${clean(r.pfr_player_name)}`, r]))
  const usedDraftRows = new Set<Record<string, string>>()

  const fromCombine = combine.map((r, i) => {
    const year = n(r.draft_year) || n(r.season) || 0
    const d = byPfr.get(r.pfr_id) || byNameYear.get(`${year}-${clean(r.player_name)}`)
    if (d) usedDraftRows.add(d)
    return toHistorical(r, d, i, year)
  })

  const fromDraftOnly = draft
    .filter((r) => !usedDraftRows.has(r))
    .map((r, i) => toHistorical({}, r, combine.length + i, n(r.season) || 0))

  return [...fromCombine, ...fromDraftOnly]
    .filter((p) => p.year >= 2000 && p.name !== 'Unknown' && KNOWN_POSITIONS.has(p.pos))
}

function toHistorical(combineRow: Record<string, string>, draftRow: Record<string, string> | undefined, index: number, year: number): Historical {
  const av = n(draftRow?.w_av) || n(draftRow?.car_av) || 0
  const games = n(draftRow?.games) || 0
  const starts = n(draftRow?.seasons_started) || 0
  const proBowls = n(draftRow?.probowls) || 0
  const allPros = n(draftRow?.allpro) || 0
  return {
    id: `${year}-${combineRow.player_name || draftRow?.pfr_player_name || 'unknown'}-${index}`,
    name: combineRow.player_name || draftRow?.pfr_player_name || 'Unknown',
    school: combineRow.school || draftRow?.college || '',
    year,
    pos: norm(combineRow.pos || draftRow?.position || ''),
    pick: n(combineRow.draft_ovr) || n(draftRow?.pick) || 260,
    age: n(draftRow?.age),
    height: ht(combineRow.ht),
    weight: n(combineRow.wt),
    forty: n(combineRow.forty),
    vertical: n(combineRow.vertical),
    broad: n(combineRow.broad_jump),
    cone: n(combineRow.cone),
    shuttle: n(combineRow.shuttle),
    bench: n(combineRow.bench),
    games,
    av,
    starts,
    proBowls,
    allPros,
    category: cat(av, games, starts, proBowls, allPros),
  }
}

// ── Normalize PFF profiles ────────────────────────────────────────────────────

type CompactPffOutcome = [number, number, number, number, number, number, Category, number?]
type CompactPffProfile = [string, string, string, number, number, number, number, number, number, CompactPffOutcome | null]
type RawPff = PffProfile | CompactPffProfile
type PffPayload = { profiles: RawPff[] }

function normalizePff(profiles: RawPff[]): PffProfile[] {
  return profiles.flatMap((p) => {
    if (!Array.isArray(p)) {
      return [{ ...p, position: norm(p.position) }]
    }
    const [name, college, rawPos, draftSeason, composite, grade, production, efficiency, cleanPlay, nfl] = p
    const position = norm(rawPos)
    if (!KNOWN_POSITIONS.has(position)) return []
    return [{
      id: `${clean(name)}|${draftSeason}|${position}`,
      name,
      college,
      position,
      draftSeason,
      games: 0,
      pff: { composite, grade, production, efficiency, clean: cleanPlay },
      nfl: nfl ? {
        draftPick: nfl[0],
        games: nfl[1],
        starts: nfl[2],
        snaps: nfl[3],
        awards: nfl[4],
        score: nfl[5],
        category: nfl[6],
        av: nfl[7] ?? nfl[5] * 0.82,
      } : null,
    }]
  })
}

// ── Build Prospect from Historical (mirrors App.tsx prospectFromHistorical) ────

function toProspect(player: Historical, pff?: PffProfile): Prospect {
  const baseline = player.pick <= 32 ? 84 : player.pick <= 64 ? 78 : player.pick <= 100 ? 72 : player.pick <= 150 ? 66 : 60
  const def = positionDefaults[player.pos] ?? {}
  return {
    name: player.name,
    school: player.school,
    pos: player.pos,
    draftSeason: player.year,
    pick: player.pick < 260 ? player.pick : 200,
    age: player.age ?? 22,
    height: player.height ?? def.height ?? 73,
    weight: player.weight ?? def.weight ?? 220,
    forty: player.forty ?? def.forty ?? 4.6,
    vertical: player.vertical ?? def.vertical ?? 33,
    broad: player.broad ?? def.broad ?? 118,
    cone: player.cone ?? def.cone ?? 7.1,
    shuttle: player.shuttle ?? def.shuttle ?? 4.3,
    bench: player.bench ?? 0,
    film: pff?.pff.grade ?? baseline,
    production: pff?.pff.production ?? Math.max(55, baseline - 2),
    fit: pff?.pff.composite ?? baseline,
    health: pff?.pff.clean ?? 80,
    processing: pff?.pff.efficiency ?? (player.pos === 'QB' ? baseline : Math.max(55, baseline - 4)),
    pffProfileId: pff?.id ?? '',
    pffComposite: pff?.pff.composite ?? baseline,
    pffGrade: pff?.pff.grade ?? baseline,
    pffProduction: pff?.pff.production ?? Math.max(55, baseline - 2),
    pffEfficiency: pff?.pff.efficiency ?? baseline,
    pffClean: pff?.pff.clean ?? 70,
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
  const n = xs.length
  const d2 = rx.reduce((s, r, i) => s + (r - ry[i]) ** 2, 0)
  return 1 - 6 * d2 / (n * (n * n - 1))
}

function mae(pred: number[], actual: number[]): number {
  return pred.reduce((s, p, i) => s + Math.abs(p - actual[i]), 0) / pred.length
}

function rmse(pred: number[], actual: number[]): number {
  return Math.sqrt(pred.reduce((s, p, i) => s + (p - actual[i]) ** 2, 0) / pred.length)
}

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function fmt(x: number, dp = 3): string {
  return isNaN(x) ? 'N/A' : x.toFixed(dp)
}

// ── Load data ────────────────────────────────────────────────────────────────

process.stdout.write('Loading data... ')

const combine = parseCsv(readFileSync(DATA + 'combine.csv', 'utf-8'))
const draft   = parseCsv(readFileSync(DATA + 'draft_picks.csv', 'utf-8'))

const b64   = readFileSync(DATA + 'pff_comparison_profiles.json.gz.b64', 'utf-8').replace(/\s/g, '')
const bytes = Buffer.from(b64, 'base64')
const pffPayload = JSON.parse(gunzipSync(bytes).toString('utf-8')) as PffPayload

const pool        = buildPool(combine, draft)
const pffProfiles = normalizePff(pffPayload.profiles)

// Build PFF lookup by clean name + season
const pffByKey = new Map<string, PffProfile>()
for (const p of pffProfiles) {
  pffByKey.set(`${clean(p.name)}|${p.draftSeason}`, p)
}

console.log(`✓  pool=${pool.length} pff=${pffProfiles.length}`)

// ── Run evaluation ────────────────────────────────────────────────────────────

type EvalRow = {
  player: Historical
  projScore: number
  projAv: number
  actualAv: number
  hasPff: boolean
}

const evalSet = pool.filter((p) =>
  p.year >= 2000 &&
  p.year <= yearMax &&
  p.pick < 260 &&
  KNOWN_POSITIONS.has(p.pos) &&
  (!filterPos || p.pos === filterPos)
)

console.log(`Evaluating ${evalSet.length} players (year ≤ ${yearMax}${filterPos ? `, pos=${filterPos}` : ''})...`)

const results: EvalRow[] = []
let done = 0
const start = Date.now()

for (const player of evalSet) {
  const pff = pffByKey.get(`${clean(player.name)}|${player.year}`)
  const prospect = toProspect(player, pff)
  const proj = project(prospect, pool, pffProfiles, player.id)
  results.push({
    player,
    projScore: proj.score,
    projAv: proj.expectedAv,
    actualAv: player.av,
    hasPff: !!pff,
  })
  done++
  if (done % 200 === 0) {
    const elapsed = (Date.now() - start) / 1000
    process.stdout.write(`  ${done}/${evalSet.length} (${elapsed.toFixed(1)}s)\r`)
  }
}

const elapsed = ((Date.now() - start) / 1000).toFixed(1)
console.log(`  Done in ${elapsed}s                    `)

// ── Compute overall metrics ───────────────────────────────────────────────────

function metrics(rows: EvalRow[]): { rho: number; maeAv: number; rmseAv: number; n: number; medAv: number } {
  if (rows.length < 3) return { rho: NaN, maeAv: NaN, rmseAv: NaN, n: rows.length, medAv: NaN }
  const scores  = rows.map((r) => r.projScore)
  const projAvs = rows.map((r) => r.projAv)
  const actuals = rows.map((r) => r.actualAv)
  return {
    rho:    spearman(scores, actuals),
    maeAv:  mae(projAvs, actuals),
    rmseAv: rmse(projAvs, actuals),
    n:      rows.length,
    medAv:  median(actuals),
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════')
console.log(' OVERALL')
console.log('══════════════════════════════════════════════════════')
const overall = metrics(results)
console.log(`  n=${overall.n}  Spearman ρ=${fmt(overall.rho)}  MAE=${fmt(overall.maeAv, 1)} AV  RMSE=${fmt(overall.rmseAv, 1)} AV  median actual AV=${fmt(overall.medAv, 1)}`)

// By position
console.log('\n── By position ───────────────────────────────────────')
const byPos: Record<string, EvalRow[]> = {}
for (const r of results) {
  ;(byPos[r.player.pos] ??= []).push(r)
}
for (const pos of ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S']) {
  const rows = byPos[pos]
  if (!rows || rows.length < 5) continue
  const m = metrics(rows)
  console.log(`  ${pos.padEnd(3)} n=${String(m.n).padStart(3)}  ρ=${fmt(m.rho)}  MAE=${fmt(m.maeAv, 1)}  RMSE=${fmt(m.rmseAv, 1)}`)
}

// By pick range
console.log('\n── By pick range ─────────────────────────────────────')
const pickRanges = [
  { label: 'Rd 1  (1-32)',   lo: 1,   hi: 32  },
  { label: 'Rd 2  (33-64)',  lo: 33,  hi: 64  },
  { label: 'Rd 3  (65-100)', lo: 65,  hi: 100 },
  { label: 'Rd 4-5 (101-160)', lo: 101, hi: 160 },
  { label: 'Rd 6-7 (161+)',  lo: 161, hi: 999 },
]
for (const { label, lo, hi } of pickRanges) {
  const rows = results.filter((r) => r.player.pick >= lo && r.player.pick <= hi)
  if (rows.length < 5) continue
  const m = metrics(rows)
  console.log(`  ${label.padEnd(20)} n=${String(m.n).padStart(3)}  ρ=${fmt(m.rho)}  MAE=${fmt(m.maeAv, 1)}  RMSE=${fmt(m.rmseAv, 1)}`)
}

// By PFF availability
const withPff    = results.filter((r) => r.hasPff)
const withoutPff = results.filter((r) => !r.hasPff)
if (withPff.length >= 10 && withoutPff.length >= 10) {
  console.log('\n── PFF data availability ─────────────────────────────')
  const mp = metrics(withPff), mn = metrics(withoutPff)
  console.log(`  With PFF    n=${String(mp.n).padStart(3)}  ρ=${fmt(mp.rho)}  MAE=${fmt(mp.maeAv, 1)}  RMSE=${fmt(mp.rmseAv, 1)}`)
  console.log(`  Without PFF n=${String(mn.n).padStart(3)}  ρ=${fmt(mn.rho)}  MAE=${fmt(mn.maeAv, 1)}  RMSE=${fmt(mn.rmseAv, 1)}`)
}

// By draft year band
console.log('\n── By draft year ─────────────────────────────────────')
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
  console.log(`  ${label.padEnd(12)} n=${String(m.n).padStart(3)}  ρ=${fmt(m.rho)}  MAE=${fmt(m.maeAv, 1)}  RMSE=${fmt(m.rmseAv, 1)}`)
}

// Verbose: worst misses
if (verbose) {
  console.log('\n── Largest absolute misses (expectedAv vs actualAv) ─')
  const sorted = [...results].sort((a, b) => Math.abs(b.projAv - b.actualAv) - Math.abs(a.projAv - a.actualAv)).slice(0, 20)
  for (const r of sorted) {
    const err = (r.projAv - r.actualAv).toFixed(1)
    const sign = r.projAv > r.actualAv ? '+' : ''
    console.log(`  ${r.player.name.padEnd(22)} ${r.player.pos} ${r.player.year} pick ${String(r.player.pick).padStart(3)}  actual=${String(r.actualAv).padStart(3)}  proj=${r.projAv.toFixed(1).padStart(5)}  err=${sign}${err}`)
  }
}

console.log('')
