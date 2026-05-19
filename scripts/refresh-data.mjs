import { mkdir, writeFile } from 'node:fs/promises'

const dataDir = new URL('../public/data/', import.meta.url)
const sources = [
  ['combine.csv', 'https://github.com/nflverse/nflverse-data/releases/download/combine/combine.csv'],
  ['draft_picks.csv', 'https://github.com/nflverse/nflverse-data/releases/download/draft_picks/draft_picks.csv'],
  ['player_stats_season.csv', 'https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_season.csv'],
]

await mkdir(dataDir, { recursive: true })
const manifest = { refreshedAt: new Date().toISOString(), sources: [] }

for (const [filename, url] of sources) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to download ${filename}: ${response.status}`)
  const text = await response.text()
  await writeFile(new URL(filename, dataDir), text)
  manifest.sources.push({ filename, url, rows: Math.max(0, text.trim().split('\n').length - 1) })
}

await writeFile(new URL('source-manifest.json', dataDir), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Downloaded ${sources.length} nflverse datasets`)
