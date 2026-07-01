// Shared data-loading + feature-prep helpers for the model evaluation harness
// (scripts/evaluate-model.mts) and the calibration fitting script
// (scripts/fit-calibration-model.mts). Kept in one place so the two never
// reimplement CSV parsing / prospect construction differently and drift apart —
// that drift is exactly what happened between scripts/fit-calibration-models.py
// (stale, missing athletic/size features) and the live model.
//
// Pure data-shape helpers only — no CLI flags, no eval-loop logic.

import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { clean, computeQbTrajectory, group } from '../../src/model.ts'
import type { Historical, PffProfile, Prospect, Category, QbPffSeason, Y1NflStats } from '../../src/model.ts'

// ── CSV parsing ───────────────────────────────────────────────────────────────

export function parseCsv(text: string): Record<string, string>[] {
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

export function n(s: string | undefined): number | null {
  if (!s || s.trim() === '') return null
  const x = parseFloat(s.replace(/,/g, ''))
  return isFinite(x) ? x : null
}

export function ht(s: string | undefined): number | null {
  if (!s) return null
  const m = s.match(/^(\d+)-(\d+)$/)
  if (m) return parseInt(m[1]) * 12 + parseInt(m[2])
  const v = parseFloat(s)
  return isFinite(v) ? v : null
}

export function norm(p: string): string {
  const x = p.toUpperCase().trim()
  if (['OT', 'G', 'T', 'LT', 'RT', 'OG', 'C', 'OL', 'IOL', 'OC'].includes(x)) return 'OL'
  if (['DE', 'DT', 'NT', 'DL', 'IDL', 'DI', 'OLB', 'EDGE', 'ED'].includes(x)) return 'DL'
  if (['ILB', 'MLB', 'WILL', 'MIKE', 'SAM'].includes(x)) return 'LB'
  if (['FS', 'SS', 'DB', 'SAF'].includes(x)) return 'S'
  if (x === 'FB') return 'RB'
  return x
}

export function avToCat(av: number, games: number, starts: number, pb: number, ap: number): Category {
  if (ap || pb >= 2 || av >= 70) return 'Star'
  if (pb || av >= 45 || (starts >= 5 && av >= 35)) return 'High-end starter'
  if (av >= 24 || starts >= 3 || (games >= 64 && av >= 18)) return 'Starter'
  if (av >= 10 || games >= 48) return 'Role'
  if (av >= 4 || games >= 17) return 'Reserve'
  return 'Bust'
}

// ── Position defaults (mirrors App.tsx positionDefaults) ─────────────────────

export const positionDefaults: Record<string, Partial<Prospect>> = {
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

export const KNOWN_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S'])

// ── Build historical pool ─────────────────────────────────────────────────────

export function toHistorical(cr: Record<string, string>, dr: Record<string, string> | undefined, idx: number, year: number): Historical {
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

export function buildPool(combine: Record<string, string>[], draft: Record<string, string>[]): Historical[] {
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

// ── Normalize PFF profiles ────────────────────────────────────────────────────

type CompactPffOutcome = [number, number, number, number, number, number, Category, number?]
type CompactPffProfile = [string, string, string, number, number, number, number, number, number, CompactPffOutcome | null]
type RawPff = PffProfile | CompactPffProfile
type PffPayload = { profiles: RawPff[] }

export function normalizePff(profiles: RawPff[]): PffProfile[] {
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

export function toProspect(player: Historical, qbPffSeasons: QbPffSeason[], pff?: PffProfile, ras?: RasRecord | null): Prospect {
  const def = positionDefaults[player.pos] ?? {}
  // Film defaults at neutral 70 regardless of pick; pick-correlated defaults
  // duplicate the draft signal and add noise (confirmed by signal ablation).
  // PFF grades replace the neutral default when a match is found.
  // Walk-forward safe: qbTrajectory uses draftYear-1 and draftYear-2 — no future leakage.
  const qbTrajectory = player.pos === 'QB'
    ? computeQbTrajectory(player.year, player.name, qbPffSeasons)
    : null
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
    officialRas:  ras?.ras  ?? null,
    alltimeRas:   ras?.alltimeRas ?? null,
    qbTrajectory,
  }
}

// ── RAS lookup helpers ────────────────────────────────────────────────────────

export type RasRecord = { ras: number | null; alltimeRas: number | null; sourceUrl: string }

export function normRasPos(p: string): string {
  const x = p.toUpperCase().trim()
  if (['OT', 'OG', 'OC', 'G', 'T', 'C', 'OL'].includes(x)) return 'OL'
  if (['DE', 'DT', 'NT', 'OLB'].includes(x)) return 'DL'
  if (['ILB', 'MLB'].includes(x)) return 'LB'
  if (['FS', 'SS', 'DB'].includes(x)) return 'S'
  if (x === 'FB') return 'RB'
  return x  // QB, WR, RB, TE, LB, CB pass through
}

export function buildRasLookup(rows: Record<string, string>[]) {
  const byNYP = new Map<string, RasRecord>()
  const byNY  = new Map<string, RasRecord | null>()
  for (const row of rows) {
    const rPos = normRasPos(row.pos ?? '')
    if (!KNOWN_POSITIONS.has(rPos)) continue
    const yr = parseInt(row.year ?? '')
    if (!isFinite(yr)) continue
    const rec: RasRecord = {
      ras: row.ras && row.ras.trim() !== '' ? parseFloat(row.ras) : null,
      alltimeRas: row.alltime_ras && row.alltime_ras.trim() !== '' ? parseFloat(row.alltime_ras) : null,
      sourceUrl: row.source_url ?? '',
    }
    const pk = `${clean(row.name ?? '')}|${yr}|${rPos}`
    byNYP.set(pk, rec)
    const fk = `${clean(row.name ?? '')}|${yr}`
    if (!byNY.has(fk)) byNY.set(fk, rec)
    else byNY.set(fk, null) // ambiguous — multiple positions in same year
  }
  return { byNYP, byNY }
}

export function getRas(name: string, year: number, pos: string, lookup: ReturnType<typeof buildRasLookup>): RasRecord | null {
  const pk = `${clean(name)}|${year}|${pos}`
  if (lookup.byNYP.has(pk)) return lookup.byNYP.get(pk)!
  const fk = `${clean(name)}|${year}`
  const fb = lookup.byNY.get(fk)
  return fb ?? null  // null means ambiguous or not found
}

// Compute mean AV by pick range (×posGroup) from a training set.
// Used for true walk-forward slot baselines and slot-value ratio diagnostics.
export function computeSlotBaselines(trainRows: Historical[]): Map<string, number> {
  const bands = [
    { key: '1-32',   lo: 1,   hi: 32  },
    { key: '33-64',  lo: 33,  hi: 64  },
    { key: '65-100', lo: 65,  hi: 100 },
    { key: '101-160',lo: 101, hi: 160 },
    { key: '161+',   lo: 161, hi: 999 },
  ]
  const posGroups = ['QB', 'SKILL', 'OL', 'FRONT', 'DB']
  const out = new Map<string, number>()
  for (const pg of posGroups) {
    const pgRows = trainRows.filter((r) => (group[r.pos] ?? 'SKILL') === pg)
    for (const b of bands) {
      const band = pgRows.filter((r) => r.pick >= b.lo && r.pick <= b.hi)
      const mu = band.length >= 5 ? band.reduce((s, r) => s + (r.av || 0), 0) / band.length : null
      // Fall back to global band average if position group has too few players
      const globalBand = trainRows.filter((r) => r.pick >= b.lo && r.pick <= b.hi)
      out.set(`${pg}|${b.key}`, mu ?? (globalBand.length ? globalBand.reduce((s, r) => s + (r.av || 0), 0) / globalBand.length : 0))
    }
  }
  return out
}

export function getSlotBaseline(baselines: Map<string, number>, posGroup: string, pick: number): number {
  const bandKey = pick <= 32 ? '1-32' : pick <= 64 ? '33-64' : pick <= 100 ? '65-100' : pick <= 160 ? '101-160' : '161+'
  return baselines.get(`${posGroup}|${bandKey}`) ?? baselines.get(`SKILL|${bandKey}`) ?? 0
}

// ── Statistical metrics ───────────────────────────────────────────────────────

export function rankArray(arr: number[]): number[] {
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

export function spearman(xs: number[], ys: number[]): number {
  if (xs.length < 3) return NaN
  const rx = rankArray(xs), ry = rankArray(ys)
  const nd = xs.length
  const d2 = rx.reduce((s, r, i) => s + (r - ry[i]) ** 2, 0)
  return 1 - 6 * d2 / (nd * (nd * nd - 1))
}

export function mae(pred: number[], actual: number[]): number {
  return pred.reduce((s, p, i) => s + Math.abs(p - actual[i]), 0) / pred.length
}

export function rmse(pred: number[], actual: number[]): number {
  return Math.sqrt(pred.reduce((s, p, i) => s + (p - actual[i]) ** 2, 0) / pred.length)
}

export function bias(pred: number[], actual: number[]): number {
  return pred.reduce((s, p, i) => s + (p - actual[i]), 0) / pred.length
}

export function bootstrapCI(scores: number[], actuals: number[], iters = 500): [number, number] {
  const n = scores.length
  const rhos: number[] = []
  for (let i = 0; i < iters; i++) {
    const idx = Array.from({ length: n }, () => Math.floor(Math.random() * n))
    rhos.push(spearman(idx.map((j) => scores[j]), idx.map((j) => actuals[j])))
  }
  rhos.sort((a, b) => a - b)
  return [rhos[Math.floor(0.025 * iters)], rhos[Math.floor(0.975 * iters)]]
}

export function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function fmt(x: number, dp = 3): string {
  return isNaN(x) ? ' N/A ' : x.toFixed(dp)
}

export function fmtBias(x: number, dp = 1): string {
  if (isNaN(x)) return '  N/A'
  const s = x >= 0 ? '+' : ''
  return `${s}${x.toFixed(dp)}`
}

// ── Full data load ────────────────────────────────────────────────────────────

export type EvalData = {
  pool: Historical[]
  pffProfiles: PffProfile[]
  pffByKey: Map<string, PffProfile>
  rasLookup: ReturnType<typeof buildRasLookup>
  rasRowCount: number
  qbPffSeasons: QbPffSeason[]
  y1NflStats: Y1NflStats
}

// dataDir must end with a trailing slash (e.g. new URL('../../public/data/', import.meta.url).pathname)
export function loadEvalData(dataDir: string): EvalData {
  const combine    = parseCsv(readFileSync(dataDir + 'combine.csv', 'utf-8'))
  const draft      = parseCsv(readFileSync(dataDir + 'draft_picks.csv', 'utf-8'))
  const b64        = readFileSync(dataDir + 'pff_comparison_profiles.json.gz.b64', 'utf-8').replace(/\s/g, '')
  const pffPayload = JSON.parse(gunzipSync(Buffer.from(b64, 'base64')).toString('utf-8')) as PffPayload

  const pool        = buildPool(combine, draft)
  const pffProfiles = normalizePff(pffPayload.profiles)

  const pffByKey = new Map<string, PffProfile>()
  for (const p of pffProfiles) pffByKey.set(`${clean(p.name)}|${p.draftSeason}`, p)

  const rasRows   = parseCsv(readFileSync(dataDir + 'ras_main_table.csv', 'utf-8'))
  const rasLookup = buildRasLookup(rasRows)

  const qbPffSeasonsRaw = JSON.parse(readFileSync(dataDir + 'qb_pff_seasons.json', 'utf-8'))
  const qbPffSeasons: QbPffSeason[] = qbPffSeasonsRaw.records

  const y1NflStatsRaw = JSON.parse(readFileSync(dataDir + 'y1_nfl_stats.json', 'utf-8'))
  const y1NflStats: Y1NflStats = y1NflStatsRaw

  return { pool, pffProfiles, pffByKey, rasLookup, rasRowCount: rasRows.length, qbPffSeasons, y1NflStats }
}
