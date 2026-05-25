import fs from 'fs';

function clean(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseCsv(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

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
    headers.forEach((h, i) => obj[h] = values[i] ?? '');
    return obj;
  });
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number.isFinite(v) ? v : 0));
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function spearman(rows, actualKey, predKey) {
  const valid = rows.filter(r => Number.isFinite(r[actualKey]) && Number.isFinite(r[predKey]));
  if (valid.length < 3) return 0;

  const rank = (arr, key) => {
    const sorted = [...arr].sort((a, b) => a[key] - b[key]);
    const out = new Map();
    sorted.forEach((r, i) => out.set(r.id, i + 1));
    return out;
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
    pairs: total,
    accuracy: total ? correct / total : 0,
    weightedAccuracy: weightedTotal ? weightedCorrect / weightedTotal : 0,
  };
}

function topReport(rows, key, n = 20) {
  const top = [...rows].sort((a, b) => b[key] - a[key]).slice(0, n);

  return {
    n,
    avgOutcome: mean(top.map(r => r.actualOutcome)),
    avgWav: mean(top.map(r => r.wAv)),
    avgPick: mean(top.map(r => r.pick)),
    starters: top.filter(r => r.starts >= 2 || r.wAv >= 20).length,
    stars: top.filter(r => r.pb > 0 || r.ap > 0 || r.wAv >= 35).length,
    busts: top.filter(r => r.pick <= 100 && r.wAv <= 10 && r.starts < 1).length,
    names: top.slice(0, 15).map(r => `${r.name} (${r.year})`),
  };
}

function draftScoreFromPick(pick) {
  const p = Math.max(1, Number(pick) || 260);
  return clamp(100 - (Math.log(p) / Math.log(260)) * 100);
}

function rushingScore(row) {
  const run = num(row.run_grade, 50);
  const off = num(row.offense_grade, 50);
  const ypa = num(row.ypa, 0);
  const yco = num(row.yco_attempt, 0);
  const elusive = num(row.elusive_rating, 0);
  const avoided = num(row.avoided_tackles, 0);
  const breakaway = num(row.breakaway_percent, 0);
  const yards = num(row.yards, 0);

  return clamp(
    run * 0.30 +
    off * 0.18 +
    clamp(ypa * 13) * 0.11 +
    clamp(yco * 22) * 0.15 +
    clamp(elusive / 2.2) * 0.12 +
    clamp(avoided) * 0.08 +
    clamp(breakaway * 1.7) * 0.03 +
    clamp(yards / 18) * 0.03
  );
}

function receivingScore(row) {
  const route = num(row.route_grade, 50);
  const yprr = num(row.yprr, 0);
  const targets = num(row.targets, 0);
  const receptions = num(row.receptions, 0);
  const recYards = num(row.rec_yards, 0);
  const drops = num(row.drops, 0);

  let score =
    route * 0.34 +
    clamp(yprr * 35) * 0.22 +
    clamp(targets * 2.0) * 0.16 +
    clamp(receptions * 2.2) * 0.12 +
    clamp(recYards / 4) * 0.12 +
    50 * 0.04;

  if (drops === 0 && targets >= 15) score += 2;
  if (drops >= 4) score -= 3;

  return clamp(score);
}

function passDownScore(row) {
  const passBlock = num(row.pass_block_grade, 50);
  const route = num(row.route_grade, 50);
  const targets = num(row.targets, 0);
  const yprr = num(row.yprr, 0);

  return clamp(
    passBlock * 0.38 +
    route * 0.24 +
    clamp(targets * 2) * 0.18 +
    clamp(yprr * 35) * 0.20
  );
}

function usageScore(row) {
  const attempts = num(row.attempts, 0);
  const touches = num(row.total_touches, 0);
  const yards = num(row.yards, 0);
  const recYards = num(row.rec_yards, 0);
  const games = num(row.player_game_count, 0);
  const tds = num(row.touchdowns, 0);

  return clamp(
    clamp(attempts / 3.2) * 0.24 +
    clamp(touches / 3.5) * 0.22 +
    clamp(yards / 18) * 0.22 +
    clamp(recYards / 5) * 0.10 +
    clamp(games * 6) * 0.10 +
    clamp(tds * 4) * 0.12
  );
}

function completenessBonus(row) {
  let bonus = 0;

  const run = num(row.run_grade, 0);
  const yco = num(row.yco_attempt, 0);
  const elusive = num(row.elusive_rating, 0);
  const targets = num(row.targets, 0);
  const route = num(row.route_grade, 0);
  const passBlock = num(row.pass_block_grade, 0);

  if (run >= 85) bonus += 3;
  if (yco >= 3.2) bonus += 2;
  if (elusive >= 90) bonus += 2;
  if (targets >= 25 && route >= 60) bonus += 2;
  if (passBlock >= 65) bonus += 1;

  return clamp(bonus * 10);
}

function riskPenalty(row) {
  let penalty = 0;

  const fumbles = num(row.fumbles, 0);
  const attempts = num(row.attempts, 0);
  const yco = num(row.yco_attempt, 0);
  const run = num(row.run_grade, 50);
  const targets = num(row.targets, 0);
  const route = num(row.route_grade, 50);

  if (fumbles >= 4) penalty += 4;
  if (attempts >= 180 && yco < 2.4) penalty += 3;
  if (run < 70) penalty += 4;
  if (targets < 10 && route < 55) penalty += 2;

  return penalty;
}

function rbPffScore(row) {
  const rush = rushingScore(row);
  const rec = receivingScore(row);
  const pass = passDownScore(row);
  const usage = usageScore(row);
  const bonus = completenessBonus(row);
  const penalty = riskPenalty(row);

  return clamp(
    rush * 0.48 +
    rec * 0.15 +
    pass * 0.08 +
    usage * 0.15 +
    bonus * 0.07 -
    penalty
  );
}

function rasScore(rasRecord) {
  if (!rasRecord) return 50;

  const raw = rasRecord.ras ?? rasRecord.alltimeRas;
  const ras = Number(raw);

  if (!Number.isFinite(ras) || ras <= 0) return 50;

  return clamp(ras * 10);
}

function buildRasMap() {
  const rasPath = 'public/data/ras_main_table.csv';
  if (!fs.existsSync(rasPath)) return new Map();

  const rows = parseCsv(fs.readFileSync(rasPath, 'utf8'));
  const out = new Map();

  for (const row of rows) {
    if (row.name === 'name' || row.pos === 'pos') continue;
    if (String(row.pos || '').toUpperCase() !== 'RB') continue;

    const name = clean(row.name || '');
    const year = num(row.year);
    if (!name || !year) continue;

    const ras = num(row.ras, null);
    const alltimeRas = num(row.alltime_ras, null);

    out.set(`${name}|${year}`, {
      ras,
      alltimeRas,
      sourceUrl: row.source_url || null,
      college: row.college || null,
    });
  }

  return out;
}

function getRas(rasMap, name, year) {
  return rasMap.get(`${clean(name)}|${Number(year)}`) || null;
}

const draftRows = parseCsv(fs.readFileSync('public/data/draft_picks.csv', 'utf8'));
const rbPayload = JSON.parse(fs.readFileSync('public/data/rb_pff_seasons.json', 'utf8'));
const rbRows = rbPayload.records ?? [];
const rasMap = buildRasMap();

const rbMap = new Map();
for (const r of rbRows) {
  rbMap.set(`${clean(r.name)}|${Number(r.season)}`, r);
}

const rows = [];
const recentDrafted = [];

for (const d of draftRows) {
  const pos = String(d.position || d.pos || '').toUpperCase();
  if (!['RB', 'HB', 'FB'].includes(pos)) continue;

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
  if (year < 2016 || year > 2025) continue;

  const preDraftSeason = year - 1;
  const pff = rbMap.get(`${clean(name)}|${preDraftSeason}`);
  if (!pff) continue;

  const rasRecord = getRas(rasMap, name, year);
  const ras = rasScore(rasRecord);

  const actualOutcome =
    wAv +
    Math.min(starts, 8) * 1.25 +
    pb * 8 +
    ap * 12;

  const row = {
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
    draftScore: draftScoreFromPick(pick),
    rbPffScore: rbPffScore(pff),
    rushingScore: rushingScore(pff),
    receivingScore: receivingScore(pff),
    passDownScore: passDownScore(pff),
    usageScore: usageScore(pff),
    completenessBonus: completenessBonus(pff),
    rasScore: ras,
    hasRas: !!rasRecord && ras !== 50,
    ras: rasRecord?.ras ?? null,
    alltimeRas: rasRecord?.alltimeRas ?? null,
    pff,
  };

  if (year <= 2021) rows.push(row);
  else recentDrafted.push(row);
}

const candidateWeights = [];

for (let draftW = 45; draftW <= 90; draftW += 5) {
  for (let pffW = 5; pffW <= 50; pffW += 5) {
    for (let rasW = 0; rasW <= 20; rasW += 5) {
      if (draftW + pffW + rasW !== 100) continue;
      candidateWeights.push({ draft: draftW, pff: pffW, ras: rasW });
    }
  }
}

const candidates = [];

for (const w of candidateWeights) {
  const key = `blend_${w.draft}_${w.pff}_${w.ras}`;

  for (const r of rows) {
    r[key] =
      r.draftScore * (w.draft / 100) +
      r.rbPffScore * (w.pff / 100) +
      r.rasScore * (w.ras / 100);
  }

  const pw = pairwiseAccuracy(rows, key);

  candidates.push({
    key,
    weights: w,
    spearman: spearman(rows, 'actualOutcome', key),
    pairwise: pw.accuracy,
    weightedPairwise: pw.weightedAccuracy,
    top20: topReport(rows, key, 20),
  });
}

candidates.sort((a, b) =>
  b.weightedPairwise - a.weightedPairwise ||
  b.spearman - a.spearman ||
  b.top20.avgOutcome - a.top20.avgOutcome
);

const baselineKeys = [
  'draftScore',
  'rbPffScore',
  'rasScore',
  'rushingScore',
  'receivingScore',
  'passDownScore',
  'usageScore',
];

const baselines = Object.fromEntries(baselineKeys.map(key => {
  const pw = pairwiseAccuracy(rows, key);
  return [key, {
    spearman: spearman(rows, 'actualOutcome', key),
    pairwise: pw,
    top20: topReport(rows, key, 20),
  }];
}));

const best = candidates[0];

for (const r of recentDrafted) {
  r.bestBlendScore =
    r.draftScore * (best.weights.draft / 100) +
    r.rbPffScore * (best.weights.pff / 100) +
    r.rasScore * (best.weights.ras / 100);
}

const report = {
  generatedAt: new Date().toISOString(),
  trainingWindow: '2016-2021 drafted RBs with pre-draft PFF and optional RAS',
  historicalRows: rows.length,
  historicalRowsWithRas: rows.filter(r => r.hasRas).length,
  recentDraftedRows: recentDrafted.length,
  recentDraftedRowsWithRas: recentDrafted.filter(r => r.hasRas).length,
  baselines,
  bestCandidates: candidates.slice(0, 20),
  bestBlend: best,
  recentDraftedProjection: recentDrafted
    .sort((a, b) => b.bestBlendScore - a.bestBlendScore)
    .map(r => ({
      name: r.name,
      year: r.year,
      pick: r.pick,
      bestBlendScore: Number(r.bestBlendScore.toFixed(1)),
      draftScore: Number(r.draftScore.toFixed(1)),
      rbPffScore: Number(r.rbPffScore.toFixed(1)),
      rasScore: Number(r.rasScore.toFixed(1)),
      ras: r.ras,
      alltimeRas: r.alltimeRas,
      wAv: r.wAv,
      starts: r.starts,
    })),
};

fs.mkdirSync('public/data/model', { recursive: true });
fs.writeFileSync('public/data/model/rb_pff_ras_optimization_report.json', JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  historicalRows: report.historicalRows,
  historicalRowsWithRas: report.historicalRowsWithRas,
  recentDraftedRows: report.recentDraftedRows,
  recentDraftedRowsWithRas: report.recentDraftedRowsWithRas,
  baselines: report.baselines,
  bestCandidates: report.bestCandidates.slice(0, 10),
  recentDraftedTop15: report.recentDraftedProjection.slice(0, 15),
}, null, 2));

console.log('Wrote public/data/model/rb_pff_ras_optimization_report.json');
