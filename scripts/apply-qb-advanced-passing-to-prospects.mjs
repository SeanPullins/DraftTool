import fs from 'fs';

function clean(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function loadJson(path) {
  if (!fs.existsSync(path)) return null;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function rowsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.rows || payload?.players || payload?.prospects || payload?.records || [];
}

function writeBack(path, original, rows) {
  if (Array.isArray(original)) {
    fs.writeFileSync(path, JSON.stringify(rows, null, 2));
  } else {
    const next = { ...original };
    if (Array.isArray(next.rows)) next.rows = rows;
    else if (Array.isArray(next.players)) next.players = rows;
    else if (Array.isArray(next.prospects)) next.prospects = rows;
    else if (Array.isArray(next.records)) next.records = rows;
    else next.rows = rows;
    fs.writeFileSync(path, JSON.stringify(next, null, 2));
  }
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function getScore(row) {
  return num(
    row.modelScore ??
    row.score ??
    row.finalScore ??
    row.projectedScore ??
    row.grade,
    0
  );
}

function setScore(row, value) {
  if ('modelScore' in row) row.modelScore = value;
  else if ('score' in row) row.score = value;
  else if ('finalScore' in row) row.finalScore = value;
  else row.modelScore = value;
}

function key(year, name) {
  return `${year}|QB|${clean(name)}`;
}

const signalPayload = loadJson('public/data/model/qb_advanced_passing_signal_candidates.json');
const signals = new Map();

for (const s of signalPayload?.candidates || []) {
  signals.set(s.key || key(s.year, s.name), s);
}

const files = [
  [2024, 'public/data/prospects_2024_qb.json'],
  [2025, 'public/data/prospects_2025_qb.json'],
  [2026, 'public/data/prospects_2026_qb.json'],
  [2027, 'public/data/prospects_2027_qb.json'],
];

const changed = [];

for (const [year, path] of files) {
  const payload = loadJson(path);
  if (!payload) continue;

  const rows = rowsFrom(payload);
  let fileChanged = 0;

  for (const row of rows) {
    const name = row.name || row.player || row.playerName;
    if (!name) continue;

    const s = signals.get(key(year, name));
    if (!s) {
      row.advancedPassingAdjustment = 0;
      row.advancedPassingTraits = [];
      row.advancedPassingLabel = 'No advanced passing signal';
      row.projectionHitMiss = year >= 2024 ? 'Projection — Watch' : row.projectionHitMiss;
      continue;
    }

    const oldScore = getScore(row);
    const adjustment = num(s.recommendedAdjustment, 0);

    // Convert small signal units into score points.
    // +0.35 = +3.5 points. Keep intentionally capped.
    const scoreDelta = Number((adjustment * 10).toFixed(1));
    const newScore = Number((oldScore + scoreDelta).toFixed(1));

    row.modelScoreBeforeAdvancedPassing = oldScore;
    row.advancedPassingAdjustment = adjustment;
    row.advancedPassingScoreDelta = scoreDelta;
    row.advancedPassingTraits = s.traits || [];
    row.advancedPassingLabel = s.label || 'Advanced passing signal';
    row.projectionHitMiss = s.projectionLabel || 'Projection — Watch';
    row.modelScoreAfterAdvancedPassing = newScore;

    setScore(row, newScore);
    fileChanged++;
  }

  writeBack(path, payload, rows);
  changed.push({ year, path, updatedRows: fileChanged, totalRows: rows.length });
}

fs.writeFileSync('public/data/model/qb_advanced_passing_apply_report.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  note: 'Applied QB Advanced Passing Signal to 2024-present QB prospect score files.',
  changed,
}, null, 2));

console.log(JSON.stringify({ changed }, null, 2));
console.log('Wrote public/data/model/qb_advanced_passing_apply_report.json');
