import fs from 'fs';

function clean(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === ',' && !inQuotes) {
        values.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    values.push(cur);
    const obj = {};
    headers.forEach((h, i) => obj[h] = values[i]);
    return obj;
  });
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function mean(xs) {
  return xs.length ? xs.reduce((a,b) => a + b, 0) / xs.length : 0;
}

function spearman(rows, actualKey, predKey) {
  const valid = rows.filter(r => Number.isFinite(r[actualKey]) && Number.isFinite(r[predKey]));
  if (valid.length < 3) return 0;

  const rank = (arr, key) => {
    const sorted = [...arr].sort((a,b) => a[key] - b[key]);
    const m = new Map();
    sorted.forEach((r, i) => m.set(r.id, i + 1));
    return m;
  };

  const ar = rank(valid, actualKey);
  const pr = rank(valid, predKey);

  const ax = mean(valid.map(r => ar.get(r.id)));
  const px = mean(valid.map(r => pr.get(r.id)));

  let cov = 0, av = 0, pv = 0;
  for (const r of valid) {
    const a = ar.get(r.id) - ax;
    const p = pr.get(r.id) - px;
    cov += a * p;
    av += a * a;
    pv += p * p;
  }

  return av && pv ? cov / Math.sqrt(av * pv) : 0;
}

function pairwiseAccuracy(rows, predKey, minGap = 5) {
  let total = 0;
  let correct = 0;
  let weightedTotal = 0;
  let weightedCorrect = 0;

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];

      const actualGap = a.actualOutcome - b.actualOutcome;
      if (Math.abs(actualGap) < minGap) continue;

      const predGap = a[predKey] - b[predKey];
      if (predGap === 0) continue;

      const weight = Math.min(30, Math.abs(actualGap));
      const ok = Math.sign(actualGap) === Math.sign(predGap);

      total++;
      weightedTotal += weight;

      if (ok) {
        correct++;
        weightedCorrect += weight;
      }
    }
  }

  return {
    accuracy: total ? correct / total : 0,
    weightedAccuracy: weightedTotal ? weightedCorrect / weightedTotal : 0,
    pairs: total
  };
}

function scoreReceiving(row) {
  const route = num(row.route_grade, 50);
  const off = num(row.offense_grade, 50);
  const yprr = num(row.yprr, 0);
  const targets = num(row.targets, 0);
  const yards = num(row.yards, 0);
  const dropRate = num(row.drop_rate, 8);

  let score =
    route * 0.38 +
    off * 0.25 +
    Math.min(100, yprr * 25) * 0.20 +
    Math.min(100, yards / 8) * 0.10 +
    Math.min(100, targets) * 0.07;

  if (dropRate <= 5) score += 2;
  if (dropRate >= 10) score -= 3;

  return Math.max(0, Math.min(100, score));
}

function scoreBlocking(row) {
  const run = num(row.run_block_grade, 50);
  const pass = num(row.pass_block_grade, 50);
  const off = num(row.offense_grade, 50);
  const teSnaps = num(row.snap_counts_te, 0);
  const blockSnaps = num(row.snap_counts_block, 0);
  const pbe = num(row.pbe, 50);
  const penalties = num(row.penalties, 0);
  const pressures = num(row.pressures_allowed, 0);
  const passBlockSnaps = num(row.snap_counts_pass_block, 0);

  const inlineUsage = Math.min(100, teSnaps / 4);
  const volume = Math.min(100, blockSnaps / 5);
  const pressureRatePenalty = passBlockSnaps > 0 ? Math.min(15, (pressures / passBlockSnaps) * 100) : 0;

  let score =
    run * 0.42 +
    pass * 0.24 +
    off * 0.14 +
    inlineUsage * 0.10 +
    volume * 0.05 +
    pbe * 0.05;

  score -= Math.min(8, penalties * 0.8);
  score -= pressureRatePenalty;

  return Math.max(0, Math.min(100, score));
}

function topReport(rows, key, n = 20) {
  const top = [...rows].sort((a,b) => b[key] - a[key]).slice(0, n);
  return {
    n,
    avgOutcome: mean(top.map(r => r.actualOutcome)),
    avgWav: mean(top.map(r => r.wAv)),
    avgPick: mean(top.map(r => r.pick)),
    starters: top.filter(r => r.starts >= 2 || r.wAv >= 20).length,
    stars: top.filter(r => r.pb > 0 || r.ap > 0 || r.wAv >= 35).length,
    busts: top.filter(r => r.pick <= 100 && r.wAv <= 10 && r.starts < 1).length,
    names: top.slice(0, 12).map(r => `${r.name} (${r.year})`)
  };
}

const draftRows = parseCsv(fs.readFileSync('public/data/draft_picks.csv', 'utf8'));
const recPayload = JSON.parse(fs.readFileSync('public/data/te_pff_seasons.json', 'utf8'));
const blockPayload = JSON.parse(fs.readFileSync('public/data/te_blocking_pff_seasons.json', 'utf8'));

const recRows = recPayload.records ?? [];
const blockRows = blockPayload.records ?? [];

const recMap = new Map();
for (const r of recRows) {
  recMap.set(`${clean(r.name)}|${r.season}`, r);
}

const blockMap = new Map();
for (const r of blockRows) {
  blockMap.set(`${clean(r.name)}|${r.season}`, r);
}

const rows = [];

for (const d of draftRows) {
  const pos = String(d.position || d.pos || '').toUpperCase();
  if (pos !== 'TE') continue;

  const year = num(d.season);
  const name = d.pfr_player_name || d.player_name || d.name;
  const pick = num(d.pick);
  const wAv = num(d.w_av, num(d.car_av, 0));
  const carAv = num(d.car_av, wAv);
  const starts = num(d.seasons_started, 0);
  const games = num(d.games, 0);
  const pb = num(d.probowls, 0);
  const ap = num(d.allpro, 0);

  if (!year || !name || !pick) continue;
  if (year < 2016 || year > 2023) continue;

  const preDraftSeason = year - 1;
  const rec = recMap.get(`${clean(name)}|${preDraftSeason}`);
  const block = blockMap.get(`${clean(name)}|${preDraftSeason}`);

  if (!rec && !block) continue;

  const actualOutcome =
    wAv +
    Math.min(starts, 8) * 1.25 +
    pb * 8 +
    ap * 12;

  const draftScore = 100 - (Math.log(Math.max(1, pick)) / Math.log(260)) * 100;
  const receivingScore = rec ? scoreReceiving(rec) : 50;
  const blockingScore = block ? scoreBlocking(block) : 50;
  const fullPffScore = receivingScore * 0.72 + blockingScore * 0.28;

  rows.push({
    id: `${clean(name)}-${year}`,
    name,
    year,
    pick,
    actualOutcome,
    wAv,
    carAv,
    starts,
    games,
    pb,
    ap,
    draftScore,
    receivingScore,
    blockingScore,
    fullPffScore,
    hasReceiving: !!rec,
    hasBlocking: !!block,
    route: num(rec?.route_grade),
    yprr: num(rec?.yprr),
    recOff: num(rec?.offense_grade),
    runBlock: num(block?.run_block_grade),
    passBlock: num(block?.pass_block_grade),
    blockOff: num(block?.offense_grade),
    teSnaps: num(block?.snap_counts_te),
  });
}

const candidates = [];

for (let draftW = 50; draftW <= 90; draftW += 5) {
  for (let recW = 5; recW <= 45; recW += 5) {
    for (let blockW = 0; blockW <= 30; blockW += 5) {
      if (draftW + recW + blockW !== 100) continue;

      const key = `score_${draftW}_${recW}_${blockW}`;
      for (const r of rows) {
        r[key] = r.draftScore * (draftW / 100) + r.receivingScore * (recW / 100) + r.blockingScore * (blockW / 100);
      }

      const pw = pairwiseAccuracy(rows, key);

      candidates.push({
        key,
        weights: { draft: draftW, receiving: recW, blocking: blockW },
        spearman: spearman(rows, 'actualOutcome', key),
        pairwise: pw.accuracy,
        weightedPairwise: pw.weightedAccuracy,
        top20: topReport(rows, key, 20),
      });
    }
  }
}

candidates.sort((a,b) =>
  b.weightedPairwise - a.weightedPairwise ||
  b.spearman - a.spearman ||
  b.top20.avgOutcome - a.top20.avgOutcome
);

const baselineKeys = ['draftScore', 'receivingScore', 'blockingScore', 'fullPffScore'];
const baselines = Object.fromEntries(baselineKeys.map(key => [
  key,
  {
    spearman: spearman(rows, 'actualOutcome', key),
    pairwise: pairwiseAccuracy(rows, key),
    top20: topReport(rows, key, 20),
  }
]));

const report = {
  generatedAt: new Date().toISOString(),
  rows: rows.length,
  rowsWithReceiving: rows.filter(r => r.hasReceiving).length,
  rowsWithBlocking: rows.filter(r => r.hasBlocking).length,
  years: [...new Set(rows.map(r => r.year))].sort((a,b) => a-b),
  baselines,
  bestCandidates: candidates.slice(0, 20),
  sampleRows: rows.slice(0, 30),
};

fs.mkdirSync('public/data/model', { recursive: true });
fs.writeFileSync('public/data/model/te_pff_blocking_optimization_report.json', JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  rows: report.rows,
  rowsWithReceiving: report.rowsWithReceiving,
  rowsWithBlocking: report.rowsWithBlocking,
  baselines: report.baselines,
  bestCandidates: report.bestCandidates.slice(0, 10),
}, null, 2));

console.log('Wrote public/data/model/te_pff_blocking_optimization_report.json');
