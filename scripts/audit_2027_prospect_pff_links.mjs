import fs from 'fs';

function clean(s = '') {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/gi, '')
    .replace(/\bjunior\b/gi, '')
    .replace(/\bsenior\b/gi, '')
    .replace(/[^a-z0-9]/g, '');
}

function load(path) {
  if (!fs.existsSync(path)) return [];
  const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  return raw.records ?? raw;
}

const prospectFiles = [
  'public/data/prospects_2027_qb.json',
  'public/data/prospects_2027_wr.json',
].filter(fs.existsSync);

const pffFiles = {
  QB: 'public/data/qb_pff_seasons.json',
  WR: 'public/data/wr_pff_seasons.json',
};

const pffByPos = {};
for (const [pos, file] of Object.entries(pffFiles)) {
  const rows = load(file);
  const map = new Map();
  for (const r of rows) {
    const key = clean(r.name);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  pffByPos[pos] = map;
}

const prospects = [];
for (const file of prospectFiles) {
  const rows = load(file);
  for (const p of rows) prospects.push({ ...p, sourceFile: file });
}

const result = prospects.map(p => {
  const name = p.name;
  const pos = String(p.pos || '').toUpperCase();
  const draftYear = Number(p.draftSeason ?? p.year ?? 2027);
  const key = clean(name);
  const pffRows = pffByPos[pos]?.get(key) ?? [];
  const preDraft = pffRows.filter(r => Number(r.season) < draftYear);

  return {
    sourceFile: p.sourceFile,
    name,
    cleanName: key,
    pos,
    school: p.school,
    draftYear,
    status: !pffByPos[pos]
      ? 'NO_PFF_FILE_FOR_POS'
      : !pffRows.length
        ? 'NO_NAME_MATCH'
        : !preDraft.length
          ? 'NAME_MATCH_BUT_NO_PREDRAFT_SEASONS'
          : 'LINKED',
    pffSeasons: pffRows.map(r => r.season).sort(),
    preDraftSeasons: preDraft.map(r => r.season).sort(),
    pffNames: [...new Set(pffRows.map(r => r.name))],
  };
});

const summary = {};
for (const r of result) {
  summary[r.pos] ??= {};
  summary[r.pos][r.status] = (summary[r.pos][r.status] ?? 0) + 1;
}

console.log('2027 PFF LINK SUMMARY');
console.log(JSON.stringify(summary, null, 2));

console.log('\nMismatches:');
console.log(JSON.stringify(result.filter(r => r.status !== 'LINKED').slice(0, 100), null, 2));

fs.writeFileSync(
  'public/data/audit_2027_prospect_pff_links.json',
  JSON.stringify({ summary, result }, null, 2)
);
