import fs from 'fs';
import readline from 'readline';

const SEASONS_JSONL = 'public/data/model/college_player_seasons_2014_2025.jsonl';
const CAREER_WITH_OUTCOMES = 'public/data/model/college_player_career_summary_2014_2025_with_nfl_outcomes.json';

const OUT_SUMMARY = 'public/data/model/college_model_training_key_metrics_v2.json';
const OUT_SIGNALS = 'public/data/model/college_position_feature_signal_summary_v2.json';

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

function normalizePosition(pos = '') {
  const p = String(pos).trim().toUpperCase();

  if (['QB', 'QUARTERBACK', 'PRO', 'DUAL'].includes(p)) return 'QB';

  if (['WR', 'WIDE RECEIVER'].includes(p)) return 'WR';
  if (['RB', 'RUNNING BACK', 'HB', 'APB', 'FB', 'FULLBACK'].includes(p)) return 'RB';
  if (['TE', 'TIGHT END'].includes(p)) return 'TE';

  if (['OT', 'T', 'OFFENSIVE TACKLE'].includes(p)) return 'OT';
  if (['OG', 'G', 'OFFENSIVE GUARD', 'C', 'OC', 'CENTER', 'IOL', 'OL'].includes(p)) return 'IOL';

  if (['EDGE', 'ED', 'WDE', 'SDE', 'DE', 'DEFENSIVE END', 'DEFENSIVE EDGE'].includes(p)) return 'EDGE';
  if (['DI', 'DL', 'DT', 'NT', 'DEFENSIVE TACKLE'].includes(p)) return 'DL';
  if (['LB', 'ILB', 'OLB', 'LINEBACKER', 'INSIDE LINEBACKER', 'OUTSIDE LINEBACKER'].includes(p)) return 'LB';

  if (['CB', 'CORNERBACK'].includes(p)) return 'CB';
  if (['S', 'SAFETY', 'DB'].includes(p)) return 'S';

  if (['K', 'PK', 'PLACE KICKER'].includes(p)) return 'K';
  if (['P', 'PUNTER'].includes(p)) return 'P';

  return p || 'UNK';
}

function playerKey(row) {
  return `${row.normalized_name || cleanName(row.player)}|${normalizePosition(row.position)}`;
}

function allowedFeatureForPosition(position, feature) {
  const f = feature.toLowerCase();

  // Always remove identifiers / obvious leakage.
  if (
    f.includes('player_id') ||
    f.includes('athleteid') ||
    f.includes('source') ||
    f.includes('jersey') ||
    f.includes('birth') ||
    f.includes('height_inches') ||
    f.includes('weight_lbs')
  ) {
    return false;
  }

  // Recruiting can be used cautiously for all positions except ID fields.
  if (f.startsWith('college.recruiting.')) {
    return (
      f.includes('.stars') ||
      f.includes('.rating') ||
      f.includes('.ranking') ||
      f.includes('.height') ||
      f.includes('.weight')
    );
  }

  if (position === 'QB') {
    return (
      f.includes('.qb_pff.') ||
      f.includes('.passing') ||
      f.includes('.qbr') ||
      f.includes('.ppa_epa') ||
      f.includes('big_time') ||
      f.includes('turnover') ||
      f.includes('pressure') ||
      f.includes('sack') ||
      f.includes('passing') ||
      f.includes('rushing')
    ) && !f.includes('.receiving.');
  }

  if (position === 'WR') {
    return (
      f.includes('.receiving') ||
      f.includes('.ppa_epa') ||
      f.includes('traditional.receiving') ||
      f.includes('kickreturns') ||
      f.includes('puntreturns')
    ) && !f.includes('.defense.');
  }

  if (position === 'TE') {
    return (
      f.includes('.receiving') ||
      f.includes('.ppa_epa') ||
      f.includes('traditional.receiving') ||
      f.includes('offense_blocking') ||
      f.includes('blocking')
    ) && !f.includes('.defense.');
  }

  if (position === 'RB') {
    return (
      f.includes('.rushing') ||
      f.includes('.receiving') ||
      f.includes('.ppa_epa') ||
      f.includes('traditional.rushing') ||
      f.includes('traditional.receiving') ||
      f.includes('kickreturns') ||
      f.includes('puntreturns')
    ) && !f.includes('.defense.');
  }

  if (['OT', 'IOL'].includes(position)) {
    return (
      f.includes('.ol.') ||
      f.includes('offense_blocking') ||
      f.includes('pass_block') ||
      f.includes('run_block') ||
      f.includes('blocking')
    );
  }

  if (position === 'EDGE') {
    return (
      f.includes('.defense') ||
      f.includes('pass_rush') ||
      f.includes('run_defense') ||
      f.includes('tackling') ||
      f.includes('traditional.defensive.sacks') ||
      f.includes('traditional.defensive.tfl') ||
      f.includes('traditional.defensive.qb_hur') ||
      f.includes('traditional.defensive.tot') ||
      f.includes('.ppa_epa')
    ) && !f.includes('.receiving.');
  }

  if (position === 'DL') {
    return (
      f.includes('.defense') ||
      f.includes('pass_rush') ||
      f.includes('run_defense') ||
      f.includes('tackling') ||
      f.includes('traditional.defensive') ||
      f.includes('.ppa_epa')
    ) && !f.includes('.receiving.');
  }

  if (position === 'LB') {
    return (
      f.includes('.defense') ||
      f.includes('coverage') ||
      f.includes('run_defense') ||
      f.includes('pass_rush') ||
      f.includes('tackling') ||
      f.includes('traditional.defensive') ||
      f.includes('.ppa_epa')
    ) && !f.includes('.receiving.');
  }

  if (['CB', 'S'].includes(position)) {
    return (
      f.includes('.defense') ||
      f.includes('coverage') ||
      f.includes('tackling') ||
      f.includes('traditional.defensive') ||
      f.includes('puntreturns') ||
      f.includes('kickreturns') ||
      f.includes('.ppa_epa')
    ) && !f.includes('.receiving.receiving_depth.');
  }

  return false;
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

function labelBucket(score) {
  if (score >= 85) return 'Elite';
  if (score >= 70) return 'Core Starter';
  if (score >= 55) return 'Starter / Useful Hit';
  if (score >= 35) return 'Contributor';
  return 'Miss';
}

if (!fs.existsSync(SEASONS_JSONL)) {
  console.error(`Missing ${SEASONS_JSONL}`);
  process.exit(1);
}

if (!fs.existsSync(CAREER_WITH_OUTCOMES)) {
  console.error(`Missing ${CAREER_WITH_OUTCOMES}`);
  process.exit(1);
}

const careerPayload = JSON.parse(fs.readFileSync(CAREER_WITH_OUTCOMES, 'utf8'));
const careerRows = careerPayload.rows || [];

const outcomeByKey = new Map();

for (const row of careerRows) {
  const normalizedPosition = normalizePosition(row.position);
  const key = `${row.normalized_name || cleanName(row.player)}|${normalizedPosition}`;
  const outcome = row.nfl_outcome || {};
  const outcomeScore = Number(outcome.nfl_outcome_score || 0);

  outcomeByKey.set(key, {
    player: row.player,
    position: normalizedPosition,
    original_position: row.position,
    college: row.college,
    last_college: row.last_college,
    outcome_score: outcomeScore,
    outcome_label: outcome.nfl_outcome_label || labelBucket(outcomeScore),
    hit_miss: outcome.hit_miss || (outcomeScore >= 55 ? 'Hit' : 'Miss'),
    match_confidence: outcome.match_confidence || 'unknown',
    draft_pick: row.draft?.nfl_draft?.pick ?? outcome.draft?.pick ?? null,
    draft_year: row.draft?.nfl_draft?.draft_year ?? outcome.draft?.draft_year ?? null,
  });
}

const playerAgg = new Map();

function ensureAgg(row) {
  const key = playerKey(row);
  const position = normalizePosition(row.position);

  if (!playerAgg.has(key)) {
    playerAgg.set(key, {
      key,
      player: row.player,
      normalized_name: row.normalized_name || cleanName(row.player),
      position,
      raw_positions: new Set(),
      seasons: new Set(),
      teams: [],
      featureStats: new Map(),
      rejectedFeatures: 0,
      acceptedFeatures: 0,
    });
  }

  const agg = playerAgg.get(key);
  if (row.position) agg.raw_positions.add(String(row.position).toUpperCase());

  return agg;
}

function addFeature(agg, feature, value, season) {
  const n = toNum(value);
  if (n === null) return;

  if (!allowedFeatureForPosition(agg.position, feature)) {
    agg.rejectedFeatures++;
    return;
  }

  agg.acceptedFeatures++;

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

  const flat = flattenNumeric({
    pff: row.pff || {},
    traditional: row.traditional || {},
    efficiency: row.efficiency || {},
    roster: row.roster || {},
    recruiting: row.recruiting || {},
  }, 'college');

  for (const [feature, value] of Object.entries(flat)) {
    addFeature(agg, feature, value, season);
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
    raw_positions: Array.from(agg.raw_positions).sort(),
    seasons: Array.from(agg.seasons).sort((a, b) => a - b),
    season_count: agg.seasons.size,
    college_history: agg.teams,
    outcome,
    feature_count: Object.keys(features).length,
    accepted_feature_events: agg.acceptedFeatures,
    rejected_feature_events: agg.rejectedFeatures,
    features,
  });
}

function buildPositionReport(rows, mode) {
  const byPosition = new Map();

  for (const row of rows) {
    if (!byPosition.has(row.position)) byPosition.set(row.position, []);
    byPosition.get(row.position).push(row);
  }

  const reports = {};

  for (const [position, posRows] of byPosition.entries()) {
    const featureMap = new Map();

    for (const row of posRows) {
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

    const minN = Math.max(20, Math.min(150, Math.floor(posRows.length * 0.12)));
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

    reports[position] = {
      mode,
      position,
      player_count: posRows.length,
      hit_count: posRows.filter(r => r.outcome.hit_miss === 'Hit').length,
      outcome_label_counts: posRows.reduce((acc, r) => {
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

  return reports;
}

const allReports = buildPositionReport(modelRows, 'all_players');

const matchedRows = modelRows.filter(r =>
  r.outcome.match_confidence &&
  r.outcome.match_confidence !== 'unmatched' &&
  r.outcome.outcome_label !== 'No NFL Match'
);

const matchedReports = buildPositionReport(matchedRows, 'matched_only');

const coverage = {
  source_season_lines: seasonLineCount,
  career_rows_with_outcomes: careerRows.length,
  model_player_rows: modelRows.length,
  matched_model_rows: matchedRows.length,
  by_position_all: modelRows.reduce((acc, r) => {
    acc[r.position] = (acc[r.position] || 0) + 1;
    return acc;
  }, {}),
  by_position_matched: matchedRows.reduce((acc, r) => {
    acc[r.position] = (acc[r.position] || 0) + 1;
    return acc;
  }, {}),
};

function compactReports(reports) {
  return Object.fromEntries(
    Object.entries(reports).map(([pos, report]) => [
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
}

const summary = {
  generatedAt: new Date().toISOString(),
  model_version: 'college_key_metrics_v2',
  target: {
    name: 'nfl_outcome_score',
    source: 'college_player_career_summary_2014_2025_with_nfl_outcomes.json',
    note: 'v2 normalizes positions and filters feature families by position to reduce cross-position metric pollution.',
  },
  coverage,
  all_players: compactReports(allReports),
  matched_only: compactReports(matchedReports),
  website_use: {
    recommended_publish_file: OUT_SUMMARY,
    recommended_mode_for_feature_selection: 'matched_only where sample size is adequate; otherwise blend with all_players',
    next_step: 'Build lean website prospect scoring files from v2 key_metric_candidates.',
  },
};

fs.writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 2));
fs.writeFileSync(OUT_SIGNALS, JSON.stringify({
  generatedAt: new Date().toISOString(),
  model_version: 'college_key_metrics_v2',
  target: summary.target,
  coverage,
  all_players: allReports,
  matched_only: matchedReports,
}, null, 2));

console.log('DONE v2');
console.log('Season JSONL lines:', seasonLineCount);
console.log('Career rows:', careerRows.length);
console.log('Model rows:', modelRows.length);
console.log('Matched rows:', matchedRows.length);
console.log('By position all:', coverage.by_position_all);
console.log('By position matched:', coverage.by_position_matched);
console.log(`Wrote ${OUT_SUMMARY}`);
console.log(`Wrote ${OUT_SIGNALS}`);
