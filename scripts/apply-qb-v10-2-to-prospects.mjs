import fs from 'fs';

function clean(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function loadRows(path) {
  if (!fs.existsSync(path)) return [];
  const payload = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (Array.isArray(payload)) return payload;
  return payload.rows || payload.players || payload.prospects || payload.records || [];
}

function writeRows(path, rows) {
  fs.writeFileSync(path, JSON.stringify(rows, null, 2));
}

function key(year, name) {
  return `${Number(year)}|${clean(name)}`;
}

const modelPath = 'public/data/model/qb_realistic_projection_v10_2.json';

if (!fs.existsSync(modelPath)) {
  console.error(`Missing ${modelPath}. Run v10.2 builder first.`);
  process.exit(1);
}

const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
const current = model.current || [];

const byYearName = new Map();
for (const r of current) {
  byYearName.set(key(r.year, r.name), r);
}

const files = [
  'public/data/prospects_2024_qb.json',
  'public/data/prospects_2025_qb.json',
  'public/data/prospects_2026_qb.json',
  'public/data/prospects_2027_qb.json',
];

const report = [];

for (const file of files) {
  const rows = loadRows(file);
  const yearFromFile = Number((file.match(/prospects_(\d{4})_qb/) || [])[1]);

  let matched = 0;

  const updated = rows.map(row => {
    const name = row.name || row.player || row.playerName;
    const year = Number(row.year || row.draftYear || yearFromFile);
    const m = byYearName.get(key(year, name));

    if (!m) return row;

    matched++;

    return {
      ...row,

      // Keep old values for audit/backtesting.
      modelScoreBeforeV10_2: row.score ?? row.grade ?? row.modelScore ?? row.forecast?.final ?? null,

      // Official new QB scoring fields.
      qbProjectionScore: m.realisticProjectionScoreV10_2,
      qbProjectionTier: m.tierV10_2,
      qbProjectionLabel: m.projectionLabelV10_2,

      qbMissRiskScore: m.missRiskScore,
      qbMissRiskLabel: m.missRiskLabel,
      qbMissRiskPenalty: m.missRiskPenalty,
      qbMissRiskTraits: m.missRiskTraits || [],

      qbModelPath: m.modelPath || row.qbModelPath || '',
      qbTraditionalScore: m.traditionalScore ?? row.qbTraditionalScore ?? null,
      qbOutlierScore: m.outlierScore ?? row.qbOutlierScore ?? null,

      // Also update the general score fields so the board sorts by the new QB model.
      score: m.realisticProjectionScoreV10_2,
      grade: m.realisticProjectionScoreV10_2,
      modelScore: m.realisticProjectionScoreV10_2,
    };
  });

  writeRows(file, updated);
  report.push({ file, rows: rows.length, matched });
}

fs.writeFileSync(
  'public/data/model/qb_v10_2_apply_report.json',
  JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2)
);

console.table(report);
console.log('Wrote public/data/model/qb_v10_2_apply_report.json');
