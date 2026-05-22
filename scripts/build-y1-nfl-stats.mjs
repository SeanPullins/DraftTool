#!/usr/bin/env node
// Build y1_nfl_stats.json from player_stats_season.csv
// Extracts one record per (player, season) for REG season only.

import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const DATA = new URL('../public/data/', import.meta.url).pathname

// ── CSV parser ────────────────────────────────────────────────────────────────

function parseCsv(text) {
  const rows = []
  let row = []
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
  const [head, ...body] = rows.filter(r => r.some(Boolean))
  return body.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), r[i]?.trim() || ''])))
}

// ── Key generator (mirrors model.ts clean()) ──────────────────────────────────

function clean(s = '') {
  return s.toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

// ── Numeric helpers ───────────────────────────────────────────────────────────

function n(s) {
  if (!s || s.trim() === '') return null
  const x = parseFloat(s.replace(/,/g, ''))
  return isFinite(x) ? x : null
}

function safeDiv(a, b) {
  if (a == null || b == null || b === 0) return null
  const r = a / b
  return isFinite(r) ? r : null
}

function safeN(x) {
  if (x == null || !isFinite(x)) return null
  return x
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

// NFL passer rating formula
function passerRating(att, completions, yards, tds, ints) {
  if (!att || att < 1) return null
  const cmp_pct = completions / att * 100
  const ypa = yards / att
  const td_pct = tds / att * 100
  const int_pct = ints / att * 100
  const a = clamp((cmp_pct - 30) * 0.05, 0, 2.375)
  const b = clamp((ypa - 3) * 0.25, 0, 2.375)
  const c = clamp(td_pct * 0.2, 0, 2.375)
  const d = clamp((2.375 - int_pct * 0.25), 0, 2.375)
  const rtg = (a + b + c + d) / 6 * 100
  return isFinite(rtg) ? rtg : null
}

// ── Load data ─────────────────────────────────────────────────────────────────

process.stdout.write('Loading player_stats_season.csv... ')
const rows = parseCsv(readFileSync(DATA + 'player_stats_season.csv', 'utf-8'))
console.log(`${rows.length} rows`)

// ── Filter REG season only ────────────────────────────────────────────────────

const reg = rows.filter(r => r.season_type === 'REG')
console.log(`REG rows: ${reg.length}`)

// ── Build output arrays ───────────────────────────────────────────────────────

const qb = []
const wr = []
const rb = []
const te = []

for (const row of reg) {
  const pos = (row.position || '').toUpperCase()
  const season = parseInt(row.season)
  if (!isFinite(season)) continue

  const displayName = row.player_display_name || row.player_name || ''
  if (!displayName) continue

  const key = clean(displayName)
  const games = n(row.games) != null ? Math.round(n(row.games)) : null

  if (pos === 'QB') {
    const att = n(row.attempts)
    if (att == null || att < 20) continue

    const completions = n(row.completions)
    const yards = n(row.passing_yards)
    const tds = n(row.passing_tds)
    const ints = n(row.interceptions)
    const passingEpa = n(row.passing_epa)

    const cmp_pct = safeN(safeDiv(completions, att) != null ? completions / att * 100 : null)
    const ypa = safeN(safeDiv(yards, att))
    const rtg = passerRating(att, completions ?? 0, yards ?? 0, tds ?? 0, ints ?? 0)
    const epa_per_att = safeN(safeDiv(passingEpa, att))

    qb.push({
      key,
      season,
      games: games ?? null,
      att: Math.round(att),
      cmp_pct: cmp_pct != null ? Math.round(cmp_pct * 10) / 10 : null,
      rtg: rtg != null ? Math.round(rtg * 10) / 10 : null,
      ypa: ypa != null ? Math.round(ypa * 100) / 100 : null,
      epa_per_att: epa_per_att != null ? Math.round(epa_per_att * 1000) / 1000 : null,
    })
  } else if (pos === 'WR') {
    const tgt = n(row.targets)
    if (tgt == null || tgt < 10) continue

    const rec = n(row.receptions)
    const yds = n(row.receiving_yards)
    const receivingEpa = n(row.receiving_epa)

    const ypr = safeN(safeDiv(yds, rec))
    const ctch_pct = safeN(safeDiv(rec, tgt) != null ? rec / tgt * 100 : null)
    const epa_per_tgt = safeN(safeDiv(receivingEpa, tgt))

    wr.push({
      key,
      season,
      games: games ?? null,
      tgt: Math.round(tgt),
      rec: rec != null ? Math.round(rec) : null,
      yds: yds != null ? Math.round(yds) : null,
      ypr: ypr != null ? Math.round(ypr * 100) / 100 : null,
      ctch_pct: ctch_pct != null ? Math.round(ctch_pct * 10) / 10 : null,
      epa_per_tgt: epa_per_tgt != null ? Math.round(epa_per_tgt * 1000) / 1000 : null,
    })
  } else if (pos === 'TE') {
    const tgt = n(row.targets)
    if (tgt == null || tgt < 10) continue

    const rec = n(row.receptions)
    const yds = n(row.receiving_yards)
    const receivingEpa = n(row.receiving_epa)

    const ypr = safeN(safeDiv(yds, rec))
    const ctch_pct = safeN(safeDiv(rec, tgt) != null ? rec / tgt * 100 : null)
    const epa_per_tgt = safeN(safeDiv(receivingEpa, tgt))

    te.push({
      key,
      season,
      games: games ?? null,
      tgt: Math.round(tgt),
      rec: rec != null ? Math.round(rec) : null,
      yds: yds != null ? Math.round(yds) : null,
      ypr: ypr != null ? Math.round(ypr * 100) / 100 : null,
      ctch_pct: ctch_pct != null ? Math.round(ctch_pct * 10) / 10 : null,
      epa_per_tgt: epa_per_tgt != null ? Math.round(epa_per_tgt * 1000) / 1000 : null,
    })
  } else if (pos === 'RB') {
    const carries = n(row.carries)
    if (carries == null || carries < 10) continue

    const rushYds = n(row.rushing_yards)
    const rushingEpa = n(row.rushing_epa)

    const rush_ypa = safeN(safeDiv(rushYds, carries))
    const epa_per_carry = safeN(safeDiv(rushingEpa, carries))

    rb.push({
      key,
      season,
      games: games ?? null,
      rush_att: Math.round(carries),
      rush_yds: rushYds != null ? Math.round(rushYds) : null,
      rush_ypa: rush_ypa != null ? Math.round(rush_ypa * 100) / 100 : null,
      epa_per_carry: epa_per_carry != null ? Math.round(epa_per_carry * 1000) / 1000 : null,
    })
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

function yearRange(arr) {
  if (!arr.length) return 'N/A'
  const years = arr.map(r => r.season)
  return `${Math.min(...years)}–${Math.max(...years)}`
}

console.log(`\nSummary:`)
console.log(`  QB: ${qb.length} records  (${yearRange(qb)})`)
console.log(`  WR: ${wr.length} records  (${yearRange(wr)})`)
console.log(`  RB: ${rb.length} records  (${yearRange(rb)})`)
console.log(`  TE: ${te.length} records  (${yearRange(te)})`)
console.log(`  Total: ${qb.length + wr.length + rb.length + te.length} records`)

// ── Write output ──────────────────────────────────────────────────────────────

const out = { qb, wr, rb, te }
writeFileSync(DATA + 'y1_nfl_stats.json', JSON.stringify(out, null, 0))
console.log(`\nWrote public/data/y1_nfl_stats.json`)
