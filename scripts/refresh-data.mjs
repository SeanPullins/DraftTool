import { mkdir, writeFile, access } from 'node:fs/promises'

const dataDir = new URL('../public/data/', import.meta.url)
const sources = [
  ['combine.csv', 'https://github.com/nflverse/nflverse-data/releases/download/combine/combine.csv'],
  ['draft_picks.csv', 'https://github.com/nflverse/nflverse-data/releases/download/draft_picks/draft_picks.csv'],
  ['player_stats_season.csv', 'https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_season.csv'],
]

await mkdir(dataDir, { recursive: true })
const manifest = { refreshedAt: new Date().toISOString(), sources: [] }

for (const [filename, url] of sources) {
  const dest = new URL(filename, dataDir)
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const text = await response.text()
    await writeFile(dest, text)
    manifest.sources.push({ filename, url, rows: Math.max(0, text.trim().split('\n').length - 1) })
    console.log(`Downloaded ${filename}`)
  } catch (err) {
    // Check if we have a previously committed/cached copy to fall back on
    const exists = await access(dest).then(() => true).catch(() => false)
    if (exists) {
      console.warn(`Warning: could not fetch ${filename} (${err.message}) — using existing file`)
      manifest.sources.push({ filename, url, rows: 0, warning: String(err.message) })
    } else {
      throw new Error(`Failed to download ${filename} and no cached copy exists: ${err.message}`)
    }
  }
}

await writeFile(new URL('source-manifest.json', dataDir), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Data refresh complete (${sources.length} sources)`)
