import fs from 'fs';

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function mae(rows, key) {
  return mean(rows.map((r) => Math.abs(r[key] - r.av)));
}

function rmse(rows, key) {
  return Math.sqrt(mean(rows.map((r) => (r[key] - r.av) ** 2)));
}

function spearman(rows, key) {
  const rank = (arr, k) => {
    const m = new Map();
    [...arr].sort((a, b) => a[k] - b[k]).forEach((r, i) => m.set(r.id, i + 1));
    return m;
  };

  const rx = rank(rows, key);
  const ry = rank(rows, 'av');
  const xs = rows.map((r) => rx.get(r.id));
  const ys = rows.map((r) => ry.get(r.id));
  const mx = mean(xs);
  const my = mean(ys);

  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const den = Math.sqrt(
    xs.reduce((s, x) => s + (x - mx) ** 2, 0) *
    ys.reduce((s, y) => s + (y - my) ** 2, 0)
  );

  return den ? num / den : 0;
}

const rowFile = 'public/data/model/v5_qb_wr_row_scores.json';

if (!fs.existsSync(rowFile)) {
  console.log(JSON.stringify({
    status: 'missing_row_scores',
    message: 'Need to patch scripts/test-v5-qb-wr.mjs to export public/data/model/v5_qb_wr_row_scores.json first.'
  }, null, 2));
  process.exit(0);
}

const rows = readJson(rowFile);

function testPosition(pos, positionKey) {
  const posRows = rows.filter((r) => r.pos === pos && Number.isFinite(r.globalAv) && Number.isFinite(r[positionKey]));

  const results = [];

  for (let w = 0; w <= 1.0001; w += 0.05) {
    const weight = Math.round(w * 100) / 100;
    const scored = posRows.map((r) => ({
      ...r,
      blendAv: r.globalAv * (1 - weight) + r[positionKey] * weight,
    }));

    results.push({
      position: pos,
      positionModelWeight: weight,
      globalWeight: Math.round((1 - weight) * 100) / 100,
      n: scored.length,
      mae: mae(scored, 'blendAv'),
      rmse: rmse(scored, 'blendAv'),
      spearman: spearman(scored, 'blendAv'),
    });
  }

  const bestBySpearman = [...results].sort((a, b) => {
    const rank = b.spearman - a.spearman;
    if (Math.abs(rank) > 0.000001) return rank;
    return a.mae - b.mae;
  })[0];

  const bestByMae = [...results].sort((a, b) => a.mae - b.mae)[0];

  return {
    position: pos,
    bestBySpearman,
    bestByMae,
    allWeights: results,
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  QB: testPosition('QB', 'qbAv'),
  WR: testPosition('WR', 'wrAv'),
};

fs.writeFileSync('public/data/model/v5_qb_wr_blend_report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
