import fs from 'fs';

function clean(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number.isFinite(v) ? v : 0));
}

function readJson(path, fallback = null) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function parseCsv(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(',').map((h) => h.trim());

  return lines.slice(1).map((line) => {
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
    headers.forEach((h, i) => {
      obj[h] = values[i] ?? '';
    });
    return obj;
  });
}

function buildRasMap(path = 'public/data/ras_main_table.csv') {
  if (!fs.existsSync(path)) return new Map();

  const rows = parseCsv(fs.readFileSync(path, 'utf8'));
  const out = new Map();

  for (const row of rows) {
    // Skip duplicated header row.
    if (row.name === 'name' || row.pos === 'pos') continue;

    const pos = String(row.pos || '').toUpperCase();
    if (pos !== 'RB') continue;

    const name = clean(row.name || '');
    const year = Number(row.year);
    if (!name || !Number.isFinite(year)) continue;

    const ras = Number(row.ras);
    const alltimeRas = Number(row.alltime_ras);

    out.set(`${name}|${year}`, {
      ras: Number.isFinite(ras) ? ras : null,
      alltimeRas: Number.isFinite(alltimeRas) ? alltimeRas : null,
      sourceUrl: row.source_url || null,
      college: row.college || null,
    });
  }

  return out;
}

function getRasForPlayer(rasMap, name, draftYear) {
  const key = `${clean(name)}|${Number(draftYear)}`;
  return rasMap.get(key) || null;
}

function rasScore(rasRecord) {
  if (!rasRecord) return 50;

  const ras = Number(rasRecord.ras ?? rasRecord.alltimeRas);
  if (!Number.isFinite(ras)) return 50;

  // Convert 0-10 RAS to 0-100 score.
  return clamp(ras * 10);
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
    run * 0.28 +
    off * 0.18 +
    clamp(ypa * 13) * 0.12 +
    clamp(yco * 22) * 0.14 +
    clamp(elusive / 2.2) * 0.12 +
    clamp(avoided) * 0.08 +
    clamp(breakaway * 1.7) * 0.04 +
    clamp(yards / 18) * 0.04
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

function passProScore(row) {
  const passBlock = num(row.pass_block_grade, 50);
  const routes = num(row.routes, 0);
  const targets = num(row.targets, 0);

  // We don't want pass pro to dominate RB projection,
  // but receiving/pass-down ability matters.
  return clamp(passBlock * 0.75 + clamp(routes / 2) * 0.15 + clamp(targets * 2) * 0.10);
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

  return clamp(bonus, 0, 10);
}

function finalRbForecastScore(row, rasRecord = null) {
  const rush = rushingScore(row);
  const recv = receivingScore(row);
  const pro = passProScore(row);
  const use = usageScore(row);
  const ras = rasScore(rasRecord);
  const bonus = completenessBonus(row) * 10;
  const penalty = riskPenalty(row);

  const final =
    rush * 0.48 +
    recv * 0.15 +
    pro * 0.08 +
    use * 0.15 +
    ras * 0.07 +
    bonus * 0.07 -
    penalty;

  return {
    final: Math.round(clamp(final)),
    rushing: Math.round(clamp(rush)),
    receiving: Math.round(clamp(recv)),
    passPro: Math.round(clamp(pro)),
    usage: Math.round(clamp(use)),
    ras: Math.round(clamp(ras)),
    completeness: Math.round(clamp(bonus)),
    penalty,
  };
}

const payload = readJson('public/data/rb_pff_seasons.json', { records: [] });
const rows = payload.records ?? [];
const rasMap = buildRasMap();

const latestSeason = 2025;
const latest = rows.filter((r) => Number(r.season) === latestSeason);

const seen = new Set();
const prospects = [];

for (const r of latest) {
  const key = clean(r.name || r.player);
  if (!key || seen.has(key)) continue;

  const attempts = num(r.attempts, 0);
  const touches = num(r.total_touches, 0);
  const yards = num(r.yards, 0);

  // Meaningful 2027 RB candidate filter.
  if (attempts < 80 && touches < 100 && yards < 500) continue;

  seen.add(key);

  const rasRecord = getRasForPlayer(rasMap, r.name || r.player, 2027);
  const scores = finalRbForecastScore(r, rasRecord);

  prospects.push({
    id: `rb-2027-${key}`,
    name: r.name,
    school: r.team_name,
    team: r.team_name,
    year: 2027,
    draftYear: 2027,
    pos: 'RB',
    position: 'RB',

    grade: scores.final,
    score: scores.final,
    pick: null,
    projectedPick: null,
    source: 'rb_rushing_forecast',

    forecast: {
      final: scores.final,
      rushing: scores.rushing,
      receiving: scores.receiving,
      passPro: scores.passPro,
      usage: scores.usage,
      ras: scores.ras,
      completeness: scores.completeness,
      penalty: scores.penalty,
      weights: {
        rushing: 48,
        receiving: 15,
        passPro: 8,
        usage: 15,
        ras: 7,
        completeness: 7,
      },
    },

    pff: {
      attempts: r.attempts,
      yards: r.yards,
      ypa: r.ypa,
      touchdowns: r.touchdowns,
      run_grade: r.run_grade,
      offense_grade: r.offense_grade,
      yards_after_contact: r.yards_after_contact,
      yco_attempt: r.yco_attempt,
      avoided_tackles: r.avoided_tackles,
      elusive_rating: r.elusive_rating,
      breakaway_percent: r.breakaway_percent,
      breakaway_yards: r.breakaway_yards,
      explosive: r.explosive,
      targets: r.targets,
      receptions: r.receptions,
      rec_yards: r.rec_yards,
      route_grade: r.route_grade,
      yprr: r.yprr,
      pass_block_grade: r.pass_block_grade,
      fumbles: r.fumbles,
      total_touches: r.total_touches,
      ras: rasRecord?.ras ?? null,
      alltime_ras: rasRecord?.alltimeRas ?? null,
      ras_source_url: rasRecord?.sourceUrl ?? null,
    },
  });
}

prospects.sort((a, b) =>
  b.grade - a.grade ||
  Number(b.pff.yards || 0) - Number(a.pff.yards || 0) ||
  String(a.name).localeCompare(String(b.name))
);

prospects.forEach((p, idx) => {
  p.rank = idx + 1;

  // Synthetic display rank only. Not actual draft capital.
  p.pick = idx + 1;
  p.projectedPick = idx + 1;
});

fs.writeFileSync('public/data/prospects_2027_rb.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  model: 'RB_FORECAST_RUSHING_RECEIVING_V1',
  notes: [
    'RB-only forecast model.',
    'Does not change QB, WR, or TE scoring.',
    'Uses 2025 RB rushing/receiving/pass-pro PFF data to forecast 2027 RB prospects.',
    'No actual draft slot is used.'
  ],
  records: prospects,
}, null, 2));

console.log(`Wrote public/data/prospects_2027_rb.json (${prospects.length} RBs)`);
console.table(prospects.slice(0, 20).map((p) => ({
  rank: p.rank,
  name: p.name,
  school: p.school,
  grade: p.grade,
  rush: p.forecast.rushing,
  recv: p.forecast.receiving,
  passPro: p.forecast.passPro,
  usage: p.forecast.usage,
  ras: p.forecast.ras,
  run: p.pff.run_grade,
  yco: p.pff.yco_attempt,
  elusive: p.pff.elusive_rating,
  yards: p.pff.yards,
})));
