import fs from 'fs';

const CAREER_IN = 'public/data/model/college_player_career_summary_2014_2025_enriched.json';

const SEASONAL = 'data/nfl_outcomes/nfl_seasonal_2014_2025.csv';
const WEEKLY = 'data/nfl_outcomes/nfl_weekly_2014_2025.csv';
const PBP_QB = 'data/nfl_outcomes/nfl_pbp_qb_outcomes_2014_2025.csv';
const PBP_RUSHING = 'data/nfl_outcomes/nfl_pbp_rushing_outcomes_2014_2025.csv';
const PBP_RECEIVING = 'data/nfl_outcomes/nfl_pbp_receiving_outcomes_2014_2025.csv';
const ROSTERS = 'data/nfl_outcomes/nfl_rosters_2014_2025.csv';
const DRAFT = 'data/nfl_outcomes/nfl_draft_picks.csv';
const NGS_PASSING = 'data/nfl_outcomes/nfl_ngs_passing_2014_2025.csv';
const NGS_RECEIVING = 'data/nfl_outcomes/nfl_ngs_receiving_2014_2025.csv';
const NGS_RUSHING = 'data/nfl_outcomes/nfl_ngs_rushing_2014_2025.csv';
const NFL_PLAYERS = 'data/nfl_outcomes/nfl_players.csv';
const NFL_IDS = 'data/nfl_outcomes/nfl_ids.csv';

const OUT_OUTCOMES = 'public/data/model/nfl_player_outcomes_2014_2025.json';
const OUT_JOINED = 'public/data/model/college_player_career_summary_2014_2025_with_nfl_outcomes.json';
const OUT_REPORT = 'public/data/model/college_nfl_outcome_join_report_2014_2025.json';

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
  if (!fs.existsSync(file)) {
    console.warn(`Missing ${file}`);
    return [];
  }

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
    return row;
  });
}

function pick(row, names) {
  if (!row) return '';

  for (const name of names) {
    if (row[name] !== undefined && row[name] !== '') return row[name];
  }

  const normalized = Object.fromEntries(Object.entries(row).map(([k, v]) => [normKey(k), v]));
  for (const name of names) {
    const nk = normKey(name);
    if (normalized[nk] !== undefined && normalized[nk] !== '') return normalized[nk];
  }

  return '';
}

function rowPlayerName(row) {
  return pick(row, [
    'player_name',
    'player_display_name',
    'player',
    'name',
    'full_name',
    'pfr_player_name'
  ]);
}

function rowPlayerId(row) {
  return pick(row, [
    'player_id',
    'gsis_id',
    'nflverse_id',
    'pfr_player_id',
    'pfr_id'
  ]);
}

function rowPosition(row) {
  return String(pick(row, ['position', 'pos', 'draft_position']) || '').toUpperCase();
}

function rowCollege(row) {
  return pick(row, ['college', 'college_name', 'school', 'team']);
}

function rowDraftSeason(row) {
  return num(pick(row, ['season', 'draft_year', 'year']));
}

function rowPick(row) {
  return num(pick(row, ['pick', 'overall', 'overall_pick', 'draft_pick', 'pick_overall']));
}

function rowRound(row) {
  return num(pick(row, ['round', 'draft_round']));
}

function addStat(obj, key, value) {
  const n = num(value);
  if (n === null) return;
  obj[key] = (obj[key] || 0) + n;
}

function maxStat(obj, key, value) {
  const n = num(value);
  if (n === null) return;
  obj[key] = Math.max(obj[key] ?? -Infinity, n);
}

function safeDiv(a, b) {
  return b ? a / b : 0;
}

function outcomeLabel(score) {
  if (score >= 85) return 'Elite';
  if (score >= 70) return 'Core Starter';
  if (score >= 55) return 'Starter / Useful Hit';
  if (score >= 35) return 'Contributor';
  return 'Miss';
}

function hitMiss(score) {
  return score >= 55 ? 'Hit' : 'Miss';
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function scoreOutcome(o) {
  const pos = String(o.position || '').toUpperCase();

  const games = Number(o.games || 0);
  const starts = Number(o.starts || 0);
  const seasons = Number(o.nfl_seasons || 0);

  const longevityScore = clamp(seasons / 8 * 12, 0, 12);
  const gamesScore = clamp(games / 110 * 10, 0, 10);
  const startsBonus = starts > 0 ? clamp(starts / 80 * 10, 0, 10) : 0;

  let productionScore = 0;

  if (pos === 'QB') {
    productionScore += clamp((o.passing_yards || 0) / 40000 * 34, 0, 34);
    productionScore += clamp((o.passing_tds || 0) / 280 * 18, 0, 18);
    productionScore -= clamp((o.interceptions || 0) / 120 * 6, 0, 6);
    productionScore += clamp((o.rushing_yards || 0) / 4500 * 10, 0, 10);
    productionScore += clamp((o.passing_epa || 0) / 1000 * 16, 0, 16);
  } else if (['WR', 'TE'].includes(pos)) {
    productionScore += clamp((o.receiving_yards || 0) / 9000 * 42, 0, 42);
    productionScore += clamp((o.receptions || 0) / 650 * 14, 0, 14);
    productionScore += clamp((o.receiving_tds || 0) / 75 * 12, 0, 12);
    productionScore += clamp((o.receiving_epa || 0) / 700 * 12, 0, 12);
  } else if (pos === 'RB') {
    const scrimmageYards = Number(o.rushing_yards || 0) + Number(o.receiving_yards || 0);
    const scrimmageTds = Number(o.rushing_tds || 0) + Number(o.receiving_tds || 0);

    productionScore += clamp(scrimmageYards / 10000 * 44, 0, 44);
    productionScore += clamp(scrimmageTds / 80 * 16, 0, 16);
    productionScore += clamp((o.rushing_epa || 0) / 500 * 8, 0, 8);
    productionScore += clamp((o.receiving_epa || 0) / 350 * 8, 0, 8);
  } else {
    // Until we add AV/PFR/snap-based outcomes for OL/defense, use longevity/games/starts.
    productionScore += clamp(starts / 85 * 45, 0, 45);
    productionScore += clamp(games / 120 * 25, 0, 25);
  }

  const raw = longevityScore + gamesScore + startsBonus + productionScore;
  return Number(clamp(raw, 0, 100).toFixed(1));
}


const careerPayload = JSON.parse(fs.readFileSync(CAREER_IN, 'utf8'));
const careerRows = careerPayload.rows || [];

const seasonal = parseCsv(SEASONAL);
const weekly = parseCsv(WEEKLY);
const pbpQb = parseCsv(PBP_QB);
const pbpRushing = parseCsv(PBP_RUSHING);
const pbpReceiving = parseCsv(PBP_RECEIVING);
const rosters = parseCsv(ROSTERS);
const draft = parseCsv(DRAFT);
const ngsPassing = parseCsv(NGS_PASSING);
const ngsReceiving = parseCsv(NGS_RECEIVING);
const ngsRushing = parseCsv(NGS_RUSHING);
const nflPlayers = parseCsv(NFL_PLAYERS);
const nflIds = parseCsv(NFL_IDS);

console.log('Loaded rows:', {
  career: careerRows.length,
  seasonal: seasonal.length,
  weekly: weekly.length,
  pbpQb: pbpQb.length,
  pbpRushing: pbpRushing.length,
  pbpReceiving: pbpReceiving.length,
  rosters: rosters.length,
  draft: draft.length,
  ngsPassing: ngsPassing.length,
  ngsReceiving: ngsReceiving.length,
  ngsRushing: ngsRushing.length,
  nflPlayers: nflPlayers.length,
  nflIds: nflIds.length,
});

// Build NFL identity maps so PBP abbreviated names can resolve to full player names.
const nflIdentityById = new Map();

function addIdentity(id, payload) {
  if (!id) return;
  const key = String(id);
  const existing = nflIdentityById.get(key) || {};
  nflIdentityById.set(key, {
    ...existing,
    ...Object.fromEntries(Object.entries(payload).filter(([_, v]) => v !== undefined && v !== null && v !== '')),
  });
}

for (const r of nflPlayers) {
  const ids = [
    pick(r, ['gsis_id', 'gsis_it_id']),
    pick(r, ['nfl_id']),
    pick(r, ['nflverse_id']),
    pick(r, ['pfr_id', 'pfr_player_id']),
    pick(r, ['sportradar_id']),
    pick(r, ['espn_id']),
  ].filter(Boolean);

  const payload = {
    player: pick(r, ['display_name', 'full_name', 'football_name', 'name', 'player_name']),
    position: rowPosition(r),
    college: rowCollege(r),
  };

  ids.forEach(id => addIdentity(id, payload));
}

for (const r of nflIds) {
  const ids = [
    pick(r, ['gsis_id', 'gsis_it_id']),
    pick(r, ['nfl_id']),
    pick(r, ['nflverse_id']),
    pick(r, ['pfr_id', 'pfr_player_id']),
    pick(r, ['sportradar_id']),
    pick(r, ['espn_id']),
  ].filter(Boolean);

  const payload = {
    player: pick(r, ['name', 'player_name', 'full_name', 'display_name']),
    position: rowPosition(r),
    college: rowCollege(r),
  };

  ids.forEach(id => addIdentity(id, payload));
}

function resolvedPlayerName(row) {
  const id = rowPlayerId(row);
  const identity = id ? nflIdentityById.get(String(id)) : null;
  return identity?.player || rowPlayerName(row);
}

function resolvedPosition(row, fallback = '') {
  const id = rowPlayerId(row);
  const identity = id ? nflIdentityById.get(String(id)) : null;
  return String(identity?.position || rowPosition(row) || fallback || '').toUpperCase();
}

// Build draft map to connect player name/position/college to IDs.
const draftById = new Map();
const draftByNamePos = new Map();
const draftByNameOnly = new Map();

for (const r of draft) {
  const name = rowPlayerName(r);
  const pos = rowPosition(r);
  const college = rowCollege(r);
  const id = rowPlayerId(r);
  const season = rowDraftSeason(r);
  const overallPick = rowPick(r);
  const round = rowRound(r);

  const payload = {
    player: name,
    normalized_name: cleanName(name),
    position: pos,
    college,
    draft_year: season,
    pick: overallPick,
    round,
    nfl_team: pick(r, ['team', 'draft_team']),
    player_id: id,
  };

  if (id) draftById.set(String(id), payload);

  const namePos = `${cleanName(name)}|${pos}`;
  if (!draftByNamePos.has(namePos)) draftByNamePos.set(namePos, []);
  draftByNamePos.get(namePos).push(payload);

  const nameOnly = cleanName(name);
  if (!draftByNameOnly.has(nameOnly)) draftByNameOnly.set(nameOnly, []);
  draftByNameOnly.get(nameOnly).push(payload);
}

function createOutcomeFromBase({ id, name, position }) {
  return {
    player_id: id || '',
    player: name || '',
    normalized_name: cleanName(name),
    position: String(position || '').toUpperCase(),

    nfl_seasons_set: new Set(),
    nfl_seasons: 0,

    games: 0,
    starts: 0,

    passing_yards: 0,
    passing_tds: 0,
    interceptions: 0,
    sacks: 0,

    carries: 0,
    rushing_yards: 0,
    rushing_tds: 0,

    targets: 0,
    receptions: 0,
    receiving_yards: 0,
    receiving_tds: 0,

    fumbles: 0,

    ngs: {},
    draft: null,
  };
}

const outcomeById = new Map();
const outcomeByNamePos = new Map();

function getOutcome({ id, name, position }) {
  const clean = cleanName(name);
  const pos = String(position || '').toUpperCase();

  if (id && outcomeById.has(String(id))) return outcomeById.get(String(id));

  const namePos = `${clean}|${pos}`;
  if (outcomeByNamePos.has(namePos)) return outcomeByNamePos.get(namePos);

  const o = createOutcomeFromBase({ id, name, position: pos });

  if (id) outcomeById.set(String(id), o);
  outcomeByNamePos.set(namePos, o);

  return o;
}

// Seasonal player stats: main production layer.
for (const r of seasonal) {
  const id = rowPlayerId(r);
  const name = rowPlayerName(r);
  const pos = rowPosition(r);
  const season = num(pick(r, ['season']));

  if (!name || !pos) continue;

  const o = getOutcome({ id, name, position: pos });
  if (season) o.nfl_seasons_set.add(season);

  addStat(o, 'games', pick(r, ['games', 'g']));
  addStat(o, 'passing_yards', pick(r, ['passing_yards']));
  addStat(o, 'passing_tds', pick(r, ['passing_tds']));
  addStat(o, 'interceptions', pick(r, ['interceptions']));
  addStat(o, 'sacks', pick(r, ['sacks']));

  addStat(o, 'games', pick(r, ['games']));
  addStat(o, 'carries', pick(r, ['carries']));
  addStat(o, 'rushing_yards', pick(r, ['rushing_yards']));
  addStat(o, 'rushing_tds', pick(r, ['rushing_tds']));

  addStat(o, 'games', pick(r, ['games']));
  addStat(o, 'targets', pick(r, ['targets']));
  addStat(o, 'receptions', pick(r, ['receptions']));
  addStat(o, 'receiving_yards', pick(r, ['receiving_yards']));
  addStat(o, 'receiving_tds', pick(r, ['receiving_tds']));
  addStat(o, 'fumbles', pick(r, ['fumbles']));
}

// PBP-derived QB outcomes.
for (const r of pbpQb) {
  const id = rowPlayerId(r);
  const name = resolvedPlayerName(r);
  const pos = resolvedPosition(r, 'QB') || 'QB';

  if (!name) continue;

  const o = getOutcome({ id, name, position: pos });

  o.nfl_seasons = Math.max(o.nfl_seasons || 0, Number(pick(r, ['nfl_seasons'])) || 0);

  addStat(o, 'games', pick(r, ['games']));
  addStat(o, 'passing_yards', pick(r, ['passing_yards']));
  addStat(o, 'passing_tds', pick(r, ['passing_tds']));
  addStat(o, 'interceptions', pick(r, ['interceptions']));
  addStat(o, 'sacks', pick(r, ['sacks']));
  addStat(o, 'passing_epa', pick(r, ['passing_epa']));
}

// PBP-derived rushing outcomes.
for (const r of pbpRushing) {
  const id = rowPlayerId(r);
  const name = resolvedPlayerName(r);

  if (!name) continue;

  // Use ID/name first; position can be corrected by roster/draft later.
  const o = getOutcome({ id, name, position: resolvedPosition(r, 'RB') || 'RB' });

  o.nfl_seasons = Math.max(o.nfl_seasons || 0, Number(pick(r, ['nfl_seasons'])) || 0);

  addStat(o, 'games', pick(r, ['games']));
  addStat(o, 'carries', pick(r, ['carries']));
  addStat(o, 'rushing_yards', pick(r, ['rushing_yards']));
  addStat(o, 'rushing_tds', pick(r, ['rushing_tds']));
  addStat(o, 'rushing_epa', pick(r, ['rushing_epa']));
}

// PBP-derived receiving outcomes.
for (const r of pbpReceiving) {
  const id = rowPlayerId(r);
  const name = resolvedPlayerName(r);

  if (!name) continue;

  // Use ID/name first; position can be corrected by roster/draft later.
  const o = getOutcome({ id, name, position: resolvedPosition(r, 'WR') || 'WR' });

  o.nfl_seasons = Math.max(o.nfl_seasons || 0, Number(pick(r, ['nfl_seasons'])) || 0);

  addStat(o, 'games', pick(r, ['games']));
  addStat(o, 'targets', pick(r, ['targets']));
  addStat(o, 'receptions', pick(r, ['receptions']));
  addStat(o, 'receiving_yards', pick(r, ['receiving_yards']));
  addStat(o, 'receiving_tds', pick(r, ['receiving_tds']));
  addStat(o, 'receiving_epa', pick(r, ['receiving_epa']));
  addStat(o, 'air_yards', pick(r, ['air_yards']));
  addStat(o, 'yards_after_catch', pick(r, ['yards_after_catch']));
}

// Rosters: starts/games/longevity if available.
for (const r of rosters) {
  const id = rowPlayerId(r);
  const name = rowPlayerName(r);
  const pos = rowPosition(r);
  const season = num(pick(r, ['season']));

  if (!name || !pos) continue;

  const o = getOutcome({ id, name, position: pos });
  if (season) o.nfl_seasons_set.add(season);

  addStat(o, 'games', pick(r, ['games', 'g']));
  addStat(o, 'starts', pick(r, ['starts', 'gs', 'games_started']));
}

// NGS compact rollups.
function mergeNgs(rows, type) {
  for (const r of rows) {
    const id = rowPlayerId(r);
    const name = rowPlayerName(r);
    const pos = rowPosition(r) || (type === 'passing' ? 'QB' : '');
    const season = num(pick(r, ['season']));

    if (!name) continue;

    const o = getOutcome({ id, name, position: pos });
    if (season) o.nfl_seasons_set.add(season);

    o.ngs[type] ||= {};

    for (const [k, v] of Object.entries(r)) {
      const nk = normKey(k);
      const n = num(v);
      if (n === null) continue;

      const field = `${nk}_sum`;
      o.ngs[type][field] = (o.ngs[type][field] || 0) + n;
    }
  }
}

mergeNgs(ngsPassing, 'passing');
mergeNgs(ngsReceiving, 'receiving');
mergeNgs(ngsRushing, 'rushing');

// Attach draft data where possible.
for (const o of outcomeByNamePos.values()) {
  if (o.player_id && draftById.has(o.player_id)) {
    o.draft = draftById.get(o.player_id);
  } else {
    const candidates = draftByNamePos.get(`${o.normalized_name}|${o.position}`) || draftByNameOnly.get(o.normalized_name) || [];
    o.draft = candidates[0] || null;
  }

  o.nfl_seasons = Math.max(Number(o.nfl_seasons || 0), o.nfl_seasons_set.size);
  delete o.nfl_seasons_set;

  o.nfl_outcome_score = scoreOutcome(o);
  o.nfl_outcome_label = outcomeLabel(o.nfl_outcome_score);
  o.hit_miss = hitMiss(o.nfl_outcome_score);
}

// Index outcomes for college join.
const outcomes = Array.from(outcomeByNamePos.values())
  .filter(o => o.player)
  .filter(o => String(o.position || '').trim() !== '')
  .sort((a, b) => b.nfl_outcome_score - a.nfl_outcome_score);

const outcomeByNamePosition = new Map();
const outcomeByName = new Map();

for (const o of outcomes) {
  const np = `${o.normalized_name}|${o.position}`;
  if (!outcomeByNamePosition.has(np)) outcomeByNamePosition.set(np, []);
  outcomeByNamePosition.get(np).push(o);

  if (!outcomeByName.has(o.normalized_name)) outcomeByName.set(o.normalized_name, []);
  outcomeByName.get(o.normalized_name).push(o);
}

function matchOutcome(collegeRow) {
  const name = collegeRow.normalized_name || cleanName(collegeRow.player);
  const pos = String(collegeRow.position || '').toUpperCase();

  const exact = outcomeByNamePosition.get(`${name}|${pos}`) || [];
  if (exact.length) return { outcome: exact[0], confidence: 'name+position' };

  const nameOnly = outcomeByName.get(name) || [];
  if (nameOnly.length === 1) return { outcome: nameOnly[0], confidence: 'name_only_unique' };

  return { outcome: null, confidence: 'unmatched' };
}

let matched = 0;
let unmatched = 0;
const unmatchedSamples = [];

const joinedCareer = careerRows.map(row => {
  const { outcome, confidence } = matchOutcome(row);

  if (outcome) matched++;
  else {
    unmatched++;
    if (unmatchedSamples.length < 100) {
      unmatchedSamples.push({
        player: row.player,
        position: row.position,
        college: row.college,
      });
    }
  }

  return {
    ...row,
    nfl_outcome: outcome ? {
      player_id: outcome.player_id,
      player: outcome.player,
      position: outcome.position,
      nfl_seasons: outcome.nfl_seasons,
      games: outcome.games,
      starts: outcome.starts,
      passing_yards: outcome.passing_yards,
      passing_tds: outcome.passing_tds,
      interceptions: outcome.interceptions,
      rushing_yards: outcome.rushing_yards,
      rushing_tds: outcome.rushing_tds,
      receptions: outcome.receptions,
      receiving_yards: outcome.receiving_yards,
      receiving_tds: outcome.receiving_tds,
      draft: outcome.draft,
      nfl_outcome_score: outcome.nfl_outcome_score,
      nfl_outcome_label: outcome.nfl_outcome_label,
      hit_miss: outcome.hit_miss,
      match_confidence: confidence,
    } : {
      nfl_outcome_score: 0,
      nfl_outcome_label: 'No NFL Match',
      hit_miss: 'Miss',
      match_confidence: confidence,
    },
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  sourceRows: {
    career: careerRows.length,
    seasonal: seasonal.length,
    pbpQb: pbpQb.length,
    pbpRushing: pbpRushing.length,
    pbpReceiving: pbpReceiving.length,
    rosters: rosters.length,
    draft: draft.length,
    ngsPassing: ngsPassing.length,
    ngsReceiving: ngsReceiving.length,
    ngsRushing: ngsRushing.length,
  },
  outcomeRows: outcomes.length,
  join: {
    matched,
    unmatched,
    matchRate: Number((matched / Math.max(1, careerRows.length)).toFixed(4)),
  },
  byOutcomeLabel: joinedCareer.reduce((acc, r) => {
    const label = r.nfl_outcome?.nfl_outcome_label || 'Unknown';
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {}),
  unmatchedSamples,
  topOutcomes: outcomes.slice(0, 50).map(o => ({
    player: o.player,
    position: o.position,
    score: o.nfl_outcome_score,
    label: o.nfl_outcome_label,
    games: o.games,
    starts: o.starts,
    pass_yards: o.passing_yards,
    rush_yards: o.rushing_yards,
    rec_yards: o.receiving_yards,
  })),
};

fs.writeFileSync(OUT_OUTCOMES, JSON.stringify({
  generatedAt: new Date().toISOString(),
  rowType: 'nfl_player_outcome',
  note: 'NFL outcome labels built from nfl_data_py seasonal, roster, draft and NGS files. Score is first-pass proxy; can be improved with AV/PFR later.',
  rows: outcomes.map(o => ({
    ...o,
    ngs: undefined,
  })),
}, null, 2));

fs.writeFileSync(OUT_JOINED, JSON.stringify({
  ...careerPayload,
  generatedAt: new Date().toISOString(),
  note: `${careerPayload.note || ''} Joined with NFL outcome labels from nfl_data_py.`,
  rows: joinedCareer,
}, null, 2));

fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2));

console.log('DONE');
console.log('Outcome rows:', outcomes.length);
console.log('Join:', report.join);
console.log('By label:', report.byOutcomeLabel);
console.log(`Wrote ${OUT_OUTCOMES}`);
console.log(`Wrote ${OUT_JOINED}`);
console.log(`Wrote ${OUT_REPORT}`);
