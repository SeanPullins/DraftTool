import fs from 'fs';

const CAREER_IN = 'public/data/model/college_player_career_summary_2014_2025.json';
const SEASONS_IN = 'public/data/model/college_player_seasons_compact_2014_2025.json';

const COMBINE = 'public/data/combine.csv';
const DRAFT = 'public/data/draft_picks.csv';
const RAS = 'public/data/ras_main_table.csv';

const CAREER_OUT = 'public/data/model/college_player_career_summary_2014_2025_enriched.json';
const SEASONS_OUT = 'public/data/model/college_player_seasons_compact_2014_2025_enriched.json';
const REPORT_OUT = 'public/data/model/college_athletic_draft_join_report_2014_2025.json';

function cleanName(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cleanTeam(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normKey(s = '') {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"' && quoted && next === '"') {
      cur += '"';
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }

  out.push(cur);
  return out;
}

function parseCsv(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').replace(/\r/g, '').split('\n').filter(Boolean);
  if (!lines.length) return [];

  const headers = splitCsvLine(lines[0]).map(h => h.trim());

  return lines.slice(1).map(line => {
    const cells = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      const raw = cells[i] ?? '';
      const n = Number(raw);
      row[h] = raw !== '' && Number.isFinite(n) ? n : raw;
    });
    row.__headers = headers;
    return row;
  });
}

function pick(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== '') return row[name];
  }

  const normalized = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [normKey(k), v])
  );

  for (const name of names) {
    const nk = normKey(name);
    if (normalized[nk] !== undefined && normalized[nk] !== '') return normalized[nk];
  }

  return '';
}

function extractName(row) {
  return pick(row, [
    'player',
    'player_name',
    'name',
    'Player',
    'PLAYER',
    'full_name',
    'Full Name',
    'athlete',
    'athlete_name'
  ]);
}

function extractPos(row) {
  return String(pick(row, [
    'position',
    'pos',
    'Position',
    'POS',
    'draft_position'
  ]) || '').toUpperCase();
}

function extractCollege(row) {
  return pick(row, [
    'college',
    'school',
    'team',
    'School',
    'College',
    'college_name',
    'school_name'
  ]);
}

function extractDraftYear(row) {
  return num(pick(row, [
    'draft_year',
    'year',
    'season',
    'Draft Year',
    'draftYear'
  ]));
}

function extractPick(row) {
  return num(pick(row, [
    'pick',
    'overall',
    'overall_pick',
    'draft_pick',
    'pick_overall',
    'Overall',
    'Pick'
  ]));
}

function extractRound(row) {
  return num(pick(row, [
    'round',
    'draft_round',
    'Round'
  ]));
}

function makeKeys({ name, pos, college }) {
  const n = cleanName(name);
  const p = String(pos || '').toUpperCase();
  const c = cleanTeam(college);

  return [
    `${n}|${p}|${c}`,
    `${n}|${p}`,
    `${n}`,
  ];
}

function indexRows(rows, sourceName) {
  const byKey = new Map();

  for (const row of rows) {
    const name = extractName(row);
    if (!name) continue;

    const pos = extractPos(row);
    const college = extractCollege(row);

    for (const key of makeKeys({ name, pos, college })) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(row);
    }
  }

  return byKey;
}

function bestMatch(index, player) {
  const keys = makeKeys({
    name: player.player,
    pos: player.position,
    college: player.college || player.last_college,
  });

  for (const key of keys) {
    const rows = index.get(key);
    if (rows?.length) return rows[0];
  }

  return null;
}

function cleanPayload(row) {
  if (!row) return null;

  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === '__headers') continue;
    out[normKey(k)] = v;
  }
  return out;
}

function draftPayload(row) {
  if (!row) return null;

  return {
    ...cleanPayload(row),
    draft_year: extractDraftYear(row),
    round: extractRound(row),
    pick: extractPick(row),
    nfl_team: pick(row, ['team', 'nfl_team', 'draft_team', 'Team']),
  };
}

function athleticPayload(row, type) {
  if (!row) return null;

  const payload = cleanPayload(row);

  if (type === 'combine') {
    payload.height = pick(row, ['height', 'Height']);
    payload.weight = pick(row, ['weight', 'Weight']);
    payload.forty = pick(row, ['forty', '40yd', '40', 'forty_yard', 'forty_yard_dash']);
    payload.vertical = pick(row, ['vertical', 'vert', 'Vertical']);
    payload.broad = pick(row, ['broad', 'broad_jump', 'Broad Jump']);
    payload.three_cone = pick(row, ['three_cone', '3cone', 'cone', '3-cone']);
    payload.shuttle = pick(row, ['shuttle', 'short_shuttle', '20ss']);
  }

  if (type === 'ras') {
    payload.ras = pick(row, ['ras', 'RAS', 'ras_score', 'alltime_ras', 'relative_athletic_score']);
  }

  return payload;
}

const careerPayload = JSON.parse(fs.readFileSync(CAREER_IN, 'utf8'));
const seasonsPayload = JSON.parse(fs.readFileSync(SEASONS_IN, 'utf8'));

const careerRows = careerPayload.rows || [];
const seasonRows = seasonsPayload.rows || [];

const combineRows = parseCsv(COMBINE);
const draftRows = parseCsv(DRAFT);
const rasRows = parseCsv(RAS);

const combineIndex = indexRows(combineRows, 'combine');
const draftIndex = indexRows(draftRows, 'draft');
const rasIndex = indexRows(rasRows, 'ras');

let combineMatches = 0;
let draftMatches = 0;
let rasMatches = 0;

const enrichedCareer = careerRows.map(row => {
  const combine = bestMatch(combineIndex, row);
  const draft = bestMatch(draftIndex, row);
  const ras = bestMatch(rasIndex, row);

  if (combine) combineMatches++;
  if (draft) draftMatches++;
  if (ras) rasMatches++;

  return {
    ...row,
    athletic: {
      ...(row.athletic || {}),
      combine: athleticPayload(combine, 'combine'),
      ras: athleticPayload(ras, 'ras'),
    },
    draft: {
      ...(row.draft || {}),
      nfl_draft: draftPayload(draft),
    },
  };
});

const careerByNamePos = new Map();
for (const row of enrichedCareer) {
  careerByNamePos.set(`${row.normalized_name}|${row.position}`, row);
}

const enrichedSeasons = seasonRows.map(row => {
  const career = careerByNamePos.get(`${row.normalized_name}|${row.position}`);

  if (!career) return row;

  return {
    ...row,
    college: career.college,
    last_college: career.last_college,
    college_history: career.college_history,
    athletic: career.athletic || {},
    draft: career.draft || {},
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  careerRows: careerRows.length,
  seasonRows: seasonRows.length,
  sourceRows: {
    combine: combineRows.length,
    draft: draftRows.length,
    ras: rasRows.length,
  },
  matches: {
    combine: combineMatches,
    draft: draftMatches,
    ras: rasMatches,
  },
  matchRates: {
    combine: careerRows.length ? Number((combineMatches / careerRows.length).toFixed(4)) : 0,
    draft: careerRows.length ? Number((draftMatches / careerRows.length).toFixed(4)) : 0,
    ras: careerRows.length ? Number((rasMatches / careerRows.length).toFixed(4)) : 0,
  },
  sampleMatched: enrichedCareer
    .filter(r => r.athletic?.combine || r.athletic?.ras || r.draft?.nfl_draft)
    .slice(0, 30)
    .map(r => ({
      player: r.player,
      pos: r.position,
      college: r.college,
      combine: !!r.athletic?.combine,
      ras: !!r.athletic?.ras,
      draft: !!r.draft?.nfl_draft,
      pick: r.draft?.nfl_draft?.pick ?? null,
      ras_score: r.athletic?.ras?.ras ?? null,
    })),
};

fs.writeFileSync(CAREER_OUT, JSON.stringify({
  ...careerPayload,
  generatedAt: new Date().toISOString(),
  note: `${careerPayload.note || ''} Enriched with RAS, combine and draft data.`,
  rows: enrichedCareer,
}, null, 2));

fs.writeFileSync(SEASONS_OUT, JSON.stringify({
  ...seasonsPayload,
  generatedAt: new Date().toISOString(),
  note: `${seasonsPayload.note || ''} Enriched with career-level RAS, combine and draft data.`,
  rows: enrichedSeasons,
}, null, 2));

fs.writeFileSync(REPORT_OUT, JSON.stringify(report, null, 2));

console.log('DONE');
console.log('Career rows:', careerRows.length);
console.log('Season rows:', seasonRows.length);
console.log('Source rows:', report.sourceRows);
console.log('Matches:', report.matches);
console.log('Match rates:', report.matchRates);
console.log(`Wrote ${CAREER_OUT}`);
console.log(`Wrote ${SEASONS_OUT}`);
console.log(`Wrote ${REPORT_OUT}`);
