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

function compDistance(c) {
  const candidates = [
    c?.distance,
    c?.delta,
    c?.profileDistance,
    c?.scoreDelta,
    c?.difference,
  ];

  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.abs(n);
  }

  return 999;
}

function normalizeComp(c) {
  if (!c) return null;

  if (typeof c === 'string') {
    return { name: c };
  }

  return {
    name: c.name || c.player || c.comp || c.qb || '',
    year: c.year || c.draftYear || c.season || null,
    pick: c.pick || c.draftPick || null,
    archetype: c.archetype || c.style || c.label || '',
    distance: c.distance ?? c.delta ?? c.profileDistance ?? c.scoreDelta ?? null,
    reason: c.reason || c.summary || c.note || '',
  };
}

function pickOneComp(row) {
  const buckets = [
    row.primaryQbProfileComp,
    row.qbPrimaryComp,
    row.primaryComp,
    row.qbTranslationSignal?.primaryComp,
    ...(Array.isArray(row.projectionComps) ? row.projectionComps : []),
    ...(Array.isArray(row.styleComps) ? row.styleComps : []),
    ...(Array.isArray(row.comps) ? row.comps : []),
    ...(Array.isArray(row.qbComps) ? row.qbComps : []),
  ].filter(Boolean);

  const normalized = buckets
    .map(normalizeComp)
    .filter(c => c && c.name);

  if (!normalized.length) return null;

  normalized.sort((a, b) => compDistance(a) - compDistance(b));
  return normalized[0];
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
  let updatedCount = 0;

  const updated = rows.map(row => {
    const one = pickOneComp(row);
    if (!one) return row;

    updatedCount++;

    return {
      ...row,
      primaryQbProfileComp: one,

      // For UI simplicity: keep arrays but make them one item.
      projectionComps: [one],
      styleComps: [one],
      qbComps: [one],
    };
  });

  writeRows(file, updated);
  report.push({ file, rows: rows.length, updated: updatedCount });
}

fs.writeFileSync(
  'public/data/model/qb_single_primary_comp_apply_report.json',
  JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2)
);

console.table(report);
console.log('Wrote public/data/model/qb_single_primary_comp_apply_report.json');
