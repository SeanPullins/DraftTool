import fs from 'fs';
import path from 'path';

const WEIGHTS = 'public/data/model/college_position_scoring_weights_v2.json';
const DICTIONARY = 'public/data/model/college_model_feature_dictionary_v2.json';

const OUT = 'public/data/model/college_model_v2_prospect_scores.json';
const REPORT = 'public/data/model/college_model_v2_prospect_scores_report.json';

const prospectFiles = [
  'public/data/prospects_2024_qb.json',
  'public/data/prospects_2024_wr.json',
  'public/data/prospects_2024_rb.json',
  'public/data/prospects_2024_te.json',

  'public/data/prospects_2025_qb.json',
  'public/data/prospects_2025_wr.json',
  'public/data/prospects_2025_rb.json',
  'public/data/prospects_2025_te.json',

  'public/data/prospects_2026_qb.json',
  'public/data/prospects_2026_wr.json',
  'public/data/prospects_2026_rb.json',
  'public/data/prospects_2026_te.json',

  'public/data/prospects_2027_qb.json',
  'public/data/prospects_2027_wr.json',
  'public/data/prospects_2027_rb.json',
  'public/data/prospects_2027_te.json',
  'public/data/prospects_2027_all.json',
].filter(fs.existsSync);

function cleanName(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
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

  return p || 'UNK';
}

function deepGet(obj, feature) {
  if (!obj) return null;

  const cleaned = feature
    .replace(/^college\./, '')
    .replace(/\.(avg|max|min|final)$/, '');

  const parts = cleaned.split('.');

  // Prospect files are flatter than training rows, so try several mappings.
  const candidates = [
    parts,
    parts.slice(1),
    parts.slice(2),
  ];

  for (const pathParts of candidates) {
    let cur = obj;
    let ok = true;

    for (const part of pathParts) {
      if (cur && Object.prototype.hasOwnProperty.call(cur, part)) {
        cur = cur[part];
      } else {
        ok = false;
        break;
      }
    }

    if (ok && cur !== undefined && cur !== null && cur !== '') {
      const n = Number(cur);
      return Number.isFinite(n) ? n : null;
    }
  }

  return null;
}

function findFeatureValue(player, feature) {
  const base = feature.replace(/\.(avg|max|min|final)$/, '');
  const candidates = [
    base,
    feature,
  ];

  for (const f of candidates) {
    const direct = deepGet(player, f);
    if (direct !== null) return direct;
  }

  // Manual fallbacks for common current prospect fields.
  const f = feature.toLowerCase();

  const pff = player.pff || {};
  const forecast = player.forecast || {};

  const fallbackMap = [
    ['passing_yards', pff.yards ?? pff.pass_yards],
    ['passing_touchdowns', pff.touchdowns ?? pff.pass_tds ?? pff.tds],
    ['big_time', pff.btt_rate ?? pff.big_time_throw_rate],
    ['turnover', pff.twp_rate ?? pff.turnover_worthy_play_rate],
    ['pressure', pff.pressure_grade ?? pff.under_pressure_grade],
    ['sack', pff.pressure_to_sack_rate],
    ['adjusted_completion', pff.adjusted_completion_percent],
    ['adot', pff.adot],
    ['epa', pff.epa],
    ['pass_grade', pff.pass_grade],
    ['offense_grade', pff.offense_grade],
    ['receiving_yards', pff.receiving_yards ?? pff.yards],
    ['receiving_touchdowns', pff.receiving_tds ?? pff.tds],
    ['rushing_yards', pff.rushing_yards ?? pff.yards],
    ['rushing_touchdowns', pff.rushing_tds ?? pff.tds],
    ['modelscore', forecast.modelScore],
    ['projectionscore', forecast.projectionScore],
  ];

  for (const [needle, value] of fallbackMap) {
    if (f.includes(needle)) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }

  return null;
}

function percentileFromStats(value, stats, direction) {
  if (!stats || value === null) return null;

  const min = Number(stats.min);
  const max = Number(stats.max);

  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return null;

  let pct = (value - min) / (max - min);

  if (direction === 'lower_is_better') pct = 1 - pct;

  return Math.max(0, Math.min(1, pct));
}

function labelFromScore(score) {
  if (score >= 85) return 'Elite Outcome Profile';
  if (score >= 75) return 'Core Starter Profile';
  if (score >= 65) return 'Starter / Useful Hit Profile';
  if (score >= 50) return 'Contributor Profile';
  return 'Low Translation Profile';
}

const weightsPayload = JSON.parse(fs.readFileSync(WEIGHTS, 'utf8'));
const dictionary = fs.existsSync(DICTIONARY)
  ? JSON.parse(fs.readFileSync(DICTIONARY, 'utf8'))
  : { features: {} };

const scores = [];
const reportRows = [];

for (const file of prospectFiles) {
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  const arr = Array.isArray(rows) ? rows : rows.rows || [];

  let scored = 0;

  for (const player of arr) {
    const pos = normalizePosition(player.pos || player.position);
    const year = Number(player.year || player.draftYear || path.basename(file).match(/20\d{2}/)?.[0]);
    const positionModel = weightsPayload.positions?.[pos];

    if (!positionModel || !positionModel.weights?.length) continue;

    let totalWeight = 0;
    let weightedScore = 0;
    const signals = [];
    const missing = [];

    for (const w of positionModel.weights) {
      const value = findFeatureValue(player, w.feature);
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
        label: dictionary.features?.[w.feature]?.label || w.label,
        bucket: w.bucket,
        direction: w.direction,
        value,
        percentile: Number((pct * 100).toFixed(1)),
        weight,
        contribution: Number((pct * weight).toFixed(2)),
      });
    }

    const modelScore = totalWeight > 0
      ? Number(((weightedScore / totalWeight) * 100).toFixed(1))
      : null;

    const draftCapitalScore = player.pick
      ? Math.max(0, Math.min(100, 100 - ((Number(player.pick) - 1) / 260) * 100))
      : null;

    const blendedScore = modelScore !== null && draftCapitalScore !== null
      ? Number((modelScore * 0.75 + draftCapitalScore * 0.25).toFixed(1))
      : modelScore;

    const topSignals = signals
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 5);

    scores.push({
      id: player.id || `${pos.toLowerCase()}-${year}-${cleanName(player.name)}`,
      name: player.name,
      normalized_name: cleanName(player.name),
      school: player.school || player.team || player.college,
      year,
      draftYear: player.draftYear || year,
      pos,
      original_position: player.pos || player.position,
      source_file: file,

      collegeModelV2Score: blendedScore,
      collegeModelV2RawScore: modelScore,
      collegeModelV2Label: blendedScore !== null ? labelFromScore(blendedScore) : 'Insufficient Data',
      collegeModelV2Mode: positionModel.mode,
      collegeModelV2Coverage: {
        matched_features: signals.length,
        missing_features: missing.length,
        total_weight_used: Number(totalWeight.toFixed(2)),
      },
      collegeModelV2TopSignals: topSignals,
      collegeModelV2MissingFeatures: missing.slice(0, 10),

      existingScore: player.score ?? player.grade ?? player.forecast?.final ?? null,
      pick: player.pick ?? player.projectedPick ?? null,
    });

    scored++;
  }

  reportRows.push({
    file,
    rows: arr.length,
    scored,
  });
}

scores.sort((a, b) =>
  (a.year - b.year) ||
  String(a.pos).localeCompare(String(b.pos)) ||
  ((b.collegeModelV2Score ?? -1) - (a.collegeModelV2Score ?? -1))
);

const byYear = {};
for (const row of scores) {
  byYear[row.year] ||= {};
  byYear[row.year][row.pos] ||= 0;
  byYear[row.year][row.pos]++;
}

fs.writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  model_version: 'college_model_v2_prospect_scores',
  source_weights: WEIGHTS,
  note: 'Lean prospect scoring overlay generated from college_position_scoring_weights_v2. Does not replace existing prospect files.',
  rows: scores,
}, null, 2));

fs.writeFileSync(REPORT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  model_version: 'college_model_v2_prospect_scores',
  files: reportRows,
  total_scores: scores.length,
  byYear,
}, null, 2));

console.log('DONE');
console.log(`Scored prospects: ${scores.length}`);
console.table(reportRows);
console.log('By year:', byYear);
console.log(`Wrote ${OUT}`);
console.log(`Wrote ${REPORT}`);
