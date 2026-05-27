import fs from 'fs';

const PROSPECT_OVERLAY = 'public/data/model/college_model_v2_prospect_scores.json';
const SHARD_INDEX = 'public/data/model/college_scores_shards/index.json';

const OUT = 'public/data/model/college_model_v2_score_lookup.json';
const REPORT = 'public/data/model/college_model_v2_score_lookup_report.json';

function cleanName(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function keyOf(row) {
  return `${Number(row.year || row.draftYear || 0)}|${String(row.pos || row.position || '').toUpperCase()}|${cleanName(row.name || row.player)}`
}

function compact(row, source) {
  return {
    id: row.id || `${String(row.pos || '').toLowerCase()}-${row.year}-${cleanName(row.name)}`,
    name: row.name || row.player,
    normalized_name: row.normalized_name || cleanName(row.name || row.player),
    school: row.school || row.team || row.college || '',
    year: Number(row.year || row.draftYear || 0),
    draftYear: Number(row.draftYear || row.year || 0),
    pos: String(row.pos || row.position || '').toUpperCase(),

    collegeModelV2Score: row.collegeModelV2Score ?? null,
    collegeModelV2RawScore: row.collegeModelV2RawScore ?? null,
    collegeModelV2CalibratedSignalScore: row.collegeModelV2CalibratedSignalScore ?? null,
    collegeModelV2Label: row.collegeModelV2Label || 'Insufficient Data',
    collegeModelV2Mode: row.collegeModelV2Mode || source,
    collegeModelV2Coverage: row.collegeModelV2Coverage || {
      matched_features: 0,
      missing_features: 0,
      total_weight_used: 0,
    },
    collegeModelV2TopSignals: (row.collegeModelV2TopSignals || []).slice(0, 3),

    source,
    source_file: row.source_file || row.sourceFile || '',
    draft: row.draft || null,
    nfl_outcome: row.nfl_outcome || null,
  };
}

function priority(row) {
  let p = 0;

  // Current prospect overlay should beat historical shard for same year/pos/name.
  if (row.source === 'prospect_overlay') p += 10000;

  const matched = Number(row.collegeModelV2Coverage?.matched_features || 0);
  p += matched * 100;

  if (row.collegeModelV2Mode !== 'fallback_existing_score') p += 500;
  if (Number.isFinite(Number(row.collegeModelV2Score))) p += 50;

  return p;
}

const map = new Map();
const sources = [];

function addRow(row, source) {
  const c = compact(row, source);
  const key = keyOf(c);
  const current = map.get(key);

  if (!current || priority(c) > priority(current)) {
    map.set(key, c);
  }
}

if (fs.existsSync(SHARD_INDEX)) {
  const index = JSON.parse(fs.readFileSync(SHARD_INDEX, 'utf8'));
  for (const shard of index.shards || []) {
    const file = shard.file;
    if (!file || !fs.existsSync(file)) continue;

    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    const rows = payload.rows || [];
    sources.push({ source: 'historical_shard', file, rows: rows.length });

    for (const row of rows) addRow(row, 'historical_shard');
  }
}

if (fs.existsSync(PROSPECT_OVERLAY)) {
  const payload = JSON.parse(fs.readFileSync(PROSPECT_OVERLAY, 'utf8'));
  const rows = payload.rows || [];
  sources.push({ source: 'prospect_overlay', file: PROSPECT_OVERLAY, rows: rows.length });

  for (const row of rows) addRow(row, 'prospect_overlay');
}

const rows = Array.from(map.values()).sort((a, b) =>
  (a.year - b.year) ||
  String(a.pos).localeCompare(String(b.pos)) ||
  ((b.collegeModelV2Score ?? -1) - (a.collegeModelV2Score ?? -1))
);

const byYearPos = {};
for (const r of rows) {
  const key = `${r.year}|${r.pos}`;
  byYearPos[key] = (byYearPos[key] || 0) + 1;
}

const compactRows = rows.map((r) => ({
  k: r.k || `${Number(r.year || r.draftYear || r.y || 0)}|${String(r.pos || r.position || r.p || '').toUpperCase()}|${cleanName(r.name || r.player || r.n)}`,
  n: r.n || r.name || r.player || '',
  y: Number(r.y || r.year || r.draftYear || 0),
  p: String(r.p || r.pos || r.position || '').toUpperCase(),
  s: r.s ?? r.collegeModelV2Score ?? null,
  l: r.l || r.collegeModelV2Label || 'Insufficient Data',
  m: Number(r.m ?? r.collegeModelV2Coverage?.matched_features ?? 0),
  src: r.src || (r.source === 'prospect_overlay' ? 'prospect' : 'historical'),
}));

fs.writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  model_version: 'college_model_v2_score_lookup',
  note: 'Tiny lookup for all College Model v2 scores. k=year|pos|normalized_name, s=score, l=label, m=matched features.',
  rows: compactRows,
}));

fs.writeFileSync(REPORT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  model_version: 'college_model_v2_score_lookup',
  source_count: sources.length,
  sources,
  rows: rows.length,
  byYearPos,
}, null, 2));

console.log('DONE');
console.log('Rows:', rows.length);
console.log('Wrote', OUT);
console.log('Wrote', REPORT);
console.table(sources.slice(0, 20));
