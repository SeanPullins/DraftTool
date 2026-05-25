import fs from 'fs';

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clean(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function metricVector(row) {
  const m = row.metrics || row.pff || {};
  return {
    score: num(row.realisticProjectionScoreV10_2 ?? row.qbProjectionScore ?? row.score),
    passGrade: num(m.passGrade ?? m.pass_grade),
    adjustedAccuracy: num(m.adjustedAccuracy ?? m.adjusted_completion_percent),
    bttRate: num(m.bttRate ?? m.btt_rate),
    twpRate: num(m.twpRate ?? m.twp_rate),
    adot: num(m.adot),
    ttt: num(m.ttt ?? m.time_to_throw),
    p2s: num(m.p2s ?? m.pressure_to_sack_rate),
    runGrade: num(m.runGrade ?? m.run_grade),
    scrambles: num(m.scrambles),
    pressureGrade: num(m.pressureGrade),
    mediumAcc: num(m.mediumAcc),
    deepAcc: num(m.deepAcc),
  };
}

const weights = {
  score: 0.8,
  passGrade: 0.8,
  adjustedAccuracy: 0.9,
  bttRate: 1.0,
  twpRate: 0.8,
  adot: 0.9,
  ttt: 0.6,
  p2s: 0.7,
  runGrade: 0.9,
  scrambles: 0.8,
  pressureGrade: 1.0,
  mediumAcc: 1.0,
  deepAcc: 0.8,
};

const scales = {
  score: 20,
  passGrade: 20,
  adjustedAccuracy: 15,
  bttRate: 3,
  twpRate: 2.5,
  adot: 3,
  ttt: 0.45,
  p2s: 8,
  runGrade: 20,
  scrambles: 30,
  pressureGrade: 20,
  mediumAcc: 15,
  deepAcc: 20,
};

function distance(a, b) {
  let total = 0;
  let used = 0;

  for (const k of Object.keys(weights)) {
    const av = a[k];
    const bv = b[k];

    if (!Number.isFinite(av) || !Number.isFinite(bv)) continue;
    if (av === 0 || bv === 0) continue;

    const d = Math.abs(av - bv) / scales[k];
    total += d * weights[k];
    used += weights[k];
  }

  return used ? total / used : 999;
}

const modelPath = 'public/data/model/qb_realistic_projection_v10_2.json';
if (!fs.existsSync(modelPath)) {
  console.error(`Missing ${modelPath}`);
  process.exit(1);
}

const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));

const historic = (model.historic || [])
  .filter(r => r.name && r.year && r.pick && r.metrics)
  .map(r => ({
    ...r,
    vector: metricVector(r),
  }));

const currentByKey = new Map(
  (model.current || []).map(r => [`${Number(r.year)}|${clean(r.name)}`, r])
);

const files = [
  'public/data/prospects_2024_qb.json',
  'public/data/prospects_2025_qb.json',
  'public/data/prospects_2026_qb.json',
  'public/data/prospects_2027_qb.json',
];

const report = [];

for (const file of files) {
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  const fileYear = Number((file.match(/prospects_(\d{4})_qb/) || [])[1]);
  let changed = 0;

  const updated = rows.map(row => {
    const name = row.name || row.player || row.playerName;
    const year = Number(row.year || row.draftYear || fileYear);
    const modelRow = currentByKey.get(`${year}|${clean(name)}`);

    if (!modelRow) return row;

    const curVector = metricVector(modelRow);

    const best = historic
      .filter(h => !(clean(h.name) === clean(name) && Number(h.year) === year))
      .map(h => ({
        h,
        dist: distance(curVector, h.vector),
      }))
      .sort((a, b) => a.dist - b.dist)[0];

    if (!best || best.dist >= 999) return row;

    changed++;

    const comp = {
      name: best.h.name,
      year: best.h.year,
      pick: best.h.pick,
      score: best.h.realisticProjectionScoreV10_2,
      outcome: best.h.hitMissLabel,
      distance: Number(best.dist.toFixed(3)),
      reason: 'Closest historical QB profile by v10.2 score, passing profile, pressure/depth traits, creation, and risk shape.',
    };

    return {
      ...row,
      primaryQbProfileComp: comp,

      // Force only one available comp for the UI.
      projectionComps: [comp],
      styleComps: [comp],
      qbComps: [comp],
      comps: [comp],
    };
  });

  fs.writeFileSync(file, JSON.stringify(updated, null, 2));
  report.push({ file, rows: rows.length, changed });
}

fs.writeFileSync(
  'public/data/model/qb_primary_profile_comps_v10_2_report.json',
  JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2)
);

console.table(report);
console.log('Wrote public/data/model/qb_primary_profile_comps_v10_2_report.json');
