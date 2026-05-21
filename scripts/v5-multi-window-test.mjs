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

const featureNames = [
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

    const row = {
      id: `${clean(name)}-${year}-${pickNo}`,
      name,
      year,
      rawPos,
      pos,
      group: g,
      pick: pickNo,
      av,
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

  return {
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
}

function trainModel(rows, label, lambda = 3.5) {
  const trainingRows = rows.map((row) => ({
    ...row,
    features: makeFeatures(row),
    target: Math.log1p(Math.max(0, row.av)),
  }));

  const stats = {};

  for (const feature of featureNames) {
    const values = trainingRows.map((row) => row.features[feature]);
    stats[feature] = {
      mean: mean(values),
      sd: std(values),
    };
  }

  const X = trainingRows.map((row) => [
    1,
    ...featureNames.map((feature) => {
      return (row.features[feature] - stats[feature].mean) / stats[feature].sd;
    }),
  ]);

  const y = trainingRows.map((row) => row.target);
  const beta = ridgeFit(X, y, lambda);
  const intercept = beta[0];
  const coefs = beta.slice(1);

  const model = {
    label,
    intercept,
    features: featureNames.map((name, i) => ({
      name,
      coef: coefs[i],
      mean: stats[name].mean,
      sd: stats[name].sd,
    })),
  };

  const scored = trainingRows.map((row) => ({
    ...row,
    predAv: predictAv(model, row.features),
  }));

  return {
    model,
    scored,
    report: {
      label,
      n: scored.length,
      pffProfileMatches: scored.filter((row) => row.pff).length,
      pffSeasonMatches: scored.filter((row) => row.seasonPffScore != null).length,
      mae: mae(scored),
      rmse: rmse(scored),
      spearman: spearman(scored),
      byGroup: summarizeByGroup(scored),
    },
  };
}

function evaluateModel(model, rows, key = 'predAv') {
  const scored = rows.map((row) => {
    const features = makeFeatures(row);
    return {
      ...row,
      features,
      [key]: predictAv(model, features),
    };
  });

  return {
    n: scored.length,
    pffProfileMatches: scored.filter((row) => row.pff).length,
    pffSeasonMatches: scored.filter((row) => row.seasonPffScore != null).length,
    mae: mae(scored, key),
    rmse: rmse(scored, key),
    spearman: spearman(scored, key),
    byGroup: summarizeByGroup(scored, key),
    scored,
  };
}

function blendModels(modelA, modelB, rows, weightB) {
  const scored = rows.map((row) => {
    const features = makeFeatures(row);
    const a = predictAv(modelA, features);
    const b = predictAv(modelB, features);

    return {
      ...row,
      features,
      predAv: a * (1 - weightB) + b * weightB,
    };
  });

  return {
    weightB,
    n: scored.length,
    mae: mae(scored),
    rmse: rmse(scored),
    spearman: spearman(scored),
    byGroup: summarizeByGroup(scored),
  };
}

function blendSearch(modelA, modelB, rows, labelA, labelB) {
  const results = [];

  for (let w = 0; w <= 1.0001; w += 0.05) {
    const weightB = Math.round(w * 100) / 100;
    results.push({
      labelA,
      labelB,
      weightA: Math.round((1 - weightB) * 100) / 100,
      weightB,
      ...blendModels(modelA, modelB, rows, weightB),
    });
  }

  const bestBySpearman = [...results].sort((a, b) => {
    const rank = b.spearman - a.spearman;
    if (Math.abs(rank) > 0.000001) return rank;
    return a.mae - b.mae;
  })[0];

  const bestByMae = [...results].sort((a, b) => a.mae - b.mae)[0];

  return {
    labelA,
    labelB,
    bestBySpearman,
    bestByMae,
    allWeights: results,
  };
}

function trainWindow(allRows, startYear, endYear, label) {
  const trainRows = allRows.filter((row) => row.year >= startYear && row.year <= endYear);
  return trainModel(trainRows, label);
}

function testWindow({ rows, trainStart, trainEnd, testStart, testEnd, label }) {
  const trainRows = rows.filter((row) => row.year >= trainStart && row.year <= trainEnd);
  const testRows = rows.filter((row) => row.year >= testStart && row.year <= testEnd);

  const trained = trainModel(trainRows, label);
  const evaluated = evaluateModel(trained.model, testRows);

  return {
    label,
    trainStart,
    trainEnd,
    testStart,
    testEnd,
    trainN: trainRows.length,
    testN: testRows.length,
    train: trained.report,
    test: {
      n: evaluated.n,
      pffProfileMatches: evaluated.pffProfileMatches,
      pffSeasonMatches: evaluated.pffSeasonMatches,
      mae: evaluated.mae,
      rmse: evaluated.rmse,
      spearman: evaluated.spearman,
      byGroup: evaluated.byGroup,
    },
  };
}

function rollingModernValidation(rows) {
  const results = [];

  for (const testYear of [2018, 2019, 2020, 2021, 2022, 2023]) {
    const trainRows = rows.filter((row) => row.year >= 2014 && row.year < testYear);
    const testRows = rows.filter((row) => row.year === testYear);

    if (trainRows.length < 400 || testRows.length < 50) continue;

    const trained = trainModel(trainRows, `modern-through-${testYear - 1}`);
    const evaluated = evaluateModel(trained.model, testRows);

    results.push({
      testYear,
      trainN: trainRows.length,
      testN: testRows.length,
      mae: evaluated.mae,
      rmse: evaluated.rmse,
      spearman: evaluated.spearman,
      byGroup: evaluated.byGroup,
    });
  }

  return {
    years: results,
    avgMae: mean(results.map((row) => row.mae)),
    avgRmse: mean(results.map((row) => row.rmse)),
    avgSpearman: mean(results.map((row) => row.spearman)),
  };
}

const { rows, meta } = buildRows({ maxYear: 2023 });

const rowsMature = rows.filter((row) => row.year <= 2021);
const rowsModernMature = rows.filter((row) => row.year >= 2014 && row.year <= 2021);
const rowsRecent = rows.filter((row) => row.year >= 2014 && row.year <= 2023);

const longHistory = trainModel(rowsMature, 'LONG_HISTORY_2000_2021');
const modernMature = trainModel(rowsModernMature, 'MODERN_MATURE_2014_2021');
const recentWindow = trainModel(rowsRecent, 'RECENT_WINDOW_2014_2023');

const holdout_2018_2021 = {
  longHistory: testWindow({
    rows,
    trainStart: 2000,
    trainEnd: 2017,
    testStart: 2018,
    testEnd: 2021,
    label: 'LONG_HISTORY_train_2000_2017_test_2018_2021',
  }),
  modern: testWindow({
    rows,
    trainStart: 2014,
    trainEnd: 2017,
    testStart: 2018,
    testEnd: 2021,
    label: 'MODERN_train_2014_2017_test_2018_2021',
  }),
};

const hybridBlend = blendSearch(
  longHistory.model,
  modernMature.model,
  rowsMature,
  'LONG_HISTORY_2000_2021',
  'MODERN_MATURE_2014_2021'
);

const recentVsLongBlend = blendSearch(
  longHistory.model,
  recentWindow.model,
  rowsRecent,
  'LONG_HISTORY_2000_2021',
  'RECENT_WINDOW_2014_2023'
);

const rollingModern = rollingModernValidation(rows);

const report = {
  generatedAt: new Date().toISOString(),
  modelVersion: 'V5.3-multi-window-test',
  meta,
  samples: {
    allRowsThrough2023: rows.length,
    matureThrough2021: rowsMature.length,
    modernMature2014_2021: rowsModernMature.length,
    recent2014_2023: rowsRecent.length,
  },
  longHistory: longHistory.report,
  modernMature: modernMature.report,
  recentWindow: recentWindow.report,
  holdout_2018_2021,
  hybridBlend,
  recentVsLongBlend,
  rollingModern,
  models: {
    LONG_HISTORY_2000_2021: longHistory.model,
    MODERN_MATURE_2014_2021: modernMature.model,
    RECENT_WINDOW_2014_2023: recentWindow.model,
  },
};

fs.mkdirSync('public/data/model', { recursive: true });
fs.writeFileSync('public/data/model/v5_multi_window_report.json', JSON.stringify(report, null, 2));
fs.writeFileSync('public/data/model/v5_multi_window_models.json', JSON.stringify(report.models, null, 2));

console.log(
  JSON.stringify(
    {
      modelVersion: report.modelVersion,
      meta: report.meta,
      samples: report.samples,
      longHistory: {
        mae: report.longHistory.mae,
        rmse: report.longHistory.rmse,
        spearman: report.longHistory.spearman,
      },
      modernMature: {
        mae: report.modernMature.mae,
        rmse: report.modernMature.rmse,
        spearman: report.modernMature.spearman,
      },
      recentWindow: {
        mae: report.recentWindow.mae,
        rmse: report.recentWindow.rmse,
        spearman: report.recentWindow.spearman,
      },
      holdout_2018_2021: {
        longHistory: report.holdout_2018_2021.longHistory.test,
        modern: report.holdout_2018_2021.modern.test,
      },
      hybridBlend: {
        bestBySpearman: report.hybridBlend.bestBySpearman,
        bestByMae: report.hybridBlend.bestByMae,
      },
      recentVsLongBlend: {
        bestBySpearman: report.recentVsLongBlend.bestBySpearman,
        bestByMae: report.recentVsLongBlend.bestByMae,
      },
      rollingModern: report.rollingModern,
    },
    null,
    2
  )
);