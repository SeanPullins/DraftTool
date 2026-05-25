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

function readJson(path, fallback = null) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function draftScoreFromPick(pick) {
  const p = Math.max(1, Number(pick) || 260);
  return clamp(100 - (Math.log(p) / Math.log(260)) * 100);
}

function buildRasMap() {
  const path = 'public/data/ras_main_table.csv';
  if (!fs.existsSync(path)) return new Map();

  const rows = parseCsv(fs.readFileSync(path, 'utf8'));
  const out = new Map();

  for (const row of rows) {
    if (row.name === 'name' || row.pos === 'pos') continue;
    if (String(row.pos || '').toUpperCase() !== 'TE') continue;

    const name = clean(row.name || '');
    const year = num(row.year);
    if (!name || !year) continue;

    out.set(`${name}|${year}`, {
      ras: num(row.ras, null),
      alltimeRas: num(row.alltime_ras, null),
      sourceUrl: row.source_url || null,
      college: row.college || null,
    });
  }

  return out;
}

function getRas(rasMap, name, year) {
  return rasMap.get(`${clean(name)}|${Number(year)}`) || null;
}

function rasScore(rasRecord) {
  if (!rasRecord) return 50;

  const raw = rasRecord.ras ?? rasRecord.alltimeRas;
  const ras = Number(raw);

  if (!Number.isFinite(ras) || ras <= 0) return 50;

  return clamp(ras * 10);
}

function teReceivingScore(row) {
  if (!row) return 50;

  const route = num(get(row, ['route_grade', 'grades_pass_route']), 50);
  const off = num(get(row, ['offense_grade', 'grades_offense']), 50);
  const yprr = num(get(row, ['yprr']), 0);
  const yards = num(get(row, ['yards']), 0);
  const targets = num(get(row, ['targets']), 0);
  const receptions = num(get(row, ['receptions']), 0);
  const dropRate = num(get(row, ['drop_rate']), 8);
  const inline = num(get(row, ['inline_rate']), 0);

  let score =
    route * 0.32 +
    off * 0.22 +
    clamp(yprr * 28) * 0.20 +
    clamp(yards / 8) * 0.10 +
    clamp(targets) * 0.07 +
    clamp(receptions * 1.5) * 0.04 +
    clamp(inline) * 0.05;

  if (dropRate <= 5 && targets >= 25) score += 2;
  if (dropRate >= 10) score -= 3;

  return clamp(score);
}

function teBlockingScore(row) {
  if (!row) return 50;

  const run = num(get(row, ['run_block_grade', 'grades_run_block']), 50);
  const pass = num(get(row, ['pass_block_grade', 'grades_pass_block']), 50);
  const off = num(get(row, ['offense_grade', 'grades_offense']), 50);
  const teSnaps = num(get(row, ['snap_counts_te']), 0);
  const blockSnaps = num(get(row, ['snap_counts_block']), 0);
  const passBlockSnaps = num(get(row, ['snap_counts_pass_block']), 0);
  const pressures = num(get(row, ['pressures_allowed']), 0);
  const penalties = num(get(row, ['penalties']), 0);
  const pbe = num(get(row, ['pbe']), 50);

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
  const routes = num(get(rec, ['routes']), 0);
  const targets = num(get(rec, ['targets']), 0);
  const yards = num(get(rec, ['yards']), 0);
  const receptions = num(get(rec, ['receptions']), 0);
  const inlineSnaps = num(get(rec, ['inline_snaps']), 0) || num(get(block, ['snap_counts_te']), 0);
  const blockSnaps = num(get(block, ['snap_counts_block']), 0);
  const games = num(get(rec, ['player_game_count']), 0) || num(get(block, ['player_game_count']), 0);

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

function completenessScore(rec, block, rasRecord) {
  const route = num(get(rec, ['route_grade', 'grades_pass_route']), 0);
  const yprr = num(get(rec, ['yprr']), 0);
  const recOff = num(get(rec, ['offense_grade', 'grades_offense']), 0);
  const run = num(get(block, ['run_block_grade', 'grades_run_block']), 0);
  const pass = num(get(block, ['pass_block_grade', 'grades_pass_block']), 0);
  const inline = num(get(rec, ['inline_rate']), 0);
  const blockSnaps = num(get(block, ['snap_counts_block']), 0);
  const ras = rasScore(rasRecord);

  let score = 50;

  if (route >= 75 && yprr >= 1.8) score += 12;
  if (recOff >= 75) score += 6;
  if (run >= 65) score += 8;
  if (pass >= 65) score += 4;
  if (inline >= 25 || blockSnaps >= 120) score += 6;
  if (route >= 70 && yprr >= 1.5 && run >= 65) score += 10;
  if (ras >= 80) score += 5;

  return clamp(score);
}

function futureTeForecastScore(rec, block, rasRecord = null) {
  const recScore = teReceivingScore(rec);
  const blockScore = teBlockingScore(block);
  const useScore = usageScore(rec, block);
  const ras = rasScore(rasRecord);
  const complete = completenessScore(rec, block, rasRecord);

  const final =
    recScore * 0.40 +
    blockScore * 0.25 +
    useScore * 0.15 +
    ras * 0.10 +
    complete * 0.10;

  return {
    final: Math.round(clamp(final)),
    receiving: Math.round(clamp(recScore)),
    blocking: Math.round(clamp(blockScore)),
    usage: Math.round(clamp(useScore)),
    ras: Math.round(clamp(ras)),
    completeness: Math.round(clamp(complete)),
  };
}

function seasonMap(rows) {
  const out = new Map();

  for (const r of rows || []) {
    const name = r.name || r.player || r.player_name;
    const season = Number(r.season || r.year);
    if (!name || !Number.isFinite(season)) continue;
    out.set(`${clean(name)}|${season}`, r);
  }

  return out;
}

function getBestTeProfile(recMap, blockMap, name, draftYear) {
  const seasons = [Number(draftYear) - 1, Number(draftYear) - 2];

  const candidates = seasons.map((season) => {
    const rec = recMap.get(`${clean(name)}|${season}`) || null;
    const block = blockMap.get(`${clean(name)}|${season}`) || null;

    if (!rec && !block) return null;

    const recScore = teReceivingScore(rec);
    const blockScore = teBlockingScore(block);
    const use = usageScore(rec, block);
    const targets = num(get(rec, ['targets']), 0);
    const yards = num(get(rec, ['yards']), 0);
    const routes = num(get(rec, ['routes']), 0);
    const blockSnaps = num(get(block, ['snap_counts_block']), 0);

    const sample = targets + yards / 10 + routes / 8 + blockSnaps / 6;
    const qualifies = targets >= 20 || yards >= 250 || routes >= 100 || blockSnaps >= 100;

    return {
      season,
      rec,
      block,
      recScore,
      blockScore,
      use,
      sample,
      qualifies,
      profileScore: recScore * 0.48 + blockScore * 0.28 + use * 0.14 + clamp(sample) * 0.10,
    };
  }).filter(Boolean);

  if (!candidates.length) return null;

  const qualifying = candidates.filter(c => c.qualifies);
  const pool = qualifying.length ? qualifying : candidates;

  pool.sort((a, b) =>
    b.profileScore - a.profileScore ||
    b.sample - a.sample ||
    b.season - a.season
  );

  return pool[0];
}

const draftRows = parseCsv(fs.readFileSync('public/data/draft_picks.csv', 'utf8'));
const recPayload = readJson('public/data/te_pff_seasons.json', { records: [] });
const blockPayload = readJson('public/data/te_blocking_pff_seasons.json', { records: [] });

const recRows = recPayload.records ?? [];
const blockRows = blockPayload.records ?? [];

const recMap = seasonMap(recRows);
const blockMap = seasonMap(blockRows);
const rasMap = buildRasMap();

function makeDraftedTeFile(year) {
  const records = [];

  for (const d of draftRows) {
    const pos = String(d.position || d.pos || '').toUpperCase();
    if (pos !== 'TE') continue;

    const draftYear = num(d.season);
    if (draftYear !== year) continue;

    const name = d.pfr_player_name || d.player_name || d.name;
    const pick = num(d.pick);
    if (!name || !pick) continue;

    const bestProfile = getBestTeProfile(recMap, blockMap, name, year);
    if (!bestProfile) continue;

    const rasRecord = getRas(rasMap, name, year);

    const draftScore = draftScoreFromPick(pick);
    const receiving = bestProfile.recScore;
    const blocking = bestProfile.blockScore;
    const ras = rasScore(rasRecord);

    // Conservative because TE historical tests were draft-capital heavy.
    const final =
      draftScore * 0.85 +
      receiving * 0.05 +
      blocking * 0.05 +
      ras * 0.05;

    records.push({
      id: `te-${year}-${clean(name)}`,
      name,
      school: bestProfile.rec?.team_name || bestProfile.block?.team_name || d.college || '',
      team: bestProfile.rec?.team_name || bestProfile.block?.team_name || d.college || '',
      year,
      draftYear: year,
      pos: 'TE',
      position: 'TE',
      pick,
      projectedPick: pick,
      grade: Math.round(clamp(final)),
      score: Math.round(clamp(final)),
      source: 'te_drafted_projection_85_5_5_5',
      forecast: {
        final: Math.round(clamp(final)),
        draft: Math.round(clamp(draftScore)),
        receiving: Math.round(clamp(receiving)),
        blocking: Math.round(clamp(blocking)),
        ras: Math.round(clamp(ras)),
        weights: { draft: 85, receiving: 5, blocking: 5, ras: 5 },
      },
      pff: {
        season_used: bestProfile.season,
        sample_score: Number(bestProfile.sample.toFixed(1)),
        route_grade: get(bestProfile.rec, ['route_grade', 'grades_pass_route']),
        offense_grade: get(bestProfile.rec, ['offense_grade', 'grades_offense']),
        yprr: get(bestProfile.rec, ['yprr']),
        targets: get(bestProfile.rec, ['targets']),
        receptions: get(bestProfile.rec, ['receptions']),
        yards: get(bestProfile.rec, ['yards']),
        drop_rate: get(bestProfile.rec, ['drop_rate']),
        inline_rate: get(bestProfile.rec, ['inline_rate']),
        run_block_grade: get(bestProfile.block, ['run_block_grade', 'grades_run_block']),
        pass_block_grade: get(bestProfile.block, ['pass_block_grade', 'grades_pass_block']),
        block_snaps: get(bestProfile.block, ['snap_counts_block']),
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

function makeFutureTeFile(draftYear) {
  const sourceSeason = 2025;
  const records = [];
  const seen = new Set();

  const seasonRows = recRows.filter((r) => Number(r.season) === sourceSeason);

  for (const rec of seasonRows) {
    const name = rec.name || rec.player || rec.player_name;
    const key = clean(name);
    if (!key || seen.has(key)) continue;

    const targets = num(get(rec, ['targets']), 0);
    const yards = num(get(rec, ['yards']), 0);
    const routes = num(get(rec, ['routes']), 0);

    if (targets < 12 && yards < 125 && routes < 60) continue;

    seen.add(key);

    const block = blockMap.get(`${key}|${sourceSeason}`) || null;
    const rasRecord = getRas(rasMap, name, draftYear);
    const scores = futureTeForecastScore(rec, block, rasRecord);

    records.push({
      id: `te-${draftYear}-${key}`,
      name,
      school: rec.team_name || rec.team || '',
      team: rec.team_name || rec.team || '',
      year: draftYear,
      draftYear,
      pos: 'TE',
      position: 'TE',
      pick: null,
      projectedPick: null,
      grade: scores.final,
      score: scores.final,
      source: 'te_future_receiving_blocking_ras_forecast',
      forecast: {
        ...scores,
        weights: {
          receiving: 40,
          blocking: 25,
          usage: 15,
          ras: 10,
          completeness: 10,
        },
      },
      pff: {
        season_used: sourceSeason,
        route_grade: get(rec, ['route_grade', 'grades_pass_route']),
        offense_grade: get(rec, ['offense_grade', 'grades_offense']),
        yprr: get(rec, ['yprr']),
        targets: get(rec, ['targets']),
        receptions: get(rec, ['receptions']),
        yards: get(rec, ['yards']),
        drop_rate: get(rec, ['drop_rate']),
        inline_rate: get(rec, ['inline_rate']),
        run_block_grade: get(block, ['run_block_grade', 'grades_run_block']),
        pass_block_grade: get(block, ['pass_block_grade', 'grades_pass_block']),
        block_snaps: get(block, ['snap_counts_block']),
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
  { year: 2024, records: makeDraftedTeFile(2024), model: 'TE_DRAFTED_85_5_5_5' },
  { year: 2025, records: makeDraftedTeFile(2025), model: 'TE_DRAFTED_85_5_5_5' },
  { year: 2026, records: makeFutureTeFile(2026), model: 'TE_FUTURE_RECEIVING_BLOCKING_RAS_V1' },
  { year: 2027, records: makeFutureTeFile(2027), model: 'TE_FUTURE_RECEIVING_BLOCKING_RAS_V1' },
];

for (const out of outputs) {
  const path = `public/data/prospects_${out.year}_te.json`;

  fs.writeFileSync(path, JSON.stringify({
    generatedAt: new Date().toISOString(),
    model: out.model,
    notes: [
      out.year <= 2025
        ? 'Drafted TE projection uses 85% draft capital, 5% receiving PFF, 5% blocking PFF, 5% RAS.'
        : 'Future TE projection uses no actual draft slot; receiving + blocking + usage + RAS forecast only.',
      'Missing or zero RAS is treated as neutral 50.',
    ],
    records: out.records,
  }, null, 2));

  console.log(`Wrote ${path} (${out.records.length} TEs)`);
  console.table(out.records.slice(0, 15).map(r => ({
    rank: r.rank,
    name: r.name,
    school: r.school,
    grade: r.grade,
    draft: r.forecast?.draft,
    rec: r.forecast?.receiving,
    block: r.forecast?.blocking,
    ras: r.forecast?.ras,
    season: r.pff?.season_used,
    yprr: r.pff?.yprr,
    yards: r.pff?.yards,
    runBlock: r.pff?.run_block_grade,
  })));
}
