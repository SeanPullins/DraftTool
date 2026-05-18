/**
 * Processes raw QB passing season data from two Sports Reference exports:
 *   1. scripts/source/qb_nfl_seasons_top200_raw.xls  – ranks 1-200 (HTML table)
 *   2. scripts/source/qb_nfl_seasons_raw.json         – ranks 201-400 (cleaned JSON)
 *
 * Output: public/data/qb_seasons.json
 * Run:    node scripts/process-qb-seasons.mjs
 *
 * Column layout for the XLS (PFR passing season finder export):
 *   0:Rk  1:Player  2:Cmp(dup)  3:Season  4:Age  5:Team  6:G  7:GS
 *   8:Cmp  9:Att  10:Inc  11:Cmp%  12:Yds  13:TD  14:Int  15:Pick6
 *   16:TD%  17:Int%  18:Rate  19:Sk  20:SkYds  21:Sk%  22:Y/A
 *   23:AY/A  24:ANY/A  25:Y/C  26:Y/G  27:Succ%  28:W  29:L  30:T
 *   31:4QC  32:GWD  33:Pos
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function clean(s = '') {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
}

function num(s) {
  const v = parseFloat(s)
  return isNaN(v) ? null : v
}

function int(s) {
  const v = parseInt(s, 10)
  return isNaN(v) ? null : v
}

// ── Parse PFR HTML/XLS ────────────────────────────────────────────────────────
function parseXlsRows(html) {
  const rows = []
  // Extract all <tr> blocks
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
  const tagRe = /<[^>]+>/g
  let trM
  while ((trM = trRe.exec(html)) !== null) {
    const cells = []
    let tdM
    const inner = trM[1]
    const localTd = new RegExp(tdRe.source, 'gi')
    while ((tdM = localTd.exec(inner)) !== null) {
      const text = tdM[1]
        .replace(tagRe, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#160;/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .trim()
      cells.push(text)
    }
    if (cells.length > 0) rows.push(cells)
  }
  return rows
}

function xlsRowToRecord(r) {
  const season = int(r[3])
  const pos = r[33] ?? ''
  if (!pos.startsWith('QB')) return null
  if (season === null || season < 2000) return null
  return {
    rank: int(r[0]),
    key: clean(r[1]),
    name: r[1],
    season,
    team: r[5],
    games: int(r[6]),
    gs: int(r[7]),
    att: int(r[9]),
    cmp_pct: num(r[11]),
    rtg: num(r[18]),
    td_pct: num(r[16]),
    int_pct: num(r[17]),
    sk_pct: num(r[21]),
    any_a: num(r[24]),
    succ: num(r[27]),
    ypa: num(r[22]),
  }
}

// ── Source 1: top-200 XLS ─────────────────────────────────────────────────────
const xlsPath = join(__dirname, 'source/qb_nfl_seasons_top200_raw.xls')
const xlsHtml = readFileSync(xlsPath, 'utf8')
const xlsAllRows = parseXlsRows(xlsHtml)
// Find the first row where index 0 === 'Rk' — that's the column header
const headerIdx = xlsAllRows.findIndex((r) => r[0] === 'Rk')
const xlsDataRows = xlsAllRows.slice(headerIdx + 1).filter((r) => /^\d+$/.test(r[0]))
const top200Records = xlsDataRows.map(xlsRowToRecord).filter(Boolean)

// ── Source 2: ranks 201-400 JSON ─────────────────────────────────────────────
const jsonPath = join(__dirname, 'source/qb_nfl_seasons_raw.json')
const raw = JSON.parse(readFileSync(jsonPath, 'utf8'))
const bot200Records = raw.records.map((r) => ({
  rank: r.rank,
  key: clean(r.player),
  name: r.player,
  season: r.season,
  team: r.team,
  games: r.games,
  gs: r.games_started,
  att: r.pass_att,
  cmp_pct: r.pass_cmp_pct ?? null,
  rtg: r.pass_rating ?? null,
  td_pct: r.pass_td_pct ?? null,
  int_pct: r.pass_int_pct ?? null,
  sk_pct: r.sack_pct ?? null,
  any_a: r.adjusted_net_yards_per_attempt ?? null,
  succ: r.success_pct ?? null,
  ypa: r.yards_per_attempt ?? null,
}))

// ── Merge & deduplicate ───────────────────────────────────────────────────────
// Prefer the lower-rank (better) record when both sources contain the same (player, season)
const seen = new Map()
for (const rec of [...top200Records, ...bot200Records]) {
  const k = `${rec.key}_${rec.season}`
  if (!seen.has(k)) {
    seen.set(k, rec)
  } else {
    const existing = seen.get(k)
    // Keep the one with the lower rank number (better season)
    if (rec.rank !== null && (existing.rank === null || rec.rank < existing.rank)) {
      seen.set(k, rec)
    }
  }
}
const records = Array.from(seen.values()).sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))

// ── Write output ──────────────────────────────────────────────────────────────
const outDir = join(__dirname, '../public/data')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'qb_seasons.json'), JSON.stringify({ records }, null, 2))

const uniqueQbs = new Set(records.map((r) => r.key)).size
const seasons = [...new Set(records.map((r) => r.season))].sort()
console.log(`✓ Wrote ${records.length} QB season records | ${uniqueQbs} unique QBs | seasons ${seasons[0]}–${seasons[seasons.length - 1]}`)
console.log(`  top-200 slice:    ${top200Records.length} records`)
console.log(`  201-400 slice:    ${bot200Records.length} records`)
console.log(`  after dedup:      ${records.length} records`)
console.log(`  Output: public/data/qb_seasons.json`)
