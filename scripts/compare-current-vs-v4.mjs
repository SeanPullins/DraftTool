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
  for (const k of keys) if (row && row[k] != null && row[k] !== '') return row[k];
  return '';
}
function num(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace('%', '').trim());
  return Number.isFinite(n) ? n : null;
}
function mean(xs) { return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0; }
function clamp(v, min = 0, max = 99) { return Math.max(min, Math.min(max, Number.isFinite(v) ? v : 50)); }

function normPos(pos = '') {
  const p = String(pos).toUpperCase().trim();
  if (p === 'QB') return 'QB';
  if (p === 'RB' || p === 'FB') return 'RB';
  if (p === 'WR') return 'WR';
  if (p === 'TE') return 'TE';
  if (['T','OT','G','OG','C','OL','IOL'].includes(p)) return 'OL';
  if (['DE','EDGE'].includes(p)) return 'EDGE';
  if (['DT','NT','DL','IDL'].includes(p)) return 'DL';
  if (['LB','OLB','ILB'].includes(p)) return 'LB';
  if (['DB','CB'].includes(p)) return 'CB';
  if (['S','SAF','FS','SS'].includes(p)) return 'S';
  return p;
}
function group(pos = '') {
  const p = normPos(pos);
  if (p === 'QB') return 'QB';
  if (['RB','WR','TE'].includes(p)) return 'SKILL';
  if (p === 'OL') return 'OL';
  if (['DL','EDGE','LB'].includes(p)) return 'FRONT';
  if (['CB','S'].includes(p)) return 'DB';
  return 'OTHER';
}
function draftScore(pickNo) {
  return clamp(100 - (Math.log(Math.max(1, pickNo)) / Math.log(260)) * 100, 1, 99);
}
function ageScore(age, pos) {
  const a = Number(age ?? 22);
  const p = normPos(pos), g = group(pos);
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
  const encoded = fs.readFileSync('public/data/pff_comparison_profiles.json.gz.b64', 'utf8').replace(/\s/g, '');
  return JSON.parse(zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8'));
}
function normalizePffProfiles(profiles) {
  return profiles.map(profile => {
    if (!Array.isArray(profile)) return profile;
    const [name, college, rawPos, draftSeason, composite, grade, production, efficiency, cleanPlay, nfl] = profile;
    return {
      name, college, position: normPos(rawPos), draftSeason: Number(draftSeason),
      pff: { composite, grade, production, efficiency, clean: cleanPlay },
      nfl
    };
  });
}

function extractCurrentModel() {
  const text = fs.readFileSync('src/model.ts', 'utf8');
  const start = text.indexOf('export const calibratedAvModel');
  const open = text.indexOf('= {', start) + 2;
  let depth = 0, end = -1;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  const raw = text.slice(open, end)
    .replace(/([,{]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
    .replace(/'/g, '"')
    // TypeScript allows trailing commas; JSON.parse does not.
    .replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(raw);
}

function predictAv(model, features) {
  let logPred = model.intercept;
  for (const f of model.features) {
    const value = features[f.name] ?? 50;
    logPred += f.coef * ((value - f.mean) / f.sd);
  }
  return clamp(Math.expm1(logPred), 0, 110);
}
function mae(rows, key) { return mean(rows.map(r => Math.abs(r[key] - r.av))); }
function rmse(rows, key) { return Math.sqrt(mean(rows.map(r => (r[key] - r.av) ** 2))); }
function spearman(rows, key) {
  const rank = (arr, k) => {
    const m = new Map();
    [...arr].sort((a,b)=>a[k]-b[k]).forEach((r,i)=>m.set(r.id,i+1));
    return m;
  };
  const rx = rank(rows, key), ry = rank(rows, 'av');
  const xs = rows.map(r=>rx.get(r.id)), ys = rows.map(r=>ry.get(r.id));
  const mx = mean(xs), my = mean(ys);
  const num = xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0);
  const den = Math.sqrt(xs.reduce((s,x)=>s+(x-mx)**2,0)*ys.reduce((s,y)=>s+(y-my)**2,0));
  return den ? num / den : 0;
}

const currentModel = extractCurrentModel();
const v4Model = JSON.parse(fs.readFileSync('public/data/model/retrain_report_v4.json','utf8')).calibratedAvModel;

const draftRows = parseCsv(fs.readFileSync('public/data/draft_picks.csv','utf8'));
const combineRows = parseCsv(fs.readFileSync('public/data/combine.csv','utf8'));
const combineMap = new Map();

for (const r of combineRows) {
  const year = num(pick(r, ['season','draft_year','year']));
  const name = pick(r, ['player_name','pfr_player_name','name']);
  const pos = normPos(pick(r, ['pos','position']));
  if (year && name) {
    combineMap.set(`${clean(name)}|${year}|${pos}`, r);
    combineMap.set(`${clean(name)}|${year}`, r);
  }
}

const pffProfiles = normalizePffProfiles(loadPffPayload().profiles ?? []);
const pffMap = new Map();
for (const p of pffProfiles) {
  pffMap.set(`${clean(p.name)}|${p.draftSeason}|${group(p.position)}`, p);
  pffMap.set(`${clean(p.name)}|${p.draftSeason}|${normPos(p.position)}`, p);
}

const rows = [];

for (const r of draftRows) {
  const year = num(pick(r, ['season','draft_year','year']));
  const name = pick(r, ['pfr_player_name','player_name','name']);
  const pos = normPos(pick(r, ['position','pos']));
  const g = group(pos);
  const pickNo = num(pick(r, ['pick','overall_pick','draft_pick']));
  const av = num(pick(r, ['w_av','weighted_av','career_av','car_av','av','dr_av']));
  if (['K','P','LS','KR'].includes(pos) || g === 'OTHER') continue;
  if (!year || !name || !pos || !pickNo || av == null) continue;
  if (year < 2000 || year > 2021 || pickNo > 260) continue;

  const c = combineMap.get(`${clean(name)}|${year}|${pos}`) ?? combineMap.get(`${clean(name)}|${year}`);
  const pff = pffMap.get(`${clean(name)}|${year}|${g}`) ?? pffMap.get(`${clean(name)}|${year}|${pos}`) ?? null;

  const height = num(pick(c ?? r, ['height','ht','inch_height']));
  const weight = num(pick(c ?? r, ['weight','wt']));
  const forty = num(pick(c ?? r, ['forty','forty_yd','forty_yard']));
  const vertical = num(pick(c ?? r, ['vertical','vertical_jump']));
  const broad = num(pick(c ?? r, ['broad','broad_jump']));
  const cone = num(pick(c ?? r, ['cone','three_cone']));
  const shuttle = num(pick(c ?? r, ['shuttle','short_shuttle']));
  const age = num(pick(r, ['age']));

  const athleticVals = [];
  if (forty) athleticVals.push(clamp(50 + ((4.7 - forty) / 0.22) * 15));
  if (vertical) athleticVals.push(clamp(50 + ((vertical - 32) / 5) * 12));
  if (broad) athleticVals.push(clamp(50 + ((broad - 115) / 10) * 12));
  if (cone) athleticVals.push(clamp(50 + ((7.1 - cone) / 0.3) * 10));
  if (shuttle) athleticVals.push(clamp(50 + ((4.35 - shuttle) / 0.22) * 10));

  const heightScore = height ? clamp(50 + ((height - 73) / 3) * 10) : 50;
  const weightScore = weight ? clamp(50 + ((weight - 220) / 35) * 10) : 50;

  const features = {
    draftScore: draftScore(pickNo),
    logPick: Math.log(clamp(pickNo, 1, 260)),
    pffComp: pff?.pff?.composite ?? 50,
    pffGrade: pff?.pff?.grade ?? pff?.pff?.composite ?? 50,
    pffProd: pff?.pff?.production ?? 50,
    pffEff: pff?.pff?.efficiency ?? 50,
    pffClean: pff?.pff?.clean ?? 50,
    ageScore: ageScore(age, pos),
    athletic: athleticVals.length ? mean(athleticVals) : 50,
    size: (heightScore + weightScore) / 2,
    isQB: g === 'QB' ? 1 : 0,
    isSkill: g === 'SKILL' ? 1 : 0,
    isOL: g === 'OL' ? 1 : 0,
    isFront: g === 'FRONT' ? 1 : 0,
    isDB: g === 'DB' ? 1 : 0,
  };

  rows.push({
    id: `${clean(name)}-${year}-${pickNo}`,
    name, year, pos, group: g, pick: pickNo, av, pff: !!pff,
    currentAv: predictAv(currentModel, features),
    v4Av: predictAv(v4Model, features),
  });
}

function summary(key) {
  const byGroup = {};
  for (const r of rows) {
    byGroup[r.group] ??= [];
    byGroup[r.group].push(r);
  }
  return {
    overall: { mae: mae(rows,key), rmse: rmse(rows,key), spearman: spearman(rows,key) },
    byGroup: Object.fromEntries(Object.entries(byGroup).map(([g, rs]) => [g, {
      n: rs.length,
      mae: mae(rs,key),
      rmse: rmse(rs,key),
      spearman: spearman(rs,key),
    }]))
  };
}

console.log(JSON.stringify({
  rows: rows.length,
  pffMatched: rows.filter(r=>r.pff).length,
  currentWebsiteModel: {
    intercept: currentModel.intercept,
    ...summary('currentAv')
  },
  v4Model: {
    intercept: v4Model.intercept,
    ...summary('v4Av')
  }
}, null, 2));
