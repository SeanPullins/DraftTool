import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const csvPath = path.join(root, 'public/data/player_stats_season.csv')
const outPath = path.join(root, 'public/data/career_stats.json')

function parseCsv(text) {
  const rows = []
  let row = []
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
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] || '').trim()])))
}

function clean(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function n(v) {
  const x = parseFloat(v)
  return Number.isFinite(x) ? x : null
}

const text = readFileSync(csvPath, 'utf8')
const rows = parseCsv(text)

// Only regular season skill positions
const SKILL_POSITIONS = new Set(['QB', 'WR', 'TE', 'RB', 'HB', 'FB'])
const relevant = rows.filter((r) => r.season_type === 'REG' && SKILL_POSITIONS.has(r.position))

// Group by player key (cleaned display name), collect per-season stats
const byPlayer = new Map()

for (const r of relevant) {
  const displayName = r.player_display_name || r.player_name || ''
  if (!displayName) continue
  const key = clean(displayName)
  const season = parseInt(r.season, 10)
  if (!Number.isFinite(season) || season < 1999) continue

  const rawPos = (r.position || '').toUpperCase()
  const pos = rawPos === 'HB' || rawPos === 'FB' ? 'RB' : rawPos

  // Aggregate multiple team stints in same season (traded players appear twice)
  if (!byPlayer.has(key)) byPlayer.set(key, new Map())
  const seasons = byPlayer.get(key)

  if (!seasons.has(season)) {
    seasons.set(season, {
      season,
      pos,
      team: r.recent_team || r.team || '',
      games: 0,
      // QB
      completions: 0, attempts: 0, passing_yards: 0, passing_tds: 0, interceptions: 0,
      passing_epa: 0, dakota: null,
      // WR/TE
      targets: 0, receptions: 0, receiving_yards: 0, receiving_tds: 0, receiving_epa: 0,
      // RB
      carries: 0, rushing_yards: 0, rushing_tds: 0, rushing_epa: 0,
      // RB receiving
      rb_targets: 0, rb_receptions: 0, rb_receiving_yards: 0,
    })
  }

  const s = seasons.get(season)
  s.games += n(r.games) ?? 0

  // QB
  s.completions += n(r.completions) ?? 0
  s.attempts += n(r.attempts) ?? 0
  s.passing_yards += n(r.passing_yards) ?? 0
  s.passing_tds += n(r.passing_tds) ?? 0
  s.interceptions += n(r.interceptions) ?? 0
  s.passing_epa += n(r.passing_epa) ?? 0
  if (r.dakota != null && r.dakota !== '') {
    s.dakota = (s.dakota ?? 0) + (n(r.dakota) ?? 0)
  }

  // WR/TE
  s.targets += n(r.targets) ?? 0
  s.receptions += n(r.receptions) ?? 0
  s.receiving_yards += n(r.receiving_yards) ?? 0
  s.receiving_tds += n(r.receiving_tds) ?? 0
  s.receiving_epa += n(r.receiving_epa) ?? 0

  // RB (rushing)
  s.carries += n(r.carries) ?? 0
  s.rushing_yards += n(r.rushing_yards) ?? 0
  s.rushing_tds += n(r.rushing_tds) ?? 0
  s.rushing_epa += n(r.rushing_epa) ?? 0

  // RB (receiving — same fields used for WR/TE, but we store separately for RBs)
  if (pos === 'RB') {
    s.rb_targets += n(r.targets) ?? 0
    s.rb_receptions += n(r.receptions) ?? 0
    s.rb_receiving_yards += n(r.receiving_yards) ?? 0
  }
}

// Convert to compact output format
const output = {}
for (const [key, seasons] of byPlayer) {
  const seasonArr = Array.from(seasons.values()).sort((a, b) => a.season - b.season)
  const compact = seasonArr.map((s) => {
    const base = { season: s.season, pos: s.pos, games: s.games }
    if (s.pos === 'QB' && s.attempts > 0) {
      const cmp_pct = s.attempts > 0 ? +(s.completions / s.attempts * 100).toFixed(1) : null
      const ypa = s.attempts > 0 ? +(s.passing_yards / s.attempts).toFixed(1) : null
      const epa_per_att = s.attempts > 0 ? +(s.passing_epa / s.attempts).toFixed(2) : null
      return { ...base, att: s.attempts, yds: s.passing_yards, tds: s.passing_tds, ints: s.interceptions, cmp_pct, ypa, epa_per_att }
    }
    if (s.pos === 'WR' || s.pos === 'TE') {
      const ctch_pct = s.targets > 0 ? +(s.receptions / s.targets * 100).toFixed(1) : null
      const ypr = s.receptions > 0 ? +(s.receiving_yards / s.receptions).toFixed(1) : null
      const epa_per_tgt = s.targets > 0 ? +(s.receiving_epa / s.targets).toFixed(2) : null
      return { ...base, tgt: s.targets, rec: s.receptions, yds: s.receiving_yards, tds: s.receiving_tds, ctch_pct, ypr, epa_per_tgt }
    }
    if (s.pos === 'RB') {
      const ypc = s.carries > 0 ? +(s.rushing_yards / s.carries).toFixed(1) : null
      const rush_epa_per_carry = s.carries > 0 ? +(s.rushing_epa / s.carries).toFixed(2) : null
      return { ...base, car: s.carries, rush_yds: s.rushing_yards, rush_tds: s.rushing_tds, ypc, rush_epa_per_carry, rec: s.rb_receptions, rec_yds: s.rb_receiving_yards }
    }
    return base
  }).filter((s) => s.games > 0)

  if (compact.length > 0) output[key] = compact
}

mkdirSync(path.dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(output))
console.log(`Built career_stats.json: ${Object.keys(output).length} players`)
