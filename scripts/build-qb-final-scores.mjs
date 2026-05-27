import fs from 'fs';
import path from 'path';

// Consolidates QB model output into the single authoritative file the app merges
// into its projection overlay: public/data/model/qb_final_scores.json.
//
// Build-safe by design: it reads a *local* QB model export (never committed) and,
// if that input is absent, no-ops cleanly so `npm run build` still succeeds. The
// app treats the output file as optional and falls back to per-prospect QB scores.
//
// Input source (first match wins):
//   1. QB_MODEL_INPUT env var (path to a JSON file or directory of JSON files)
//   2. scripts/local/qb_model_output.json
//   3. existing committed prospects_*_qb.json files (passthrough fallback)
//
// Accepted input record shape (loose — fields are matched case-insensitively):
//   name, pos, year|draftSeason|draftYear, school|college, pick,
//   finalScore|score|grade|qbProjectionScore, tier, confidence,
//   modelVersion|model, components, notes

const OUT = 'public/data/model/qb_final_scores.json';

const QB_TIERS = [
  { min: 90, label: 'Elite' },
  { min: 75, label: 'High-floor' },
  { min: 50, label: 'Developmental' },
  { min: 25, label: 'Long shot' },
  { min: 0, label: 'Project' },
];

function tierFor(score) {
  return (QB_TIERS.find((t) => score >= t.min) ?? QB_TIERS[QB_TIERS.length - 1]).label;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function toRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    return payload.records || payload.rows || payload.players || payload.prospects || payload.current || [];
  }
  return [];
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function gatherInputRows() {
  const fromEnv = process.env.QB_MODEL_INPUT;
  if (fromEnv && fs.existsSync(fromEnv)) {
    const stat = fs.statSync(fromEnv);
    if (stat.isDirectory()) {
      return fs.readdirSync(fromEnv)
        .filter((f) => f.endsWith('.json'))
        .flatMap((f) => toRows(readJson(path.join(fromEnv, f))));
    }
    return toRows(readJson(fromEnv));
  }

  const localDefault = 'scripts/local/qb_model_output.json';
  if (fs.existsSync(localDefault)) return toRows(readJson(localDefault));

  // Passthrough fallback: build from whatever committed QB prospect files exist so
  // the app still has a consolidated final-scores file even without a fresh export.
  const prospectFiles = [
    'public/data/prospects_2024_qb.json',
    'public/data/prospects_2025_qb.json',
    'public/data/prospects_2026_qb.json',
    'public/data/prospects_2027_qb.json',
  ].filter((f) => fs.existsSync(f));

  if (!prospectFiles.length) return null;
  return prospectFiles.flatMap((f) => toRows(readJson(f)));
}

const inputRows = gatherInputRows();

if (!inputRows) {
  console.log('build-qb-final-scores: no QB model input found — skipping (build-safe no-op).');
  console.log('  Provide one via QB_MODEL_INPUT=<file|dir> or scripts/local/qb_model_output.json.');
  process.exit(0);
}

const records = [];
const seen = new Set();

for (const raw of inputRows) {
  if (!raw || typeof raw !== 'object') continue;

  const name = pick(raw, ['name', 'player', 'Player']);
  const finalScore = num(pick(raw, ['finalScore', 'score', 'grade', 'qbProjectionScore']));
  const year = num(pick(raw, ['draftSeason', 'year', 'draftYear', 'season']));
  if (!name || finalScore == null || finalScore <= 0 || year == null) continue;

  const dedupeKey = `${year}|${String(name).toLowerCase()}`;
  if (seen.has(dedupeKey)) continue;
  seen.add(dedupeKey);

  records.push({
    name: String(name),
    pos: 'QB',
    draftSeason: year,
    school: pick(raw, ['school', 'college', 'College']) ?? null,
    pick: num(pick(raw, ['pick', 'overall', 'draftPick'])),
    finalScore: Math.round(finalScore * 100) / 100,
    tier: pick(raw, ['tier']) ?? tierFor(finalScore),
    confidence: pick(raw, ['confidence']) ?? null,
    modelVersion: pick(raw, ['modelVersion', 'model', 'version']) ?? 'qb_final',
    components: raw.components ?? null,
    notes: pick(raw, ['notes']) ?? null,
  });
}

records.sort((a, b) => b.finalScore - a.finalScore);

const payload = {
  model: 'final_qb',
  generatedAt: new Date().toISOString(),
  count: records.length,
  records,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));

console.log(`build-qb-final-scores: wrote ${records.length} QB final scores to ${OUT}`);
