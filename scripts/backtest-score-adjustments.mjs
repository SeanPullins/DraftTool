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

    const sample =
      num(get(row, ['attempts', 'dropbacks', 'targets', 'carries', 'routes']), 0) ||
      num(get(row, ['yards', 'receiving_yards', 'rushing_yards']), 0);

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

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(v) ? v : 0));
}

function draftCapitalDamping(pick) {
  const p = Number(pick) || 260;
  if (p <= 64) return 1.0;
  if (p <= 100) return 0.80;
  if (p <= 180) return 0.65;
  return 0.50;
}

function posCap(pos) {
  if (pos === 'QB') return 2.0;
  if (pos === 'RB') return 3.0;
  if (pos === 'TE') return 1.5;
  if (pos === 'WR') return 1.0;
  return 1.0;
}

const quantumTraits = {
  QB: [
    {
      key: 'creation_without_chaos',
      label: 'Creation without chaos',
      adjustment: 0.11,
      test: r => val(r, ['btt_rate', 'btt_pct'], 0) >= 6.0 && val(r, ['twp_rate', 'twp_pct'], 99) <= 2.5,
    },
    {
      key: 'pressure_translator',
      label: 'Pressure translator',
      adjustment: 0.11,
      test: r => val(r, ['pass_grade', 'grades_pass'], 0) >= 85 && val(r, ['pressure_to_sack_rate', 'pressure_to_sack_pct'], 99) <= 15,
    },
    {
      key: 'danger_profile',
      label: 'QB danger profile',
      adjustment: -0.11,
      test: r => val(r, ['twp_rate', 'twp_pct'], 0) >= 4.0 && val(r, ['pressure_to_sack_rate', 'pressure_to_sack_pct'], 0) >= 20 && val(r, ['adjusted_completion_percent', 'accuracy_percent'], 100) < 70,
    },
  ],
  RB: [
    {
      key: 'contact_creator',
      label: 'Contact creator',
      adjustment: 0.51,
      test: r => val(r, ['yco', 'yco_attempt', 'yards_after_contact_per_attempt'], 0) >= 3.4 &&
                 val(r, ['elusive', 'elusive_rating'], 0) >= 90,
    },
    {
      key: 'three_down_viability',
      label: 'Three-down viability',
      adjustment: 0.94,
      test: r => val(r, ['run_grade', 'grades_run'], 0) >= 80 &&
                 val(r, ['receiving_grade', 'route_grade', 'grades_pass_route'], 0) >= 65 &&
                 val(r, ['pass_block_grade', 'grades_pass_block'], 0) >= 60,
    },
    {
      key: 'volume_efficiency',
      label: 'Volume efficiency',
      adjustment: 0.59,
      test: r => val(r, ['yards', 'rushing_yards'], 0) >= 1000 &&
                 val(r, ['yco', 'yco_attempt', 'yards_after_contact_per_attempt'], 0) >= 3.0,
    },
  ],
  TE: [
    {
      key: 'inline_survivor',
      label: 'Inline survivor',
      adjustment: 0.15,
      test: r => {
        const block = Math.max(
          val(r, ['run_block_grade', 'grades_run_block'], 0),
          val(r, ['pass_block_grade', 'grades_pass_block'], 0)
        );
        return block >= 70 && val(r, ['route_grade', 'grades_pass_route'], 0) >= 60;
      },
    },
  ],
  WR: [
    // WR quantum traits are not score-ready yet; intentionally blank.
  ],
};

function traitAdjustment(pos, pff, pick) {
  const traits = quantumTraits[pos] || [];
  const matched = [];
  let raw = 0;

  for (const t of traits) {
    if (t.test(pff)) {
      matched.push(t.label);
      raw += t.adjustment;
    }
  }

  const damped = raw * draftCapitalDamping(pick);
  const capped = clamp(damped, -posCap(pos), posCap(pos));

  return {
    adjustment: Number(capped.toFixed(2)),
    matched,
  };
}

function rank(values, getter) {
  return values
    .slice()
    .sort((a, b) => getter(b) - getter(a))
    .map((x, i) => [x.key, i + 1]);
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
    avgPick: Number((top.reduce((s, r) => s + r.pick, 0) / Math.max(1, top.length)).toFixed(2)),
    stars: top.filter(r => r.actual >= 45).length,
    starters: top.filter(r => r.actual >= 20).length,
    busts: top.filter(r => r.actual <= 5).length,
    names: top.slice(0, 15).map(r => `${r.name} ${r.year} #${r.pick}`),
  };
}

const draftRows = parseCsv(fs.readFileSync('public/data/draft_picks.csv', 'utf8'));

const pffMaps = {
  QB: buildSeasonMap(loadJsonRows('public/data/qb_pff_seasons.json')),
  WR: buildSeasonMap(loadJsonRows('public/data/wr_pff_seasons.json')),
  RB: buildSeasonMap(loadJsonRows('public/data/rb_pff_seasons.json')),
  TE: buildSeasonMap(loadJsonRows('public/data/te_pff_seasons.json')),
};

const positions = ['QB', 'WR', 'RB', 'TE'];
const rows = [];

for (const r of draftRows) {
  const pos = String(r.position || r.pos || '').toUpperCase();
  if (!positions.includes(pos)) continue;

  const year = num(r.season || r.year);
  const name = r.pfr_player_name || r.player_name || r.name || '';
  const pick = num(r.pick, 260);

  if (!year || !name || year < 2016 || year > 2021) continue;

  const best = bestPffBeforeDraft(pffMaps[pos], name, year);
  if (!best?.row) continue;

  const actual = outcomeScore(r);
  const expected = expectedOutcomeByPick(pick);
  const baseScore = draftScoreFromPick(pick);

  const traits = traitAdjustment(pos, best.row, pick);

  rows.push({
    key: `${year}|${pos}|${clean(name)}`,
    year,
    pos,
    name,
    pick,
    actual,
    expected,
    delta: actual - expected,
    baseScore,
    adjustedScore: baseScore + traits.adjustment,
    adjustment: traits.adjustment,
    matchedTraits: traits.matched,
    pffSeason: best.season,
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  note: 'True historical quantum trait backtest. Applies the same score-ready trait logic to historical players with PFF rows.',
  all: {
    n: rows.length,
    baseSpearman: Number(spearman(rows, 'baseScore').toFixed(4)),
    adjustedSpearman: Number(spearman(rows, 'adjustedScore').toFixed(4)),
    basePairwise: Number(pairwise(rows, 'baseScore').toFixed(4)),
    adjustedPairwise: Number(pairwise(rows, 'adjustedScore').toFixed(4)),
    baseTop20: topSummary(rows, 'baseScore', 20),
    adjustedTop20: topSummary(rows, 'adjustedScore', 20),
  },
  byPosition: Object.fromEntries(positions.map(pos => {
    const pr = rows.filter(r => r.pos === pos);

    return [pos, {
      n: pr.length,
      adjustedCount: pr.filter(r => Math.abs(r.adjustment) > 0).length,
      baseSpearman: Number(spearman(pr, 'baseScore').toFixed(4)),
      adjustedSpearman: Number(spearman(pr, 'adjustedScore').toFixed(4)),
      basePairwise: Number(pairwise(pr, 'baseScore').toFixed(4)),
      adjustedPairwise: Number(pairwise(pr, 'adjustedScore').toFixed(4)),
      baseTop20: topSummary(pr, 'baseScore', Math.min(20, pr.length)),
      adjustedTop20: topSummary(pr, 'adjustedScore', Math.min(20, pr.length)),
      biggestPositive: pr
        .filter(r => r.adjustment > 0)
        .sort((a, b) => b.adjustment - a.adjustment)
        .slice(0, 20)
        .map(r => ({
          name: r.name,
          year: r.year,
          pick: r.pick,
          adjustment: r.adjustment,
          traits: r.matchedTraits,
          actual: Number(r.actual.toFixed(1)),
          delta: Number(r.delta.toFixed(1)),
        })),
      biggestNegative: pr
        .filter(r => r.adjustment < 0)
        .sort((a, b) => a.adjustment - b.adjustment)
        .slice(0, 20)
        .map(r => ({
          name: r.name,
          year: r.year,
          pick: r.pick,
          adjustment: r.adjustment,
          traits: r.matchedTraits,
          actual: Number(r.actual.toFixed(1)),
          delta: Number(r.delta.toFixed(1)),
        })),
    }];
  })),
};

fs.mkdirSync('public/data/model', { recursive: true });
fs.writeFileSync('public/data/model/score_adjustment_backtest.json', JSON.stringify(report, null, 2));

console.log(JSON.stringify(report, null, 2));
console.log('Wrote public/data/model/score_adjustment_backtest.json');
