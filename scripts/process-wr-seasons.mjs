/**
 * Processes raw WR receiving season data from Sports Reference into a
 * compact lookup table keyed by normalized player name + season.
 *
 * Input:  scripts/source/wr_nfl_seasons_top200_raw.xls  (HTML table)
 * Output: public/data/wr_seasons.json
 * Run:    node scripts/process-wr-seasons.mjs
 *
 * Column layout (PFR receiving season finder export):
 *   0:Rk  1:Player  2:Tgt(dup)  3:Season  4:Age  5:Team  6:G  7:GS
 *   8:Tgt  9:Rec  10:Yds  11:Y/R  12:TD  13:Y/G  14:Ctch%  15:Y/Tgt
 *   16:1D  17:Succ%  18:Pos
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

function parseXlsRows(html) {
  const rows = []
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  const tagRe = /<[^>]+>/g
  let trM
  while ((trM = trRe.exec(html)) !== null) {
    const cells = []
    const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
    let tdM
    while ((tdM = tdRe.exec(trM[1])) !== null) {
      cells.push(
        tdM[1]
          .replace(tagRe, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#160;|&nbsp;/g, ' ')
          .trim(),
      )
    }
    if (cells.length > 0) rows.push(cells)
  }
  return rows
}

const xlsPath = join(__dirname, 'source/wr_nfl_seasons_top200_raw.xls')
const html = readFileSync(xlsPath, 'utf8')
const allRows = parseXlsRows(html)

const headerIdx = allRows.findIndex((r) => r[0] === 'Rk')
const dataRows = allRows.slice(headerIdx + 1).filter((r) => /^\d+$/.test(r[0]))

const records = dataRows
  .filter((r) => (r[18] ?? '').startsWith('WR') || (r[18] ?? '').startsWith('TE'))
  .map((r) => ({
    rank: int(r[0]),
    key: clean(r[1]),
    name: r[1],
    season: int(r[3]),
    team: r[5],
    games: int(r[6]),
    gs: int(r[7]),
    tgt: int(r[8]),
    rec: int(r[9]),
    yds: int(r[10]),
    ypr: num(r[11]),
    td: int(r[12]),
    ypg: num(r[13]),
    ctch_pct: num(r[14]),
    succ: num(r[17]),
    pos: r[18] ?? 'WR',
  }))
  .filter((r) => r.season !== null && r.season >= 2000)

const outDir = join(__dirname, '../public/data')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'wr_seasons.json'), JSON.stringify({ records }, null, 2))

const uniquePlayers = new Set(records.map((r) => r.key)).size
const seasons = [...new Set(records.map((r) => r.season))].sort()
console.log(`✓ Wrote ${records.length} WR/TE season records | ${uniquePlayers} unique players | seasons ${seasons[0]}–${seasons[seasons.length - 1]}`)
console.log(`  Output: public/data/wr_seasons.json`)
