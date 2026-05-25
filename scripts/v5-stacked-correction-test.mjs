import fs from 'fs';
import {
  clean,
  parseCsv,
  pick,
  num,
  mean,
  std,
  clamp,
  normPos,
  group,
  draftScore,
  ageScore,
  loadPffPayload,
  normalizePffProfiles,
  loadPffSeasonStore,
  weightedSeasonScore,
  ridgeFit,
  mae,
  rmse,
  spearman,
  predictAv,
  summarizeByGroup
} from './modeling/model-lib.mjs';

const baseFeatureNames = [
  'v4Score',
  'draftScore',
  'logPick',
  'pffComp',
  'pffGrade',
  'pffProd',
  'pffEff',
  'pffClean',
  'hasPffProfile',
  'seasonPffScore',
  'hasSeasonPff',
  'ageScore',
  'athletic',
  'size',
  'isQB',
  'isSkill',
  'isOL',
  'isFront',
  'isDB',

  // Correction interactions
  'v4_x_qb',
  'v4_x_skill',
  'v4_x_ol',
  'v4_x_front',
  'v4_x_db',
  'pff_x_hasSeason',
  'age_x_qb',
  'athletic_x_skill',
  'size_x_ol'
];

function buildRows({ maxYear = 2023 } = {}) {
  const draftRows = parseCsv(fs.readFileSync('public/data/draft_picks.csv', 'utf8'));
  const combineRows = parseCsv(fs.readFileSync('public/data/combine.csv', 'utf8'));

  const combineMap = new Map();

  for (const r of combineRows) {
    const year = num(pick(r, ['season', 'draft_year', 'year']));
    const name = pick(r, ['player_name', 'pfr_player_name', 'name']);
    const pos = normPos(pick(r, ['pos', 'position']));

    if (year && name) {
      combineMap.set(`${clean(name)}|${year}|${pos}`, r);
      combineMap.set(`${clean(name)}|${year}`, r);
    }
  }

  const pffPayload = loadPffPayload();
  const pffProfiles = normalizePffProfiles(pffPayload?.profiles ?? []);
  const pffMap = new Map();

  for (const p of pffProfiles) {
    pffMap.set(`${clean(p.name)}|${p.draftSeason}|${group(p.position)}`, p);
    pffMap.set(`${clean(p.name)}|${p.draftSeason}|${p.position}`, p);
  }

  const pffSeasonStore = loadPffSeasonStore();
  const rows = [];

  for (const r of draftRows) {
    const year = num(pick(r, ['season', 'draft_year', 'year']));
    const name = pick(r, ['pfr_player_name', 'player_name', 'name']);
    const rawPos = String(pick(r, ['position', 'pos'])).toUpperCase();
    const pos = normPos(rawPos);
    const g = group(pos);
    const pickNo = num(pick(r, ['pick', 'overall_pick', 'draft_pick']));
    const av = num(pick(r, ['w_av', 'weighted_av', 'career_av', 'car_av', 'av', 'dr_av']));

    if (['K', 'P', 'LS', 'KR'].includes(pos) || g === 'OTHER') continue;
    if (!year || !name || !pos || !pickNo || av == null) continue;
    if (year < 2000 || year > maxYear || pickNo > 260) continue;

    const c =
      combineMap.get(`${clean(name)}|${year}|${pos}`) ??
      combineMap.get(`${clean(name)}|${year}`);

    const pff =
      pffMap.get(`${clean(name)}|${year}|${g}`) ??
      pffMap.get(`${clean(name)}|${year}|${pos}`) ??
      null;

    const weightedAv = num(pick(r, ['w_av'])) ?? av;
    const careerAv = num(pick(r, ['car_av'])) ?? av;
    const draftApproxAv = num(pick(r, ['dr_av'])) ?? 0;
    const games = num(pick(r, ['games'])) ?? 0;
    const seasonsStarted = num(pick(r, ['seasons_started'])) ?? 0;
    const proBowls = num(pick(r, ['probowls'])) ?? 0;
    const allPro = num(pick(r, ['allpro'])) ?? 0;

    const row = {
      id: `${clean(name)}-${year}-${pickNo}`,
      name,
      year,
      rawPos,
      pos,
      group: g,
      pick: pickNo,
      av,
      weightedAv,
      careerAv,
      draftApproxAv,
      games,
      seasonsStarted,
      proBowls,
      allPro,
      age: num(pick(r, ['age'])),
      height: num(pick(c ?? r, ['height', 'ht', 'inch_height'])),
      weight: num(pick(c ?? r, ['weight', 'wt'])),
      forty: num(pick(c ?? r, ['forty', 'forty_yd', 'forty_yard'])),
      vertical: num(pick(c ?? r, ['vertical', 'vertical_jump'])),
      broad: num(pick(c ?? r, ['broad', 'broad_jump'])),
      cone: num(pick(c ?? r, ['cone', 'three_cone'])),
      shuttle: num(pick(c ?? r, ['shuttle', 'short_shuttle'])),
      bench: num(pick(c ?? r, ['bench', 'bench_press'])),
      pff,
    };

    row.seasonPffScore = weightedSeasonScore(row, pffSeasonStore);

    row.actualOutcome =
      weightedAv +
      Math.min(seasonsStarted, 8) * 1.25 +
      proBowls * 8 +
      allPro * 12;

    rows.push(row);
  }

  return {
    rows,
    meta: {
      maxYear,
      pffProfilesLoaded: pffProfiles.length,
      pffProfileMatches: rows.filter((r) => r.pff).length,
      pffSeasonFilesLoaded: Object.keys(pffSeasonStore),
      pffSeasonMatches: rows.filter((r) => r.seasonPffScore != null).length,
    },
  };
}

function makeFeatures(player) {
  const heightScore = player.height
    ? clamp(50 + ((player.height - 73) / 3) * 10)
    : 50;

  const weightScore = player.weight
    ? clamp(50 + ((player.weight - 220) / 35) * 10)
    : 50;

  const athleticVals = [];

  if (player.forty) athleticVals.push(clamp(50 + ((4.7 - player.forty) / 0.22) * 15));
  if (player.vertical) athleticVals.push(clamp(50 + ((player.vertical - 32) / 5) * 12));
  if (player.broad) athleticVals.push(clamp(50 + ((player.broad - 115) / 10) * 12));
  if (player.cone) athleticVals.push(clamp(50 + ((7.1 - player.cone) / 0.3) * 10));
  if (player.shuttle) athleticVals.push(clamp(50 + ((4.35 - player.shuttle) / 0.22) * 10));

  const base = {
    draftScore: draftScore(player.pick),
    logPick: Math.log(clamp(player.pick, 1, 260)),
    pffComp: player.pff?.pff?.composite ?? 50,
    pffGrade: player.pff?.pff?.grade ?? player.pff?.pff?.composite ?? 50,
    pffProd: player.pff?.pff?.production ?? 50,
    pffEff: player.pff?.pff?.efficiency ?? 50,
    pffClean: player.pff?.pff?.clean ?? 50,
    hasPffProfile: player.pff ? 1 : 0,
    seasonPffScore: player.seasonPffScore ?? 50,
    hasSeasonPff: player.seasonPffScore != null ? 1 : 0,
    ageScore: ageScore(player.age, player.pos),
    athletic: athleticVals.length ? mean(athleticVals) : 50,
    size: (heightScore + weightScore) / 2,
    isQB: player.group === 'QB' ? 1 : 0,
    isSkill: player.group === 'SKILL' ? 1 : 0,
    isOL: player.group === 'OL' ? 1 : 0,
    isFront: player.group === 'FRONT' ? 1 : 0,
    isDB: player.group === 'DB' ? 1 : 0,
  };

  return base;
}

function extractV4Model() {
  const text = fs.readFileSync('src/model.ts', 'utf8');
  const start = text.indexOf('export const calibratedAvModel');

  if (start === -1) {
    throw new Error('Could not find calibratedAvModel in src/model.ts');
  }

  const open = text.indexOf('= {', start) + 2;
  let depth = 0;
  let end = -1;

  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  const raw = text
    .slice(open, end)
    .replace(/([,{]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
    .replace(/'/g, '"')
    .replace(/,\s*([}\]])/g, '$1');

  return JSON.parse(raw);
}

function addClassPercentileTargets(rows) {
  const byYear = new Map();

  for (const row of rows) {
    if (!byYear.has(row.year)) byYear.set(row.year, []);
    byYear.get(row.year).push(row);
  }

  for (const [, classRows] of byYear.entries()) {
    const sorted = [...classRows].sort((a, b) => a.actualOutcome - b.actualOutcome);

    sorted.forEach((row, index) => {
      row.classOutcomePercentile =
        sorted.length <= 1 ? 50 : (index / (sorted.length - 1)) * 100;
    });
  }

  return rows;
}

function scoreV4(rows, model) {
  return addClassPercentileTargets(rows.map((row) => ({ ...row }))).map((row) => {
    const features = makeFeatures(row);
    return {
      ...row,
      baseFeatures: features,
      v4Score: predictAv(model, features),
    };
  });
}

function addV4Percentile(rows) {
  const byYear = new Map();

  for (const row of rows) {
    if (!byYear.has(row.year)) byYear.set(row.year, []);
    byYear.get(row.year).push(row);
  }

  for (const [, classRows] of byYear.entries()) {
    const sorted = [...classRows].sort((a, b) => a.v4Score - b.v4Score);

    sorted.forEach((row, index) => {
      row.v4Percentile =
        sorted.length <= 1 ? 50 : (index / (sorted.length - 1)) * 100;
      row.correctionTarget = row.classOutcomePercentile - row.v4Percentile;
    });
  }

  return rows;
}

function makeStackFeatures(row) {
  const f = row.baseFeatures ?? makeFeatures(row);

  return {
    v4Score: row.v4Percentile ?? row.v4Score ?? 50,
    draftScore: f.draftScore,
    logPick: f.logPick,
    pffComp: f.pffComp,
    pffGrade: f.pffGrade,
    pffProd: f.pffProd,
    pffEff: f.pffEff,
    pffClean: f.pffClean,
    hasPffProfile: f.hasPffProfile,
    seasonPffScore: f.seasonPffScore,
    hasSeasonPff: f.hasSeasonPff,
    ageScore: f.ageScore,
    athletic: f.athletic,
    size: f.size,
    isQB: f.isQB,
    isSkill: f.isSkill,
    isOL: f.isOL,
    isFront: f.isFront,
    isDB: f.isDB,

    v4_x_qb: (row.v4Percentile ?? row.v4Score ?? 50) * f.isQB,
    v4_x_skill: (row.v4Percentile ?? row.v4Score ?? 50) * f.isSkill,
    v4_x_ol: (row.v4Percentile ?? row.v4Score ?? 50) * f.isOL,
    v4_x_front: (row.v4Percentile ?? row.v4Score ?? 50) * f.isFront,
    v4_x_db: (row.v4Percentile ?? row.v4Score ?? 50) * f.isDB,
    pff_x_hasSeason: f.seasonPffScore * f.hasSeasonPff,
    age_x_qb: f.ageScore * f.isQB,
    athletic_x_skill: f.athletic * f.isSkill,
    size_x_ol: f.size * f.isOL,
  };
}

function trainCorrectionModel(rows, label, lambda = 8.0) {
  const trainingRows = rows.map((row) => ({
    ...row,
    stackFeatures: makeStackFeatures(row),
    target: row.correctionTarget,
  }));

  const stats = {};

  for (const feature of baseFeatureNames) {
    const values = trainingRows.map((row) => row.stackFeatures[feature]);
    stats[feature] = { mean: mean(values), sd: std(values) };
  }

  const X = trainingRows.map((row) => [
    1,
    ...baseFeatureNames.map((feature) => {
      return (row.stackFeatures[feature] - stats[feature].mean) / stats[feature].sd;
    }),
  ]);

  const y = trainingRows.map((row) => row.target);
  const beta = ridgeFit(X, y, lambda);
  const intercept = beta[0];
  const coefs = beta.slice(1);

  return {
    label,
    target: 'actual_class_percentile_minus_v4_percentile',
    type: 'ridge_stacked_correction',
    intercept,
    features: baseFeatureNames.map((name, i) => ({
      name,
      coef: coefs[i],
      mean: stats[name].mean,
      sd: stats[name].sd,
    })),
  };
}

function predictCorrection(model, stackFeatures) {
  let value = model.intercept;

  for (const feature of model.features) {
    const raw = stackFeatures[feature.name] ?? 50;
    value += feature.coef * ((raw - feature.mean) / feature.sd);
  }

  return clamp(value, -35, 35);
}

function applyStackModel(rows, model) {
  return rows.map((row) => {
    const stackFeatures = makeStackFeatures(row);
    const correction = predictCorrection(model, stackFeatures);
    const stackedScore = clamp((row.v4Percentile ?? 50) + correction, 0, 100);

    return {
      ...row,
      correction,
      predRankScore: stackedScore,
    };
  });
}

function evaluate(rows, key = 'predRankScore') {
  const converted = rows.map((row) => ({
    ...row,
    av: row.classOutcomePercentile,
    predAv: row[key],
  }));

  return {
    n: converted.length,
    mae: mae(converted),
    rmse: rmse(converted),
    spearman: spearman(converted),
    pairwise: pairwiseAccuracy(converted, key),
    pairwiseByGroup: pairwiseByGroup(converted, key),
    top50: topNReport(converted, 50, key),
    top100: topNReport(converted, 100, key),
    byGroup: summarizeByGroup(converted),
  };
}

function pairwiseAccuracy(rows, key = 'predRankScore', minOutcomeGap = 5) {
  const byYear = new Map();

  for (const row of rows) {
    if (!byYear.has(row.year)) byYear.set(row.year, []);
    byYear.get(row.year).push(row);
  }

  let total = 0;
  let correct = 0;
  let weightedTotal = 0;
  let weightedCorrect = 0;

  for (const [, classRows] of byYear.entries()) {
    for (let i = 0; i < classRows.length; i++) {
      for (let j = i + 1; j < classRows.length; j++) {
        const a = classRows[i];
        const b = classRows[j];

        const actualGap = a.actualOutcome - b.actualOutcome;
        if (Math.abs(actualGap) < minOutcomeGap) continue;

        const predGap = a[key] - b[key];
        if (predGap === 0) continue;

        const isCorrect = Math.sign(actualGap) === Math.sign(predGap);
        const weight = Math.min(30, Math.abs(actualGap));

        total++;
        weightedTotal += weight;

        if (isCorrect) {
          correct++;
          weightedCorrect += weight;
        }
      }
    }
  }

  return {
    pairs: total,
    accuracy: total ? correct / total : 0,
    weightedAccuracy: weightedTotal ? weightedCorrect / weightedTotal : 0,
  };
}

function pairwiseByGroup(rows, key = 'predRankScore') {
  const result = {};

  for (const g of ['QB', 'SKILL', 'OL', 'FRONT', 'DB']) {
    const groupRows = rows.filter((row) => row.group === g);
    result[g] = pairwiseAccuracy(groupRows, key, 5);
  }

  return result;
}

function topNReport(rows, n, key = 'predRankScore') {
  const top = [...rows].sort((a, b) => b[key] - a[key]).slice(0, n);

  return {
    n,
    avgActualOutcome: mean(top.map((row) => row.actualOutcome)),
    avgWeightedAv: mean(top.map((row) => row.weightedAv)),
    avgPick: mean(top.map((row) => row.pick)),
    starters: top.filter((row) => row.seasonsStarted >= 2 || row.weightedAv >= 20).length,
    stars: top.filter((row) => row.proBowls > 0 || row.allPro > 0 || row.weightedAv >= 40).length,
    busts: top.filter((row) => row.pick <= 100 && row.weightedAv <= 12 && row.seasonsStarted < 1).length,
  };
}

function prepareRowsForStacking(rows, v4Model) {
  return addV4Percentile(scoreV4(rows, v4Model));
}

function holdoutTest(rows, trainStart, trainEnd, testStart, testEnd, label) {
  const v4Model = extractV4Model();

  const trainRows = prepareRowsForStacking(
    rows.filter((row) => row.year >= trainStart && row.year <= trainEnd),
    v4Model
  );

  const testRows = prepareRowsForStacking(
    rows.filter((row) => row.year >= testStart && row.year <= testEnd),
    v4Model
  );

  const correctionModel = trainCorrectionModel(trainRows, label);
  const stacked = applyStackModel(testRows, correctionModel);

  const v4Only = testRows.map((row) => ({
    ...row,
    predRankScore: row.v4Percentile,
  }));

  return {
    label,
    trainStart,
    trainEnd,
    testStart,
    testEnd,
    trainN: trainRows.length,
    testN: testRows.length,
    stacked: evaluate(stacked),
    v4: evaluate(v4Only),
    model: correctionModel,
  };
}

function rollingModern(rows) {
  const years = [2018, 2019, 2020, 2021, 2022, 2023];
  const results = [];

  for (const testYear of years) {
    const testRowsRaw = rows.filter((row) => row.year === testYear);
    const trainRowsRaw = rows.filter((row) => row.year >= 2014 && row.year < testYear);

    if (trainRowsRaw.length < 400 || testRowsRaw.length < 50) continue;

    const result = holdoutTest(
      rows,
      2014,
      testYear - 1,
      testYear,
      testYear,
      `V5_6_STACKED_CORRECTION_train_2014_${testYear - 1}_test_${testYear}`
    );

    results.push({
      testYear,
      trainN: trainRowsRaw.length,
      testN: testRowsRaw.length,
      stacked: result.stacked,
      v4: result.v4,
    });
  }

  return {
    years: results,
    stackedAvgPairwiseAccuracy: mean(results.map((row) => row.stacked.pairwise.accuracy)),
    v4AvgPairwiseAccuracy: mean(results.map((row) => row.v4.pairwise.accuracy)),
    stackedAvgWeightedPairwiseAccuracy: mean(results.map((row) => row.stacked.pairwise.weightedAccuracy)),
    v4AvgWeightedPairwiseAccuracy: mean(results.map((row) => row.v4.pairwise.weightedAccuracy)),
    stackedAvgSpearman: mean(results.map((row) => row.stacked.spearman)),
    v4AvgSpearman: mean(results.map((row) => row.v4.spearman)),
  };
}

const { rows, meta } = buildRows({ maxYear: 2023 });
const v4Model = extractV4Model();

const matureRows = rows.filter((row) => row.year <= 2021);
const stackedMatureTrain = prepareRowsForStacking(matureRows, v4Model);
const correctionModelMature = trainCorrectionModel(stackedMatureTrain, 'V5_6_STACKED_CORRECTION_2000_2021');
const stackedMature = applyStackModel(stackedMatureTrain, correctionModelMature);
const v4Mature = stackedMatureTrain.map((row) => ({ ...row, predRankScore: row.v4Percentile }));

const holdout_2018_2021 = holdoutTest(
  rows,
  2000,
  2017,
  2018,
  2021,
  'V5_6_HOLDOUT_train_2000_2017_test_2018_2021'
);

const modernHoldout_2018_2021 = holdoutTest(
  rows,
  2014,
  2017,
  2018,
  2021,
  'V5_6_MODERN_HOLDOUT_train_2014_2017_test_2018_2021'
);

const rolling = rollingModern(rows);

const report = {
  generatedAt: new Date().toISOString(),
  modelVersion: 'V5.6-stacked-correction-test',
  status: 'experimental',
  meta,
  samples: {
    allRowsThrough2023: rows.length,
    matureThrough2021: matureRows.length,
  },
  sameSample: {
    stacked: evaluate(stackedMature),
    v4: evaluate(v4Mature),
  },
  holdout_2018_2021: {
    stacked: holdout_2018_2021.stacked,
    v4: holdout_2018_2021.v4,
  },
  modernHoldout_2018_2021: {
    stacked: modernHoldout_2018_2021.stacked,
    v4: modernHoldout_2018_2021.v4,
  },
  rollingModern: rolling,
  models: {
    matureCorrection: correctionModelMature,
    holdoutCorrection: holdout_2018_2021.model,
    modernHoldoutCorrection: modernHoldout_2018_2021.model,
  },
};

fs.mkdirSync('public/data/model', { recursive: true });
fs.writeFileSync('public/data/model/v5_stacked_correction_report.json', JSON.stringify(report, null, 2));
fs.writeFileSync('public/data/model/v5_stacked_correction_models.json', JSON.stringify(report.models, null, 2));

console.log(
  JSON.stringify(
    {
      modelVersion: report.modelVersion,
      meta: report.meta,
      samples: report.samples,
      sameSample: {
        stacked: {
          spearman: report.sameSample.stacked.spearman,
          pairwise: report.sameSample.stacked.pairwise,
          top50: report.sameSample.stacked.top50,
          top100: report.sameSample.stacked.top100,
        },
        v4: {
          spearman: report.sameSample.v4.spearman,
          pairwise: report.sameSample.v4.pairwise,
          top50: report.sameSample.v4.top50,
          top100: report.sameSample.v4.top100,
        },
      },
      holdout_2018_2021: {
        stacked: report.holdout_2018_2021.stacked,
        v4: report.holdout_2018_2021.v4,
      },
      modernHoldout_2018_2021: {
        stacked: report.modernHoldout_2018_2021.stacked,
        v4: report.modernHoldout_2018_2021.v4,
      },
      rollingModern: report.rollingModern,
    },
    null,
    2
  )
);