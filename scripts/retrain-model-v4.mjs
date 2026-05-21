import fs from 'fs';
import zlib from 'zlib';

function clean(s = '') {
  return String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '"' && q && n === '"') { cell += '"'; i++; }
    else if (c === '"') q = !q;
    else if (c === ',' && !q) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !q) {
      if (c === '\r' && n === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift().map(h => h.trim());
  return rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

function pick(row, keys) {
  for (const k of keys) {
    if (row && row[k] != null && row[k] !== '') return row[k];
  }
  return '';
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace('%', '').trim());
  return Number.isFinite(n) ? n : null;
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function std(xs) {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map(x => (x - m) ** 2))) || 1;
}

function clamp(v, min = 0, max = 99) {
  return Math.max(min, Math.min(max, Number.isFinite(v) ? v : 50));
}

function normPos(pos = '') {
  const p = String(pos).toUpperCase().trim();

  if (p === 'QB') return 'QB';
  if (p === 'RB' || p === 'FB') return 'RB';
  if (p === 'WR') return 'WR';
  if (p === 'TE') return 'TE';

  if (['T', 'OT', 'G', 'OG', 'C', 'OL', 'IOL'].includes(p)) return 'OL';

  if (['DE', 'EDGE'].includes(p)) return 'EDGE';
  if (['DT', 'NT', 'DL', 'IDL'].includes(p)) return 'DL';
  if (['LB', 'OLB', 'ILB'].includes(p)) return 'LB';

  if (['DB', 'CB'].includes(p)) return 'CB';
  if (['S', 'SAF', 'FS', 'SS'].includes(p)) return 'S';

  return p;
}

function group(pos = '') {
  const p = normPos(pos);
  if (p === 'QB') return 'QB';
  if (['RB', 'WR', 'TE'].includes(p)) return 'SKILL';
  if (p === 'OL') return 'OL';
  if (['DL', 'EDGE', 'LB'].includes(p)) return 'FRONT';
  if (['CB', 'S'].includes(p)) return 'DB';
  return 'OTHER';
}

function draftScore(pickNo) {
  return clamp(100 - (Math.log(Math.max(1, pickNo)) / Math.log(260)) * 100, 1, 99);
}

function ageScore(age, pos) {
  const a = Number(age ?? 22);
  const p = normPos(pos);
  const g = group(pos);

  if (p === 'QB') return a <= 20.8 ? 92 : a <= 21.6 ? 82 : a <= 22.8 ? 70 : a <= 24.0 ? 56 : a <= 25.5 ? 44 : 32;
  if (p === 'RB') return a <= 20.3 ? 94 : a <= 21.0 ? 84 : a <= 21.8 ? 72 : a <= 22.6 ? 60 : a <= 23.5 ? 48 : 34;
  if (g === 'OL') return a <= 21.5 ? 84 : a <= 22.5 ? 74 : a <= 24.0 ? 64 : a <= 25.5 ? 54 : a <= 27.0 ? 44 : 36;
  if (g === 'FRONT') return a <= 21.0 ? 90 : a <= 22.0 ? 80 : a <= 23.0 ? 68 : a <= 24.0 ? 58 : a <= 25.0 ? 48 : 36;
  return a <= 20.8 ? 90 : a <= 21.6 ? 80 : a <= 22.5 ? 68 : a <= 23.5 ? 58 : a <= 24.5 ? 50 : 38;
}

function loadPffPayload() {
  if (fs.existsSync('public/data/pff_comparison_profiles.json')) {
    const raw = fs.readFileSync('public/data/pff_comparison_profiles.json', 'utf8');
    if (raw.trim().startsWith('{')) return JSON.parse(raw);
  }

  if (fs.existsSync('public/data/pff_comparison_profiles.json.gz.b64')) {
    const encoded = fs.readFileSync('public/data/pff_comparison_profiles.json.gz.b64', 'utf8').replace(/\s/g, '');
    const gz = Buffer.from(encoded, 'base64');
    const json = zlib.gunzipSync(gz).toString('utf8');
    return JSON.parse(json);
  }

  return null;
}

function normalizePffProfiles(profiles) {
  return profiles.map(profile => {
    if (!Array.isArray(profile)) {
      return {
        id: profile.id ?? `${clean(profile.name)}|${profile.draftSeason ?? profile.year}|${normPos(profile.position ?? profile.pos)}`,
        name: profile.name,
        college: profile.college ?? profile.school ?? '',
        position: normPos(profile.position ?? profile.pos),
        draftSeason: Number(profile.draftSeason ?? profile.year),
        pff: {
          composite: Number(profile.pff?.composite ?? profile.pffComposite ?? 50),
          grade: Number(profile.pff?.grade ?? profile.pffGrade ?? profile.pff?.composite ?? profile.pffComposite ?? 50),
          production: Number(profile.pff?.production ?? profile.pffProduction ?? 50),
          efficiency: Number(profile.pff?.efficiency ?? profile.pffEfficiency ?? 50),
          clean: Number(profile.pff?.clean ?? profile.pffClean ?? 50),
        },
        nfl: profile.nfl ?? null,
      };
    }

    const [name, college, rawPos, draftSeason, composite, grade, production, efficiency, cleanPlay, nfl] = profile;
    const position = normPos(rawPos);

    return {
      id: `${clean(name)}|${draftSeason}|${position}`,
      name,
      college,
      position,
      draftSeason: Number(draftSeason),
      pff: {
        composite: Number(composite ?? 50),
        grade: Number(grade ?? composite ?? 50),
        production: Number(production ?? 50),
        efficiency: Number(efficiency ?? 50),
        clean: Number(cleanPlay ?? 50),
      },
      nfl: nfl ? {
        draftPick: nfl[0],
        games: nfl[1],
        starts: nfl[2],
        snaps: nfl[3],
        awards: nfl[4],
        score: nfl[5],
        category: nfl[6],
        av: nfl[7] ?? nfl[5] * 0.82,
      } : null,
    };
  }).filter(p => p.name && p.position && p.draftSeason);
}

function ridgeFit(X, y, lambda = 3.0) {
  if (!X.length) throw new Error('No training rows generated.');
  const p = X[0].length;
  const A = Array.from({ length: p }, () => Array(p).fill(0));
  const b = Array(p).fill(0);

  for (let i = 0; i < X.length; i++) {
    for (let j = 0; j < p; j++) {
      b[j] += X[i][j] * y[i];
      for (let k = 0; k < p; k++) A[j][k] += X[i][j] * X[i][k];
    }
  }

  for (let j = 1; j < p; j++) A[j][j] += lambda;

  for (let i = 0; i < p; i++) {
    let max = i;
    for (let r = i + 1; r < p; r++) if (Math.abs(A[r][i]) > Math.abs(A[max][i])) max = r;
    [A[i], A[max]] = [A[max], A[i]];
    [b[i], b[max]] = [b[max], b[i]];

    const div = A[i][i] || 1e-12;
    for (let c = i; c < p; c++) A[i][c] /= div;
    b[i] /= div;

    for (let r = 0; r < p; r++) {
      if (r === i) continue;
      const f = A[r][i];
      for (let c = i; c < p; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }

  return b;
}

function mae(rows) {
  return mean(rows.map(r => Math.abs(r.predAv - r.av)));
}

function rmse(rows) {
  return Math.sqrt(mean(rows.map(r => (r.predAv - r.av) ** 2)));
}

function spearman(rows) {
  const rank = (arr, key) => {
    const m = new Map();
    [...arr].sort((a, b) => a[key] - b[key]).forEach((r, i) => m.set(r.id, i + 1));
    return m;
  };

  const rx = rank(rows, 'predAv');
  const ry = rank(rows, 'av');
  const xs = rows.map(r => rx.get(r.id));
  const ys = rows.map(r => ry.get(r.id));
  const mx = mean(xs);
  const my = mean(ys);
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const den = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0));
  return den ? num / den : 0;
}

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

const rows = [];
let skippedSpecialTeams = 0;

for (const r of draftRows) {
  const year = num(pick(r, ['season', 'draft_year', 'year']));
  const name = pick(r, ['pfr_player_name', 'player_name', 'name']);
  const rawPos = String(pick(r, ['position', 'pos'])).toUpperCase();
  const pos = normPos(rawPos);
  const g = group(pos);
  const pickNo = num(pick(r, ['pick', 'overall_pick', 'draft_pick']));
  const av = num(pick(r, ['w_av', 'weighted_av', 'career_av', 'car_av', 'av', 'dr_av']));

  if (['K', 'P', 'LS', 'KR'].includes(pos) || g === 'OTHER') {
    skippedSpecialTeams++;
    continue;
  }

  if (!year || !name || !pos || !pickNo || av == null) continue;
  if (year < 2000 || year > 2021 || pickNo > 260) continue;

  const c = combineMap.get(`${clean(name)}|${year}|${pos}`) ?? combineMap.get(`${clean(name)}|${year}`);
  const pff = pffMap.get(`${clean(name)}|${year}|${g}`) ?? pffMap.get(`${clean(name)}|${year}|${pos}`) ?? null;

  const height = num(pick(c ?? r, ['height', 'ht', 'inch_height']));
  const weight = num(pick(c ?? r, ['weight', 'wt']));
  const forty = num(pick(c ?? r, ['forty', 'forty_yd', 'forty_yard']));
  const vertical = num(pick(c ?? r, ['vertical', 'vertical_jump']));
  const broad = num(pick(c ?? r, ['broad', 'broad_jump']));
  const cone = num(pick(c ?? r, ['cone', 'three_cone']));
  const shuttle = num(pick(c ?? r, ['shuttle', 'short_shuttle']));
  const bench = num(pick(c ?? r, ['bench', 'bench_press']));
  const age = num(pick(r, ['age']));

  rows.push({
    id: `${clean(name)}-${year}-${pickNo}`,
    name,
    year,
    rawPos,
    pos,
    group: g,
    pick: pickNo,
    av,
    age,
    height,
    weight,
    forty,
    vertical,
    broad,
    cone,
    shuttle,
    bench,
    pff,
  });
}

console.log(`Training rows: ${rows.length}`);
console.log(`PFF profiles loaded: ${pffProfiles.length}`);
console.log(`Rows with PFF match: ${rows.filter(r => r.pff).length}`);
console.log(`Skipped special/other rows: ${skippedSpecialTeams}`);
console.log('By group:', rows.reduce((m, r) => ((m[r.group] = (m[r.group] ?? 0) + 1), m), {}));
console.log('By normalized pos:', rows.reduce((m, r) => ((m[r.pos] = (m[r.pos] ?? 0) + 1), m), {}));

if (!rows.length) throw new Error('No rows found.');

const featureNames = [
  'draftScore',
  'logPick',
  'pffComp',
  'pffGrade',
  'pffProd',
  'pffEff',
  'pffClean',
  'ageScore',
  'athletic',
  'size',
  'isQB',
  'isSkill',
  'isOL',
  'isFront',
  'isDB',
];

function makeFeatures(p) {
  const heightScore = p.height ? clamp(50 + ((p.height - 73) / 3) * 10) : 50;
  const weightScore = p.weight ? clamp(50 + ((p.weight - 220) / 35) * 10) : 50;
  const size = (heightScore + weightScore) / 2;

  const athleticVals = [];
  if (p.forty) athleticVals.push(clamp(50 + ((4.7 - p.forty) / 0.22) * 15));
  if (p.vertical) athleticVals.push(clamp(50 + ((p.vertical - 32) / 5) * 12));
  if (p.broad) athleticVals.push(clamp(50 + ((p.broad - 115) / 10) * 12));
  if (p.cone) athleticVals.push(clamp(50 + ((7.1 - p.cone) / 0.3) * 10));
  if (p.shuttle) athleticVals.push(clamp(50 + ((4.35 - p.shuttle) / 0.22) * 10));

  return {
    draftScore: draftScore(p.pick),
    logPick: Math.log(clamp(p.pick, 1, 260)),
    pffComp: p.pff?.pff?.composite ?? 50,
    pffGrade: p.pff?.pff?.grade ?? p.pff?.pff?.composite ?? 50,
    pffProd: p.pff?.pff?.production ?? 50,
    pffEff: p.pff?.pff?.efficiency ?? 50,
    pffClean: p.pff?.pff?.clean ?? 50,
    ageScore: ageScore(p.age, p.pos),
    athletic: athleticVals.length ? mean(athleticVals) : 50,
    size,
    isQB: p.group === 'QB' ? 1 : 0,
    isSkill: p.group === 'SKILL' ? 1 : 0,
    isOL: p.group === 'OL' ? 1 : 0,
    isFront: p.group === 'FRONT' ? 1 : 0,
    isDB: p.group === 'DB' ? 1 : 0,
  };
}

const trainingRows = rows.map(r => ({ ...r, features: makeFeatures(r), target: Math.log1p(Math.max(0, r.av)) }));

const stats = {};
for (const f of featureNames) {
  const vals = trainingRows.map(r => r.features[f]);
  stats[f] = { mean: mean(vals), sd: std(vals) };
}

const X = trainingRows.map(r => [1, ...featureNames.map(f => (r.features[f] - stats[f].mean) / stats[f].sd)]);
const y = trainingRows.map(r => r.target);
const beta = ridgeFit(X, y, 3.0);
const intercept = beta[0];
const coefs = beta.slice(1);

for (const r of trainingRows) {
  const logPred = intercept + featureNames.reduce((s, f, i) => s + coefs[i] * ((r.features[f] - stats[f].mean) / stats[f].sd), 0);
  r.predAv = clamp(Math.expm1(logPred), 0, 110);
}

const byGroup = {};
for (const r of trainingRows) {
  byGroup[r.group] ??= [];
  byGroup[r.group].push(r);
}

const report = {
  trainedAt: new Date().toISOString(),
  source: 'draft_picks.csv + combine.csv + pff_comparison_profiles',
  sampleSize: trainingRows.length,
  pffProfilesLoaded: pffProfiles.length,
  pffMatchedRows: trainingRows.filter(r => r.pff).length,
  skippedSpecialOrOther: skippedSpecialTeams,
  overall: {
    mae: mae(trainingRows),
    rmse: rmse(trainingRows),
    spearman: spearman(trainingRows),
  },
  byGroup: Object.fromEntries(Object.entries(byGroup).map(([g, rs]) => [g, {
    n: rs.length,
    pffMatched: rs.filter(r => r.pff).length,
    mae: mae(rs),
    rmse: rmse(rs),
    spearman: spearman(rs),
  }])),
  calibratedAvModel: {
    intercept,
    features: featureNames.map((name, i) => ({
      name,
      coef: coefs[i],
      mean: stats[name].mean,
      sd: stats[name].sd,
    })),
  },
};

fs.mkdirSync('public/data/model', { recursive: true });
fs.writeFileSync('public/data/model/retrain_report_v4.json', JSON.stringify(report, null, 2));

console.log('\nRetrain complete');
console.log(JSON.stringify(report.overall, null, 2));
console.log(JSON.stringify(report.byGroup, null, 2));
console.log('\nMODEL_BLOCK_START');
console.log(`export const calibratedAvModel: { intercept: number; features: Array<{ name: ModelSignal; coef: number; mean: number; sd: number }> } = ${JSON.stringify(report.calibratedAvModel, null, 2)}`);
console.log('MODEL_BLOCK_END');
