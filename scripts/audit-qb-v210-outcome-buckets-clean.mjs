import fs from 'fs';

const SCORES = 'public/data/model/college_model_v210_qb_traits_score_lookup.json';
const OUT = 'public/data/model/college_model_v210_qb_outcome_bucket_audit_clean.json';

function cleanName(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function bucket(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return 'No Score';
  if (s >= 85) return '85+ Elite';
  if (s >= 80) return '80-84 Franchise/Core';
  if (s >= 75) return '75-79 High Starter';
  if (s >= 70) return '70-74 Developmental Starter';
  if (s >= 60) return '60-69 Backup/Longshot';
  return '<60 Low';
}

// Temporary clean validation labels.
// This is intentionally conservative and only for 2015-2022 classes.
const LABELS = {
  // Elite / franchise-core
  patrickmahomes: 'Elite',
  lamarjackson: 'Elite',

  joeburrow: 'Core Starter',
  joshallen: 'Core Starter',
  jaredgoff: 'Core Starter',
  dakprescott: 'Core Starter',
  deshaunwatson: 'Core Starter',
  justinherbert: 'Core Starter',
  jalenhurts: 'Core Starter',
  brockpurdy: 'Core Starter',

  bakermayfield: 'Starter / Useful Hit',
  kylermurray: 'Starter / Useful Hit',
  tuatagovailoa: 'Starter / Useful Hit',
  trevorlawrence: 'Starter / Useful Hit',
  jordanlove: 'Starter / Useful Hit',

  // Useful contributors / partial starters
  samdarnold: 'Contributor',
  danieljones: 'Contributor',
  jacobybrissett: 'Contributor',
  gardnerminshew: 'Contributor',
  marcusmariota: 'Contributor',
  jameiswinston: 'Contributor',
  carsonwentz: 'Contributor',

  // Misses / disappointments relative to draft capital
  joshrosen: 'Miss',
  dwaynehaskins: 'Miss',
  zachwilson: 'Miss',
  treylance: 'Miss',
  justinfields: 'Miss',
  macjones: 'Miss',
  kennypickett: 'Miss',
  paxtonlynch: 'Miss',
  mitchtrubisky: 'Miss',
  deshonkizer: 'Miss',
  drewlock: 'Miss',
  willgrier: 'Miss',
  masonrudolph: 'Miss',
  baileyzappe: 'Miss',
  brandondoughty: 'Miss',
  brendondoughty: 'Miss',
  zachterrell: 'Miss',
  anthonygordon: 'Miss',
  lukefalk: 'Miss',
};

function isHit(label) {
  return ['Elite', 'Core Starter', 'Starter / Useful Hit'].includes(label);
}

const scores = JSON.parse(fs.readFileSync(SCORES, 'utf8')).rows || [];

const joined = [];

for (const r of scores) {
  if (String(r.p || r.pos).toUpperCase() !== 'QB') continue;

  const year = Number(r.y || r.year);
  const name = r.n || r.name || '';
  const key = cleanName(name);
  const score = Number(r.s ?? r.score);

  // Hold out immature classes.
  if (year >= 2023) continue;
  if (year < 2015) continue;

  const label = LABELS[key] || 'Miss';

  joined.push({
    year,
    name,
    score,
    bucket: bucket(score),
    matched: Number(r.m ?? r.matched ?? 0),
    pick: r.pick ?? null,
    outcome_label: label,
    hit: isHit(label),
  });
}

function summarize(rows) {
  const n = rows.length;
  const hits = rows.filter(r => r.hit).length;
  return {
    n,
    hit_rate: n ? Number((hits / n).toFixed(3)) : null,
    elite: rows.filter(r => r.outcome_label === 'Elite').length,
    core: rows.filter(r => r.outcome_label === 'Core Starter').length,
    starter: rows.filter(r => r.outcome_label === 'Starter / Useful Hit').length,
    contributor: rows.filter(r => r.outcome_label === 'Contributor').length,
    miss: rows.filter(r => r.outcome_label === 'Miss').length,
    avg_score: n ? Number((rows.reduce((a, r) => a + r.score, 0) / n).toFixed(1)) : null,
  };
}

const byBucket = {};
for (const r of joined) {
  byBucket[r.bucket] ||= [];
  byBucket[r.bucket].push(r);
}

const bucketSummary = Object.fromEntries(
  Object.entries(byBucket).map(([k, v]) => [k, summarize(v)])
);

const highScoreMisses = joined
  .filter(r => r.score >= 75 && !r.hit)
  .sort((a, b) => b.score - a.score);

const lowScoreHits = joined
  .filter(r => r.score < 70 && r.hit)
  .sort((a, b) => a.score - b.score);

const out = {
  generatedAt: new Date().toISOString(),
  model_version: 'college_model_v210_qb_traits_score_lookup',
  validation_scope: '2015-2022 only; 2023+ held out as immature',
  joined_rows: joined.length,
  bucketSummary,
  highScoreMisses,
  lowScoreHits,
  allJoined: joined.sort((a, b) => b.score - a.score),
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

console.log('DONE');
console.log('joined_rows:', joined.length);
console.log('\nBucket summary');
console.table(bucketSummary);

console.log('\nHigh score misses');
console.table(highScoreMisses.slice(0, 40).map(r => ({
  year: r.year,
  name: r.name,
  score: r.score,
  bucket: r.bucket,
  outcome: r.outcome_label,
})));

console.log('\nLow score hits');
console.table(lowScoreHits.slice(0, 40).map(r => ({
  year: r.year,
  name: r.name,
  score: r.score,
  bucket: r.bucket,
  outcome: r.outcome_label,
})));
