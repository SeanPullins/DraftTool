import fs from 'fs';

function readJson(path, fallback = null) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function clean(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function clamp(x, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : 50));
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function normPos(pos = '') {
  const p = String(pos).toUpperCase();

  if (['OT', 'T'].includes(p)) return 'OT';
  if (['IOL', 'G', 'C', 'OG'].includes(p)) return 'IOL';
  if (['EDGE', 'DE', 'OLB'].includes(p)) return 'EDGE';
  if (['IDL', 'DT', 'NT', 'DL'].includes(p)) return 'IDL';
  if (['CB'].includes(p)) return 'CB';
  if (['S', 'SAF'].includes(p)) return 'S';
  if (['WR', 'RB', 'TE', 'QB', 'LB'].includes(p)) return p;

  return p || 'UNK';
}

function group(pos = '') {
  const p = normPos(pos);

  if (p === 'QB') return 'QB';
  if (['WR', 'RB', 'TE'].includes(p)) return 'SKILL';
  if (['OT', 'IOL'].includes(p)) return 'OL';
  if (['EDGE', 'IDL', 'LB'].includes(p)) return 'FRONT';
  if (['CB', 'S'].includes(p)) return 'DB';

  return 'OTHER';
}

function draftScore(pick) {
  const p = Number(pick);
  if (!Number.isFinite(p) || p <= 0) return 50;
  return clamp(100 - ((Math.log(p) / Math.log(260)) * 100));
}

function ageScore(age, pos) {
  const a = Number(age);
  if (!Number.isFinite(a)) return 50;

  const ideal = normPos(pos) === 'QB' ? 22.5 : 21.8;
  return clamp(75 - Math.abs(a - ideal) * 12);
}

function extractV4Model() {
  const text = fs.readFileSync('src/model.ts', 'utf8');
  const start = text.indexOf('export const calibratedAvModel');

  if (start === -1) throw new Error('Could not find calibratedAvModel in src/model.ts');

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

function predictModel(model, features) {
  let value = model.intercept ?? 0;

  for (const f of model.features ?? []) {
    const raw = features[f.name] ?? 50;
    const sd = f.sd || 1;
    value += f.coef * ((raw - f.mean) / sd);
  }

  // V4 predicts AV-like output, so keep it as-is here.
  return Math.max(0, Math.expm1 ? Math.expm1(value) : value);
}

function predictLinearCorrection(model, features) {
  let value = model.intercept ?? 0;

  for (const f of model.features ?? []) {
    const raw = features[f.name] ?? 50;
    const sd = f.sd || 1;
    value += f.coef * ((raw - f.mean) / sd);
  }

  return clamp(value, -15, 15);
}

function percentileByYear(rows, scoreKey, outKey) {
  const byYear = new Map();

  for (const row of rows) {
    const year = Number(row.year ?? row.draftYear ?? row.draftSeason ?? 2027);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(row);
  }

  for (const [, classRows] of byYear.entries()) {
    const sorted = [...classRows].sort((a, b) => (a[scoreKey] ?? 0) - (b[scoreKey] ?? 0));

    sorted.forEach((row, idx) => {
      row[outKey] = sorted.length <= 1 ? 50 : (idx / (sorted.length - 1)) * 100;
    });
  }
}

function makeBaseFeatures(player, pffProfile = null, seasonPffScore = null) {
  const pos = normPos(player.pos ?? player.position);
  const g = group(pos);
  const pick = Number(player.pick ?? player.projectedPick ?? player.bigBoardRank ?? player.rank ?? 150);

  const heightScore = 50;
  const weightScore = 50;

  return {
    draftScore: draftScore(pick),
    logPick: Math.log(clamp(pick, 1, 260)),
    pffComp: pffProfile?.pff?.composite ?? pffProfile?.composite ?? 50,
    pffGrade: pffProfile?.pff?.grade ?? pffProfile?.pff?.composite ?? pffProfile?.grade ?? 50,
    pffProd: pffProfile?.pff?.production ?? pffProfile?.production ?? 50,
    pffEff: pffProfile?.pff?.efficiency ?? pffProfile?.efficiency ?? 50,
    pffClean: pffProfile?.pff?.clean ?? pffProfile?.clean ?? 50,
    hasPffProfile: pffProfile ? 1 : 0,
    seasonPffScore: seasonPffScore ?? 50,
    hasSeasonPff: seasonPffScore != null ? 1 : 0,
    ageScore: ageScore(player.age, pos),
    athletic: Number(player.athletic ?? player.ras ?? 50) || 50,
    size: (heightScore + weightScore) / 2,
    isQB: g === 'QB' ? 1 : 0,
    isSkill: g === 'SKILL' ? 1 : 0,
    isOL: g === 'OL' ? 1 : 0,
    isFront: g === 'FRONT' ? 1 : 0,
    isDB: g === 'DB' ? 1 : 0,
  };
}

function makeStackFeatures(row) {
  const f = row.baseFeatures;
  const v4 = row.v4Percentile ?? 50;

  return {
    v4Score: v4,
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
    v4_x_qb: v4 * f.isQB,
    v4_x_skill: v4 * f.isSkill,
    v4_x_ol: v4 * f.isOL,
    v4_x_front: v4 * f.isFront,
    v4_x_db: v4 * f.isDB,
    pff_x_hasSeason: f.seasonPffScore * f.hasSeasonPff,
    age_x_qb: f.ageScore * f.isQB,
    athletic_x_skill: f.athletic * f.isSkill,
    size_x_ol: f.size * f.isOL,
  };
}

function loadPffProfiles() {
  const payload =
    readJson('public/data/pff_comparison_profiles.json', null) ??
    readJson('public/data/pff_profiles.json', null) ??
    null;

  const records = payload?.profiles ?? payload?.records ?? payload ?? [];

  if (!Array.isArray(records)) return [];

  return records;
}

function loadSeasonRows(path) {
  const payload = readJson(path, null);
  const rows = payload?.records ?? payload ?? [];
  return Array.isArray(rows) ? rows : [];
}

function seasonScoreFor(player, qbRows, wrRows) {
  const name = clean(player.name ?? player.player ?? player.player_name);
  const pos = normPos(player.pos ?? player.position);
  const draftYear = Number(player.year ?? player.draftYear ?? player.draftSeason ?? 2027);

  const rows = pos === 'QB' ? qbRows : pos === 'WR' ? wrRows : [];

  const hits = rows.filter((r) => {
    const rowName = clean(r.name ?? r.player ?? r.player_name);
    const season = Number(r.season ?? r.year);
    return rowName === name && season < draftYear;
  });

  if (!hits.length) return null;

  const vals = hits
    .map((r) => {
      if (pos === 'QB') {
        return Number(r.pass_grade ?? r.grade ?? r.passing_grade ?? r.offense_grade ?? r.pff_grade);
      }

      if (pos === 'WR') {
        return Number(r.route_grade ?? r.grades_pass_route ?? r.offense_grade ?? r.pff_grade);
      }

      return null;
    })
    .filter((v) => Number.isFinite(v));

  if (!vals.length) return null;
  return mean(vals);
}

function readProspects() {
  const files = [
    'public/data/prospects_2027_all.json',
    'public/data/prospects_2027_qb.json',
    'public/data/prospects_2027_wr.json',
    'public/data/extra_prospects.json',
    'public/data/prospects.json'
  ];

  const seen = new Set();
  const out = [];

  for (const file of files) {
    const payload = readJson(file, null);
    const rows = payload?.records ?? payload ?? [];

    if (!Array.isArray(rows)) continue;

    for (const r of rows) {
      const name = r.name ?? r.player ?? r.player_name;
      if (!name) continue;

      const pos = normPos(r.pos ?? r.position);
      const year = Number(r.year ?? r.draftYear ?? r.draftSeason ?? 2027);
      const key = `${clean(name)}|${pos}|${year}`;

      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        ...r,
        name,
        pos,
        group: group(pos),
        year,
        sourceFile: file,
      });
    }
  }

  return out;
}

const v4Model = extractV4Model();
const active = readJson('public/data/model/active_model_v57.json');
const correctionModel = active.correctionModel;

const pffProfiles = loadPffProfiles();
const pffMap = new Map();

for (const p of pffProfiles) {
  const name = p.name ?? p.player ?? p.player_name;
  const pos = normPos(p.position ?? p.pos);
  const year = Number(p.draftSeason ?? p.year ?? p.draftYear ?? 2027);
  if (name) {
    pffMap.set(`${clean(name)}|${pos}|${year}`, p);
    pffMap.set(`${clean(name)}|${pos}`, p);
  }
}

const qbRows = loadSeasonRows('public/data/qb_pff_seasons.json');
const wrRows = loadSeasonRows('public/data/wr_pff_seasons.json');

const prospects = readProspects();

const scored = prospects.map((p) => {
  const pffProfile =
    pffMap.get(`${clean(p.name)}|${p.pos}|${p.year}`) ??
    pffMap.get(`${clean(p.name)}|${p.pos}`) ??
    null;

  const seasonPffScore = seasonScoreFor(p, qbRows, wrRows);
  const baseFeatures = makeBaseFeatures(p, pffProfile, seasonPffScore);
  const v4Score = predictModel(v4Model, baseFeatures);

  return {
    ...p,
    pffProfile: !!pffProfile,
    seasonPffScore,
    baseFeatures,
    v4Score,
  };
});

percentileByYear(scored, 'v4Score', 'v4Percentile');

for (const row of scored) {
  const rawCorrection = predictLinearCorrection(correctionModel, makeStackFeatures(row));

  const hasAnyPff = row.pffProfile || row.seasonPffScore != null;

  // Prospect-safe policy:
  // 1) No correction without data.
  // 2) Cap prospect correction tighter than historical backtest.
  // 3) Do not hammer elite prospects by full negative correction.
  // 4) Do not move QBs until QB season/profile matching is fixed.
  let correction = 0;

  if (hasAnyPff && row.group !== 'QB') {
    const hasFullProfile = row.pffProfile;
    const seasonOnly = !row.pffProfile && row.seasonPffScore != null;

    // Full profile can move more. Season-only data gets a tighter cap.
    const cap = hasFullProfile ? 8 : 5;
    correction = clamp(rawCorrection, -cap, cap);

    // Protect elite/high-board WRs from being hammered by season-only correction.
    if ((row.v4Percentile ?? 50) >= 90 && correction < -3) {
      correction = -3;
    }

    // If season PFF is genuinely strong, do not apply negative season-only correction.
    if (seasonOnly && (row.v4Percentile ?? 50) >= 80 && (row.seasonPffScore ?? 0) >= 75 && correction < 0) {
      correction = 0;
    }

    // Low-ranked players can rise, but don't let season-only data create big jumps.
    if ((row.v4Percentile ?? 50) <= 25 && correction > 5) {
      correction = 5;
    }
  }

  row.v57RawCorrection = rawCorrection;
  row.v57Correction = correction;
  row.v57Percentile = clamp(row.v4Percentile + correction, 0, 100);
  row.v57Delta = row.v57Percentile - row.v4Percentile;

  if (!hasAnyPff) {
    row.flag = 'NO_DATA_NO_MOVE';
  } else if (row.group === 'QB') {
    row.flag = 'QB_HELD_UNTIL_PFF_LINK';
  } else if (Math.abs(row.v57Delta) >= 8) {
    row.flag = 'BIG_MOVE';
  } else if (Math.abs(row.v57Delta) >= 5) {
    row.flag = 'MED_MOVE';
  } else {
    row.flag = '';
  }
}

const risers = [...scored].sort((a, b) => b.v57Delta - a.v57Delta).slice(0, 40);
const fallers = [...scored].sort((a, b) => a.v57Delta - b.v57Delta).slice(0, 40);

const byGroup = Object.fromEntries(
  ['QB', 'SKILL', 'OL', 'FRONT', 'DB', 'OTHER'].map((g) => {
    const rows = scored.filter((r) => r.group === g);
    return [
      g,
      {
        n: rows.length,
        avgDelta: mean(rows.map((r) => r.v57Delta)),
        avgAbsDelta: mean(rows.map((r) => Math.abs(r.v57Delta))),
        bigMoves: rows.filter((r) => Math.abs(r.v57Delta) >= 12).length,
        pffProfiles: rows.filter((r) => r.pffProfile).length,
        seasonPff: rows.filter((r) => r.seasonPffScore != null).length,
      },
    ];
  })
);

const report = {
  generatedAt: new Date().toISOString(),
  modelVersion: 'V5.7 prospect sanity audit',
  totalProspects: scored.length,
  byGroup,
  risers: risers.map(strip),
  fallers: fallers.map(strip),
  allScored: scored.map(strip),
};

fs.mkdirSync('public/data/model', { recursive: true });
fs.writeFileSync('public/data/model/v57_current_prospect_audit.json', JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  wrote: 'public/data/model/v57_current_prospect_audit.json',
  totalProspects: report.totalProspects,
  byGroup: report.byGroup,
  topRisers: report.risers.slice(0, 15),
  topFallers: report.fallers.slice(0, 15),
}, null, 2));

function strip(row) {
  return {
    name: row.name,
    year: row.year,
    pos: row.pos,
    group: row.group,
    school: row.school ?? row.team ?? row.college,
    pick: row.pick ?? row.projectedPick ?? row.bigBoardRank ?? row.rank,
    v4Percentile: Number(row.v4Percentile?.toFixed?.(2) ?? row.v4Percentile),
    v57Percentile: Number(row.v57Percentile?.toFixed?.(2) ?? row.v57Percentile),
    v57Delta: Number(row.v57Delta?.toFixed?.(2) ?? row.v57Delta),
    rawCorrection: Number(row.v57RawCorrection?.toFixed?.(2) ?? row.v57RawCorrection),
    correction: Number(row.v57Correction?.toFixed?.(2) ?? row.v57Correction),
    pffProfile: row.pffProfile,
    seasonPffScore: row.seasonPffScore,
    flag: row.flag,
    sourceFile: row.sourceFile,
  };
}
