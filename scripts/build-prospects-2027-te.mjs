import fs from 'fs';

function clean(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function scoreTe(row) {
  const route = Number(row.route_grade ?? 50);
  const off = Number(row.offense_grade ?? 50);
  const yprr = Number(row.yprr ?? 0);
  const yards = Number(row.yards ?? 0);
  const targets = Number(row.targets ?? 0);
  const inline = Number(row.inline_rate ?? 0);
  const passBlock = Number(row.pass_block_grade ?? 50);

  let score =
    route * 0.35 +
    off * 0.25 +
    Math.min(100, yprr * 25) * 0.20 +
    Math.min(100, yards / 8) * 0.10 +
    Math.min(100, targets) * 0.05 +
    passBlock * 0.05;

  // Small bump for real TE usage rather than pure detached WR usage.
  if (inline >= 25) score += 2;

  return Math.round(Math.max(0, Math.min(100, score)));
}

const payload = JSON.parse(fs.readFileSync('public/data/te_pff_seasons.json', 'utf8'));
const rows = payload.records ?? [];

const latest = rows.filter(r => Number(r.season) === 2025);

const seen = new Set();
const prospects = [];

for (const r of latest) {
  const routes = Number(r.routes ?? 0);
  const targets = Number(r.targets ?? 0);
  const yards = Number(r.yards ?? 0);

  // Filter tiny samples.
  if (routes < 80 && targets < 15 && yards < 150) continue;

  const key = clean(r.name);
  if (seen.has(key)) continue;
  seen.add(key);

  const grade = scoreTe(r);

  prospects.push({
    id: `te-2027-${key}`,
    name: r.name,
    school: r.team_name,
    team: r.team_name,
    year: 2027,
    draftYear: 2027,
    pos: 'TE',
    position: 'TE',
    grade,
    pick: null,
    projectedPick: null,
    source: 'te_pff_seasons',
    pff: {
      route_grade: r.route_grade,
      offense_grade: r.offense_grade,
      pass_block_grade: r.pass_block_grade,
      yprr: r.yprr,
      targets: r.targets,
      receptions: r.receptions,
      yards: r.yards,
      touchdowns: r.touchdowns,
      drop_rate: r.drop_rate,
      inline_rate: r.inline_rate,
      slot_rate: r.slot_rate,
      wide_rate: r.wide_rate
    }
  });
}

prospects.sort((a,b) => b.grade - a.grade || String(a.name).localeCompare(String(b.name)));

prospects.forEach((p, idx) => {
  p.rank = idx + 1;
  p.pick = idx + 1;
  p.projectedPick = idx + 1;
});

fs.writeFileSync('public/data/prospects_2027_te.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  records: prospects
}, null, 2));

console.log(`Wrote public/data/prospects_2027_te.json (${prospects.length} TEs)`);
console.log(prospects.slice(0, 15).map(p => ({
  rank: p.rank,
  name: p.name,
  school: p.school,
  grade: p.grade,
  route: p.pff.route_grade,
  off: p.pff.offense_grade,
  yprr: p.pff.yprr,
  yards: p.pff.yards
})));
