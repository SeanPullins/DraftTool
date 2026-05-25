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

function get(row, keys, fallback = null) {
  for (const k of keys) {
    if (row?.[k] != null) return row[k];
  }
  return fallback;
}

function draftScoreFromPick(pick) {
  const p = Math.max(1, Number(pick) || 260);
  return clamp(100 - (Math.log(p) / Math.log(260)) * 100);
}

function wrPffScore(row) {
  const route = num(get(row, ['route_grade', 'grades_pass_route']), 50);
  const recvGrade = num(get(row, ['receiving_grade', 'grades_pass_route', 'offense_grade', 'grades_offense']), 50);
  const off = num(get(row, ['offense_grade', 'grades_offense']), 50);
  const yprr = num(get(row, ['yprr', 'yards_per_route_run']), 0);
  const yards = num(get(row, ['yards', 'receiving_yards']), 0);
  const targets = num(get(row, ['targets']), 0);
  const receptions = num(get(row, ['receptions']), 0);
  const adot = num(get(row, ['adot', 'avg_depth_of_target']), 0);
  const yac = num(get(row, ['yards_after_catch', 'yac']), 0);
  const dropRate = num(get(row, ['drop_rate']), 8);
  const contested = num(get(row, ['contested_catch_rate']), 50);

  let score =
    route * 0.26 +
    recvGrade * 0.18 +
    off * 0.12 +
    clamp(yprr * 25) * 0.17 +
    clamp(yards / 12) * 0.10 +
    clamp(targets) * 0.07 +
    clamp(receptions * 1.25) * 0.04 +
    clamp(adot * 5) * 0.025 +
    clamp(yac / 5) * 0.025 +
    contested * 0.02;

  if (dropRate <= 5 && targets >= 40) score += 2;
  if (dropRate >= 10) score -= 4;

  return clamp(score);
}

function wrSampleScore(row) {
  const targets = num(get(row, ['targets']), 0);
  const yards = num(get(row, ['yards', 'receiving_yards']), 0);
  const routes = num(get(row, ['routes']), 0);

  return targets + yards / 10 + routes / 8;
}

function isQualifyingWrSeason(row) {
  const targets = num(get(row, ['targets']), 0);
  const yards = num(get(row, ['yards', 'receiving_yards']), 0);
  const routes = num(get(row, ['routes']), 0);

  return targets >= 30 || yards >= 400 || routes >= 150;
}

function buildRasMap() {
  const rasPath = 'public/data/ras_main_table.csv';
  if (!fs.existsSync(rasPath)) return new Map();

  const rows = parseCsv(fs.readFileSync(rasPath, 'utf8'));
  const out = new Map();

  for (const row of rows) {
    if (row.name === 'name' || row.pos === 'pos') continue;
    if (String(row.pos || '').toUpperCase() !== 'WR') continue;

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

function rasScore(rasRecord) {
  if (!rasRecord) return 50;

  const raw = rasRecord.ras ?? rasRecord.alltimeRas;
  const ras = Number(raw);

  if (!Number.isFinite(ras) || ras <= 0) return 50;

  return clamp(ras * 10);
}

function getRas(rasMap, name, year) {
  return rasMap.get(`${clean(name)}|${Number(year)}`) || null;
}

function loadWrRows() {
  const candidates = [
    'public/data/wr_pff_seasons.json',
    'wr_pff_seasons.json',
  ];

  for (const path of candidates) {
    if (!fs.existsSync(path)) continue;
    const payload = JSON.parse(fs.readFileSync(path, 'utf8'));
    return payload.records ?? payload;
  }

  throw new Error('Could not find WR PFF season data.');
}

function getBestWrProfile(wrMap, name, draftYear) {
  const seasons = [Number(draftYear) - 1, Number(draftYear) - 2];

  const candidates = seasons
    .map((season) => {
      const row = wrMap.get(`${clean(name)}|${season}`);
      if (!row) return null;

      const pff = wrPffScore(row);
      const sample = wrSampleScore(row);
      const qualifies = isQualifyingWrSeason(row);

      return {
        row,
        season,
        pff,
        sample,
        qualifies,
        profileScore: qualifies ? pff * 0.82 + clamp(sample) * 0.18 : pff * 0.65 + clamp(sample) * 0.10,
      };
    })
    .filter(Boolean);

  if (!candidates.length) return null;

  const qualifying = candidates.filter((c) => c.qualifies);
  const pool = qualifying.length ? qualifying : candidates;

  pool.sort((a, b) =>
    b.profileScore - a.profileScore ||
    b.sample - a.sample ||
    b.season - a.season
  );

  return pool[0];
}

function futureWrForecastScore(row, rasRecord = null) {
  const route = num(get(row, ['route_grade', 'grades_pass_route']), 50);
  const off = num(get(row, ['offense_grade', 'grades_offense']), 50);
  const pff = wrPffScore(row);
  const yprr = num(get(row, ['yprr', 'yards_per_route_run']), 0);
  const yards = num(get(row, ['yards', 'receiving_yards']), 0);
  const targets = num(get(row, ['targets']), 0);
  const receptions = num(get(row, ['receptions']), 0);
  const adot = num(get(row, ['adot', 'avg_depth_of_target']), 0);
  const yac = num(get(row, ['yards_after_catch', 'yac']), 0);
  const dropRate = num(get(row, ['drop_rate']), 8);
  const ras = rasScore(rasRecord);

  const routeScore = clamp(route * 0.55 + off * 0.20 + pff * 0.25);
  const efficiency = clamp(clamp(yprr * 28) * 0.65 + clamp(adot * 5) * 0.15 + clamp(yac / 5) * 0.20);
  const production = clamp(clamp(yards / 12) * 0.45 + clamp(targets) * 0.35 + clamp(receptions * 1.25) * 0.20);
  const explosive = clamp(clamp(adot * 5) * 0.45 + clamp(yac / 5) * 0.35 + clamp(yards / 15) * 0.20);

  let completeness = 50;
  if (route >= 80 && yprr >= 2.5) completeness += 15;
  if (targets >= 80 || yards >= 900) completeness += 10;
  if (ras >= 80) completeness += 7;
  if (dropRate <= 5 && targets >= 40) completeness += 5;
  if (dropRate >= 10) completeness -= 8;
  completeness = clamp(completeness);

  const final =
    routeScore * 0.35 +
    efficiency * 0.20 +
    production * 0.15 +
    explosive * 0.10 +
    ras * 0.10 +
    completeness * 0.10;

  return {
    final: Math.round(clamp(final)),
    pff: Math.round(clamp(pff)),
    route: Math.round(clamp(routeScore)),
    efficiency: Math.round(clamp(efficiency)),
    production: Math.round(clamp(production)),
    explosive: Math.round(clamp(explosive)),
    ras: Math.round(clamp(ras)),
    completeness: Math.round(clamp(completeness)),
  };
}

const draftRows = parseCsv(fs.readFileSync('public/data/draft_picks.csv', 'utf8'));
const wrRows = loadWrRows();
const rasMap = buildRasMap();

const wrMap = new Map();
for (const r of wrRows) {
  const name = r.name || r.player || r.player_name;
  const season = Number(r.season || r.year);
  if (!name || !Number.isFinite(season)) continue;
  wrMap.set(`${clean(name)}|${season}`, r);
}

function makeDraftedWrFile(year) {
  const records = [];

  for (const d of draftRows) {
    const pos = String(d.position || d.pos || '').toUpperCase();
    if (pos !== 'WR') continue;

    const draftYear = num(d.season);
    if (draftYear !== year) continue;

    const name = d.pfr_player_name || d.player_name || d.name;
    const pick = num(d.pick);
    if (!name || !pick) continue;

    const bestProfile = getBestWrProfile(wrMap, name, year);
    if (!bestProfile?.row) continue;

    const rasRecord = getRas(rasMap, name, year);
    const draftScore = draftScoreFromPick(pick);
    const pffScore = wrPffScore(bestProfile.row);
    const ras = rasScore(rasRecord);

    const final = draftScore * 0.75 + pffScore * 0.15 + ras * 0.10;

    records.push({
      id: `wr-${year}-${clean(name)}`,
      name,
      school: bestProfile.row.team_name || bestProfile.row.team || d.college || '',
      team: bestProfile.row.team_name || bestProfile.row.team || d.college || '',
      year,
      draftYear: year,
      pos: 'WR',
      position: 'WR',
      pick,
      projectedPick: pick,
      grade: Math.round(clamp(final)),
      score: Math.round(clamp(final)),
      source: 'wr_drafted_projection_75_15_10',
      forecast: {
        final: Math.round(clamp(final)),
        draft: Math.round(clamp(draftScore)),
        pff: Math.round(clamp(pffScore)),
        ras: Math.round(clamp(ras)),
        weights: { draft: 75, pff: 15, ras: 10 },
      },
      pff: {
        season_used: bestProfile.season,
        sample_score: Number(bestProfile.sample.toFixed(1)),
        route_grade: get(bestProfile.row, ['route_grade', 'grades_pass_route']),
        offense_grade: get(bestProfile.row, ['offense_grade', 'grades_offense']),
        yprr: get(bestProfile.row, ['yprr', 'yards_per_route_run']),
        targets: get(bestProfile.row, ['targets']),
        receptions: get(bestProfile.row, ['receptions']),
        yards: get(bestProfile.row, ['yards', 'receiving_yards']),
        drop_rate: get(bestProfile.row, ['drop_rate']),
        ras: rasRecord?.ras ?? null,
        alltime_ras: rasRecord?.alltimeRas ?? null,
        ras_source_url: rasRecord?.sourceUrl ?? null,
      },
    });
  }

  records.sort((a, b) =>
    b.grade - a.grade ||
    Number(a.pick || 999) - Number(b.pick || 999) ||
    String(a.name).localeCompare(String(b.name))
  );

  records.forEach((r, idx) => {
    r.rank = idx + 1;
  });

  return records;
}

function makeFutureWrFile(draftYear) {
  const sourceSeason = 2025;
  const records = [];
  const seen = new Set();

  const seasonRows = wrRows.filter((r) => Number(r.season || r.year) === sourceSeason);

  for (const row of seasonRows) {
    const name = row.name || row.player || row.player_name;
    const key = clean(name);
    if (!key || seen.has(key)) continue;

    const targets = num(get(row, ['targets']), 0);
    const yards = num(get(row, ['yards', 'receiving_yards']), 0);
    const routes = num(get(row, ['routes']), 0);

    if (targets < 25 && yards < 350 && routes < 120) continue;

    seen.add(key);

    const rasRecord = getRas(rasMap, name, draftYear);
    const scores = futureWrForecastScore(row, rasRecord);

    records.push({
      id: `wr-${draftYear}-${key}`,
      name,
      school: row.team_name || row.team || '',
      team: row.team_name || row.team || '',
      year: draftYear,
      draftYear,
      pos: 'WR',
      position: 'WR',
      pick: null,
      projectedPick: null,
      grade: scores.final,
      score: scores.final,
      source: 'wr_future_pff_ras_forecast',
      forecast: {
        ...scores,
        weights: {
          route: 35,
          efficiency: 20,
          production: 15,
          explosive: 10,
          ras: 10,
          completeness: 10,
        },
      },
      pff: {
        season_used: sourceSeason,
        route_grade: get(row, ['route_grade', 'grades_pass_route']),
        offense_grade: get(row, ['offense_grade', 'grades_offense']),
        yprr: get(row, ['yprr', 'yards_per_route_run']),
        targets: get(row, ['targets']),
        receptions: get(row, ['receptions']),
        yards: get(row, ['yards', 'receiving_yards']),
        adot: get(row, ['adot', 'avg_depth_of_target']),
        yards_after_catch: get(row, ['yards_after_catch', 'yac']),
        drop_rate: get(row, ['drop_rate']),
        contested_catch_rate: get(row, ['contested_catch_rate']),
        ras: rasRecord?.ras ?? null,
        alltime_ras: rasRecord?.alltimeRas ?? null,
        ras_source_url: rasRecord?.sourceUrl ?? null,
      },
    });
  }

  records.sort((a, b) =>
    b.grade - a.grade ||
    Number(b.pff.yards || 0) - Number(a.pff.yards || 0) ||
    String(a.name).localeCompare(String(b.name))
  );

  records.forEach((r, idx) => {
    r.rank = idx + 1;
    r.pick = idx + 1;
    r.projectedPick = idx + 1;
  });

  return records;
}

const outputs = [
  { year: 2024, records: makeDraftedWrFile(2024), model: 'WR_DRAFTED_75_15_10' },
  { year: 2025, records: makeDraftedWrFile(2025), model: 'WR_DRAFTED_75_15_10' },
  { year: 2026, records: makeFutureWrFile(2026), model: 'WR_FUTURE_PFF_RAS_V1' },
  { year: 2027, records: makeFutureWrFile(2027), model: 'WR_FUTURE_PFF_RAS_V1' },
];

for (const out of outputs) {
  const path = `public/data/prospects_${out.year}_wr.json`;

  fs.writeFileSync(path, JSON.stringify({
    generatedAt: new Date().toISOString(),
    model: out.model,
    notes: [
      out.year <= 2025
        ? 'Drafted WR projection uses 75% draft capital, 15% best qualifying final-2-season WR PFF, 10% RAS.'
        : 'Future WR projection uses no actual draft slot; PFF + RAS forecast only.',
      'Missing or zero RAS is treated as neutral 50.',
    ],
    records: out.records,
  }, null, 2));

  console.log(`Wrote ${path} (${out.records.length} WRs)`);
  console.table(out.records.slice(0, 15).map(r => ({
    rank: r.rank,
    name: r.name,
    school: r.school,
    grade: r.grade,
    draft: r.forecast?.draft,
    pff: r.forecast?.pff,
    ras: r.forecast?.ras,
    season: r.pff?.season_used,
    yprr: r.pff?.yprr,
    yards: r.pff?.yards,
  })));
}
