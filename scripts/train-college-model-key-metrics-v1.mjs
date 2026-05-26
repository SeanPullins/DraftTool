import fs from 'fs';
import readline from 'readline';

const SEASONS_JSONL = 'public/data/model/college_player_seasons_2014_2025.jsonl';
const CAREER_WITH_OUTCOMES = 'public/data/model/college_player_career_summary_2014_2025_with_nfl_outcomes.json';

const OUT_SUMMARY = 'public/data/model/college_model_training_key_metrics_v1.json';
const OUT_FEATURES = 'public/data/model/college_model_feature_importance_v1.json';

function cleanName(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normKey(s = '') {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function playerKey(row) {
  return `${row.normalized_name || cleanName(row.player)}|${String(row.position || '').toUpperCase()}`;
}

function flattenNumeric(obj, prefix = '', out = {}) {
  if (!obj || typeof obj !== 'object') return out;

  for (const [rawKey, value] of Object.entries(obj)) {
    const key = normKey(rawKey);
    if (!key) continue;

    if ([
      'source_files',
      'source_ids',
      'player',
      'name',
      'normalized_name',
      'team',
      'school',
      'college',
      'conference',
      'position',
      'pos'
    ].includes(key)) continue;

    const path = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'number' && Number.isFinite(value)) {
      out[path] = value;
    } else if (typeof value === 'string') {
      const n = toNum(value);
      if (n !== null && value.trim() !== '') out[path] = n;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenNumeric(value, path, out);
    }
  }

  return out;
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 10) return null;

  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;

  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }

  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  if (!den) return null;

  return num / den;
}

function summarize(values) {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    count: values.length,
    avg: Number(avg.toFixed(4)),
    min: s[0],
    p25: s[Math.floor(s.length * 0.25)],
    median: s[Math.floor(s.length * 0.5)],
    p75: s[Math.floor(s.length * 0.75)],
    max: s[s.length - 1],
  };
}

if (!fs.existsSync(SEASONS_JSONL)) {
  console.error(`Missing ${SEASONS_JSONL}. Run the college master builder first.`);
  process.exit(1);
}

if (!fs.existsSync(CAREER_WITH_OUTCOMES)) {
  console.error(`Missing ${CAREER_WITH_OUTCOMES}. Run NFL outcome join first.`);
  process.exit(1);
}

const careerPayload = JSON.parse(fs.readFileSync(CAREER_WITH_OUTCOMES, 'utf8'));
const careerRows = careerPayload.rows || [];

const outcomeByKey = new Map();

for (const row of careerRows) {
  const key = `${row.normalized_name || cleanName(row.player)}|${String(row.position || '').toUpperCase()}`;
  const outcome = row.nfl_outcome || {};
  outcomeByKey.set(key, {
    player: row.player,
    position: row.position,
    college: row.college,
    last_college: row.last_college,
    outcome_score: Number(outcome.nfl_outcome_score || 0),
    outcome_label: outcome.nfl_outcome_label || 'Unknown',
    hit_miss: outcome.hit_miss || 'Miss',
    draft_pick: row.draft?.nfl_draft?.pick ?? outcome.draft?.pick ?? null,
    draft_year: row.draft?.nfl_draft?.draft_year ?? outcome.draft?.draft_year ?? null,
  });
}

const playerAgg = new Map();

function ensureAgg(row) {
  const key = playerKey(row);

  if (!playerAgg.has(key)) {
    playerAgg.set(key, {
      key,
      player: row.player,
      normalized_name: row.normalized_name || cleanName(row.player),
      position: String(row.position || '').toUpperCase(),
      seasons: new Set(),
      teams: [],
      featureStats: new Map(),
      has: {
        pff: false,
        traditional: false,
        qbr: false,
        ppa_epa: false,
        roster: false,
        recruiting: false,
      },
    });
  }

  return playerAgg.get(key);
}

function addFeature(agg, feature, value, season) {
  const n = toNum(value);
  if (n === null) return;

  if (!agg.featureStats.has(feature)) {
    agg.featureStats.set(feature, {
      count: 0,
      sum: 0,
      max: -Infinity,
      min: Infinity,
      final: null,
      finalSeason: -Infinity,
    });
  }

  const s = agg.featureStats.get(feature);
  s.count++;
  s.sum += n;
  s.max = Math.max(s.max, n);
  s.min = Math.min(s.min, n);

  if (Number(season || 0) >= s.finalSeason) {
    s.final = n;
    s.finalSeason = Number(season || 0);
  }
}

const rl = readline.createInterface({
  input: fs.createReadStream(SEASONS_JSONL),
  crlfDelay: Infinity,
});

let seasonLineCount = 0;

for await (const line of rl) {
  if (!line.trim()) continue;
  seasonLineCount++;

  let row;
  try {
    row = JSON.parse(line);
  } catch {
    continue;
  }

  const agg = ensureAgg(row);
  const season = Number(row.season || 0);

  agg.seasons.add(season);
  if (row.team && !agg.teams.includes(row.team)) agg.teams.push(row.team);

  agg.has.pff ||= Object.keys(row.pff || {}).length > 0;
  agg.has.traditional ||= Object.keys(row.traditional || {}).length > 0;
  agg.has.qbr ||= !!row.efficiency?.qbr && Object.keys(row.efficiency.qbr).length > 0;
  agg.has.ppa_epa ||= !!row.efficiency?.ppa_epa && Object.keys(row.efficiency.ppa_epa).length > 0;
  agg.has.roster ||= !!row.roster && Object.keys(row.roster).length > 0;
  agg.has.recruiting ||= !!row.recruiting && Object.keys(row.recruiting).length > 0;

  const flat = flattenNumeric({
    pff: row.pff || {},
    traditional: row.traditional || {},
    efficiency: row.efficiency || {},
    roster: row.roster || {},
    recruiting: row.recruiting || {},
  }, 'college');

  for (const [feature, value] of Object.entries(flat)) {
    addFeature(agg, `${feature}`, value, season);
  }
}

const modelRows = [];

for (const agg of playerAgg.values()) {
  const outcome = outcomeByKey.get(agg.key);
  if (!outcome) continue;

  const features = {};

  for (const [feature, s] of agg.featureStats.entries()) {
    if (s.count <= 0) continue;
    features[`${feature}.avg`] = s.sum / s.count;
    features[`${feature}.max`] = s.max;
    features[`${feature}.min`] = s.min;
    features[`${feature}.final`] = s.final;
  }

  modelRows.push({
    key: agg.key,
    player: agg.player,
    normalized_name: agg.normalized_name,
    position: agg.position,
    seasons: Array.from(agg.seasons).sort((a, b) => a - b),
    season_count: agg.seasons.size,
    college_history: agg.teams,
    has: agg.has,
    outcome,
    feature_count: Object.keys(features).length,
    features,
  });
}

const byPosition = new Map();

for (const row of modelRows) {
  if (!byPosition.has(row.position)) byPosition.set(row.position, []);
  byPosition.get(row.position).push(row);
}

const positionReports = {};
const coverage = {
  source_season_lines: seasonLineCount,
  career_rows_with_outcomes: careerRows.length,
  model_player_rows: modelRows.length,
  by_position: {},
};

for (const [position, rows] of byPosition.entries()) {
  coverage.by_position[position] = rows.length;

  const featureMap = new Map();

  for (const row of rows) {
    const y = Number(row.outcome.outcome_score || 0);

    for (const [feature, value] of Object.entries(row.features)) {
      const x = toNum(value);
      if (x === null) continue;

      if (!featureMap.has(feature)) featureMap.set(feature, { xs: [], ys: [], hits: 0 });
      const f = featureMap.get(feature);
      f.xs.push(x);
      f.ys.push(y);
      if (row.outcome.hit_miss === 'Hit') f.hits++;
    }
  }

  const minN = Math.max(15, Math.min(100, Math.floor(rows.length * 0.1)));
  const featureReports = [];

  for (const [feature, data] of featureMap.entries()) {
    if (data.xs.length < minN) continue;
    const corr = pearson(data.xs, data.ys);
    if (corr === null) continue;

    featureReports.push({
      feature,
      n: data.xs.length,
      hit_count_with_feature: data.hits,
      corr_to_nfl_outcome_score: Number(corr.toFixed(4)),
      abs_corr: Number(Math.abs(corr).toFixed(4)),
      direction: corr >= 0 ? 'higher_is_better' : 'lower_is_better',
      stats: summarize(data.xs),
    });
  }

  featureReports.sort((a, b) => b.abs_corr - a.abs_corr);

  positionReports[position] = {
    position,
    player_count: rows.length,
    hit_count: rows.filter(r => r.outcome.hit_miss === 'Hit').length,
    outcome_label_counts: rows.reduce((acc, r) => {
      const label = r.outcome.outcome_label || 'Unknown';
      acc[label] = (acc[label] || 0) + 1;
      return acc;
    }, {}),
    min_feature_n: minN,
    top_features: featureReports.slice(0, 75),
    key_metric_candidates: featureReports.slice(0, 25).map(f => ({
      feature: f.feature,
      direction: f.direction,
      corr_to_nfl_outcome_score: f.corr_to_nfl_outcome_score,
      n: f.n,
    })),
  };
}

const compactPositions = Object.fromEntries(
  Object.entries(positionReports).map(([pos, report]) => [
    pos,
    {
      player_count: report.player_count,
      hit_count: report.hit_count,
      outcome_label_counts: report.outcome_label_counts,
      top_15_features: report.top_features.slice(0, 15),
      key_metric_candidates: report.key_metric_candidates.slice(0, 15),
    }
  ])
);

const summary = {
  generatedAt: new Date().toISOString(),
  model_version: 'college_key_metrics_v1',
  target: {
    name: 'nfl_outcome_score',
    source: 'college_player_career_summary_2014_2025_with_nfl_outcomes.json',
    note: 'First-pass NFL outcome score from NFL PBP/rosters/draft/NGS. Good for QB/RB/WR/TE; OL/defense need AV/snap/defensive production upgrades later.',
  },
  coverage,
  positions: compactPositions,
  website_use: {
    recommended_publish_file: OUT_SUMMARY,
    next_step: 'Use this file to select lean position-specific model features and build website prospect score files.',
  },
};

fs.writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 2));
fs.writeFileSync(OUT_FEATURES, JSON.stringify({
  generatedAt: new Date().toISOString(),
  model_version: 'college_key_metrics_v1',
  target: summary.target,
  coverage,
  position_reports: positionReports,
}, null, 2));

console.log('DONE');
console.log('Season JSONL lines:', seasonLineCount);
console.log('Career rows:', careerRows.length);
console.log('Model rows:', modelRows.length);
console.log('By position:', coverage.by_position);
console.log(`Wrote ${OUT_SUMMARY}`);
console.log(`Wrote ${OUT_FEATURES}`);
