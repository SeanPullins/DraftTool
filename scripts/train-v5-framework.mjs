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

function buildRows() {
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

  let skipped = 0;

  for (const r of draftRows) {
    const year = num(pick(r, ['season', 'draft_year', 'year']));
    const name = pick(r, ['pfr_player_name', 'player_name', 'name']);
    const rawPos = String(pick(r, ['position', 'pos'])).toUpperCase();
    const pos = normPos(rawPos);
    const g = group(pos);
    const pickNo = num(pick(r, ['pick', 'overall_pick', 'draft_pick']));
    const av = num(pick(r, ['w_av', 'weighted_av', 'career_av', 'car_av', 'av', 'dr_av']));

    if (['K', 'P', 'LS', 'KR'].includes(pos) || g === 'OTHER') {
      skipped++;
      continue;
    }

    if (!year || !name || !pos || !pickNo || av == null) continue;
    if (year < 2000 || year > 2021 || pickNo > 260) continue;

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
      skippedSpecialOrOther: skipped,
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
      n: scored.length,
      pffProfileMatches: scored.filter((row) => row.pff).length,
      pffSeasonMatches: scored.filter((row) => row.seasonPffScore != null).length,
      mae: mae(scored),
      rmse: rmse(scored),
      spearman: spearman(scored),
    },
  };
}

function evaluateModel(model, rows) {
  const scored = rows.map((row) => {
    const features = makeFeatures(row);
    return {
      ...row,
      features,
      predAv: predictAv(model, features),
    };
  });

  return {
    n: scored.length,
    pffProfileMatches: scored.filter((row) => row.pff).length,
    pffSeasonMatches: scored.filter((row) => row.seasonPffScore != null).length,
    mae: mae(scored),
    rmse: rmse(scored),
    spearman: spearman(scored),
  };
}

function walkForward(rows) {
  const years = [...new Set(rows.map((row) => row.year))]
    .sort((a, b) => a - b)
    .filter((year) => year >= 2014 && year <= 2021);

  const results = [];

  for (const testYear of years) {
    const train = rows.filter((row) => row.year < testYear);
    const test = rows.filter((row) => row.year === testYear);

    if (train.length < 500 || test.length < 50) continue;

    const { model } = trainModel(train, `walk-forward-through-${testYear - 1}`);

    results.push({
      testYear,
      trainN: train.length,
      testN: test.length,
      ...evaluateModel(model, test),
    });
  }

  return results;
}

const { rows, meta } = buildRows();

const global = trainModel(rows, 'GLOBAL');

const byGroup = {};
const models = {
  GLOBAL: global.model,
};

for (const g of ['QB', 'SKILL', 'OL', 'FRONT', 'DB']) {
  const groupRows = rows.filter((row) => row.group === g);

  if (groupRows.length >= 150) {
    const trained = trainModel(groupRows, g);
    byGroup[g] = trained.report;
    models[g] = trained.model;
  } else {
    byGroup[g] = {
      n: groupRows.length,
      skipped: true,
    };
  }
}

const walkForwardResults = walkForward(rows);

const report = {
  trainedAt: new Date().toISOString(),
  modelVersion: 'V5-framework',
  status: 'framework-ready',
  meta,
  global: global.report,
  byGroup,
  currentTrainingByGroup: summarizeByGroup(global.scored),
  walkForward: {
    years: walkForwardResults,
    avgMae: mean(walkForwardResults.map((row) => row.mae)),
    avgRmse: mean(walkForwardResults.map((row) => row.rmse)),
    avgSpearman: mean(walkForwardResults.map((row) => row.spearman)),
  },
  models,
};

fs.mkdirSync('public/data/model', { recursive: true });
fs.writeFileSync('public/data/model/v5_framework_report.json', JSON.stringify(report, null, 2));
fs.writeFileSync('public/data/model/v5_models.json', JSON.stringify(models, null, 2));

console.log(
  JSON.stringify(
    {
      modelVersion: report.modelVersion,
      status: report.status,
      meta: report.meta,
      global: report.global,
      byGroup: report.byGroup,
      currentTrainingByGroup: report.currentTrainingByGroup,
      walkForward: report.walkForward,
    },
    null,
    2
  )
);
