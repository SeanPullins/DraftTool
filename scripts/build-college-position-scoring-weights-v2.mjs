import fs from 'fs';

const INPUT = 'public/data/model/college_model_training_key_metrics_v2.json';

const OUT_WEIGHTS = 'public/data/model/college_position_scoring_weights_v2.json';
const OUT_DICTIONARY = 'public/data/model/college_model_feature_dictionary_v2.json';
const OUT_REPORT = 'public/data/model/college_model_v2_publish_report.json';

if (!fs.existsSync(INPUT)) {
  console.error(`Missing ${INPUT}. Run train-college-model-key-metrics-v2.mjs first.`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(INPUT, 'utf8'));

const POSITION_ORDER = ['QB', 'WR', 'RB', 'TE', 'OT', 'IOL', 'EDGE', 'DL', 'LB', 'CB', 'S'];

function friendlyFeatureName(feature = '') {
  let f = feature
    .replace(/^college\./, '')
    .replace(/\.(avg|max|min|final)$/, '')
    .replace(/\./g, ' / ')
    .replace(/_/g, ' ');

  f = f.replace(/\bpff\b/i, 'PFF');
  f = f.replace(/\bppa epa\b/i, 'PPA/EPA');
  f = f.replace(/\bqbr\b/i, 'QBR');

  return f
    .split(' ')
    .filter(Boolean)
    .map(w => {
      if (['PFF', 'EPA', 'PPA/EPA', 'QBR'].includes(w.toUpperCase())) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

function bucketFeature(feature = '') {
  const f = feature.toLowerCase();

  if (f.includes('ppa_epa')) return 'Efficiency';
  if (f.includes('qbr')) return 'QBR';
  if (f.includes('passing')) return 'Passing';
  if (f.includes('receiving')) return 'Receiving';
  if (f.includes('rushing')) return 'Rushing';
  if (f.includes('blocking') || f.includes('pass_block') || f.includes('run_block')) return 'Blocking';
  if (f.includes('coverage')) return 'Coverage';
  if (f.includes('pass_rush')) return 'Pass Rush';
  if (f.includes('run_defense')) return 'Run Defense';
  if (f.includes('tackling')) return 'Tackling';
  if (f.includes('traditional.defensive')) return 'Traditional Defense';
  if (f.includes('recruiting')) return 'Recruiting';

  return 'Other';
}

function chooseSourceReport(pos) {
  const matched = data.matched_only?.[pos];
  const all = data.all_players?.[pos];

  // Prefer matched-only if we have enough players and at least a few hits.
  if (matched && matched.player_count >= 40 && matched.hit_count >= 3) {
    return { mode: 'matched_only', report: matched };
  }

  if (all) return { mode: 'all_players', report: all };

  return { mode: 'none', report: null };
}

function dedupeByBaseFeature(features) {
  const seen = new Set();
  const out = [];

  for (const item of features) {
    const base = item.feature.replace(/\.(avg|max|min|final)$/, '');

    if (seen.has(base)) continue;
    seen.add(base);
    out.push(item);
  }

  return out;
}

function buildWeightsForPosition(pos) {
  const { mode, report } = chooseSourceReport(pos);

  if (!report) {
    return {
      position: pos,
      mode,
      player_count: 0,
      hit_count: 0,
      weights: [],
    };
  }

  const candidates = dedupeByBaseFeature(report.top_15_features || [])
    .filter(f => Number.isFinite(Number(f.abs_corr)) || Number.isFinite(Math.abs(Number(f.corr_to_nfl_outcome_score))))
    .slice(0, 10);

  const totalStrength = candidates.reduce((sum, f) => {
    const strength = Math.abs(Number(f.corr_to_nfl_outcome_score || 0));
    return sum + strength;
  }, 0) || 1;

  const weights = candidates.map(f => {
    const corr = Number(f.corr_to_nfl_outcome_score || 0);
    const rawWeight = Math.abs(corr) / totalStrength;
    const weight = Number((rawWeight * 100).toFixed(2));

    return {
      feature: f.feature,
      label: friendlyFeatureName(f.feature),
      bucket: bucketFeature(f.feature),
      direction: corr >= 0 ? 'higher_is_better' : 'lower_is_better',
      corr_to_nfl_outcome_score: Number(corr.toFixed(4)),
      n: f.n,
      weight,
      stats: f.stats || null,
    };
  });

  return {
    position: pos,
    mode,
    player_count: report.player_count,
    hit_count: report.hit_count,
    outcome_label_counts: report.outcome_label_counts,
    weights,
  };
}

const positions = {};

for (const pos of POSITION_ORDER) {
  positions[pos] = buildWeightsForPosition(pos);
}

const dictionary = {
  generatedAt: new Date().toISOString(),
  model_version: 'college_position_scoring_weights_v2',
  feature_buckets: {
    Efficiency: 'College EPA/PPA production and efficiency signals.',
    QBR: 'Quarterback rating/efficiency signals where available.',
    Passing: 'Passing volume, accuracy, depth and pressure-related traits.',
    Receiving: 'Route/target/depth receiving production and efficiency.',
    Rushing: 'Rushing volume, efficiency, explosive production and touchdowns.',
    Blocking: 'Offensive line pass-blocking and run-blocking traits.',
    Coverage: 'Defensive coverage production and grading signals.',
    'Pass Rush': 'Pressure, sack and pass-rush production traits.',
    'Run Defense': 'Run-stop and run-defense traits.',
    Tackling: 'Tackling volume and tackling-quality traits.',
    'Traditional Defense': 'Traditional box score defensive production.',
    Recruiting: 'Recruiting ranking/rating background signal.',
    Other: 'Miscellaneous feature bucket.'
  },
  features: Object.fromEntries(
    Object.values(positions)
      .flatMap(p => p.weights)
      .map(w => [
        w.feature,
        {
          label: w.label,
          bucket: w.bucket,
          direction: w.direction,
          plain_english: `${w.label} is a ${w.bucket.toLowerCase()} signal. In this training run, ${w.direction === 'higher_is_better' ? 'higher values tracked better' : 'lower values tracked better'} against NFL outcome score.`,
        }
      ])
  ),
};

const report = {
  generatedAt: new Date().toISOString(),
  input: INPUT,
  model_version: 'college_position_scoring_weights_v2',
  source_model_version: data.model_version,
  coverage: data.coverage,
  positions: Object.fromEntries(
    Object.entries(positions).map(([pos, p]) => [
      pos,
      {
        mode: p.mode,
        player_count: p.player_count,
        hit_count: p.hit_count,
        weight_count: p.weights.length,
        top_features: p.weights.slice(0, 5).map(w => ({
          feature: w.feature,
          label: w.label,
          bucket: w.bucket,
          weight: w.weight,
          corr: w.corr_to_nfl_outcome_score,
        })),
      }
    ])
  ),
};

fs.writeFileSync(OUT_WEIGHTS, JSON.stringify({
  generatedAt: new Date().toISOString(),
  model_version: 'college_position_scoring_weights_v2',
  note: 'Position-specific scoring weights derived from v2 feature signal training. Use for lean website scoring, not as raw data replacement.',
  positions,
}, null, 2));

fs.writeFileSync(OUT_DICTIONARY, JSON.stringify(dictionary, null, 2));
fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2));

console.log('DONE');
console.log(`Wrote ${OUT_WEIGHTS}`);
console.log(`Wrote ${OUT_DICTIONARY}`);
console.log(`Wrote ${OUT_REPORT}`);
console.table(Object.entries(report.positions).map(([pos, r]) => ({
  pos,
  mode: r.mode,
  players: r.player_count,
  hits: r.hit_count,
  weights: r.weight_count,
})));
