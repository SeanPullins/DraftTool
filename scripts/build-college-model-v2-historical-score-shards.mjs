import fs from 'fs';
import readline from 'readline';
import path from 'path';

const SEASONS_JSONL = 'public/data/model/college_player_seasons_2014_2025.jsonl';
const CAREER_WITH_OUTCOMES = 'public/data/model/college_player_career_summary_2014_2025_with_nfl_outcomes.json';
const WEIGHTS = 'public/data/model/college_position_scoring_weights_v2.json';

const OUT_DIR = 'public/data/model/college_scores_shards';
const OUT_INDEX = `${OUT_DIR}/index.json`;
const OUT_REPORT = 'public/data/model/college_model_v2_historical_scores_report.json';

const ALLOWED_SHARD_POSITIONS = new Set([
  'QB',
  'WR',
  'RB',
  'TE',
  'OT',
  'IOL',
  'EDGE',
  'DL',
  'LB',
  'CB',
  'S',
  'K',
  'P',
]);

fs.mkdirSync(OUT_DIR, { recursive: true });

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

    const fieldPath = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'number' && Number.isFinite(value)) {
      out[fieldPath] = value;
    } else if (typeof value === 'string') {
      const n = toNum(value);
      if (n !== null && value.trim() !== '') out[fieldPath] = n;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenNumeric(value, fieldPath, out);
    }
  }

  return out;
}

function playerKey(row) {
  return `${row.normalized_name || cleanName(row.player)}|${normalizePosition(row.position)}`;
}

function featureBase(feature = '') {
  return feature.replace(/^college\./, '').replace(/\.(avg|max|min|final)$/, '');
}

function labelFromScore(score) {
  if (score >= 85) return 'Elite Outcome Profile';
  if (score >= 75) return 'Core Starter Profile';
  if (score >= 65) return 'Starter / Useful Hit Profile';
  if (score >= 50) return 'Contributor Profile';
  return 'Low Translation Profile';
}

function percentileFromStats(value, stats, direction) {
  if (!stats || value === null || value === undefined) return null;

  const min = Number(stats.min);
  const max = Number(stats.max);

  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return null;

  let pct = (Number(value) - min) / (max - min);
  if (direction === 'lower_is_better') pct = 1 - pct;

  return Math.max(0, Math.min(1, pct));
}

function getFeatureValue(features, weightFeature) {
  const base = featureBase(weightFeature);

  const suffix = weightFeature.match(/\.(avg|max|min|final)$/)?.[0]?.slice(1) || 'avg';

  const exact = features[`college.${base}.${suffix}`] ?? features[`${base}.${suffix}`];
  if (exact !== undefined) return exact;

  const fallbackOrder = ['final', 'avg', 'max', 'min'];
  for (const s of fallbackOrder) {
    const v = features[`college.${base}.${s}`] ?? features[`${base}.${s}`];
    if (v !== undefined) return v;
  }

  return null;
}

if (!fs.existsSync(SEASONS_JSONL)) {
  console.error(`Missing ${SEASONS_JSONL}`);
  process.exit(1);
}

if (!fs.existsSync(CAREER_WITH_OUTCOMES)) {
  console.error(`Missing ${CAREER_WITH_OUTCOMES}`);
  process.exit(1);
}

if (!fs.existsSync(WEIGHTS)) {
  console.error(`Missing ${WEIGHTS}`);
  process.exit(1);
}

const weightsPayload = JSON.parse(fs.readFileSync(WEIGHTS, 'utf8'));
const careerPayload = JSON.parse(fs.readFileSync(CAREER_WITH_OUTCOMES, 'utf8'));
const careerRows = careerPayload.rows || [];

const careerByKey = new Map();

for (const row of careerRows) {
  const pos = normalizePosition(row.position);
  const key = `${row.normalized_name || cleanName(row.player)}|${pos}`;

  careerByKey.set(key, {
    player: row.player,
    normalized_name: row.normalized_name || cleanName(row.player),
    position: pos,
    raw_position: row.position,
    college: row.college || row.last_college,
    last_college: row.last_college || row.college,
    college_history: row.college_history || [],
    draft: row.draft || {},
    athletic: row.athletic || {},
    nfl_outcome: row.nfl_outcome || null,
  });
}

const aggByKey = new Map();

function ensureAgg(row) {
  const key = playerKey(row);
  const pos = normalizePosition(row.position);

  if (!aggByKey.has(key)) {
    aggByKey.set(key, {
      key,
      player: row.player,
      normalized_name: row.normalized_name || cleanName(row.player),
      position: pos,
      raw_positions: new Set(),
      seasons: new Set(),
      teamsBySeason: new Map(),
      featureStats: new Map(),
    });
  }

  const agg = aggByKey.get(key);

  if (row.position) agg.raw_positions.add(String(row.position).toUpperCase());
  if (row.season) agg.seasons.add(Number(row.season));
  if (row.season && row.team) agg.teamsBySeason.set(Number(row.season), row.team);

  return agg;
}

function addFeature(agg, feature, value, season) {
  const n = toNum(value);
  if (n === null) return;

  if (!agg.featureStats.has(feature)) {
    agg.featureStats.set(feature, {
      count: 0,
      sum: 0,
      min: Infinity,
      max: -Infinity,
      final: null,
      finalSeason: -Infinity,
    });
  }

  const s = agg.featureStats.get(feature);
  s.count++;
  s.sum += n;
  s.min = Math.min(s.min, n);
  s.max = Math.max(s.max, n);

  if (Number(season || 0) >= s.finalSeason) {
    s.final = n;
    s.finalSeason = Number(season || 0);
  }
}

console.log('Reading season JSONL...');
const rl = readline.createInterface({
  input: fs.createReadStream(SEASONS_JSONL),
  crlfDelay: Infinity,
});

let lineCount = 0;

for await (const line of rl) {
  if (!line.trim()) continue;
  lineCount++;

  let row;
  try {
    row = JSON.parse(line);
  } catch {
    continue;
  }

  const agg = ensureAgg(row);
  const season = Number(row.season || 0);

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

console.log('Aggregated players:', aggByKey.size);

const rows = [];

for (const agg of aggByKey.values()) {
  const career = careerByKey.get(agg.key) || {};
  const seasons = Array.from(agg.seasons).sort((a, b) => a - b);
  const lastSeason = seasons[seasons.length - 1] || null;
  const draftYear = career.draft?.nfl_draft?.draft_year || (lastSeason ? lastSeason + 1 : null);
  const year = Number(draftYear || lastSeason || 0);

  const positionModel = weightsPayload.positions?.[agg.position];
  const features = {};

  for (const [feature, s] of agg.featureStats.entries()) {
    features[`${feature}.avg`] = s.sum / s.count;
    features[`${feature}.max`] = s.max;
    features[`${feature}.min`] = s.min;
    features[`${feature}.final`] = s.final;
  }

  let totalWeight = 0;
  let weightedScore = 0;
  const signals = [];
  const missing = [];

  if (positionModel?.weights?.length) {
    for (const w of positionModel.weights) {
      const value = getFeatureValue(features, w.feature);
      const pct = percentileFromStats(value, w.stats, w.direction);

      if (pct === null) {
        missing.push(w.feature);
        continue;
      }

      const weight = Number(w.weight || 0);
      totalWeight += weight;
      weightedScore += pct * weight;

      signals.push({
        feature: w.feature,
        label: w.label,
        bucket: w.bucket,
        direction: w.direction,
        value,
        percentile: Number((pct * 100).toFixed(1)),
        weight,
        contribution: Number((pct * weight).toFixed(2)),
      });
    }
  }

  const rawScore = totalWeight > 0
    ? Number(((weightedScore / totalWeight) * 100).toFixed(1))
    : null;

  const score = rawScore !== null
    ? Number(Math.max(0, Math.min(100, 45 + rawScore * 0.65)).toFixed(1))
    : null;

  const topSignals = signals
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 5);

  rows.push({
    id: `${agg.position.toLowerCase()}-${year}-${agg.normalized_name}`,
    name: career.player || agg.player,
    normalized_name: agg.normalized_name,
    school: career.last_college || agg.teamsBySeason.get(lastSeason) || career.college || '',
    year,
    draftYear: draftYear || year,
    pos: agg.position,
    original_positions: Array.from(agg.raw_positions).sort(),
    seasons,
    lastSeason,

    collegeModelV2Score: score,
    collegeModelV2RawScore: rawScore,
    collegeModelV2Label: score !== null ? labelFromScore(score) : 'Insufficient Data',
    collegeModelV2Mode: positionModel?.mode || 'historical_shard',
    collegeModelV2Coverage: {
      matched_features: signals.length,
      missing_features: missing.length,
      total_weight_used: Number(totalWeight.toFixed(2)),
    },
    collegeModelV2TopSignals: topSignals,
    collegeModelV2MissingFeatures: missing.slice(0, 10),

    draft: career.draft?.nfl_draft || null,
    nfl_outcome: career.nfl_outcome ? {
      nfl_outcome_score: career.nfl_outcome.nfl_outcome_score,
      nfl_outcome_label: career.nfl_outcome.nfl_outcome_label,
      hit_miss: career.nfl_outcome.hit_miss,
      match_confidence: career.nfl_outcome.match_confidence,
    } : null,
  });
}

const byShard = new Map();

for (const row of rows) {
  const y = Number(row.year || 0);
  const pos = row.pos || 'UNK';
  if (!y || y < 2014 || y > 2027) continue;
  if (!ALLOWED_SHARD_POSITIONS.has(pos)) continue;

  const key = `${y}_${pos}`;
  if (!byShard.has(key)) byShard.set(key, []);
  byShard.get(key).push(row);
}

const index = {
  generatedAt: new Date().toISOString(),
  model_version: 'college_model_v2_historical_score_shards',
  source_weights: WEIGHTS,
  row_count_total: rows.length,
  shard_count: byShard.size,
  shards: [],
};

for (const [key, shardRows] of byShard.entries()) {
  const [year, pos] = key.split('_');

  shardRows.sort((a, b) =>
    ((b.collegeModelV2Score ?? -1) - (a.collegeModelV2Score ?? -1)) ||
    String(a.name).localeCompare(String(b.name))
  );

  const file = `${OUT_DIR}/${key}.json`;

  fs.writeFileSync(file, JSON.stringify({
    generatedAt: new Date().toISOString(),
    model_version: 'college_model_v2_historical_score_shard',
    year: Number(year),
    pos,
    rows: shardRows,
  }, null, 2));

  index.shards.push({
    year: Number(year),
    pos,
    file,
    count: shardRows.length,
    scored_count: shardRows.filter(r => r.collegeModelV2Score !== null).length,
    top_player: shardRows[0]?.name || null,
    top_score: shardRows[0]?.collegeModelV2Score ?? null,
  });
}

index.shards.sort((a, b) => (a.year - b.year) || String(a.pos).localeCompare(String(b.pos)));

fs.writeFileSync(OUT_INDEX, JSON.stringify(index, null, 2));

const report = {
  generatedAt: new Date().toISOString(),
  model_version: 'college_model_v2_historical_score_shards',
  input_lines: lineCount,
  aggregated_players: aggByKey.size,
  output_rows: rows.length,
  shard_count: index.shards.length,
  byYearPos: index.shards,
};

fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2));

console.log('DONE');
console.log('Input lines:', lineCount);
console.log('Aggregated players:', aggByKey.size);
console.log('Rows:', rows.length);
console.log('Shards:', index.shards.length);
console.log(`Wrote ${OUT_INDEX}`);
console.log(`Wrote ${OUT_REPORT}`);
console.table(index.shards.slice(0, 30));
