/**
 * Processes raw QB passing season data from Sports Reference into a
 * compact lookup table keyed by normalized player name + season.
 *
 * Input:  scripts/source/qb_nfl_seasons_raw.json
 * Output: public/data/qb_seasons.json
 *
 * Run: node scripts/process-qb-seasons.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function clean(s = '') {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
}

const raw = JSON.parse(readFileSync(join(__dirname, 'source/qb_nfl_seasons_raw.json'), 'utf8'))

if (!Array.isArray(raw.records)) {
  console.error('No records array found in source file.')
  process.exit(1)
}

const records = raw.records.map((r) => ({
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

const outDir = join(__dirname, '../public/data')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'qb_seasons.json'), JSON.stringify({ records }, null, 2))

const uniqueQbs = new Set(records.map((r) => r.key)).size
const uniqueSeasons = new Set(records.map((r) => r.season)).size
console.log(`✓ Wrote ${records.length} QB season records | ${uniqueQbs} unique QBs | ${uniqueSeasons} seasons (${Math.min(...records.map((r) => r.season))}–${Math.max(...records.map((r) => r.season))})`)
console.log(`  Output: public/data/qb_seasons.json`)
