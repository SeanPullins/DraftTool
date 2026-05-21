import fs from 'fs';

function readJson(path, fallback = null) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function pct(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return ((a - b) / b) * 100;
}

function verdict({ v4, candidate, label }) {
  const maeDelta = candidate.mae - v4.mae;
  const rmseDelta = candidate.rmse - v4.rmse;
  const spearmanDelta = candidate.spearman - v4.spearman;

  const betterMae = maeDelta <= 0;
  const betterRmse = rmseDelta <= 0;
  const betterRank = spearmanDelta > 0;

  let decision = 'HOLD';
  let reason = '';

  if (betterMae && betterRmse && betterRank) {
    decision = 'PROMOTE';
    reason = 'Improves MAE, RMSE, and ranking correlation.';
  } else if (betterRank && maeDelta <= 0.25 && rmseDelta <= 0.25) {
    decision = 'PROMOTE_FOR_RANKING';
    reason = 'Improves ranking correlation with only tiny error regression.';
  } else if (betterRank) {
    decision = 'EXPERIMENTAL';
    reason = 'Improves ranking but worsens error too much for automatic promotion.';
  } else {
    decision = 'HOLD';
    reason = 'Does not improve ranking correlation enough.';
  }

  return {
    label,
    decision,
    reason,
    deltas: {
      mae: maeDelta,
      rmse: rmseDelta,
      spearman: spearmanDelta,
      maePct: pct(candidate.mae, v4.mae),
      rmsePct: pct(candidate.rmse, v4.rmse),
      spearmanPct: pct(candidate.spearman, v4.spearman),
    },
    v4,
    candidate,
  };
}

const v4Report = readJson('public/data/model/retrain_report_v4.json');
const v5Framework = readJson('public/data/model/v5_framework_report.json');
const qbWrReport = readJson('public/data/model/v5_qb_wr_test_report.json');

if (!v4Report) {
  throw new Error('Missing public/data/model/retrain_report_v4.json');
}

const v4 = v4Report.overall;

const comparisons = [];

if (v5Framework?.global) {
  comparisons.push(verdict({
    label: 'V5 framework global',
    v4,
    candidate: v5Framework.global,
  }));
}

if (qbWrReport?.globalAll) {
  comparisons.push(verdict({
    label: 'V5 global with QB/WR season context',
    v4,
    candidate: qbWrReport.globalAll,
  }));
}

const positionNotes = {};

if (qbWrReport?.qbOnly && v4Report?.byGroup?.QB) {
  positionNotes.QB = verdict({
    label: 'V5 QB-only vs V4 QB',
    v4: v4Report.byGroup.QB,
    candidate: qbWrReport.qbOnly,
  });
}

if (qbWrReport?.wrOnly && v4Report?.byGroup?.SKILL) {
  positionNotes.WR = verdict({
    label: 'V5 WR-only vs V4 SKILL',
    v4: v4Report.byGroup.SKILL,
    candidate: qbWrReport.wrOnly,
  });
}

function walkForwardHealth(scope) {
  if (!scope?.years?.length) return null;

  const years = scope.years;
  const negativeRankYears = years.filter((y) => y.spearman < 0.45);
  const strongYears = years.filter((y) => y.spearman >= 0.60);

  return {
    years: years.length,
    avgMae: scope.avgMae,
    avgRmse: scope.avgRmse,
    avgSpearman: scope.avgSpearman,
    negativeRankYears: negativeRankYears.map((y) => ({
      year: y.testYear,
      spearman: y.spearman,
      mae: y.mae,
    })),
    strongYears: strongYears.map((y) => ({
      year: y.testYear,
      spearman: y.spearman,
      mae: y.mae,
    })),
  };
}

const walkForward = {
  QB: walkForwardHealth(qbWrReport?.walkForward?.qb),
  WR: walkForwardHealth(qbWrReport?.walkForward?.wr),
  QB_WR: walkForwardHealth(qbWrReport?.walkForward?.qbWr),
  V5_FRAMEWORK: walkForwardHealth(v5Framework?.walkForward),
};

const recommendation = {
  liveModel: 'Keep V4 live for now',
  frameworkDirection: [
    'Promote QB submodel only after blended global+QB walk-forward test.',
    'Do not promote WR-only yet; add ablation and role/volume features first.',
    'Do not replace global V4 with V5 global until walk-forward beats V4 or error remains neutral.',
    'Next framework upgrade should add blend search: global model + position model.',
  ],
};

const report = {
  generatedAt: new Date().toISOString(),
  comparisons,
  positionNotes,
  walkForward,
  recommendation,
};

fs.mkdirSync('public/data/model', { recursive: true });
fs.writeFileSync('public/data/model/v5_decision_report.json', JSON.stringify(report, null, 2));

console.log(JSON.stringify(report, null, 2));
