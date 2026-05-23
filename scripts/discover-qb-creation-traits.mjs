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
function outcomeScore(row) {
  const wAv = num(row.w_av, num(row.car_av, 0));
  const starts = num(row.seasons_started, 0);
  const pb = num(row.probowls, 0);
  const ap = num(row.allpro, 0);
  return wAv + Math.min(starts, 8) * 1.2 + pb * 8 + ap * 12;
}
function summarize(key, rows, test) {
  const matches = rows.filter(test);
  const n = matches.length;
  const avgDelta = n ? matches.reduce((s, r) => s + r.delta, 0) / n : 0;
  const starterRate = n ? matches.filter(r => r.actual >= 20).length / n : 0;
  const starRate = n ? matches.filter(r => r.actual >= 45).length / n : 0;
  const bustRate = n ? matches.filter(r => r.actual <= 5).length / n : 0;
  const badMissRate = n ? matches.filter(r => r.delta <= -10).length / n : 0;

  return {
    key,
    n,
    avgDelta: Number(avgDelta.toFixed(1)),
    starterRate: Number(starterRate.toFixed(2)),
    starRate: Number(starRate.toFixed(2)),
    bustRate: Number(bustRate.toFixed(2)),
    badMissRate: Number(badMissRate.toFixed(2)),
    positives: matches.slice().sort((a,b) => b.delta - a.delta).slice(0, 10)
      .map(r => `${r.name} ${r.year} #${r.pick} Δ${r.delta.toFixed(1)} run${r.run} rushYds${r.rushYards} scr${r.scrambles}`),
    negatives: matches.slice().sort((a,b) => a.delta - b.delta).slice(0, 10)
      .map(r => `${r.name} ${r.year} #${r.pick} Δ${r.delta.toFixed(1)} run${r.run} rushYds${r.rushYards} scr${r.scrambles}`),
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

  rows.push({
    name,
    year,
    pick,
    actual,
    expected,
    delta: actual - expected,

    pass: val(p, ['pass_grade','grades_pass']),
    offense: val(p, ['offense_grade','grades_offense']),
    run: val(p, ['run_grade','grades_run']),
    btt: val(p, ['btt_rate','btt_pct']),
    twp: val(p, ['twp_rate','twp_pct']),
    acc: val(p, ['adjusted_completion_percent','accuracy_percent']),
    adot: val(p, ['adot','avg_depth_of_target']),
    ttt: val(p, ['time_to_throw','avg_time_to_throw','ttt']),
    p2s: val(p, ['pressure_to_sack_rate','pressure_to_sack_pct']),
    sackPct: val(p, ['sack_pct','sackpercent']),
    epa: val(p, ['epa','epa_per_play']),
    attempts: val(p, ['attempts','dropbacks']),
    rushYards: 0, // no true QB rushing-yards field available; do not use passing yards
    scrambles: val(p, ['scrambles']),
  });
}

const traits = [
  {
    key: 'scramble_creation_top100',
    test: r => r.pick <= 100 && r.scrambles >= 25 && r.run >= 70 && r.btt >= 4.5 && r.acc >= 70 && r.twp <= 3.5,
  },
  {
    key: 'scramble_creation_day2',
    test: r => r.pick > 32 && r.pick <= 100 && r.scrambles >= 25 && r.run >= 70 && r.acc >= 70 && r.twp <= 3.5,
  },
  {
    key: 'elite_scramble_creation',
    test: r => r.pick <= 100 && r.scrambles >= 40 && r.run >= 75 && r.acc >= 70,
  },
  {
    key: 'top32_creation_plus',
    test: r => r.pick <= 32 && r.scrambles >= 25 && r.btt >= 5.5 && r.adot >= 9.0 && r.acc >= 70,
  },
  {
    key: 'top32_static_low_creation_risk',
    test: r => r.pick <= 32 && r.scrambles < 25 && r.run < 70 && r.btt < 5.0 && r.adot < 9.0,
  },
  {
    key: 'high_pick_low_creation_low_epa_risk',
    test: r => r.pick <= 32 && r.btt < 5.0 && r.adot < 9.0 && r.epa < 0.30,
  },
  {
    key: 'day2_low_creation_risk',
    test: r => r.pick > 32 && r.pick <= 100 && r.btt < 4.5 && r.scrambles < 25 && r.epa < 0.20,
  },
];

const summaries = traits.map(t => summarize(t.key, rows, t.test));

const report = {
  generatedAt: new Date().toISOString(),
  note: 'QB creation/outlier trait discovery. Does not change scoring.',
  rows: rows.length,
  summaries: summaries.sort((a,b) => b.avgDelta - a.avgDelta),
};

fs.mkdirSync('public/data/model', { recursive: true });
fs.writeFileSync('public/data/model/qb_creation_trait_discovery_report.json', JSON.stringify(report, null, 2));

console.log(JSON.stringify(report, null, 2));
console.log('Wrote public/data/model/qb_creation_trait_discovery_report.json');
