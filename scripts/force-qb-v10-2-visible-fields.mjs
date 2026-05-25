import fs from 'fs';

const files = [
  'public/data/prospects_2024_qb.json',
  'public/data/prospects_2025_qb.json',
  'public/data/prospects_2026_qb.json',
  'public/data/prospects_2027_qb.json',
];

const report = [];

for (const file of files) {
  if (!fs.existsSync(file)) continue;

  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  let changed = 0;

  const updated = rows.map(row => {
    const score = Number(row.qbProjectionScore);
    if (!Number.isFinite(score)) return row;

    changed++;

    const next = {
      ...row,

      // Canonical QB fields
      qbProjectionScore: score,
      qbModelScore: score,
      qbScore: score,

      // Generic fields the UI may be reading
      score,
      grade: score,
      modelScore: score,
      projectedScore: score,
      projectionScore: score,
      finalScore: score,
      displayScore: score,
      overallScore: score,
      valueScore: score,
    };

    // If the app reads forecast.final, override it too.
    if (next.forecast && typeof next.forecast === 'object') {
      next.forecast = {
        ...next.forecast,
        final: score,
        modelScore: score,
        projectionScore: score,
      };
    }

    // If nested model objects exist, update likely fields there too.
    if (next.model && typeof next.model === 'object') {
      next.model = {
        ...next.model,
        score,
        final: score,
        projectionScore: score,
      };
    }

    return next;
  });

  fs.writeFileSync(file, JSON.stringify(updated, null, 2));
  report.push({ file, rows: rows.length, changed });
}

fs.writeFileSync(
  'public/data/model/qb_v10_2_force_visible_fields_report.json',
  JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2)
);

console.table(report);
console.log('Wrote public/data/model/qb_v10_2_force_visible_fields_report.json');
