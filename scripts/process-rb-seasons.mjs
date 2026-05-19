import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sourceDir = join(__dirname, 'source')
const outDir = join(__dirname, '..', 'public', 'data')

function clean(s = '') {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
}

function num(s) {
  const v = parseFloat(s)
  return isNaN(v) ? null : v
}

// Columns (0-indexed):
// 0:Rk 1:Player 2:Tgt(preview) 3:Att(preview) 4:Season 5:Age 6:Team 7:G 8:GS
// 9:rush_att 10:rush_yds 11:rush_ypa 12:rush_td 13:rush_ypg 14:rush_1d 15:rush_succ
// 16:tgt 17:rec 18:rec_yds 19:rec_ypr 20:rec_td 21:rec_ypg 22:ctch_pct 23:ytgt 24:rec_1d 25:rec_succ 26:Pos
function xlsToRecords(filePath) {
  const html = readFileSync(filePath, 'utf8')
  const rowRe = /<tr[^>]*>(.*?)<\/tr>/gs
  const cellRe = /<t[hd][^>]*>(.*?)<\/t[hd]>/gs
  const stripRe = /<[^>]+>/g

  const records = []
  let match
  while ((match = rowRe.exec(html)) !== null) {
    const cells = []
    let cm
    cellRe.lastIndex = 0
    while ((cm = cellRe.exec(match[1])) !== null) {
      cells.push(cm[1].replace(stripRe, '').replace(/\*/g, '').replace(/\+/g, '').trim())
    }
    if (!cells[0] || !cells[0].match(/^\d+$/)) continue
    const rank = parseInt(cells[0])
    const season = parseInt(cells[4])
    if (!cells[1] || isNaN(season)) continue

    records.push({
      rank,
      key: clean(cells[1]),
      name: cells[1],
      season,
      team: cells[6] ?? '',
      games: num(cells[7]) ?? 0,
      gs: num(cells[8]) ?? 0,
      rush_att: num(cells[9]),
      rush_yds: num(cells[10]),
      rush_ypa: num(cells[11]),
      rush_td: num(cells[12]),
      rush_ypg: num(cells[13]),
      rush_succ: num(cells[15]),
      tgt: num(cells[16]),
      rec: num(cells[17]),
      rec_yds: num(cells[18]),
      rec_ypr: num(cells[19]),
      rec_td: num(cells[20]),
      ctch_pct: num(cells[22]),
      rec_succ: num(cells[25]),
      pos: cells[26] ?? 'RB',
    })
  }
  return records
}

const sources = [
  join(sourceDir, 'rb_nfl_seasons_top200_raw.xls'),
  join(sourceDir, 'rb_nfl_seasons_201400_raw.xls'),
  // Add future batches here
]

const allRecords = sources.flatMap(xlsToRecords)

// Deduplicate by (key, season) — prefer lower rank
const seen = new Map()
for (const r of allRecords) {
  const k = `${r.key}|${r.season}`
  if (!seen.has(k) || r.rank < seen.get(k).rank) seen.set(k, r)
}
const records = [...seen.values()].sort((a, b) => a.rank - b.rank)

const uniquePlayers = new Set(records.map((r) => r.key)).size
console.log(`RB seasons: ${records.length} records, ${uniquePlayers} unique players`)
console.log('Sample:', records[0])

writeFileSync(join(outDir, 'rb_seasons.json'), JSON.stringify({ records }, null, 2))
console.log(`Written → public/data/rb_seasons.json`)
