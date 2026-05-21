import fs from 'fs';

function readJson(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`Missing file: ${path}`);
  }
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

const modelsPath = 'public/data/model/v5_gated_stacked_correction_models.json';
const reportPath = 'public/data/model/v5_gated_stacked_correction_report.json';
const decisionPath = 'public/data/model/v5_gated_stacked_correction_decision.json';

const models = readJson(modelsPath);
const report = readJson(reportPath);
const decision = fs.existsSync(decisionPath) ? readJson(decisionPath) : null;

// Prefer the mature correction model because it is trained on mature outcome years.
const correctionModel =
  models.matureCorrection ??
  models.holdoutCorrection ??
  models.modernHoldoutCorrection ??
  null;

if (!correctionModel) {
  throw new Error('Could not find matureCorrection/holdoutCorrection/modernHoldoutCorrection in V5.7 models file.');
}

const rolling = report.rollingModern ?? {};
const selectedPolicy =
  decision?.selectedPolicy ??
  rolling?.bestGateByWeightedPairwise?.name ??
  'gate_all_clamp_15';

const activeModel = {
  version: 'V5.7',
  label: 'V5.7 gated stacked correction',
  status: 'experimental',
  defaultLive: false,
  baseModel: 'V4',
  policy: {
    name: selectedPolicy,
    description: 'Apply V4 stacked correction to all positions, capped at +/-15 class-percentile points.',
    maxCorrection: 15,
    groups: ['QB', 'SKILL', 'OL', 'FRONT', 'DB'],
    requireData: false
  },
  correctionModel,
  metrics: {
    rollingModern: {
      v4: {
        pairwiseAccuracy: rolling.v4AvgPairwiseAccuracy,
        weightedPairwiseAccuracy: rolling.v4AvgWeightedPairwiseAccuracy,
        spearman: rolling.v4AvgSpearman
      },
      stacked: {
        pairwiseAccuracy: rolling.stackedAvgPairwiseAccuracy,
        weightedPairwiseAccuracy: rolling.stackedAvgWeightedPairwiseAccuracy,
        spearman: rolling.stackedAvgSpearman
      },
      bestGateByWeightedPairwise: rolling.bestGateByWeightedPairwise ?? null
    },
    decision: decision?.decision ?? null
  },
  notes: [
    'V4 remains the default live model.',
    'V5.7 should be exposed as an optional experimental scoring mode.',
    'Use the V5.7 delta column to audit player movement before making it default.',
    'Correction should be capped at +/-15 percentile points.'
  ],
  generatedAt: new Date().toISOString()
};

fs.mkdirSync('public/data/model', { recursive: true });
fs.writeFileSync('public/data/model/active_model_v57.json', JSON.stringify(activeModel, null, 2));

console.log(JSON.stringify({
  wrote: 'public/data/model/active_model_v57.json',
  version: activeModel.version,
  selectedPolicy: activeModel.policy.name,
  maxCorrection: activeModel.policy.maxCorrection,
  correctionModel: correctionModel.label,
  status: activeModel.status
}, null, 2));
