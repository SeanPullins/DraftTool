import fs from 'fs';

function clean(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}
function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
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
      } else cur += ch;
    }
    values.push(cur);
    const obj = {};
    headers.forEach((h, i) => obj[h] = values[i] ?? '');
    return obj;
  });
}
function loadJsonRows(path) {
  if (!fs.existsSync(path)) return [];
  const payload = JSON.parse(fs.readFileSync(path, 'utf8'));
  return payload.records || payload || [];
}
function get(row, keys, fallback = null) {
  for (const k of keys) {
    if (row?.[k] != null && row[k] !== '') return row[k];
  }
  return fallback;
}
function val(row, keys, fallback = 0) {
  return num(get(row, keys), fallback);
}
function buildSeasonMap(rows) {
  const map = new Map();
  for (const r of rows) {
    const name = r.name || r.player || r.player_name;
    const season = Number(r.season || r.year);
    if (!name || !Number.isFinite(season)) continue;
    map.set(`${clean(name)}|${season}`, r);
  }
  return map;
}
function bestPffBeforeDraft(map, name, draftYear) {
  const seasons = [Number(draftYear) - 1, Number(draftYear) - 2];
  let best = null;
  for (const season of seasons) {
    const row = map.get(`${clean(name)}|${season}`);
    if (!row) continue;
    const sample = val(row, ['attempts', 'dropbacks'], 0);
    if (!best || sample > best.sample) best = { row, season, sample };
  }
  return best;
}
function expectedOutcomeByPick(pick) {
  const p = Number(pick) || 260;
  return Math.max(3, 65 * Math.exp(-0.018 * (p - 1)));
}
function draftScoreFromPick(pick) {
  const p = Number(pick) || 260;
  return Math.max(0, Math.min(100, 100 - Math.log2(Math.max(1, p)) * 10.5));
}
function outcomeScore(row) {
  const wAv = num(row.w_av, num(row.car_av, 0));
  const starts = num(row.seasons_started, 0);
  const pb = num(row.probowls, 0);
  const ap = num(row.allpro, 0);
  return wAv + Math.min(starts, 8) * 1.2 + pb * 8 + ap * 12;
}
function rank(values, getter) {
  return values.slice().sort((a, b) => getter(b) - getter(a)).map((x, i) => [x.key, i + 1]);
}
function spearman(rows, scoreKey) {
  const a = new Map(rank(rows, r => r[scoreKey]));
  const b = new Map(rank(rows, r => r.actual));
  const n = rows.length;
  if (n < 3) return 0;
  let sumD2 = 0;
  for (const r of rows) {
    const d = a.get(r.key) - b.get(r.key);
    sumD2 += d * d;
  }
  return 1 - (6 * sumD2) / (n * (n * n - 1));
}
function pairwise(rows, scoreKey) {
  let correct = 0;
  let total = 0;
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      const scoreOrder = Math.sign(a[scoreKey] - b[scoreKey]);
      const actualOrder = Math.sign(a.actual - b.actual);
      if (scoreOrder === 0 || actualOrder === 0) continue;
      if (scoreOrder === actualOrder) correct++;
      total++;
    }
  }
  return total ? correct / total : 0;
}
function topSummary(rows, scoreKey, n = 20) {
  const top = rows.slice().sort((a, b) => b[scoreKey] - a[scoreKey]).slice(0, n);
  return {
    n: top.length,
    avgActual: Number((top.reduce((s, r) => s + r.actual, 0) / Math.max(1, top.length)).toFixed(2)),
    stars: top.filter(r => r.actual >= 45).length,
    starters: top.filter(r => r.actual >= 20).length,
    busts: top.filter(r => r.actual <= 5).length,
    names: top.slice(0, 15).map(r => `${r.name} ${r.year} #${r.pick}`),
  };
}
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function qbV5Adjustment(r) {
  const matched = [];
  let adj = 0;

  const eliteScrambleCreation =
    r.pick <= 100 &&
    r.scrambles >= 40 &&
    r.run >= 75 &&
    r.acc >= 70;

  const top32CreationPlus =
    r.pick <= 32 &&
    r.scrambles >= 25 &&
    r.btt >= 5.5 &&
    r.adot >= 9.0 &&
    r.acc >= 70;

  const day2LowPassLowAcc =
    r.pick > 32 &&
    r.pick <= 100 &&
    r.pass < 75 &&
    r.acc < 70;

  const highCapitalLowCreation =
    r.pick <= 64 &&
    r.btt < 4.5 &&
    r.adot < 9.5 &&
    r.epa < 0.35;

  const safeLimitedLowCreation =
    r.pick > 20 &&
    r.btt < 4.5 &&
    r.twp <= 2.5 &&
    r.acc >= 72;

  if (eliteScrambleCreation) {
    adj += 0.35;
    matched.push('Elite scramble creation');
  }

  if (top32CreationPlus) {
    // Useful context badge, but not score-positive yet.
    matched.push('Top-32 creation plus');
  }

  if (day2LowPassLowAcc) {
    adj -= 0.35;
    matched.push('Day-2 low pass/accuracy risk');
  }

  if (highCapitalLowCreation) {
    adj -= 0.25;
    matched.push('High-capital low-creation risk');
  }

  if (safeLimitedLowCreation) {
    adj -= 0.20;
    matched.push('Safe-limited low-creation risk');
  }

  return {
    adjustment: clamp(adj, -0.60, 0.50),
    matched,
  };
}

const draftRows = parseCsv(fs.readFileSync('public/data/draft_picks.csv', 'utf8'));
const qbMap = buildSeasonMap(loadJsonRows('public/data/qb_pff_seasons.json'));
const rows = [];

for (const d of draftRows) {
  const pos = String(d.position || d.pos || '').toUpperCase();
  if (pos !== 'QB') continue;

  const year = num(d.season || d.year);
  const name = d.pfr_player_name || d.player_name || d.name || '';
  const pick = num(d.pick, 260);
  if (!year || !name || year < 2016 || year > 2021) continue;

  const best = bestPffBeforeDraft(qbMap, name, year);
  if (!best?.row) continue;

  const p = best.row;
  const actual = outcomeScore(d);
  const expected = expectedOutcomeByPick(pick);
  const baseScore = draftScoreFromPick(pick);

  const row = {
    key: `${year}|QB|${clean(name)}`,
    name,
    year,
    pick,
    actual,
    expected,
    delta: actual - expected,
    baseScore,
    pass: val(p, ['pass_grade','grades_pass']),
    run: val(p, ['run_grade','grades_run']),
    btt: val(p, ['btt_rate','btt_pct']),
    twp: val(p, ['twp_rate','twp_pct']),
    acc: val(p, ['adjusted_completion_percent','accuracy_percent']),
    adot: val(p, ['adot','avg_depth_of_target']),
    p2s: val(p, ['pressure_to_sack_rate','pressure_to_sack_pct']),
    epa: val(p, ['epa','epa_per_play']),
    scrambles: val(p, ['scrambles']),
  };

  const signal = qbV5Adjustment(row);

  rows.push({
    ...row,
    adjustment: signal.adjustment,
    adjustedScore: baseScore + signal.adjustment,
    matchedTraits: signal.matched,
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  note: 'QB v5 isolated creation + risk backtest. Does not change app scoring.',
  all: {
    n: rows.length,
    adjustedCount: rows.filter(r => Math.abs(r.adjustment) > 0).length,
    baseSpearman: Number(spearman(rows, 'baseScore').toFixed(4)),
    adjustedSpearman: Number(spearman(rows, 'adjustedScore').toFixed(4)),
    basePairwise: Number(pairwise(rows, 'baseScore').toFixed(4)),
    adjustedPairwise: Number(pairwise(rows, 'adjustedScore').toFixed(4)),
    baseTop20: topSummary(rows, 'baseScore', 20),
    adjustedTop20: topSummary(rows, 'adjustedScore', 20),
  },
  movers: rows
    .filter(r => Math.abs(r.adjustment) > 0)
    .sort((a, b) => a.adjustment - b.adjustment)
    .map(r => ({
      name: r.name,
      year: r.year,
      pick: r.pick,
      adjustment: r.adjustment,
      traits: r.matchedTraits,
      actual: Number(r.actual.toFixed(1)),
      delta: Number(r.delta.toFixed(1)),
      pass: r.pass,
      run: r.run,
      scrambles: r.scrambles,
      btt: r.btt,
      acc: r.acc,
      adot: r.adot,
      epa: r.epa,
    })),
};

fs.mkdirSync('public/data/model', { recursive: true });
fs.writeFileSync('public/data/model/qb_v5_creation_risk_backtest_report.json', JSON.stringify(report, null, 2));

console.log(JSON.stringify(report, null, 2));
console.log('Wrote public/data/model/qb_v5_creation_risk_backtest_report.json');
