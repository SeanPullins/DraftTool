import fs from 'fs';
import zlib from 'zlib';

export function clean(s = '') {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (c === '"' && quoted && next === '"') {
      cell += '"';
      i++;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && next === '\n') i++;
      row.push(cell);
      cell = '';

      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else {
      cell += c;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  if (!rows.length) return [];

  const headers = rows.shift().map((h) => h.trim());

  return rows.map((r) =>
    Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))
  );
}

export function pick(row, keys) {
  for (const key of keys) {
    if (row && row[key] != null && row[key] !== '') return row[key];
  }
  return '';
}

export function num(value) {
  if (value == null || value === '') return null;

  const n = Number(String(value).replace('%', '').trim());
  return Number.isFinite(n) ? n : null;
}

export function mean(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

export function std(values) {
  const m = mean(values);
  const variance = mean(values.map((value) => (value - m) ** 2));
  return Math.sqrt(variance) || 1;
}

export function clamp(value, min = 0, max = 99) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 50));
}

export function normPos(pos = '') {
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

export function group(pos = '') {
  const p = normPos(pos);

  if (p === 'QB') return 'QB';
  if (['RB', 'WR', 'TE'].includes(p)) return 'SKILL';
  if (p === 'OL') return 'OL';
  if (['DL', 'EDGE', 'LB'].includes(p)) return 'FRONT';
  if (['CB', 'S'].includes(p)) return 'DB';

  return 'OTHER';
}

export function draftScore(pickNo) {
  return clamp(
    100 - (Math.log(Math.max(1, pickNo)) / Math.log(260)) * 100,
    1,
    99
  );
}

export function ageScore(age, pos) {
  const a = Number(age ?? 22);
  const p = normPos(pos);
  const g = group(pos);

  if (p === 'QB') {
    if (a <= 20.8) return 92;
    if (a <= 21.6) return 82;
    if (a <= 22.8) return 70;
    if (a <= 24.0) return 56;
    if (a <= 25.5) return 44;
    return 32;
  }

  if (p === 'RB') {
    if (a <= 20.3) return 94;
    if (a <= 21.0) return 84;
    if (a <= 21.8) return 72;
    if (a <= 22.6) return 60;
    if (a <= 23.5) return 48;
    return 34;
  }

  if (g === 'OL') {
    if (a <= 21.5) return 84;
    if (a <= 22.5) return 74;
    if (a <= 24.0) return 64;
    if (a <= 25.5) return 54;
    if (a <= 27.0) return 44;
    return 36;
  }

  if (g === 'FRONT') {
    if (a <= 21.0) return 90;
    if (a <= 22.0) return 80;
    if (a <= 23.0) return 68;
    if (a <= 24.0) return 58;
    if (a <= 25.0) return 48;
    return 36;
  }

  if (a <= 20.8) return 90;
  if (a <= 21.6) return 80;
  if (a <= 22.5) return 68;
  if (a <= 23.5) return 58;
  if (a <= 24.5) return 50;
  return 38;
}

export function loadPffPayload() {
  if (fs.existsSync('public/data/pff_comparison_profiles.json')) {
    const raw = fs.readFileSync(
      'public/data/pff_comparison_profiles.json',
      'utf8'
    );

    if (raw.trim().startsWith('{')) {
      return JSON.parse(raw);
    }
  }

  if (fs.existsSync('public/data/pff_comparison_profiles.json.gz.b64')) {
    const encoded = fs
      .readFileSync('public/data/pff_comparison_profiles.json.gz.b64', 'utf8')
      .replace(/\s/g, '');

    const json = zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8');
    return JSON.parse(json);
  }

  return null;
}

export function normalizePffProfiles(profiles = []) {
  return profiles
    .map((profile) => {
      if (!Array.isArray(profile)) {
        const name = profile.name;
        const position = normPos(profile.position ?? profile.pos);
        const draftSeason = Number(profile.draftSeason ?? profile.year);

        return {
          id: profile.id ?? `${clean(name)}|${draftSeason}|${position}`,
          name,
          college: profile.college ?? profile.school ?? '',
          position,
          draftSeason,
          pff: {
            composite: Number(profile.pff?.composite ?? profile.pffComposite ?? 50),
            grade: Number(
              profile.pff?.grade ??
                profile.pffGrade ??
                profile.pff?.composite ??
                profile.pffComposite ??
                50
            ),
            production: Number(profile.pff?.production ?? profile.pffProduction ?? 50),
            efficiency: Number(profile.pff?.efficiency ?? profile.pffEfficiency ?? 50),
            clean: Number(profile.pff?.clean ?? profile.pffClean ?? 50),
          },
        };
      }

      const [
        name,
        college,
        rawPos,
        draftSeason,
        composite,
        grade,
        production,
        efficiency,
        cleanPlay,
      ] = profile;

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
      };
    })
    .filter((p) => p.name && p.position && p.draftSeason);
}

export function loadJsonRecords(path) {
  if (!fs.existsSync(path)) return [];

  try {
    const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw.records)) return raw.records;
    if (Array.isArray(raw.players)) return raw.players;
    if (Array.isArray(raw.data)) return raw.data;
    return [];
  } catch {
    return [];
  }
}

export function loadPffSeasonStore() {
  const files = [
    'qb_pff_seasons.json',
    'wr_pff_seasons.json',
    'rb_pff_seasons.json',
    'te_pff_seasons.json',
    'ol_pff_seasons.json',
    'ot_pff_seasons.json',
    'iol_pff_seasons.json',
    'edge_pff_seasons.json',
    'dl_pff_seasons.json',
    'idl_pff_seasons.json',
    'lb_pff_seasons.json',
    'cb_pff_seasons.json',
    's_pff_seasons.json',
  ];

  const store = {};

  for (const file of files) {
    const path = `public/data/${file}`;
    const records = loadJsonRecords(path);

    if (records.length) {
      store[file] = records;
    }
  }

  return store;
}

export function pffSeasonFilesForPos(pos = '') {
  const p = normPos(pos);

  if (p === 'QB') return ['qb_pff_seasons.json'];
  if (p === 'WR') return ['wr_pff_seasons.json'];
  if (p === 'RB') return ['rb_pff_seasons.json'];
  if (p === 'TE') return ['te_pff_seasons.json'];
  if (p === 'OL') return ['ol_pff_seasons.json', 'ot_pff_seasons.json', 'iol_pff_seasons.json'];
  if (p === 'EDGE') return ['edge_pff_seasons.json', 'dl_pff_seasons.json'];
  if (p === 'DL') return ['dl_pff_seasons.json', 'idl_pff_seasons.json'];
  if (p === 'LB') return ['lb_pff_seasons.json'];
  if (p === 'CB') return ['cb_pff_seasons.json'];
  if (p === 'S') return ['s_pff_seasons.json'];

  return [];
}

export function rowName(row) {
  return String(row.name ?? row.player ?? row.player_name ?? '');
}

export function rowSeason(row) {
  return num(row.season ?? row.year);
}

export function rowNumber(row, keys) {
  for (const key of keys) {
    const value = row[key];
    const n = num(value);
    if (n != null) return n;
  }

  return null;
}

export function genericPffSeasonScore(row, pos) {
  const p = normPos(pos);

  const common = [
    'pff_grade',
    'overall_grade',
    'grade',
    'grades_overall',
    'offense_grade',
    'defense_grade',
    'grades_offense',
    'grades_defense',
  ];

  const byPos = {
    QB: ['grades_pass', 'pass_grade', 'passing_grade', 'grades_offense', 'offense_grade'],
    WR: ['route_grade', 'grades_pass_route', 'receiving_grade', 'offense_grade', 'grades_offense'],
    RB: ['rushing_grade', 'grades_run', 'receiving_grade', 'offense_grade', 'grades_offense'],
    TE: ['route_grade', 'grades_pass_route', 'receiving_grade', 'pass_block_grade', 'run_block_grade', 'offense_grade', 'grades_offense'],
    OL: ['pass_block_grade', 'grades_pass_block', 'run_block_grade', 'grades_run_block', 'offense_grade', 'grades_offense'],
    EDGE: ['pass_rush_grade', 'grades_pass_rush_defense', 'run_defense_grade', 'grades_run_defense', 'defense_grade', 'grades_defense'],
    DL: ['pass_rush_grade', 'grades_pass_rush_defense', 'run_defense_grade', 'grades_run_defense', 'defense_grade', 'grades_defense'],
    LB: ['coverage_grade', 'grades_coverage_defense', 'run_defense_grade', 'grades_run_defense', 'pass_rush_grade', 'grades_pass_rush_defense', 'defense_grade', 'grades_defense'],
    CB: ['coverage_grade', 'grades_coverage_defense', 'defense_grade', 'grades_defense'],
    S: ['coverage_grade', 'grades_coverage_defense', 'run_defense_grade', 'grades_run_defense', 'defense_grade', 'grades_defense'],
  };

  return rowNumber(row, [...(byPos[p] ?? []), ...common]);
}

export function pffSeasonVolume(row, pos) {
  const p = normPos(pos);

  if (p === 'QB') {
    return rowNumber(row, ['dropbacks', 'attempts', 'aimed_passes', 'pass_attempts']) ?? 1;
  }

  if (p === 'WR' || p === 'TE') {
    return rowNumber(row, ['routes', 'targets', 'receptions', 'snaps']) ?? 1;
  }

  if (p === 'RB') {
    return rowNumber(row, ['attempts', 'carries', 'rush_attempts', 'targets', 'snaps']) ?? 1;
  }

  if (p === 'OL') {
    return rowNumber(row, ['pass_block_snaps', 'run_block_snaps', 'snaps']) ?? 1;
  }

  if (p === 'DL' || p === 'EDGE') {
    return rowNumber(row, ['pass_rush_snaps', 'run_defense_snaps', 'snaps']) ?? 1;
  }

  if (p === 'LB' || p === 'CB' || p === 'S') {
    return rowNumber(row, ['coverage_snaps', 'pass_rush_snaps', 'run_defense_snaps', 'snaps']) ?? 1;
  }

  return rowNumber(row, ['snaps', 'routes', 'targets', 'attempts']) ?? 1;
}

export function weightedSeasonScore(player, store) {
  const files = pffSeasonFilesForPos(player.pos);
  if (!files.length) return null;

  const playerKey = clean(player.name);
  const rows = files.flatMap((file) => store[file] ?? []);

  const matched = rows.filter((row) => {
    const name = rowName(row);
    const season = rowSeason(row);
    return clean(name) === playerKey && season != null && season < player.year;
  });

  if (!matched.length) return null;

  let total = 0;
  let weightTotal = 0;

  for (const row of matched) {
    const score = genericPffSeasonScore(row, player.pos);
    if (score == null) continue;

    const weight = Math.max(1, pffSeasonVolume(row, player.pos));
    total += score * weight;
    weightTotal += weight;
  }

  return weightTotal ? total / weightTotal : null;
}

export function ridgeFit(X, y, lambda = 3.0) {
  if (!X.length) {
    throw new Error('No training rows generated.');
  }

  const p = X[0].length;
  const A = Array.from({ length: p }, () => Array(p).fill(0));
  const b = Array(p).fill(0);

  for (let i = 0; i < X.length; i++) {
    for (let j = 0; j < p; j++) {
      b[j] += X[i][j] * y[i];

      for (let k = 0; k < p; k++) {
        A[j][k] += X[i][j] * X[i][k];
      }
    }
  }

  for (let j = 1; j < p; j++) {
    A[j][j] += lambda;
  }

  for (let i = 0; i < p; i++) {
    let max = i;

    for (let r = i + 1; r < p; r++) {
      if (Math.abs(A[r][i]) > Math.abs(A[max][i])) {
        max = r;
      }
    }

    [A[i], A[max]] = [A[max], A[i]];
    [b[i], b[max]] = [b[max], b[i]];

    const div = A[i][i] || 1e-12;

    for (let c = i; c < p; c++) {
      A[i][c] /= div;
    }

    b[i] /= div;

    for (let r = 0; r < p; r++) {
      if (r === i) continue;

      const factor = A[r][i];

      for (let c = i; c < p; c++) {
        A[r][c] -= factor * A[i][c];
      }

      b[r] -= factor * b[i];
    }
  }

  return b;
}

export function mae(rows, key = 'predAv') {
  return mean(rows.map((row) => Math.abs(row[key] - row.av)));
}

export function rmse(rows, key = 'predAv') {
  return Math.sqrt(mean(rows.map((row) => (row[key] - row.av) ** 2)));
}

export function spearman(rows, key = 'predAv') {
  const rank = (arr, k) => {
    const map = new Map();

    [...arr]
      .sort((a, b) => a[k] - b[k])
      .forEach((row, i) => map.set(row.id, i + 1));

    return map;
  };

  const rx = rank(rows, key);
  const ry = rank(rows, 'av');

  const xs = rows.map((row) => rx.get(row.id));
  const ys = rows.map((row) => ry.get(row.id));

  const mx = mean(xs);
  const my = mean(ys);

  const numerator = xs.reduce(
    (sum, x, i) => sum + (x - mx) * (ys[i] - my),
    0
  );

  const denominator = Math.sqrt(
    xs.reduce((sum, x) => sum + (x - mx) ** 2, 0) *
      ys.reduce((sum, y) => sum + (y - my) ** 2, 0)
  );

  return denominator ? numerator / denominator : 0;
}

export function predictAv(model, features) {
  let logPred = model.intercept;

  for (const feature of model.features) {
    const value = features[feature.name] ?? 50;
    logPred += feature.coef * ((value - feature.mean) / feature.sd);
  }

  return clamp(Math.expm1(logPred), 0, 110);
}

export function summarizeByGroup(rows, key = 'predAv') {
  const byGroup = {};

  for (const row of rows) {
    byGroup[row.group] ??= [];
    byGroup[row.group].push(row);
  }

  return Object.fromEntries(
    Object.entries(byGroup).map(([g, groupRows]) => [
      g,
      {
        n: groupRows.length,
        mae: mae(groupRows, key),
        rmse: rmse(groupRows, key),
        spearman: spearman(groupRows, key),
      },
    ])
  );
}
