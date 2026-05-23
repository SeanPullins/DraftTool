import fs from 'fs';

function clean(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function loadJson(path) {
  if (!fs.existsSync(path)) return [];
  const payload = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.records)) return payload.records;
  if (Array.isArray(payload.players)) return payload.players;
  if (Array.isArray(payload.prospects)) return payload.prospects;
  return [];
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

function buildPffNameMap(rows) {
  const map = new Map();

  for (const row of rows) {
    const name = str(row, ['name', 'player', 'playerName'], '');
    const season = val(row, ['season', 'year'], 0);
    if (!name || !season) continue;

    const key = clean(name);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }

  for (const list of map.values()) {
    list.sort((a, b) => val(b, ['season', 'year'], 0) - val(a, ['season', 'year'], 0));
  }

  return map;
}

function bestPffForProspect(pffMap, name, draftYear) {
  const rows = pffMap.get(clean(name)) || [];
  if (!rows.length) return null;

  const targetSeasons = [
    Number(draftYear) - 1,
    Number(draftYear) - 2,
    Number(draftYear),
  ];

  for (const season of targetSeasons) {
    const exact = rows.find(r => val(r, ['season', 'year'], 0) === season);
    if (exact) return exact;
  }

  return rows[0] || null;
}

function qbSignal(prospect, pff) {
  const pick = val(prospect, ['actualDraftPick', 'draftPick', 'pick', 'draft', 'projectedPick', 'rank'], 999);

  const pass = val(pff, ['pass', 'passGrade', 'pass_grade', 'grades_pass', 'pff'], 0);
  const run = val(pff, ['run', 'runGrade', 'run_grade', 'grades_run'], 0);
  const scrambles = val(pff, ['scrambles'], 0);
  const btt = val(pff, ['btt', 'bttPct', 'btt_rate', 'btt_pct', 'btt%'], 0);
  const twp = val(pff, ['twp', 'twpPct', 'twp_rate', 'twp_pct', 'twp%'], 0);
  const acc = val(pff, ['acc', 'adjustedAccuracy', 'adjusted_completion_percent', 'accuracy_percent', 'adjustedCompletionPercent'], 0);
  const adot = val(pff, ['adot', 'avgDepthOfTarget', 'avg_depth_of_target'], 0);
  const epa = val(pff, ['epa', 'epa_per_play'], 0);

  const traits = [];
  let adjustment = 0;

  const eliteScrambleCreation =
    pick <= 100 &&
    scrambles >= 40 &&
    run >= 75 &&
    acc >= 70;

  const top32CreationPlus =
    pick <= 32 &&
    scrambles >= 25 &&
    btt >= 5.5 &&
    adot >= 9.0 &&
    acc >= 70;

  const day2LowPassLowAcc =
    pick > 32 &&
    pick <= 100 &&
    pass < 75 &&
    acc < 70;

  const highCapitalLowCreation =
    pick <= 64 &&
    btt < 4.5 &&
    adot < 9.5 &&
    epa < 0.35;

  const safeLimitedLowCreation =
    pick > 20 &&
    btt < 4.5 &&
    twp <= 2.5 &&
    acc >= 72;

  if (eliteScrambleCreation) {
    adjustment += 0.35;
    traits.push({ label: 'Elite scramble creation', scoreImpact: true, direction: 'positive' });
  }

  if (top32CreationPlus) {
    traits.push({ label: 'Top-32 creation plus', scoreImpact: false, direction: 'positive', contextOnly: true });
  }

  if (day2LowPassLowAcc) {
    adjustment -= 0.35;
    traits.push({ label: 'Day-2 low pass/accuracy risk', scoreImpact: true, direction: 'negative' });
  }

  if (highCapitalLowCreation) {
    adjustment -= 0.25;
    traits.push({ label: 'High-capital low-creation risk', scoreImpact: true, direction: 'negative' });
  }

  if (safeLimitedLowCreation) {
    adjustment -= 0.20;
    traits.push({ label: 'Safe-limited low-creation risk', scoreImpact: true, direction: 'negative' });
  }

  adjustment = Math.max(-0.60, Math.min(0.50, adjustment));

  return {
    adjustment: Number(adjustment.toFixed(2)),
    traits,
    inputs: {
      pick,
      pass,
      run,
      scrambles,
      btt,
      twp,
      acc,
      adot,
      epa,
      pffSeason: val(pff, ['season', 'year'], 0),
    },
  };
}

const pffRows = loadJson('public/data/qb_pff_seasons.json');
const pffMap = buildPffNameMap(pffRows);

const files = [
  [2024, 'public/data/prospects_2024_qb.json'],
  [2025, 'public/data/prospects_2025_qb.json'],
  [2026, 'public/data/prospects_2026_qb.json'],
  [2027, 'public/data/prospects_2027_qb.json'],
];

const candidates = [];
const skipped = [];

for (const [year, path] of files) {
  const rows = loadJson(path);

  for (const prospect of rows) {
    const name = str(prospect, ['name', 'player', 'playerName'], '');
    if (!name) continue;

    const school = str(prospect, ['school', 'team', 'college'], '');
    const pff = bestPffForProspect(pffMap, name, year);

    if (!pff) {
      skipped.push({ year, name, school, reason: 'No matching QB PFF season row', source: path });
      continue;
    }

    const signal = qbSignal(prospect, pff);
    if (!signal.traits.length) continue;

    candidates.push({
      year,
      pos: 'QB',
      name,
      school,
      adjustment: signal.adjustment,
      traits: signal.traits,
      inputs: signal.inputs,
      status: 'read-only / not applied to ranking',
      source: path,
    });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  note: 'Current/future QB Translation Signal v1 candidates. Read-only; not applied to rankings.',
  counts: {
    pffRows: pffRows.length,
    candidates: candidates.length,
    positive: candidates.filter(c => c.adjustment > 0).length,
    negative: candidates.filter(c => c.adjustment < 0).length,
    contextOnly: candidates.filter(c => c.adjustment === 0).length,
    skipped: skipped.length,
  },
  candidates,
  skipped: skipped.slice(0, 100),
};

fs.mkdirSync('public/data/model', { recursive: true });
fs.writeFileSync('public/data/model/qb_translation_signal_candidates.json', JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  counts: report.counts,
  top: candidates.slice(0, 40).map(c => ({
    year: c.year,
    name: c.name,
    school: c.school,
    adj: c.adjustment,
    traits: c.traits.map(t => t.label).join(', '),
    inputs: c.inputs,
  })),
  skipped: skipped.slice(0, 20),
}, null, 2));

console.log('Wrote public/data/model/qb_translation_signal_candidates.json');
