import fs from 'fs';
import readline from 'readline';

const SEASONS_JSONL = 'public/data/model/college_player_seasons_2014_2025.jsonl';
const WEIGHTS = 'public/data/model/college_position_scoring_weights_v2.json';
const DRAFT_CSV = 'public/data/draft_picks.csv';

const OUT = 'public/data/model/college_model_v210_qb_traits_score_lookup.json';
const AUDIT = 'public/data/model/college_model_v210_qb_traits_score_audit.json';

const ALLOWED_POSITIONS = new Set(['QB', 'WR', 'RB', 'TE', 'OT', 'IOL', 'EDGE', 'DL', 'LB', 'CB', 'S']);

function cleanName(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normKey(s = '') {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

function labelFromScore(score) {
  if (score == null) return 'Insufficient Data';
  if (score >= 85) return 'Elite Outcome Profile';
  if (score >= 75) return 'Core Starter Profile';
  if (score >= 65) return 'Starter / Useful Hit Profile';
  if (score >= 50) return 'Contributor Profile';
  return 'Low Translation Profile';
}

function parseCsv(text) {
  const rows = [];
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return rows;

  function parseLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }

    out.push(cur);
    return out;
  }

  const headers = parseLine(lines[0]).map(normKey);

  for (const line of lines.slice(1)) {
    const vals = parseLine(line);
    const row = {};
    headers.forEach((h, i) => row[h] = vals[i] ?? '');
    rows.push(row);
  }

  return rows;
}

function pick(row, keys) {
  for (const key of keys) {
    const k = normKey(key);
    if (row[k] !== undefined && row[k] !== '') return row[k];
  }
  return null;
}

function flattenNumeric(obj, prefix = '', out = {}) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;

  for (const [rawKey, value] of Object.entries(obj)) {
    const key = normKey(rawKey);
    if (!key) continue;

    if ([
      'source_files',
      'source_ids',
      'player',
      'name',
      'normalized_name',
      'team',
      'school',
      'college',
      'conference',
      'position',
      'pos',
    ].includes(key)) continue;

    const fieldPath = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'number' && Number.isFinite(value)) {
      out[fieldPath] = value;
    } else if (typeof value === 'string') {
      const n = toNum(value);
      if (n !== null && value.trim() !== '') out[fieldPath] = n;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenNumeric(value, fieldPath, out);
    }
  }

  return out;
}

function hasObjectData(obj) {
  return !!obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).length > 0;
}

function hasRealSeasonData(row) {
  return (
    hasObjectData(row.pff) ||
    hasObjectData(row.traditional) ||
    hasObjectData(row.efficiency?.qbr) ||
    hasObjectData(row.efficiency?.ppa_epa) ||
    hasObjectData(row.efficiency)
  );
}

function featureBase(feature = '') {
  return feature.replace(/^college\./, '').replace(/\.(avg|max|min|final)$/, '');
}

function percentileFromStats(value, stats, direction) {
  if (!stats || value === null || value === undefined) return null;

  const min = Number(stats.min);
  const max = Number(stats.max);

  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return null;

  let pct = (Number(value) - min) / (max - min);
  if (direction === 'lower_is_better') pct = 1 - pct;

  return Math.max(0, Math.min(1, pct));
}

function getFeatureValue(features, weightFeature) {
  const base = featureBase(weightFeature);
  const suffix = weightFeature.match(/\.(avg|max|min|final)$/)?.[0]?.slice(1) || 'avg';

  const exact = features[`college.${base}.${suffix}`] ?? features[`${base}.${suffix}`];
  if (exact !== undefined) return exact;

  for (const s of ['final', 'avg', 'max', 'min']) {
    const v = features[`college.${base}.${s}`] ?? features[`${base}.${s}`];
    if (v !== undefined) return v;
  }

  return null;
}

function getAnyFeature(features, names) {
  for (const name of names) {
    for (const suffix of ['final', 'avg', 'max', 'min']) {
      const direct = features[`${name}.${suffix}`] ?? features[`college.${name}.${suffix}`];
      if (direct !== undefined && direct !== null) return Number(direct);
    }
  }

  // Flexible fallback: find fields ending in the requested feature names.
  for (const [key, value] of Object.entries(features)) {
    const k = String(key).toLowerCase();
    for (const name of names) {
      const n = String(name).toLowerCase();
      if (k.endsWith(`${n}.final`) || k.endsWith(`${n}.avg`) || k.endsWith(`${n}.max`) || k.endsWith(`${n}.min`)) {
        const num = Number(value);
        if (Number.isFinite(num)) return num;
      }
    }
  }

  return null;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function traitPct(value, low, high, lowerIsBetter = false) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  let p = (Number(value) - low) / (high - low);
  if (lowerIsBetter) p = 1 - p;
  return clamp01(p);
}

function qbTraitProfile(features) {
  const scrambles = getAnyFeature(features, ['pff.defense.rushing.scrambles', 'pff.defense.defense.scrambles', 'pff.defense.coverage.scrambles', 'scrambles']);
  const runGrade = getAnyFeature(features, ['pff.defense.rushing.grades_run', 'pff.defense.defense.grades_run', 'pff.defense.coverage.grades_run', 'grades_run']);
  const bttRate = getAnyFeature(features, ['pff.defense.rushing.btt_rate', 'pff.defense.defense.btt_rate', 'pff.defense.coverage.btt_rate', 'btt_rate']);
  const twpRate = getAnyFeature(features, ['pff.defense.rushing.twp_rate', 'pff.defense.defense.twp_rate', 'pff.defense.coverage.twp_rate', 'twp_rate']);
  const p2s = getAnyFeature(features, ['pff.defense.rushing.pressure_to_sack_rate', 'pff.defense.defense.pressure_to_sack_rate', 'pressure_to_sack_rate']);
  const sackPct = getAnyFeature(features, ['pff.defense.rushing.sack_percent', 'pff.defense.defense.sack_percent', 'sack_percent']);
  const adot = getAnyFeature(features, ['pff.defense.rushing.avg_depth_of_target', 'pff.defense.defense.avg_depth_of_target', 'avg_depth_of_target']);
  const passGrade = getAnyFeature(features, ['pff.defense.rushing.grades_pass', 'pff.defense.defense.grades_pass', 'grades_pass']);
  const offenseGrade = getAnyFeature(features, ['pff.defense.rushing.grades_offense', 'pff.defense.defense.grades_offense', 'grades_offense']);
  const epa = getAnyFeature(features, ['pff.defense.rushing.epa', 'pff.defense.defense.epa', 'epa']);

  const scramblePct = traitPct(scrambles, 15, 60)
  const runGradePct = traitPct(runGrade, 58, 90)

  const rushParts = [
    scramblePct,
    runGradePct,
    // reward high run grade even if scramble count is modest
    runGradePct !== null && runGrade >= 78 ? Math.max(runGradePct, 0.75) : null,
  ].filter(v => v !== null);

  const armParts = [
    traitPct(bttRate, 3, 8),
    traitPct(adot, 7, 11.5),
  ].filter(v => v !== null);

  const cleanParts = [
    traitPct(twpRate, 1.2, 4.2, true),
    traitPct(p2s, 8, 24, true),
    traitPct(sackPct, 3, 9, true),
  ].filter(v => v !== null);

  const efficiencyParts = [
    traitPct(passGrade, 65, 92),
    traitPct(offenseGrade, 70, 92),
    traitPct(epa, 0.00, 0.45),
  ].filter(v => v !== null);

  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const rushScore = avg(rushParts);
  const armScore = avg(armParts);
  const cleanScore = avg(cleanParts);
  const efficiencyScore = avg(efficiencyParts);

  const outlierScore = [
    rushScore !== null ? rushScore * 0.35 : null,
    armScore !== null ? armScore * 0.25 : null,
    cleanScore !== null ? cleanScore * 0.20 : null,
    efficiencyScore !== null ? efficiencyScore * 0.20 : null,
  ].filter(v => v !== null).reduce((a, b) => a + b, 0);

  const traitCount = [rushScore, armScore, cleanScore, efficiencyScore].filter(v => v !== null).length;

  return {
    scrambles,
    runGrade,
    bttRate,
    twpRate,
    p2s,
    sackPct,
    adot,
    passGrade,
    offenseGrade,
    epa,
    rushScore,
    armScore,
    cleanScore,
    efficiencyScore,
    outlierScore: traitCount ? Number((outlierScore * 100).toFixed(1)) : null,
    traitCount,
  };
}

function capByConfidence(score, matched) {
  if (score == null) return null;
  if (matched < 5) return null;
  if (matched <= 6) return Math.min(score, 62);
  if (matched <= 8) return Math.min(score, 72);
  return score;
}

function draftCapitalScore(pick) {
  const p = Number(pick);
  if (!Number.isFinite(p) || p <= 0) return 35;
  if (p <= 1) return 100;
  if (p <= 5) return 95;
  if (p <= 15) return 88;
  if (p <= 32) return 78;
  if (p <= 64) return 66;
  if (p <= 100) return 56;
  if (p <= 150) return 48;
  if (p <= 224) return 40;
  return 36;
}

function isPowerSchool(school = '') {
  const s = String(school).toLowerCase();
  return [
    'alabama','georgia','lsu','ohio state','oklahoma','clemson','usc','oregon','texas','texas a&m',
    'florida','florida state','miami','miami fl','notre dame','michigan','penn state','wisconsin',
    'auburn','tennessee','ole miss','mississippi','north carolina','nc state','washington','stanford',
    'california','cal','ucla','arizona state','utah','iowa','iowa state','kansas state','oklahoma state',
    'texas tech','baylor','tcu','arkansas','missouri','kentucky','louisville','purdue','indiana',
    'michigan state','maryland','rutgers','south carolina','virginia tech','virginia','duke','syracuse',
    'pittsburgh','pitt','boston college','wake forest','colorado','nebraska','minnesota','illinois'
  ].some(x => s === x || s.includes(x));
}

function signalHasAny(signals, needles) {
  const text = JSON.stringify(signals || []).toLowerCase();
  return needles.some(n => text.includes(String(n).toLowerCase()));
}

function qbCalibratedScore({ calibrated, raw, matched, pick, school, signals, qbTraits }) {
  if (calibrated == null) return null;

  const dc = draftCapitalScore(pick);
  const power = isPowerSchool(school);
  const p = Number(pick);
  const hasPick = Number.isFinite(p) && p > 0;

  const traitOutlier = Number(qbTraits?.outlierScore ?? 0);
  const traitRush = Number(qbTraits?.rushScore != null ? qbTraits.rushScore * 100 : 0);
  const traitClean = Number(qbTraits?.cleanScore != null ? qbTraits.cleanScore * 100 : 0);
  const traitArm = Number(qbTraits?.armScore != null ? qbTraits.armScore * 100 : 0);
  const hasTraitOutlier = traitOutlier >= 58 || traitRush >= 55 || (traitArm >= 60 && traitClean >= 45);

  const hasBttSignal = signalHasAny(signals, ['big time', 'btt']);
  const hasRushSignal = signalHasAny(signals, ['rushing', 'rush', 'scramble', 'designed', 'run']);
  const hasAthleticSignal = signalHasAny(signals, ['athletic', 'speed', 'explosive']);
  const hasOutlierSupport = hasBttSignal || hasRushSignal || hasAthleticSignal || hasTraitOutlier;

  const highDraft = hasPick && p <= 15;
  const premiumDraft = hasPick && p <= 5;
  const rd1 = hasPick && p <= 32;
  const day2 = hasPick && p <= 100;

  let score = calibrated * 0.48 + dc * 0.38;

  // Data confidence.
  if (matched < 5) {
    if (premiumDraft && hasOutlierSupport) score = Math.max(score, 62);
    else return null;
  }

  if (matched <= 6) score = Math.min(score, premiumDraft ? 70 : 62);
  if (matched <= 8) score = Math.min(score, premiumDraft ? 82 : 76);

  // Production-only caps.
  if (!hasPick) score = Math.min(score, power ? 62 : 56);
  else if (p > 150) score = Math.min(score, 62);
  else if (p > 100) score = Math.min(score, 66);
  else if (p > 64) score = Math.min(score, 70);

  if (!power && (!hasPick || p > 64)) score = Math.min(score, 60);

  // Elite aligned profiles.
  if (premiumDraft && power && matched >= 7 && raw >= 45) score = Math.max(score, 80);
  if (premiumDraft && power && matched >= 9 && raw >= 48) score = Math.max(score, 82);
  if (highDraft && power && matched >= 9 && raw >= 58) score = Math.max(score, 84);
  if (highDraft && power && matched >= 9 && raw >= 64) score = Math.max(score, 86);

  // Draft-confirmed quality profiles outside top 5.
  if (highDraft && matched >= 9 && raw >= 45) score = Math.max(score, 78);
  if (highDraft && matched >= 9 && raw >= 55) score = Math.max(score, 82);

  // Outlier/improver protection.
  if (rd1 && hasOutlierSupport && matched >= 7 && raw >= 35) score = Math.max(score, 74);
  if (highDraft && hasOutlierSupport && matched >= 7 && raw >= 35) score = Math.max(score, 78);

  // Day-2 outlier protection for Hurts/Dak archetypes.
  if (day2 && p > 32 && hasOutlierSupport && matched >= 9 && raw >= 40) score = Math.max(score, 70);

  // False-positive caps: draft alone should not create elite score.
  if (premiumDraft && matched < 7 && !hasOutlierSupport) score = Math.min(score, 70);
  if (premiumDraft && raw < 35 && !hasOutlierSupport) score = Math.min(score, 74);
  if (highDraft && raw < 40 && !hasOutlierSupport) score = Math.min(score, 76);
  if (highDraft && raw < 47 && !hasOutlierSupport) score = Math.min(score, 78);

  // Pocket/distributor cap unless college signal or trait profile was very strong.
  if (highDraft && !hasOutlierSupport && raw < 50 && traitOutlier < 62) score = Math.min(score, 76);

  // High-pick false positives: strong draft slot but limited outlier + middling raw.
  if (highDraft && traitOutlier < 55 && raw < 50) score = Math.min(score, 76);
  if (premiumDraft && traitOutlier < 50 && raw < 50) score = Math.min(score, 74);

  // Low-data high-pick profiles should stay high-variance, not franchise locks.
  if (matched < 5 && traitOutlier < 60) score = Math.min(score, 66);

  // Toolsy/raw top picks: preserve upside, cap certainty.
  if (premiumDraft && raw < 15 && traitOutlier < 75) score = Math.min(score, 76);

  // Known risky high-draft profile shape: high pick but low clean signal.
  if (premiumDraft && raw < 32) score = Math.min(score, hasOutlierSupport ? 78 : 72);
  if (highDraft && raw < 32) score = Math.min(score, hasOutlierSupport ? 76 : 70);

  // Production monsters without NFL demand.
  if ((!hasPick || p > 100) && raw >= 55) score = Math.min(score, power ? 64 : 58);

  // Explicit outlier/improver trait protection.
  if (hasPick && p <= 75 && traitOutlier >= 58 && matched >= 7) score = Math.max(score, 72);
  if (hasPick && p <= 35 && traitOutlier >= 58 && matched >= 7) score = Math.max(score, 76);
  if (hasPick && p <= 15 && traitOutlier >= 58 && matched >= 7) score = Math.max(score, 80);

  // Strong outlier profile + top draft capital.
  if (hasPick && p <= 5 && traitOutlier >= 70 && matched >= 7) score = Math.max(score, 82);
  if (hasPick && p <= 15 && traitOutlier >= 75 && matched >= 7) score = Math.max(score, 82);

  // Elite aligned profile boost: draft + real college signal + traits.
  if (hasPick && p <= 10 && power && matched >= 9 && raw >= 48 && traitOutlier >= 55) {
    score = Math.max(score, 84);
  }

  if (hasPick && p <= 10 && matched >= 9 && raw >= 58 && traitOutlier >= 55) {
    score = Math.max(score, 85);
  }

  // Day-2 successful archetype protection: Hurts/Dak types.
  if (hasPick && p > 32 && p <= 150 && traitOutlier >= 58 && raw >= 40 && matched >= 9) {
    score = Math.max(score, 72);
  }

  if (hasPick && p > 32 && p <= 150 && traitOutlier >= 65 && raw >= 40 && matched >= 9) {
    score = Math.max(score, 74);
  }

  // High rushing/outlier but raw passer signal is weak: high variance, not automatic elite.
  if (traitRush >= 65 && raw < 35 && hasPick && p <= 15) {
    score = Math.max(score, 76);
    score = Math.min(score, 82);
  }


  // v2.10 final false-positive trim.
  // High draft capital should not create a Franchise/Core score when both raw signal and trait support are limited.
  if (hasPick && p <= 20 && raw < 47 && traitOutlier < 72) {
    score = Math.min(score, 78);
  }

  // Pocket-only / limited-outlier profiles with middling raw signal should stay in High Starter, not Franchise/Core.
  if (hasPick && p <= 20 && raw < 50 && traitRush < 60 && traitArm < 70) {
    score = Math.min(score, 76);
  }

  // Low-trait high picks: Rosen/Haskins-style cap.
  if (hasPick && p <= 20 && traitOutlier < 45 && raw < 48) {
    score = Math.min(score, 74);
  }

  // Low matched-feature top picks remain volatile, not safe.
  if (matched < 5 && hasPick && p <= 5 && traitOutlier < 60) {
    score = Math.min(score, 64);
  }

  // Toolsy but very raw: keep upside, cap certainty.
  if (hasPick && p <= 5 && raw < 15) {
    score = Math.min(score, traitOutlier >= 70 ? 78 : 74);
  }

  return Number(Math.max(0, Math.min(100, score)).toFixed(1));
}


function playerKey(name, pos) {
  return `${cleanName(name)}|${normalizePosition(pos)}`;
}

const weightsPayload = JSON.parse(fs.readFileSync(WEIGHTS, 'utf8'));

const draftByNamePos = new Map();

if (fs.existsSync(DRAFT_CSV)) {
  const draftRows = parseCsv(fs.readFileSync(DRAFT_CSV, 'utf8'));

  for (const r of draftRows) {
    const name = pick(r, ['player', 'player_name', 'name', 'pfr_player_name']);
    const pos = normalizePosition(pick(r, ['pos', 'position']));
    const year = Number(pick(r, ['season', 'year', 'draft_year']));
    const pickNo = Number(pick(r, ['pick', 'overall', 'draft_pick', 'overall_pick']));

    if (!name || !pos || !year) continue;

    const key = playerKey(name, pos);
    const existing = draftByNamePos.get(key);

    if (!existing || year > existing.draftYear) {
      draftByNamePos.set(key, {
        draftYear: year,
        pick: Number.isFinite(pickNo) ? pickNo : null,
        team: pick(r, ['team', 'draft_team']),
      });
    }
  }
}

const aggByKey = new Map();

function ensureAgg(row) {
  const pos = normalizePosition(row.position || row.pos);
  const name = row.player || row.name || '';

  const key = playerKey(name, pos);

  if (!aggByKey.has(key)) {
    aggByKey.set(key, {
      key,
      name,
      normalized_name: cleanName(name),
      pos,
      raw_positions: new Set(),
      seasons: new Set(),
      teamsBySeason: new Map(),
      featureStats: new Map(),
      realSeasonRows: 0,
      totalSeasonRows: 0,
    });
  }

  const agg = aggByKey.get(key);
  agg.totalSeasonRows++;

  if (row.position || row.pos) agg.raw_positions.add(String(row.position || row.pos).toUpperCase());

  const season = Number(row.season || row.year || 0);
  if (season) agg.seasons.add(season);

  const team = row.team || row.school || row.college || '';
  if (season && team) agg.teamsBySeason.set(season, team);

  return agg;
}

function addFeature(agg, feature, value, season) {
  const n = toNum(value);
  if (n === null) return;

  if (!agg.featureStats.has(feature)) {
    agg.featureStats.set(feature, {
      count: 0,
      sum: 0,
      min: Infinity,
      max: -Infinity,
      final: null,
      finalSeason: -Infinity,
    });
  }

  const s = agg.featureStats.get(feature);
  s.count++;
  s.sum += n;
  s.min = Math.min(s.min, n);
  s.max = Math.max(s.max, n);

  if (Number(season || 0) >= s.finalSeason) {
    s.final = n;
    s.finalSeason = Number(season || 0);
  }
}

console.log('Reading clean season data...');

const rl = readline.createInterface({
  input: fs.createReadStream(SEASONS_JSONL),
  crlfDelay: Infinity,
});

let lineCount = 0;
let realSeasonLines = 0;
let skippedNoRealData = 0;
let skippedBadPosition = 0;

for await (const line of rl) {
  if (!line.trim()) continue;
  lineCount++;

  let row;
  try {
    row = JSON.parse(line);
  } catch {
    continue;
  }

  const pos = normalizePosition(row.position || row.pos);
  if (!ALLOWED_POSITIONS.has(pos)) {
    skippedBadPosition++;
    continue;
  }

  if (!hasRealSeasonData(row)) {
    skippedNoRealData++;
    continue;
  }

  realSeasonLines++;

  const agg = ensureAgg({ ...row, position: pos });
  agg.realSeasonRows++;

  const season = Number(row.season || row.year || 0);

  const flat = flattenNumeric({
    pff: row.pff || {},
    traditional: row.traditional || {},
    efficiency: row.efficiency || {},
  }, 'college');

  for (const [feature, value] of Object.entries(flat)) {
    addFeature(agg, feature, value, season);
  }
}

console.log('Aggregated clean players:', aggByKey.size);

const rows = [];
const auditRows = [];

for (const agg of aggByKey.values()) {
  const seasons = Array.from(agg.seasons).sort((a, b) => a - b);
  const lastSeason = seasons[seasons.length - 1] || null;
  const firstSeason = seasons[0] || null;
  const rawDraftInfo = draftByNamePos.get(agg.key) || null;
  const expectedDraftYear = lastSeason ? lastSeason + 1 : null;

  // Guardrail: name+position alone can collide with older NFL draft records.
  // Only trust draft info when it aligns with the player's final college season.
  const draftInfo =
    rawDraftInfo &&
    expectedDraftYear &&
    Math.abs(Number(rawDraftInfo.draftYear) - Number(expectedDraftYear)) <= 1
      ? rawDraftInfo
      : null;

  const year = Number(draftInfo?.draftYear || expectedDraftYear || 0);
  if (!year) continue;

  const model = weightsPayload.positions?.[agg.pos];
  if (!model?.weights?.length) continue;

  const features = {};

  for (const [feature, s] of agg.featureStats.entries()) {
    features[`${feature}.avg`] = s.sum / s.count;
    features[`${feature}.max`] = s.max;
    features[`${feature}.min`] = s.min;
    features[`${feature}.final`] = s.final;
  }

  let totalWeight = 0;
  let weightedScore = 0;
  const signals = [];
  const missing = [];

  for (const w of model.weights) {
    const value = getFeatureValue(features, w.feature);
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
      label: w.label,
      bucket: w.bucket,
      direction: w.direction,
      value,
      percentile: Number((pct * 100).toFixed(1)),
      weight,
      contribution: Number((pct * weight).toFixed(2)),
    });
  }

  const raw = totalWeight > 0
    ? Number(((weightedScore / totalWeight) * 100).toFixed(1))
    : null;

  const calibrated = raw !== null
    ? Number(Math.max(0, Math.min(100, 45 + raw * 0.65)).toFixed(1))
    : null;

  const school =
    agg.teamsBySeason.get(lastSeason) ||
    agg.teamsBySeason.get(firstSeason) ||
    '';

  const baseCapped = capByConfidence(calibrated, signals.length);

  const qbTraits = agg.pos === 'QB' ? qbTraitProfile(features) : null;

  const capped = agg.pos === 'QB'
    ? qbCalibratedScore({
        calibrated,
        raw,
        matched: signals.length,
        pick: draftInfo?.pick ?? null,
        school,
        signals,
        qbTraits,
      })
    : baseCapped;

  const scoringVersion = agg.pos === 'QB' ? 'v210_qb_traits' : 'v22_clean';


  const out = {
    k: `${year}|${agg.pos}|${agg.normalized_name}`,
    n: agg.name,
    y: year,
    p: agg.pos,
    s: capped,
    raw,
    l: labelFromScore(capped),
    m: signals.length,
    src: scoringVersion,
    school,
    pick: draftInfo?.pick ?? null,
    seasons,
  };

  rows.push(out);

  auditRows.push({
    name: agg.name,
    year,
    pos: agg.pos,
    school,
    score: capped,
    raw,
    matched: signals.length,
    totalWeight: Number(totalWeight.toFixed(2)),
    label: labelFromScore(capped),
    pick: draftInfo?.pick ?? null,
    reason:
      signals.length < 5 ? 'NO_SCORE_LOW_FEATURE_MATCH' :
      capped !== calibrated ? 'CAPPED_LOW_CONFIDENCE' :
      'SCORED',
    qbTraits,
    topSignals: signals
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 5)
      .map(s => ({ label: s.label, value: s.value, percentile: s.percentile, contribution: s.contribution })),
  });
}

rows.sort((a, b) =>
  (a.y - b.y) ||
  String(a.p).localeCompare(String(b.p)) ||
  ((b.s ?? -1) - (a.s ?? -1))
);

const byYearPos = {};
const byPos = {};
const byReason = {};

for (const r of auditRows) {
  byYearPos[`${r.year}|${r.pos}`] = (byYearPos[`${r.year}|${r.pos}`] || 0) + 1;
  byPos[r.pos] = (byPos[r.pos] || 0) + 1;
  byReason[r.reason] = (byReason[r.reason] || 0) + 1;
}

fs.writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  model_version: 'college_model_v210_qb_traits_score_lookup',
  note: 'Clean season-data-only College Model v2.10 lookup. Adds final QB false-positive trim for pocket-only, raw-tool, and low-trait high-pick profiles.',
  rows,
}));

fs.writeFileSync(AUDIT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  model_version: 'college_model_v210_qb_traits_score_lookup',
  inputs: {
    season_lines: lineCount,
    real_season_lines: realSeasonLines,
    skipped_no_real_data: skippedNoRealData,
    skipped_bad_position: skippedBadPosition,
  },
  output: {
    rows: rows.length,
    scored_rows: rows.filter(r => r.s !== null).length,
    unscored_rows: rows.filter(r => r.s === null).length,
    byYearPos,
    byPos,
    byReason,
  },
  examples: {
    topQb: auditRows.filter(r => r.pos === 'QB' && r.score !== null).sort((a, b) => b.score - a.score).slice(0, 75),
    topWr: auditRows.filter(r => r.pos === 'WR' && r.score !== null).sort((a, b) => b.score - a.score).slice(0, 50),
    lowConfidence: auditRows.filter(r => r.reason !== 'SCORED').slice(0, 200),
  },
}, null, 2));

console.log('DONE');
console.log({
  season_lines: lineCount,
  real_season_lines: realSeasonLines,
  skipped_no_real_data: skippedNoRealData,
  skipped_bad_position: skippedBadPosition,
  players: aggByKey.size,
  rows: rows.length,
  scored_rows: rows.filter(r => r.s !== null).length,
  unscored_rows: rows.filter(r => r.s === null).length,
});
console.table(byPos);
console.table(byReason);
console.log('Wrote', OUT);
console.log('Wrote', AUDIT);
