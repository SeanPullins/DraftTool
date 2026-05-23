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
    scrambles: val(p, ['scrambles']),
  });
}

const filters = [];

function addFilter(key, test) {
  const matches = rows.filter(test);
  if (!matches.length) return;

  const badMisses = matches.filter(r => r.delta <= -10);
  const busts = matches.filter(r => r.actual <= 5);
  const falseHits = matches.filter(r => r.delta >= 10);
  const stars = matches.filter(r => r.actual >= 45);

  const avgDelta = matches.reduce((s, r) => s + r.delta, 0) / matches.length;

  filters.push({
    key,
    n: matches.length,
    avgDelta: Number(avgDelta.toFixed(1)),
    badMissRate: Number((badMisses.length / matches.length).toFixed(2)),
    bustRate: Number((busts.length / matches.length).toFixed(2)),
    falseHitRate: Number((falseHits.length / matches.length).toFixed(2)),
    starRate: Number((stars.length / matches.length).toFixed(2)),
    score: Number(((badMisses.length * 2 + busts.length) - (falseHits.length * 3 + stars.length * 2)).toFixed(1)),
    matches: matches
      .slice()
      .sort((a, b) => a.delta - b.delta)
      .map(r => `${r.name} ${r.year} #${r.pick} Δ${r.delta.toFixed(1)} pass${r.pass} btt${r.btt} acc${r.acc} adot${r.adot} run${r.run} scr${r.scrambles} epa${r.epa} twp${r.twp} p2s${r.p2s}`),
  });
}

// High-pick risk filters.
for (const pickMax of [10, 16, 32, 64, 100]) {
  for (const bttMax of [4.5, 5.0, 5.5, 6.0]) {
    for (const adotMax of [8.5, 9.0, 9.5]) {
      for (const epaMax of [0.2, 0.25, 0.3, 0.35]) {
        addFilter(
          `pick<=${pickMax}_btt<${bttMax}_adot<${adotMax}_epa<${epaMax}`,
          r => r.pick <= pickMax && r.btt < bttMax && r.adot < adotMax && r.epa < epaMax
        );
      }
    }
  }
}

// Static / low-creation filters with Herbert guard: require low BTT OR poor pass/offense.
for (const pickMax of [16, 32, 64, 100]) {
  for (const scrMax of [20, 25, 30]) {
    for (const runMax of [60, 65, 70]) {
      addFilter(
        `pick<=${pickMax}_scr<${scrMax}_run<${runMax}_btt<5.2_adot<9.2`,
        r => r.pick <= pickMax && r.scrambles < scrMax && r.run < runMax && r.btt < 5.2 && r.adot < 9.2
      );
    }
  }
}

// Low accuracy / low efficiency / low creation.
for (const pickMax of [32, 64, 100]) {
  addFilter(
    `pick<=${pickMax}_acc<70_epa<0.15`,
    r => r.pick <= pickMax && r.acc < 70 && r.epa < 0.15
  );

  addFilter(
    `pick<=${pickMax}_pass<75_acc<70`,
    r => r.pick <= pickMax && r.pass < 75 && r.acc < 70
  );

  addFilter(
    `pick<=${pickMax}_btt<5_acc<70_epa<0.20`,
    r => r.pick <= pickMax && r.btt < 5 && r.acc < 70 && r.epa < 0.20
  );
}

// Safe-limited profile from earlier.
addFilter(
  'pick>20_low_creation_safe_limited',
  r => r.pick > 20 && r.btt < 4.5 && r.twp <= 2.5 && r.acc >= 72
);

// Day-2 traps.
addFilter(
  'day2_low_creation_low_efficiency',
  r => r.pick > 32 && r.pick <= 100 && r.btt < 5.0 && r.epa < 0.15 && r.acc < 72
);

addFilter(
  'day2_low_pass_low_acc',
  r => r.pick > 32 && r.pick <= 100 && r.pass < 75 && r.acc < 70
);

const ranked = filters
  .filter(f => f.n >= 2)
  .sort((a, b) => b.score - a.score || a.avgDelta - b.avgDelta || b.badMissRate - a.badMissRate);

const report = {
  generatedAt: new Date().toISOString(),
  note: 'QB negative-filter search. Does not change scoring.',
  rows: rows.length,
  bestFilters: ranked.slice(0, 30),
  allFilters: ranked,
};

fs.mkdirSync('public/data/model', { recursive: true });
fs.writeFileSync('public/data/model/qb_negative_filter_search_report.json', JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  rows: report.rows,
  bestFilters: report.bestFilters.slice(0, 15)
}, null, 2));

console.log('Wrote public/data/model/qb_negative_filter_search_report.json');
