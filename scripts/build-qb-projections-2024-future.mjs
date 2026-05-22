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

function rateScore(value, low, high, inverse = false) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 50;
  const scaled = ((v - low) / (high - low)) * 100;
  return inverse ? clamp(100 - scaled) : clamp(scaled);
}

function buildRasMap() {
  const path = 'public/data/ras_main_table.csv';
  if (!fs.existsSync(path)) return new Map();

  const rows = parseCsv(fs.readFileSync(path, 'utf8'));
  const out = new Map();

  for (const row of rows) {
    if (row.name === 'name' || row.pos === 'pos') continue;
    if (String(row.pos || '').toUpperCase() !== 'QB') continue;

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

function athleticScore(rasRecord) {
  if (!rasRecord) return 50;

  const raw = rasRecord.ras ?? rasRecord.alltimeRas;
  const ras = Number(raw);

  if (!Number.isFinite(ras) || ras <= 0) return 50;

  return clamp(ras * 10);
}

function qbPffScore(row) {
  const pass = num(get(row, ['pass_grade', 'grades_pass', 'grade_pass', 'passing_grade']), null);
  const off = num(get(row, ['offense_grade', 'grades_offense']), null);
  const btt = num(get(row, ['btt_rate', 'btt_pct', 'big_time_throw_rate', 'big_time_throw_percentage']), null);
  const twp = num(get(row, ['twp_rate', 'twp_pct', 'turnover_worthy_play_rate']), null);
  const adot = num(get(row, ['adot', 'avg_depth_of_target']), null);
  const acc = num(get(row, ['adjusted_completion_percent', 'adjusted_completion_percentage', 'accuracy_percent', 'adjusted_accuracy', 'adj_comp_pct', 'accuracy']), null);
  const p2s = num(get(row, ['pressure_to_sack_rate', 'pressure_to_sack_pct', 'p2s_rate', 'pressure_to_sack']), null);
  const ttt = num(get(row, ['time_to_throw', 'avg_time_to_throw']), null);
  const epa = num(get(row, ['epa']), null);
  const attempts = num(get(row, ['attempts', 'dropbacks']), 0);

  const passScore = pass ?? off ?? 50;
  const offScore = off ?? pass ?? 50;
  const bttScore = rateScore(btt, 2.0, 8.5);
  const twpScore = rateScore(twp, 5.0, 1.0); // lower is better
  const accScore = rateScore(acc, 60, 78);
  const p2sScore = rateScore(p2s, 25, 5); // lower is better
  const adotScore = adot == null ? 50 : clamp(100 - Math.abs(adot - 9.0) * 10);
  const tttScore = ttt == null ? 50 : clamp(100 - Math.abs(ttt - 2.75) * 35);
  const epaScore = epa == null ? 50 : rateScore(epa, -0.10, 0.45);
  const volumeScore = clamp(attempts / 5);

  let score =
    passScore * 0.24 +
    offScore * 0.10 +
    bttScore * 0.15 +
    twpScore * 0.18 +
    accScore * 0.13 +
    p2sScore * 0.07 +
    adotScore * 0.03 +
    tttScore * 0.03 +
    epaScore * 0.05 +
    volumeScore * 0.02;

  if (pass != null && pass >= 85 && twp != null && twp <= 2.5) score += 3;
  if (btt != null && btt >= 6.0 && twp != null && twp <= 3.0) score += 2;
  if (twp != null && twp >= 4.0) score -= 4;
  if (p2s != null && p2s >= 22) score -= 3;

  return clamp(score);
}

function qbFutureScore(row, rasRecord = null) {
  const pass = num(get(row, ['pass_grade', 'grades_pass']), 50);
  const off = num(get(row, ['offense_grade', 'grades_offense']), 50);
  const btt = num(get(row, ['btt_rate', 'btt_pct']), null);
  const twp = num(get(row, ['twp_rate', 'twp_pct']), null);
  const acc = num(get(row, ['adjusted_completion_percent', 'accuracy_percent']), null);
  const p2s = num(get(row, ['pressure_to_sack_rate', 'pressure_to_sack_pct']), null);
  const epa = num(get(row, ['epa']), null);
  const ttt = num(get(row, ['time_to_throw', 'avg_time_to_throw']), null);
  const adot = num(get(row, ['adot', 'avg_depth_of_target']), null);
  const run = num(get(row, ['run_grade', 'grades_run']), 50);
  const attempts = num(get(row, ['attempts']), 0);
  const dropbacks = num(get(row, ['dropbacks']), 0);
  const athletic = athleticScore(rasRecord);

  const passProfile = clamp(pass * 0.65 + off * 0.35);
  const explosive = rateScore(btt, 2.0, 8.5);
  const safety = rateScore(twp, 5.0, 1.0);
  const accuracy = rateScore(acc, 60, 78);
  const pressure = rateScore(p2s, 25, 5);
  const efficiency = epa == null ? 50 : rateScore(epa, -0.10, 0.45);
  const timing = ttt == null ? 50 : clamp(100 - Math.abs(ttt - 2.75) * 35);
  const depthBalance = adot == null ? 50 : clamp(100 - Math.abs(adot - 9.0) * 10);
  const movement = clamp(run * 0.55 + athletic * 0.45);
  const volume = clamp(Math.max(attempts, dropbacks) / 5);

  let final =
    passProfile * 0.30 +
    explosive * 0.18 +
    safety * 0.18 +
    accuracy * 0.12 +
    pressure * 0.08 +
    efficiency * 0.06 +
    timing * 0.04 +
    movement * 0.02 +
    volume * 0.02;

  if (pass >= 90 && safety >= 70) final += 3;
  if (explosive >= 75 && safety >= 65) final += 2;
  if (pressure < 35) final -= 3;
  if (safety < 35) final -= 4;

  return {
    final: Math.round(clamp(final)),
    pff: Math.round(clamp(qbPffScore(row))),
    passProfile: Math.round(clamp(passProfile)),
    explosive: Math.round(clamp(explosive)),
    safety: Math.round(clamp(safety)),
    accuracy: Math.round(clamp(accuracy)),
    pressure: Math.round(clamp(pressure)),
    efficiency: Math.round(clamp(efficiency)),
    timing: Math.round(clamp(timing)),
    movement: Math.round(clamp(movement)),
    volume: Math.round(clamp(volume)),
  };
}

function loadQbRows() {
  const candidates = [
    'public/data/qb_pff_seasons.json',
    'qb_pff_seasons.json',
  ];

  for (const path of candidates) {
    if (!fs.existsSync(path)) continue;
    const payload = JSON.parse(fs.readFileSync(path, 'utf8'));
    return payload.records ?? payload;
  }

  throw new Error('Could not find QB PFF season data.');
}

function sampleScore(row) {
  const attempts = num(get(row, ['attempts']), 0);
  const dropbacks = num(get(row, ['dropbacks']), 0);
  return Math.max(attempts, dropbacks);
}

function getBestQbProfile(qbMap, name, draftYear) {
  const seasons = [Number(draftYear) - 1, Number(draftYear) - 2];

  const candidates = seasons.map((season) => {
    const row = qbMap.get(`${clean(name)}|${season}`);
    if (!row) return null;

    const pff = qbPffScore(row);
    const sample = sampleScore(row);
    const qualifies = sample >= 150;

    return {
      row,
      season,
      pff,
      sample,
      qualifies,
      profileScore: qualifies ? pff * 0.88 + clamp(sample / 5) * 0.12 : pff * 0.60 + clamp(sample / 5) * 0.10,
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
const qbRows = loadQbRows();
const rasMap = buildRasMap();

const qbMap = new Map();
for (const r of qbRows) {
  const name = r.name || r.player || r.player_name;
  const season = Number(r.season || r.year);
  if (!name || !Number.isFinite(season)) continue;
  qbMap.set(`${clean(name)}|${season}`, r);
}

function makeDraftedQbFile(year) {
  const records = [];

  for (const d of draftRows) {
    const pos = String(d.position || d.pos || '').toUpperCase();
    if (pos !== 'QB') continue;

    const draftYear = num(d.season);
    if (draftYear !== year) continue;

    const name = d.pfr_player_name || d.player_name || d.name;
    const pick = num(d.pick);
    if (!name || !pick) continue;

    const bestProfile = getBestQbProfile(qbMap, name, year);
    if (!bestProfile?.row) continue;

    const rasRecord = getRas(rasMap, name, year);
    const draft = draftScoreFromPick(pick);
    const pff = qbPffScore(bestProfile.row);
    const athletic = athleticScore(rasRecord);

    const final = draft * 0.75 + pff * 0.20 + athletic * 0.05;

    records.push({
      id: `qb-${year}-${clean(name)}`,
      name,
      school: bestProfile.row.team_name || bestProfile.row.team || d.college || '',
      team: bestProfile.row.team_name || bestProfile.row.team || d.college || '',
      year,
      draftYear: year,
      pos: 'QB',
      position: 'QB',
      pick,
      projectedPick: pick,
      grade: Math.round(clamp(final)),
      score: Math.round(clamp(final)),
      source: 'qb_drafted_projection_75_20_5',
      forecast: {
        final: Math.round(clamp(final)),
        draft: Math.round(clamp(draft)),
        pff: Math.round(clamp(pff)),
        athletic: Math.round(clamp(athletic)),
        weights: { draft: 75, pff: 20, athletic: 5 },
      },
      pff: {
        season_used: bestProfile.season,
        sample_score: bestProfile.sample,
        pass_grade: get(bestProfile.row, ['pass_grade', 'grades_pass']),
        offense_grade: get(bestProfile.row, ['offense_grade', 'grades_offense']),
        btt_rate: get(bestProfile.row, ['btt_rate', 'btt_pct']),
        twp_rate: get(bestProfile.row, ['twp_rate', 'twp_pct']),
        adjusted_completion_percent: get(bestProfile.row, ['adjusted_completion_percent', 'accuracy_percent']),
        adot: get(bestProfile.row, ['adot', 'avg_depth_of_target']),
        time_to_throw: get(bestProfile.row, ['time_to_throw', 'avg_time_to_throw']),
        pressure_to_sack_rate: get(bestProfile.row, ['pressure_to_sack_rate', 'pressure_to_sack_pct']),
        epa: get(bestProfile.row, ['epa']),
        attempts: get(bestProfile.row, ['attempts']),
        dropbacks: get(bestProfile.row, ['dropbacks']),
        ras: rasRecord?.ras && rasRecord.ras > 0 ? rasRecord.ras : null,
        alltime_ras: rasRecord?.alltimeRas && rasRecord.alltimeRas > 0 ? rasRecord.alltimeRas : null,
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

function makeFutureQbFile(draftYear) {
  const sourceSeason = 2025;
  const records = [];
  const seen = new Set();

  const seasonRows = qbRows.filter((r) => Number(r.season || r.year) === sourceSeason);

  for (const row of seasonRows) {
    const name = row.name || row.player || row.player_name;
    const key = clean(name);
    if (!key || seen.has(key)) continue;

    const attempts = num(get(row, ['attempts']), 0);
    const dropbacks = num(get(row, ['dropbacks']), 0);

    if (attempts < 120 && dropbacks < 150) continue;

    seen.add(key);

    const rasRecord = getRas(rasMap, name, draftYear);
    const scores = qbFutureScore(row, rasRecord);

    records.push({
      id: `qb-${draftYear}-${key}`,
      name,
      school: row.team_name || row.team || '',
      team: row.team_name || row.team || '',
      year: draftYear,
      draftYear,
      pos: 'QB',
      position: 'QB',
      pick: null,
      projectedPick: null,
      grade: scores.final,
      score: scores.final,
      source: 'qb_future_pff_forecast',
      forecast: {
        ...scores,
        weights: {
          passProfile: 30,
          explosive: 18,
          safety: 18,
          accuracy: 12,
          pressure: 8,
          efficiency: 6,
          timing: 4,
          movement: 2,
          volume: 2,
        },
      },
      pff: {
        season_used: sourceSeason,
        pass_grade: get(row, ['pass_grade', 'grades_pass']),
        offense_grade: get(row, ['offense_grade', 'grades_offense']),
        btt_rate: get(row, ['btt_rate', 'btt_pct']),
        twp_rate: get(row, ['twp_rate', 'twp_pct']),
        adjusted_completion_percent: get(row, ['adjusted_completion_percent', 'accuracy_percent']),
        adot: get(row, ['adot', 'avg_depth_of_target']),
        time_to_throw: get(row, ['time_to_throw', 'avg_time_to_throw']),
        pressure_to_sack_rate: get(row, ['pressure_to_sack_rate', 'pressure_to_sack_pct']),
        epa: get(row, ['epa']),
        attempts: get(row, ['attempts']),
        dropbacks: get(row, ['dropbacks']),
        ras: rasRecord?.ras && rasRecord.ras > 0 ? rasRecord.ras : null,
        alltime_ras: rasRecord?.alltimeRas && rasRecord.alltimeRas > 0 ? rasRecord.alltimeRas : null,
        ras_source_url: rasRecord?.sourceUrl ?? null,
      },
    });
  }

  records.sort((a, b) =>
    b.grade - a.grade ||
    Number(b.pff.pass_grade || 0) - Number(a.pff.pass_grade || 0) ||
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
  { year: 2024, records: makeDraftedQbFile(2024), model: 'QB_DRAFTED_75_20_5' },
  { year: 2025, records: makeDraftedQbFile(2025), model: 'QB_DRAFTED_75_20_5' },
  { year: 2026, records: makeFutureQbFile(2026), model: 'QB_FUTURE_PFF_V1' },
  { year: 2027, records: makeFutureQbFile(2027), model: 'QB_FUTURE_PFF_V1' },
];

for (const out of outputs) {
  const path = `public/data/prospects_${out.year}_qb.json`;

  fs.writeFileSync(path, JSON.stringify({
    generatedAt: new Date().toISOString(),
    model: out.model,
    notes: [
      out.year <= 2025
        ? 'Drafted QB projection uses 75% draft capital, 20% best qualifying final-2-season QB PFF, 5% athletic/RAS.'
        : 'Future QB projection uses no actual draft slot; QB PFF forecast only.',
      'Missing or zero RAS is treated as neutral 50.',
    ],
    records: out.records,
  }, null, 2));

  console.log(`Wrote ${path} (${out.records.length} QBs)`);
  console.table(out.records.slice(0, 15).map(r => ({
    rank: r.rank,
    name: r.name,
    school: r.school,
    grade: r.grade,
    draft: r.forecast?.draft,
    pff: r.forecast?.pff,
    athletic: r.forecast?.athletic,
    season: r.pff?.season_used,
    pass: r.pff?.pass_grade,
    btt: r.pff?.btt_rate,
    twp: r.pff?.twp_rate,
    epa: r.pff?.epa,
  })));
}
