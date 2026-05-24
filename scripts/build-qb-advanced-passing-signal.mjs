import fs from 'fs';

function clean(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function loadJson(path) {
  if (!fs.existsSync(path)) return null;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function loadRows(path) {
  const payload = loadJson(path);
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  return payload.rows || payload.records || payload.players || payload.prospects || [];
}

function get(row, keys, fallback = null) {
  for (const k of keys) {
    if (row?.[k] != null && row[k] !== '') return row[k];
  }

  const wanted = keys.map(clean);
  for (const [k, v] of Object.entries(row || {})) {
    if (wanted.includes(clean(k)) && v != null && v !== '') return v;
  }

  return fallback;
}

function val(row, keys, fallback = 0) {
  return num(get(row, keys), fallback);
}

function str(row, keys, fallback = '') {
  const v = get(row, keys, fallback);
  return String(v ?? fallback);
}

function projectionKey(year, pos, name) {
  return `${year}|${String(pos || '').toUpperCase()}|${clean(name)}`;
}

function buildAdvancedMap(rows) {
  const map = new Map();

  for (const r of rows) {
    const name = r.name || r.player || r.playerName;
    const season = Number(r.season || r.year);
    if (!name || !season) continue;

    const key = `${clean(name)}|${season}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }

  return map;
}

function bestAdvancedBeforeDraft(map, name, draftYear) {
  const seasons = [Number(draftYear) - 1, Number(draftYear) - 2, Number(draftYear)];

  for (const season of seasons) {
    const rows = map.get(`${clean(name)}|${season}`);
    if (rows?.length) return rows[0];
  }

  return null;
}

function advancedPassingSignal(row, pick) {
  const pressureGrade = val(row, ['passing_pressure_grades_pass'], 0);
  const mediumAcc = val(row, ['passing_depth_medium_accuracy_percent'], 0);
  const deepAcc = val(row, ['passing_depth_deep_accuracy_percent'], 0);
  const pocketTTT =
    val(row, ['time_in_pocket_avg_time_to_throw'], 0) ||
    val(row, ['time_in_pocket_time_to_throw'], 0);
  const playActionGrade = val(row, ['passing_concept_pa_grades_pass'], 0);

  let adjustment = 0;
  const traits = [];

  const hasDraftSignal = pick <= 100;
  const latePickBadgeOnly = pick > 150;

  const elitePressureIntermediate =
    pressureGrade >= 88 &&
    mediumAcc >= 68;

  const pressureDepthCreator =
    pressureGrade >= 85 &&
    deepAcc >= 50 &&
    mediumAcc >= 65;

  const completeTranslator =
    pressureGrade >= 88 &&
    mediumAcc >= 70 &&
    deepAcc >= 50 &&
    pocketTTT > 0 &&
    pocketTTT <= 3.10;

  const holdBallCreationSafe =
    pocketTTT >= 3.0 &&
    pressureGrade >= 82 &&
    mediumAcc >= 68;

  const day2PressureAccuracyRisk =
    pick > 32 &&
    pick <= 100 &&
    pressureGrade > 0 &&
    pressureGrade < 75 &&
    mediumAcc < 65;

  const paInflationRisk =
    pick <= 100 &&
    playActionGrade >= 88 &&
    pressureGrade > 0 &&
    pressureGrade < 76 &&
    mediumAcc < 66;

  if (elitePressureIntermediate) {
    traits.push('Elite pressure + intermediate translator');
    if (hasDraftSignal && !latePickBadgeOnly) adjustment += 0.15;
  }

  if (pressureDepthCreator) {
    traits.push('Pressure-depth creator');
    if (hasDraftSignal && !latePickBadgeOnly) adjustment += 0.10;
  }

  if (completeTranslator) {
    traits.push('Complete advanced translator');
    if (hasDraftSignal && !latePickBadgeOnly) adjustment += 0.10;
  }

  if (holdBallCreationSafe) {
    traits.push('Hold-ball creation-safe');
  }

  if (day2PressureAccuracyRisk) {
    traits.push('Day-2 pressure/accuracy risk');
    adjustment -= 0.20;
  }

  if (paInflationRisk) {
    traits.push('Play-action inflation risk');
    adjustment -= 0.15;
  }

  adjustment = Math.max(-0.40, Math.min(0.35, adjustment));

  return {
    adjustment: Number(adjustment.toFixed(2)),
    traits,
    inputs: {
      pressureGrade,
      mediumAcc,
      deepAcc,
      pocketTTT,
      playActionGrade,
    },
  };
}

const advancedRows = loadRows('public/data/model/qb_advanced_pff_all.json');
const advancedMap = buildAdvancedMap(advancedRows);

const files = [
  [2024, 'public/data/prospects_2024_qb.json'],
  [2025, 'public/data/prospects_2025_qb.json'],
  [2026, 'public/data/prospects_2026_qb.json'],
  [2027, 'public/data/prospects_2027_qb.json'],
];

const candidates = [];
const skipped = [];

for (const [year, file] of files) {
  const rows = loadRows(file);

  for (const player of rows) {
    const name = str(player, ['name', 'player', 'playerName'], '');
    if (!name) continue;

    const school = str(player, ['school', 'team', 'college'], '');
    const pick = val(player, ['pick', 'draftPick', 'actualDraftPick', 'projectedPick', 'rank'], 260);

    const advanced = bestAdvancedBeforeDraft(advancedMap, name, year);

    if (!advanced) {
      skipped.push({ year, name, school, reason: 'No advanced PFF row found' });
      continue;
    }

    const signal = advancedPassingSignal(advanced, pick);

    if (!signal.traits.length) continue;

    candidates.push({
      key: projectionKey(year, 'QB', name),
      year,
      pos: 'QB',
      name,
      school,
      pick,
      recommendedAdjustment: signal.adjustment,
      traits: signal.traits,
      label:
        signal.adjustment > 0 ? 'Advanced passing boost' :
        signal.adjustment < 0 ? 'Advanced passing risk' :
        'Advanced passing context',
      projectionLabel:
        signal.adjustment > 0 ? 'Projection — Hit' :
        signal.adjustment < 0 ? 'Projection — Miss' :
        'Projection — Watch',
      inputs: signal.inputs,
      status: 'score-ready small adjustment / applied to QB score layer',
    });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  note: 'QB Advanced Passing Signal candidates for 2024-present QBs. Small score layer based on mature backtest.',
  counts: {
    candidates: candidates.length,
    positive: candidates.filter(x => x.recommendedAdjustment > 0).length,
    negative: candidates.filter(x => x.recommendedAdjustment < 0).length,
    contextOnly: candidates.filter(x => x.recommendedAdjustment === 0).length,
    skipped: skipped.length,
  },
  candidates,
  skipped,
};

fs.mkdirSync('public/data/model', { recursive: true });
fs.writeFileSync('public/data/model/qb_advanced_passing_signal_candidates.json', JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  counts: report.counts,
  top: candidates.slice(0, 50).map(x => ({
    year: x.year,
    name: x.name,
    pick: x.pick,
    adj: x.recommendedAdjustment,
    label: x.label,
    projectionLabel: x.projectionLabel,
    traits: x.traits.join(', '),
    inputs: x.inputs,
  })),
}, null, 2));

console.log('Wrote public/data/model/qb_advanced_passing_signal_candidates.json');
