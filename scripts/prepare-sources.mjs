import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sources = [
  ['scripts/source/App.tsx.gz.b64.small.parts', 'src/App.tsx', 'gunzip'],
  ['scripts/source/styles.css.gz.b64.parts', 'src/styles.css', 'gunzip'],
  ['scripts/source/build-pff-comparison-data.mjs.gz.b64.parts', 'scripts/build-pff-comparison-data.mjs', 'gunzip'],
  ['scripts/source/pff_comparison_profiles.json.gz.b64.small.parts', 'public/data/pff_comparison_profiles.json.gz.b64', 'copy'],
]

for (const [sourcePath, outputPath, mode] of sources) {
  const sourceDir = path.join(root, sourcePath)
  if (!fs.existsSync(sourceDir)) continue
  const encoded = fs.readdirSync(sourceDir)
    .sort()
    .map((file) => fs.readFileSync(path.join(sourceDir, file), 'utf8'))
    .join('')
    .replace(/\s/g, '')
  const decoded = mode === 'gunzip'
    ? zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8')
    : `${encoded}\n`
  const output = path.join(root, outputPath)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, decoded)
}
