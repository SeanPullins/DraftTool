import fs from 'fs';

function clean(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseCsv(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(',').map(h => h.trim());

  return lines.slice(1).map(line => {
    const values = [];
    let cur = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === ',' && !inQuotes) {
        values.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }

    values.push(cur);

    const obj = {};
    headers.forEach((h, i) => obj[h] = values[i] ?? '');
    return obj;
  });
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, min = -99, max = 99) {
  return Math.max(min, Math.min(max, Number.isFinite(v) ? v : 0));
}

function get(row, keys, fallback = null) {
  for (const k of keys) {
    if (row?.[k] != null) return row[k];
  }
  return fallback;
}

function draftBucket(pick) {
  const p = Number(pick) || 260;
  if (p <= 5) return 'top5';
  if (p <= 15) return 'top15';
  if (p <= 32) return 'round1';
  if (p <= 64) return 'round2';
  if (p <= 100) return 'day2';
  if (p <= 180) return 'day3';
  return 'late';
}

function projectionCompRange(pick) {
  const p = Number(pick) || 260;

  if (p <= 10) return { min: 1, max: 15 };
  if (p <= 32) return { min: 1, max: 45 };
  if (p <= 64) return { min: 20, max: 90 };
  if (p <= 100) return { min: 45, max: 130 };
  if (p <= 180) return { min: 90, max: 220 };
  return { min: 120, max: 260 };
}

function winsorDelta(pos, delta) {
  const cap = pos === 'QB' ? 45 : pos === 'TE' ? 30 : 35;
  return clamp(delta, -cap, cap);
}

function matureCompWeight(pos, year) {
  // Recent classes are useful as profile comps, but their NFL outcome deltas
  // are not fully mature yet. Downweight or ignore them by position.
  const y = Number(year) || 0;

  if (pos === 'QB') {
    if (y >= 2023) return 0.25;
    if (y >= 2022) return 0.50;
    return 1.0;
  }

  if (pos === 'WR') {
    if (y >= 2023) return 0.35;
    if (y >= 2022) return 0.65;
    return 1.0;
  }

  if (pos === 'RB') {
    if (y >= 2023) return 0.50;
    return 1.0;
  }

  if (pos === 'TE') {
    if (y >= 2023) return 0.45;
    if (y >= 2022) return 0.75;
    return 1.0;
  }

  return 1.0;
}

function weightedAverageDelta(pos, comps) {
  let total = 0;
  let weightTotal = 0;

  for (const comp of comps) {
    const w = matureCompWeight(pos, comp.year);
    total += comp.delta * w;
    weightTotal += w;
  }

  return weightTotal ? total / weightTotal : 0;
}

function compConfidence(pos, comps, realDraftPrior) {
  if (!realDraftPrior) return 0;

  const effectiveN = comps.reduce((s, c) => s + matureCompWeight(pos, c.year), 0);

  if (effectiveN >= 10) return 1;
  if (effectiveN >= 7) return 0.80;
  if (effectiveN >= 4) return 0.60;
  if (effectiveN >= 2) return 0.35;
  return 0.20;
}

function adjustmentCap(pos, pick, rawAdjustment) {
  const p = Number(pick) || 260;

  // Elite WR draft slots are too volatile in this sample; avoid over-penalizing
  // Harrison/Nabers/Odunze types from a small/mixed historical sample.
  if (pos === 'WR' && p <= 10 && rawAdjustment < 0) return Math.max(rawAdjustment, -1.0);

  const cap = pos === 'QB' ? 5 : pos === 'TE' ? 3 : 4;
  return clamp(rawAdjustment, -cap, cap);
}

function hasRealDraftPrior(row) {
  const forecast = row.forecast || {};
  const source = String(row.source || '').toLowerCase();

  // Only true draft-prior files should restrict projection comps by pick range.
  // Generated future/rank files often store rank as pick/projectedPick, which is NOT real draft capital.
  if (source.includes('future')) return false;
  if (source.includes('forecast')) return false;

  return Boolean(
    source.includes('drafted_projection') ||
    forecast.draft != null ||
    forecast.draftPrior != null ||
    row.actualDraftPick != null
  );
}

function outcomeScore(row) {
  const wAv = num(row.w_av, num(row.car_av, 0));
  const starts = num(row.seasons_started, 0);
  const pb = num(row.probowls, 0);
  const ap = num(row.allpro, 0);
  return wAv + Math.min(starts, 8) * 1.2 + pb * 8 + ap * 12;
}

function expectedOutcomeByPick(pick) {
  const p = Number(pick) || 260;
  return Math.max(3, 65 * Math.exp(-0.018 * (p - 1)));
}

function profileVector(pos, pff) {
  if (!pff) return null;

  if (pos === 'QB') {
    return [
      num(get(pff, ['pass_grade', 'grades_pass']), 50),
      num(get(pff, ['offense_grade', 'grades_offense']), 50),
      num(get(pff, ['btt_rate', 'btt_pct']), 4),
      100 - num(get(pff, ['twp_rate', 'twp_pct']), 3) * 12,
      num(get(pff, ['adjusted_completion_percent', 'accuracy_percent']), 68),
      100 - num(get(pff, ['pressure_to_sack_rate', 'pressure_to_sack_pct']), 15) * 3,
      num(get(pff, ['epa']), 0.10) * 100,
    ];
  }

  if (pos === 'WR') {
    return [
      num(get(pff, ['route_grade', 'grades_pass_route']), 50),
      num(get(pff, ['offense_grade', 'grades_offense']), 50),
      num(get(pff, ['yprr', 'yards_per_route_run']), 1.5) * 25,
      num(get(pff, ['targets']), 50),
      num(get(pff, ['yards', 'receiving_yards']), 500) / 12,
      100 - num(get(pff, ['drop_rate']), 8) * 5,
    ];
  }

  if (pos === 'RB') {
    return [
      num(get(pff, ['run_grade', 'rushing_grade', 'grades_run']), 50),
      num(get(pff, ['receiving_grade', 'grades_pass_route']), 50),
      num(get(pff, ['pass_block_grade', 'grades_pass_block']), 50),
      num(get(pff, ['yco', 'yards_after_contact_per_attempt']), 3) * 20,
      num(get(pff, ['elusive', 'elusive_rating']), 70) / 2,
      num(get(pff, ['yards', 'rushing_yards']), 700) / 15,
    ];
  }

  if (pos === 'TE') {
    return [
      num(get(pff, ['route_grade', 'grades_pass_route']), 50),
      num(get(pff, ['offense_grade', 'grades_offense']), 50),
      num(get(pff, ['yprr']), 1.2) * 30,
      num(get(pff, ['yards']), 350) / 8,
      num(get(pff, ['run_block_grade', 'grades_run_block']), 50),
      num(get(pff, ['pass_block_grade', 'grades_pass_block']), 50),
    ];
  }

  return null;
}

function distance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 50) - (b[i] ?? 50);
    s += d * d;
  }
  return Math.sqrt(s / a.length);
}

function loadJsonRows(path) {
  if (!fs.existsSync(path)) return [];
  const payload = JSON.parse(fs.readFileSync(path, 'utf8'));
  return payload.records || payload || [];
}

function buildSeasonMap(rows) {
  const map = new Map();
  for (const r of rows) {
    const name = r.name || r.player || r.player_name;
    const season = Number(r.season || r.year);
    if (!name || !Number.isFinite(season)) continue;
    map.set(`${clean(name)}|${season}`, r);
  }
  return map;
}

function bestPffBeforeDraft(map, name, draftYear) {
  const seasons = [Number(draftYear) - 1, Number(draftYear) - 2];
  let best = null;

  for (const season of seasons) {
    const row = map.get(`${clean(name)}|${season}`);
    if (!row) continue;

    const sample =
      num(get(row, ['attempts', 'targets', 'carries', 'routes', 'dropbacks']), 0) ||
      num(get(row, ['yards', 'receiving_yards', 'rushing_yards']), 0);

    if (!best || sample > best.sample) best = { row, season, sample };
  }

  return best?.row || null;
}

const draft = parseCsv(fs.readFileSync('public/data/draft_picks.csv', 'utf8'));

const pffMaps = {
  QB: buildSeasonMap(loadJsonRows('public/data/qb_pff_seasons.json')),
  WR: buildSeasonMap(loadJsonRows('public/data/wr_pff_seasons.json')),
  RB: buildSeasonMap(loadJsonRows('public/data/rb_pff_seasons.json')),
  TE: buildSeasonMap(loadJsonRows('public/data/te_pff_seasons.json')),
};

const positions = ['QB', 'WR', 'RB', 'TE'];

const historical = [];

for (const d of draft) {
  const pos = String(d.position || d.pos || '').toUpperCase();
  if (!positions.includes(pos)) continue;

  const year = num(d.season);
  const name = d.pfr_player_name || d.player_name || d.name;
  const pick = num(d.pick);

  if (!year || !name || !pick) continue;
  if (year < 2016 || year > 2023) continue;

  const pff = bestPffBeforeDraft(pffMaps[pos], name, year);
  const vector = profileVector(pos, pff);
  if (!vector) continue;

  const actual = outcomeScore(d);
  const expected = expectedOutcomeByPick(pick);
  const delta = actual - expected;

  historical.push({
    name,
    year,
    pos,
    pick,
    bucket: draftBucket(pick),
    actual,
    expected,
    delta,
    vector,
  });
}

const candidates = [];

for (const year of [2024, 2025, 2026, 2027]) {
  for (const pos of positions) {
    const path = `public/data/prospects_${year}_${pos.toLowerCase()}.json`;
    if (!fs.existsSync(path)) continue;

    const payload = JSON.parse(fs.readFileSync(path, 'utf8'));
    const rows = payload.records || [];

    for (const r of rows.slice(0, 120)) {
      const name = r.name;
      const pff = r.pff || null;
      const vector = profileVector(pos, pff);
      if (!name || !vector) continue;

      const pick = num(r.projectedPick, num(r.pick, 260));
      const realDraftPrior = hasRealDraftPrior(r);
      const range = projectionCompRange(pick);

      const styleComps = historical
        .filter(h => h.pos === pos)
        .map(h => ({
          ...h,
          dist: distance(vector, h.vector),
        }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 8);

      // Projection comps must respect draft tier. If the prospect has no real
      // draft prior, do not pretend rank-based pseudo-pick is actual draft capital.
      const projectionPool = historical
        .filter(h => h.pos === pos)
        .filter(h => realDraftPrior ? (h.pick >= range.min && h.pick <= range.max) : true)
        .map(h => ({
          ...h,
          delta: winsorDelta(pos, h.delta),
          dist: distance(vector, h.vector),
        }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 12);

      const avgDelta = realDraftPrior ? weightedAverageDelta(pos, projectionPool) : 0;
      const confidence = compConfidence(pos, projectionPool, realDraftPrior);

      const rawAdjustment = realDraftPrior ? (avgDelta / 8) * confidence : 0;
      const adjustment = realDraftPrior ? adjustmentCap(pos, pick, rawAdjustment) : 0;

      candidates.push({
        year,
        pos,
        name,
        pick,
        realDraftPrior,
        projectionRange: realDraftPrior ? range : null,
        rawGeneratedScore: r.grade ?? r.score ?? null,
        compAdjustment: Number(adjustment.toFixed(1)),
        avgCompDelta: Number(avgDelta.toFixed(1)),
        confidence: Number(confidence.toFixed(2)),
        projectionComps: projectionPool.map(c => ({
          name: c.name,
          year: c.year,
          pick: c.pick,
          delta: Number(c.delta.toFixed(1)),
          weight: Number(matureCompWeight(pos, c.year).toFixed(2)),
          dist: Number(c.dist.toFixed(1)),
        })),
        styleComps: styleComps.map(c => ({
          name: c.name,
          year: c.year,
          pick: c.pick,
          delta: Number(c.delta.toFixed(1)),
          weight: Number(matureCompWeight(pos, c.year).toFixed(2)),
          dist: Number(c.dist.toFixed(1)),
        })),
      });
    }
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  historicalRows: historical.length,
  notes: [
    'This report does not change site scores.',
    'It estimates small capped score adjustments from historical same-position PFF/draft comps.',
    'Use as candidate signal only; validate manually before wiring into App.tsx.',
  ],
  byPosition: Object.fromEntries(positions.map(pos => [
    pos,
    {
      historicalRows: historical.filter(h => h.pos === pos).length,
      candidates: candidates.filter(c => c.pos === pos).slice(0, 40),
    }
  ])),
};

fs.mkdirSync('public/data/model', { recursive: true });
fs.writeFileSync('public/data/model/position_comp_adjustment_report.json', JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  historicalRows: report.historicalRows,
  byPosition: Object.fromEntries(positions.map(pos => [
    pos,
    {
      historicalRows: report.byPosition[pos].historicalRows,
      sample: report.byPosition[pos].candidates.slice(0, 8).map(c => ({
        year: c.year,
        name: c.name,
        pick: c.pick,
        rawGeneratedScore: c.rawGeneratedScore,
        compAdjustment: c.compAdjustment,
        realDraftPrior: c.realDraftPrior,
        confidence: c.confidence,
        projectionComps: c.projectionComps.slice(0, 4).map(x => `${x.name} ${x.year} #${x.pick} Δ${x.delta}`),
        styleComps: c.styleComps.slice(0, 4).map(x => `${x.name} ${x.year} #${x.pick} Δ${x.delta}`),
      })),
    }
  ])),
}, null, 2));

console.log('Wrote public/data/model/position_comp_adjustment_report.json');
