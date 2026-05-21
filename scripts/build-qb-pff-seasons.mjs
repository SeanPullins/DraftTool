#!/usr/bin/env node
// Build public/data/qb_pff_seasons.json from PFF college passing summary CSVs.
// Year mapping:
//   passing_summary (2).csv  → 2025
//   passing_summary (3).csv  → 2024
//   passing_summary (4).csv  → 2023
//   passing_summary (5).csv  → 2022 (merge with file 25)
//   passing_summary (6).csv  → 2021
//   passing_summary (7).csv  → 2020
//   passing_summary (8).csv  → 2019
//   passing_summary (19).csv → 2018
//   passing_summary (20).csv → 2017
//   passing_summary (25).csv → 2022 (merge with file 5, dedup by player_id, keep higher dropbacks)
//   passing_summary (30).csv → 2016
//   passing_summary (32).csv → 2015

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_PATH = resolve(__dirname, '../public/data/qb_pff_seasons.json')

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
  const [head, ...body] = rows.filter((r) => r.some(Boolean))
  if (!head) return []
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])))
}

function parseNum(s) {
  if (!s || s.trim() === '') return null
  const x = parseFloat(s.replace(/,/g, ''))
  return isFinite(x) ? x : null
}

// ── Convert a raw CSV row to a season record ──────────────────────────────────

function toRecord(row, season) {
  return {
    name:                 row.player ?? '',
    player_id:            parseNum(row.player_id),
    season,
    team:                 row.team_name ?? '',
    games:                parseNum(row.player_game_count),
    dropbacks:            parseNum(row.dropbacks),
    grades_pass:          parseNum(row.grades_pass),
    grades_offense:       parseNum(row.grades_offense),
    accuracy_percent:     parseNum(row.accuracy_percent),
    btt_rate:             parseNum(row.btt_rate),
    twp_rate:             parseNum(row.twp_rate),
    epa:                  parseNum(row.epa),
    positive_epa_percent: parseNum(row.positive_epa_percent),
    ypa:                  parseNum(row.ypa),
    avg_depth_of_target:  parseNum(row.avg_depth_of_target),
    avg_time_to_throw:    parseNum(row.avg_time_to_throw),
    pressure_to_sack_rate:parseNum(row.pressure_to_sack_rate),
    sack_percent:         parseNum(row.sack_percent),
  }
}

// ── File → year mapping ───────────────────────────────────────────────────────

const FILE_MAP = [
  { file: '/tmp/passing_summary (2).csv',  year: 2025 },
  { file: '/tmp/passing_summary (3).csv',  year: 2024 },
  { file: '/tmp/passing_summary (4).csv',  year: 2023 },
  { file: '/tmp/passing_summary (5).csv',  year: 2022 },
  { file: '/tmp/passing_summary (6).csv',  year: 2021 },
  { file: '/tmp/passing_summary (7).csv',  year: 2020 },
  { file: '/tmp/passing_summary (8).csv',  year: 2019 },
  { file: '/tmp/passing_summary (19).csv', year: 2018 },
  { file: '/tmp/passing_summary (20).csv', year: 2017 },
  { file: '/tmp/passing_summary (25).csv', year: 2022 },  // merge with file 5
  { file: '/tmp/passing_summary (30).csv', year: 2016 },
  { file: '/tmp/passing_summary (32).csv', year: 2015 },
]

// ── Load and merge ────────────────────────────────────────────────────────────

// Group files by year; year 2022 has two files
const byYear = new Map()
for (const { file, year } of FILE_MAP) {
  if (!byYear.has(year)) byYear.set(year, [])
  byYear.get(year).push(file)
}

const allRecords = []
const perYear = {}

for (const [year, files] of byYear.entries()) {
  // Read all records for this year from all files
  const yearRows = []
  for (const file of files) {
    let text
    try {
      text = readFileSync(file, 'utf-8')
    } catch (e) {
      console.error(`  ERROR: Could not read ${file}: ${e.message}`)
      continue
    }
    const rows = parseCsv(text)
    for (const row of rows) {
      if (row.position !== 'QB' && row.position !== undefined) {
        // filter only QBs (some files may have other positions)
        if (row.position && row.position.toUpperCase() !== 'QB') continue
      }
      yearRows.push(toRecord(row, year))
    }
  }

  // Deduplicate by player_id: keep the row with higher dropbacks
  const byPlayerId = new Map()
  for (const rec of yearRows) {
    const pid = rec.player_id
    if (pid == null) {
      // No player_id, always include
      allRecords.push(rec)
      continue
    }
    const existing = byPlayerId.get(pid)
    if (!existing) {
      byPlayerId.set(pid, rec)
    } else {
      // Keep the one with higher dropbacks
      const existDB = existing.dropbacks ?? 0
      const newDB = rec.dropbacks ?? 0
      if (newDB > existDB) {
        byPlayerId.set(pid, rec)
      }
    }
  }
  const deduped = [...byPlayerId.values()]
  allRecords.push(...deduped)
  perYear[year] = deduped.length
}

// Sort by season desc, then by dropbacks desc
allRecords.sort((a, b) => b.season - a.season || (b.dropbacks ?? 0) - (a.dropbacks ?? 0))

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\nQB PFF Season Import Summary`)
console.log(`  Total records: ${allRecords.length}`)
console.log(`\n  Records per year:`)
for (const year of Object.keys(perYear).sort((a, b) => Number(b) - Number(a))) {
  console.log(`    ${year}: ${perYear[year]}`)
}
const highVolume = allRecords.filter((r) => (r.dropbacks ?? 0) >= 100)
console.log(`\n  Records with dropbacks >= 100: ${highVolume.length}`)
console.log(`  Records with dropbacks >= 150: ${allRecords.filter((r) => (r.dropbacks ?? 0) >= 150).length}`)
console.log(`  Records with dropbacks >= 300: ${allRecords.filter((r) => (r.dropbacks ?? 0) >= 300).length}`)

// ── Write output ──────────────────────────────────────────────────────────────

const output = { records: allRecords }
writeFileSync(OUT_PATH, JSON.stringify(output, null, 2))
console.log(`\n  Written to: ${OUT_PATH}`)
