/**
 * Build 2027 QB Prospects JSON from PFF college passing data.
 * Sources:
 *   scripts/source/pff_qb_2025.csv  — 2025 college season (primary)
 *   scripts/source/pff_qb_2024.csv  — 2024 college season (prior-year context only)
 * Output:
 *   public/data/prospects_2027_qb.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')

function parseCsv(text) {
  const lines = text.trim().split('\n')
  if (!lines.length) return []
  const headers = lines[0].split(',').map((h) => h.trim())
  return lines.slice(1).map((line) => {
    const vals = line.split(',')
    return Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? '').trim()]))
  })
}

function num(row, col) {
  const v = parseFloat(row[col])
  return isNaN(v) ? null : v
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

function gradesToPick(gradesOff) {
  if (gradesOff >= 92) return Math.round(4 + (95 - gradesOff) * 1.0)
  if (gradesOff >= 88) return Math.round(8 + (92 - gradesOff) * 3.5)
  if (gradesOff >= 83) return Math.round(22 + (88 - gradesOff) * 5)
  if (gradesOff >= 77) return Math.round(47 + (83 - gradesOff) * 8)
  if (gradesOff >= 70) return Math.round(95 + (77 - gradesOff) * 8)
  return Math.min(250, Math.round(151 + (70 - gradesOff) * 6))
}

function extractStats(row) {
  return {
    games: num(row, 'player_game_count') ?? 0,
    dropbacks: Math.round(num(row, 'dropbacks') ?? 0),
    att: Math.round(num(row, 'attempts') ?? 0),
    ypa: +(num(row, 'ypa') ?? 0).toFixed(1),
    cmp_pct: +(num(row, 'completion_percent') ?? 0).toFixed(1),
    btt_rate: +(num(row, 'btt_rate') ?? 0).toFixed(1),
    twp_rate: +(num(row, 'twp_rate') ?? 0).toFixed(1),
    grades_offense: +(num(row, 'grades_offense') ?? 0).toFixed(1),
    grades_pass: +(num(row, 'grades_pass') ?? 0).toFixed(1),
    accuracy_percent: +(num(row, 'accuracy_percent') ?? 0).toFixed(1),
    positive_epa_percent: +(num(row, 'positive_epa_percent') ?? 0).toFixed(1),
    yards: Math.round(num(row, 'yards') ?? 0),
    tds: Math.round(num(row, 'touchdowns') ?? 0),
    ints: Math.round(num(row, 'interceptions') ?? 0),
  }
}

function buildProspect(row2025, row2024) {
  const row = row2025
  const gradesOff = num(row, 'grades_offense') ?? 50
  const gradesPass = num(row, 'grades_pass') ?? 50
  const bttRate = num(row, 'btt_rate') ?? 0
  const ypa = num(row, 'ypa') ?? 7.0
  const accuracyPct = num(row, 'accuracy_percent') ?? 65
  const posEpaPct = num(row, 'positive_epa_percent') ?? 40
  const twpRate = num(row, 'twp_rate') ?? 3.5
  const attToThrow = num(row, 'avg_time_to_throw') ?? 2.6
  const cmpPct = num(row, 'completion_percent') ?? 62
  const games = num(row, 'player_game_count') ?? 12
  const tds = num(row, 'touchdowns') ?? 0

  // 2024→2025 trajectory: grade delta drives optimism/pessimism for 2026 season
  const priorGrade = row2024 ? num(row2024, 'grades_offense') : null
  const priorDropbacks = row2024 ? (num(row2024, 'dropbacks') ?? 0) : 0
  // Only use trajectory when prior sample is meaningful (≥80 dropbacks in 2024)
  const gradeDelta = (priorGrade != null && priorDropbacks >= 80)
    ? Math.round((gradesOff - priorGrade) * 10) / 10
    : null
  const trajectoryLabel = gradeDelta == null ? 'unknown'
    : gradeDelta >= 8 ? 'rising'
    : gradeDelta <= -8 ? 'declining'
    : 'stable'

  // Trajectory boost: players on an upward arc project better into their 2026 season
  // Rising +8 pts grade → +~5 on film/production. Declining -8 → −5. Capped at ±8.
  const tBoost = gradeDelta != null ? clamp(gradeDelta * 0.55, -8, 8) : 0

  // Map PFF college grades → model PFF signals (1–99 scale)
  const pffComposite = clamp(Math.round(gradesOff), 45, 99)
  const pffGrade = clamp(Math.round(gradesPass), 45, 99)
  const pffProduction = clamp(Math.round(pffGrade * 0.5 + ypa * 3.5 + bttRate * 5 - 20), 30, 97)
  const pffEfficiency = clamp(Math.round((accuracyPct - 60) * 2.8 + (posEpaPct - 35) * 1.8), 25, 97)
  const pffClean = clamp(Math.round(100 - twpRate * 12), 20, 97)

  // Scouting signals — trajectory-adjusted for projected 2026 season arc
  const film = clamp(Math.round(gradesOff * 0.9 + tBoost * 0.7), 40, 95)
  const tdsPer12 = games > 0 ? (tds / games) * 12 : 0
  const production = clamp(Math.round(50 + (ypa - 7.0) * 5 + (cmpPct - 62) * 0.4 + tdsPer12 * 1.5 + tBoost * 0.5), 40, 95)
  const processing = clamp(Math.round(90 - (attToThrow - 2.3) * 18), 40, 92)

  const pick = gradesToPick(gradesOff)

  return {
    name: (row['player'] ?? '').trim(),
    school: (row['team_name'] ?? '').trim(),
    pos: 'QB',
    draftSeason: 2027,
    pick,
    age: 21.5,
    // QB positional averages — no combine data until after 2026 season
    height: 75, weight: 220, forty: 4.75, vertical: 32,
    broad: 112, cone: 7.15, shuttle: 4.35, bench: 0,
    film,
    production,
    fit: 72,
    health: 80,
    processing,
    pffProfileId: '',
    pffComposite,
    pffGrade,
    pffProduction,
    pffEfficiency,
    pffClean,
    schemeTag: '',
    trajectory: { gradeDelta, label: trajectoryLabel },
    rawStats: { season: 2025, ...extractStats(row) },
    priorStats: row2024 ? { season: 2024, ...extractStats(row2024) } : null,
  }
}

function cleanName(name) {
  return name.toLowerCase().replace(/[^a-z]/g, '')
}

// Load both CSVs
const csv2025 = parseCsv(readFileSync(join(root, 'scripts/source/pff_qb_2025.csv'), 'utf8'))
const csv2024 = parseCsv(readFileSync(join(root, 'scripts/source/pff_qb_2024.csv'), 'utf8'))

console.log(`2025 season: ${csv2025.length} rows`)
console.log(`2024 season: ${csv2024.length} rows`)

// Index 2024 by clean name for prior-year context lookup
const index2024 = new Map()
for (const row of csv2024) {
  const key = cleanName(row['player'] ?? '')
  if (key) index2024.set(key, row)
}

// Players who declared for (or were drafted in) the 2026 NFL Draft after the 2025 college season.
// These are NOT 2027 draft prospects and must be excluded.
// Drafted: Mendoza (#1 Raiders), Simpson (#13 Rams), Beck (#65 ARI), Allar (#76 PIT),
//          Klubnik (#110 NYJ), Green (#182 CLE), Kaliakmanis (#223 WSH), Nussmeier (#249 KC)
// Declared undrafted: Pavia (VAN), Aguilar (TEN), Gleason (TOL), Robertson (BAY),
//                     Fagnano (UConn→BAL), King (GT→CAR), Castellanos (FSU), Lewis (MEM)
const CLASS_2026 = new Set([
  'fernandomendoza', 'tysimpson', 'garrettnussmeier', 'drewallar',
  'carsonbeck', 'cadeklubnik', 'taylengreen', 'athankaliakmanis',
  'diegopavia', 'joeyaguilar', 'tuckergleason',
  'sawyerrobertson', 'joefagnano', 'haynesking', 'tommycastellanos', 'brendonlewis',
])

function is2026Class(name) {
  return CLASS_2026.has(cleanName(name))
}

// Build prospects from 2025 data ONLY (these are the 2027 draft eligible players)
// 2024 data is only used for prior-year context on the same player
const prospects = []
for (const row of csv2025) {
  const dropbacks = parseFloat(row['dropbacks']) || 0
  if (dropbacks < 50) continue

  const gradesOff = parseFloat(row['grades_offense']) || 0
  if (gradesOff < 55) continue

  const key = cleanName(row['player'] ?? '')
  if (!key) continue

  // Skip players who entered the 2026 draft class
  if (is2026Class(row['player'] ?? '')) continue

  const row2024 = index2024.get(key) ?? null
  prospects.push(buildProspect(row, row2024))
}

// Sort by PFF offense grade descending
prospects.sort((a, b) => b.pffComposite - a.pffComposite)

console.log(`Prospects (2025 season only): ${prospects.length}`)
console.log('Top 10:')
prospects.slice(0, 10).forEach((p, i) =>
  console.log(`  ${i + 1}. ${p.name} (${p.school}) grade=${p.pffComposite} pick=${p.pick}`)
)

const outDir = join(root, 'public/data')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'prospects_2027_qb.json'), JSON.stringify(prospects))
console.log(`\nWrote public/data/prospects_2027_qb.json (${prospects.length} QBs)`)
