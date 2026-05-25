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

function receivingScore(row) {
  const route = num(row.route_grade, 50);
  const off = num(row.offense_grade, 50);
  const yprr = num(row.yprr, 0);
  const yards = num(row.yards, 0);
  const targets = num(row.targets, 0);
  const dropRate = num(row.drop_rate, 8);
  const yac = num(row.yards_after_catch, 0);
  const contested = num(row.contested_catch_rate, 50);

  let score =
    route * 0.32 +
    off * 0.22 +
    clamp(yprr * 28) * 0.20 +
    clamp(yards / 8) * 0.10 +
    clamp(targets) * 0.07 +
    clamp(yac / 5) * 0.05 +
    contested * 0.04;

  if (dropRate <= 5) score += 2;
  if (dropRate >= 10) score -= 3;

  return clamp(score);
}

function blockingScore(row) {
  const run = num(row.run_block_grade, 50);
  const pass = num(row.pass_block_grade, 50);
  const off = num(row.offense_grade, 50);
  const teSnaps = num(row.snap_counts_te, 0);
  const blockSnaps = num(row.snap_counts_block, 0);
  const passBlockSnaps = num(row.snap_counts_pass_block, 0);
  const pressures = num(row.pressures_allowed, 0);
  const penalties = num(row.penalties, 0);
  const pbe = num(row.pbe, 50);

  const inlineUsage = clamp(teSnaps / 4);
  const blockVolume = clamp(blockSnaps / 5);
  const pressureRatePenalty =
    passBlockSnaps > 0 ? Math.min(12, (pressures / passBlockSnaps) * 100) : 0;

  let score =
    run * 0.42 +
    pass * 0.22 +
    off * 0.14 +
    inlineUsage * 0.10 +
    blockVolume * 0.06 +
    pbe * 0.06;

  score -= Math.min(8, penalties * 0.8);
  score -= pressureRatePenalty;

  return clamp(score);
}

function usageScore(rec, block) {
  const routes = num(rec?.routes, 0);
  const targets = num(rec?.targets, 0);
  const yards = num(rec?.yards, 0);
  const receptions = num(rec?.receptions, 0);
  const inlineSnaps = num(rec?.inline_snaps, 0) || num(block?.snap_counts_te, 0);
  const blockSnaps = num(block?.snap_counts_block, 0);
  const games = num(rec?.player_game_count, 0) || num(block?.player_game_count, 0);

  return clamp(
    clamp(routes / 5) * 0.24 +
    clamp(targets) * 0.22 +
    clamp(yards / 8) * 0.20 +
    clamp(receptions * 1.5) * 0.12 +
    clamp(inlineSnaps / 4) * 0.12 +
    clamp(blockSnaps / 5) * 0.06 +
    clamp(games * 6) * 0.04
  );
}

function completenessBonus(rec, block) {
  const route = num(rec?.route_grade, 0);
  const yprr = num(rec?.yprr, 0);
  const recOff = num(rec?.offense_grade, 0);
  const run = num(block?.run_block_grade, 0);
  const pass = num(block?.pass_block_grade, 0);
  const inline = num(rec?.inline_rate, 0);
  const blockSnaps = num(block?.snap_counts_block, 0);

  let bonus = 0;

  if (route >= 75 && yprr >= 1.8) bonus += 4;
  if (recOff >= 75) bonus += 2;
  if (run >= 65) bonus += 2;
  if (pass >= 65) bonus += 1;
  if (inline >= 25 || blockSnaps >= 120) bonus += 2;

  // Complete TE archetype: receiving + usable blocking.
  if (route >= 70 && yprr >= 1.5 && run >= 65) bonus += 5;

  return clamp(bonus, 0, 10);
}

function finalTeForecastScore(rec, block) {
  const recScore = rec ? receivingScore(rec) : 50;
  const blockScore = block ? blockingScore(block) : 50;
  const useScore = usageScore(rec, block);
  const complete = completenessBonus(rec, block) * 10;

  const final =
    recScore * 0.45 +
    blockScore * 0.25 +
    useScore * 0.20 +
    complete * 0.10;

  return {
    final: Math.round(clamp(final)),
    receiving: Math.round(clamp(recScore)),
    blocking: Math.round(clamp(blockScore)),
    usage: Math.round(clamp(useScore)),
    completeness: Math.round(clamp(complete)),
  };
}

const recPayload = readJson('public/data/te_pff_seasons.json', { records: [] });
const blockPayload = readJson('public/data/te_blocking_pff_seasons.json', { records: [] });

const recRows = recPayload.records ?? [];
const blockRows = blockPayload.records ?? [];

const latestSeason = 2025;
const recLatest = recRows.filter((r) => Number(r.season) === latestSeason);
const blockLatest = blockRows.filter((r) => Number(r.season) === latestSeason);

const blockMap = new Map();
for (const b of blockLatest) {
  blockMap.set(clean(b.name || b.player), b);
}

const seen = new Set();
const prospects = [];

for (const rec of recLatest) {
  const key = clean(rec.name || rec.player);
  if (!key || seen.has(key)) continue;

  const routes = num(rec.routes, 0);
  const targets = num(rec.targets, 0);
  const yards = num(rec.yards, 0);

  // Keep meaningful 2027 TE candidates only.
  if (routes < 60 && targets < 12 && yards < 125) continue;

  seen.add(key);

  const block = blockMap.get(key) ?? null;
  const scores = finalTeForecastScore(rec, block);

  prospects.push({
    id: `te-2027-${key}`,
    name: rec.name,
    school: rec.team_name,
    team: rec.team_name,
    year: 2027,
    draftYear: 2027,
    pos: 'TE',
    position: 'TE',

    // Keep both fields so the existing Future Prospects tab can rank without touching QB/WR.
    grade: scores.final,
    score: scores.final,
    pick: null,
    projectedPick: null,
    source: 'te_receiving_blocking_forecast',

    forecast: {
      final: scores.final,
      receiving: scores.receiving,
      blocking: scores.blocking,
      usage: scores.usage,
      completeness: scores.completeness,
      weights: {
        receiving: 45,
        blocking: 25,
        usage: 20,
        completeness: 10,
      },
    },

    pff: {
      route_grade: rec.route_grade,
      offense_grade: rec.offense_grade,
      pass_block_grade: rec.pass_block_grade,
      yprr: rec.yprr,
      targets: rec.targets,
      receptions: rec.receptions,
      yards: rec.yards,
      touchdowns: rec.touchdowns,
      drop_rate: rec.drop_rate,
      inline_rate: rec.inline_rate,
      slot_rate: rec.slot_rate,
      wide_rate: rec.wide_rate,
      run_block_grade: block?.run_block_grade ?? null,
      blocking_pass_block_grade: block?.pass_block_grade ?? null,
      block_offense_grade: block?.offense_grade ?? null,
      block_snaps: block?.snap_counts_block ?? null,
      te_snaps: block?.snap_counts_te ?? null,
      pressures_allowed: block?.pressures_allowed ?? null,
      penalties: block?.penalties ?? null,
    },
  });
}

// TE-only ordering. Does not affect QB/WR files or scoring.
prospects.sort((a, b) =>
  b.grade - a.grade ||
  Number(b.pff.yards || 0) - Number(a.pff.yards || 0) ||
  String(a.name).localeCompare(String(b.name))
);

prospects.forEach((p, idx) => {
  p.rank = idx + 1;

  // Synthetic pick/rank only for display/sorting in Future Prospects.
  // This is NOT actual draft capital.
  p.pick = idx + 1;
  p.projectedPick = idx + 1;
});

fs.writeFileSync('public/data/prospects_2027_te.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  model: 'TE_FORECAST_RECEIVING_BLOCKING_V1',
  notes: [
    'TE-only forecast model.',
    'Does not change QB or WR scoring.',
    'Uses 2025 TE receiving + blocking PFF data to forecast 2027 TE prospects.',
    'No actual draft slot is used.'
  ],
  records: prospects,
}, null, 2));

console.log(`Wrote public/data/prospects_2027_te.json (${prospects.length} TEs)`);
console.table(prospects.slice(0, 20).map((p) => ({
  rank: p.rank,
  name: p.name,
  school: p.school,
  grade: p.grade,
  rec: p.forecast.receiving,
  block: p.forecast.blocking,
  usage: p.forecast.usage,
  complete: p.forecast.completeness,
  route: p.pff.route_grade,
  yprr: p.pff.yprr,
  runBlock: p.pff.run_block_grade,
  yards: p.pff.yards,
})));
