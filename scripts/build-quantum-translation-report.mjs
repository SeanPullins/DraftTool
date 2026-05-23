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

function get(row, keys, fallback = null) {
  for (const k of keys) {
    if (row?.[k] != null && row[k] !== '') return row[k];
  }
  return fallback;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(v) ? v : 0));
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
      num(get(row, ['attempts', 'dropbacks', 'targets', 'carries', 'routes']), 0) ||
      num(get(row, ['yards', 'receiving_yards', 'rushing_yards']), 0);

    if (!best || sample > best.sample) best = { row, season, sample };
  }

  return best;
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

function matureWeight(pos, draftYear) {
  const y = Number(draftYear) || 0;

  if (pos === 'QB') {
    if (y >= 2023) return 0.25;
    if (y >= 2022) return 0.50;
    return 1;
  }

  if (pos === 'WR') {
    if (y >= 2023) return 0.35;
    if (y >= 2022) return 0.65;
    return 1;
  }

  if (pos === 'RB') {
    if (y >= 2023) return 0.50;
    return 1;
  }

  if (pos === 'TE') {
    if (y >= 2023) return 0.45;
    if (y >= 2022) return 0.75;
    return 1;
  }

  return 1;
}

function winsorDelta(pos, delta) {
  const cap = pos === 'QB' ? 45 : pos === 'TE' ? 30 : 35;
  return clamp(delta, -cap, cap);
}

function draftBucket(pick) {
  const p = Number(pick) || 260;
  if (p <= 10) return 'top10';
  if (p <= 32) return 'round1';
  if (p <= 64) return 'round2';
  if (p <= 100) return 'day2';
  if (p <= 180) return 'day3';
  return 'late';
}

function summarizeMatches(pos, matches) {
  const weighted = matches.map(m => ({
    ...m,
    delta: winsorDelta(pos, m.delta),
    weight: matureWeight(pos, m.year),
  }));

  const effectiveN = weighted.reduce((s, m) => s + m.weight, 0);
  const avgDelta = effectiveN
    ? weighted.reduce((s, m) => s + m.delta * m.weight, 0) / effectiveN
    : 0;

  const starters = weighted.filter(m => m.actual >= 20).length;
  const stars = weighted.filter(m => m.actual >= 45).length;
  const busts = weighted.filter(m => m.actual <= 5).length;

  const cap = pos === 'QB' ? 3 : pos === 'TE' ? 2 : 3;
  const recommendedAdjustment = effectiveN >= 4 ? clamp(avgDelta / 10, -cap, cap) : 0;

  return {
    historicalMatches: matches.length,
    effectiveN: Number(effectiveN.toFixed(2)),
    avgDeltaVsExpected: Number(avgDelta.toFixed(1)),
    starterRate: matches.length ? Number((starters / matches.length).toFixed(2)) : 0,
    starRate: matches.length ? Number((stars / matches.length).toFixed(2)) : 0,
    bustRate: matches.length ? Number((busts / matches.length).toFixed(2)) : 0,
    recommendedAdjustment: Number(recommendedAdjustment.toFixed(1)),
    confidence:
      effectiveN >= 10 ? 'high' :
      effectiveN >= 6 ? 'medium' :
      effectiveN >= 3 ? 'low' :
      'context-only',
    examples: weighted
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 8)
      .map(m => ({
        name: m.name,
        year: m.year,
        pick: m.pick,
        delta: Number(m.delta.toFixed(1)),
        weight: Number(m.weight.toFixed(2)),
      })),
  };
}

function val(row, keys, fallback = null) {
  return num(get(row, keys), fallback);
}

const quantumTraits = {
  QB: [
    {
      key: 'elite_creation_without_chaos',
      label: 'Elite creation without chaos',
      definition: 'BTT% >= 6.5, TWP% <= 2.2, pass grade >= 85, adjusted accuracy >= 70',
      adjustment: 0.18,
      test: r => val(r, ['btt_rate', 'btt_pct'], 0) >= 6.5 &&
                 val(r, ['twp_rate', 'twp_pct'], 99) <= 2.2 &&
                 val(r, ['pass_grade', 'grades_pass'], 0) >= 85 &&
                 val(r, ['adjusted_completion_percent', 'accuracy_percent'], 0) >= 70,
    },
    {
      key: 'nfl_timing_translator',
      label: 'NFL timing translator',
      definition: 'TTT <= 2.85, ADOT >= 8.0, adjusted accuracy >= 72, P2S <= 18',
      adjustment: 0.18,
      test: r => val(r, ['time_to_throw', 'avg_time_to_throw', 'ttt'], 99) <= 2.85 &&
                 val(r, ['adot', 'avg_depth_of_target'], 0) >= 8.0 &&
                 val(r, ['adjusted_completion_percent', 'accuracy_percent'], 0) >= 72 &&
                 val(r, ['pressure_to_sack_rate', 'pressure_to_sack_pct'], 99) <= 18,
    },
    {
      key: 'pressure_creation_combo',
      label: 'Pressure + creation combo',
      definition: 'Pass grade >= 85, BTT% >= 5.5, P2S <= 16',
      adjustment: 0.12,
      test: r => val(r, ['pass_grade', 'grades_pass'], 0) >= 85 &&
                 val(r, ['btt_rate', 'btt_pct'], 0) >= 5.5 &&
                 val(r, ['pressure_to_sack_rate', 'pressure_to_sack_pct'], 99) <= 16,
    },
    {
      key: 'true_danger_profile',
      label: 'True QB danger profile',
      definition: 'TWP% >= 4.0, P2S >= 20, adjusted accuracy < 70',
      adjustment: -0.18,
      inverse: true,
      test: r => val(r, ['twp_rate', 'twp_pct'], 0) >= 4.0 &&
                 val(r, ['pressure_to_sack_rate', 'pressure_to_sack_pct'], 0) >= 20 &&
                 val(r, ['adjusted_completion_percent', 'accuracy_percent'], 100) < 70,
    },
  ],
  WR: [
    {
      key: 'route_yprr_combo',
      label: 'Separation + production',
      definition: 'Route grade >= 80 and YPRR >= 2.5',
      test: r => val(r, ['route_grade', 'grades_pass_route'], 0) >= 80 && val(r, ['yprr', 'yards_per_route_run'], 0) >= 2.5,
    },
    {
      key: 'explosive_volume',
      label: 'Explosive volume profile',
      definition: 'Receiving yards >= 900 and ADOT >= 10',
      test: r => val(r, ['yards', 'receiving_yards'], 0) >= 900 && val(r, ['adot', 'avg_depth_of_target'], 0) >= 10,
    },
    {
      key: 'hands_trust',
      label: 'Hands trust with volume',
      definition: 'Drop rate <= 6 and targets >= 70',
      test: r => val(r, ['drop_rate'], 99) <= 6 && val(r, ['targets'], 0) >= 70,
    },
  ],

  RB: [
    {
      key: 'explosive_contact_creator',
      label: 'Explosive contact creator',
      definition: 'YCO >= 3.4, elusive >= 90, breakaway% >= 30, attempts >= 120',
      adjustment: 0.65,
      test: r => val(r, ['yco', 'yco_attempt', 'yards_after_contact_per_attempt'], 0) >= 3.4 &&
                 val(r, ['elusive', 'elusive_rating'], 0) >= 90 &&
                 val(r, ['breakaway_percent', 'breakawayPercent'], 0) >= 30 &&
                 val(r, ['attempts', 'carries'], 0) >= 120,
    },
    {
      key: 'three_down_plus',
      label: 'Three-down plus',
      definition: 'Run grade >= 80, receiving grade >= 65, pass pro >= 60, targets >= 15',
      adjustment: 0.95,
      test: r => val(r, ['run_grade', 'grades_run'], 0) >= 80 &&
                 val(r, ['receiving_grade', 'route_grade', 'grades_pass_route'], 0) >= 65 &&
                 val(r, ['pass_block_grade', 'grades_pass_block'], 0) >= 60 &&
                 val(r, ['targets'], 0) >= 15,
    },
    {
      key: 'volume_efficiency_plus',
      label: 'Volume efficiency plus',
      definition: 'Rushing yards >= 1000, YCO >= 3.0, breakaway% >= 25, attempts >= 150',
      adjustment: 0.65,
      test: r => val(r, ['yards', 'rushing_yards'], 0) >= 1000 &&
                 val(r, ['yco', 'yco_attempt', 'yards_after_contact_per_attempt'], 0) >= 3.0 &&
                 val(r, ['breakaway_percent', 'breakawayPercent'], 0) >= 25 &&
                 val(r, ['attempts', 'carries'], 0) >= 150,
    },
    {
      key: 'fumble_risk',
      label: 'Fumble risk',
      definition: 'Fumbles >= 4',
      adjustment: -0.35,
      test: r => val(r, ['fumbles'], 0) >= 4,
    },
    {
      key: 'workload_inefficiency_risk',
      label: 'Workload inefficiency risk',
      definition: 'Attempts >= 180, YCO < 2.8, elusive < 70',
      adjustment: -0.45,
      test: r => val(r, ['attempts', 'carries'], 0) >= 180 &&
                 val(r, ['yco', 'yco_attempt', 'yards_after_contact_per_attempt'], 99) < 2.8 &&
                 val(r, ['elusive', 'elusive_rating'], 999) < 70,
    },
  ],
  TE: [
    {
      key: 'receiving_plus_blocking',
      label: 'Receiving TE with blocking floor',
      definition: 'Route grade >= 75 and run block >= 65',
      test: r => val(r, ['route_grade', 'grades_pass_route'], 0) >= 75 && val(r, ['run_block_grade', 'grades_run_block'], 0) >= 65,
    },
    {
      key: 'mismatch_te',
      label: 'Mismatch receiving TE',
      definition: 'YPRR >= 1.8 and receiving/route grade >= 75',
      test: r => val(r, ['yprr'], 0) >= 1.8 && val(r, ['route_grade', 'grades_pass_route'], 0) >= 75,
    },
    {
      key: 'inline_survivor',
      label: 'Inline survivor',
      definition: 'Blocking grade >= 70 and receiving/route grade >= 60',
      test: r => {
        const block = Math.max(
          val(r, ['run_block_grade', 'grades_run_block'], 0),
          val(r, ['pass_block_grade', 'grades_pass_block'], 0)
        );
        return block >= 70 && val(r, ['route_grade', 'grades_pass_route'], 0) >= 60;
      },
    },
  ],
};

const draftRows = parseCsv(fs.readFileSync('public/data/draft_picks.csv', 'utf8'));

const pffMaps = {
  QB: buildSeasonMap(loadJsonRows('public/data/qb_pff_seasons.json')),
  WR: buildSeasonMap(loadJsonRows('public/data/wr_pff_seasons.json')),
  RB: buildSeasonMap(loadJsonRows('public/data/rb_pff_seasons.json')),
  TE: buildSeasonMap(loadJsonRows('public/data/te_pff_seasons.json')),
};

const positions = ['QB', 'WR', 'RB', 'TE'];

const historical = [];

for (const d of draftRows) {
  const pos = String(d.position || d.pos || '').toUpperCase();
  if (!positions.includes(pos)) continue;

  const year = num(d.season);
  const name = d.pfr_player_name || d.player_name || d.name;
  const pick = num(d.pick);

  if (!year || !name || !pick) continue;
  if (year < 2016 || year > 2023) continue;

  const best = bestPffBeforeDraft(pffMaps[pos], name, year);
  if (!best?.row) continue;

  const actual = outcomeScore(d);
  const expected = expectedOutcomeByPick(pick);

  historical.push({
    name,
    year,
    pos,
    pick,
    bucket: draftBucket(pick),
    pff: best.row,
    pffSeason: best.season,
    actual,
    expected,
    delta: actual - expected,
  });
}

function loadCurrentCandidates() {
  const out = [];

  for (const year of [2024, 2025, 2026, 2027]) {
    for (const pos of positions) {
      const path = `public/data/prospects_${year}_${pos.toLowerCase()}.json`;
      if (!fs.existsSync(path)) continue;

      const payload = JSON.parse(fs.readFileSync(path, 'utf8'));
      const rows = payload.records || [];

      for (const r of rows.slice(0, 150)) {
        if (!r?.pff) continue;

        out.push({
          name: r.name,
          year,
          pos,
          pick: r.projectedPick ?? r.pick ?? null,
          source: r.source || payload.model || '',
          pff: r.pff,
          rawGeneratedScore: r.grade ?? r.score ?? null,
        });
      }
    }
  }

  return out;
}

const currentCandidates = loadCurrentCandidates();

const report = {
  generatedAt: new Date().toISOString(),
  notes: [
    'Read-only quantum trait translation report.',
    'Does not change site scores.',
    'Tests nonlinear trait buckets against historical drafted players with PFF data.',
    'Recommended adjustments are diagnostic only.',
  ],
  byPosition: {},
};

for (const pos of positions) {
  const posHistorical = historical.filter(h => h.pos === pos);
  const posCurrent = currentCandidates.filter(c => c.pos === pos);

  report.byPosition[pos] = {
    historicalRows: posHistorical.length,
    traits: {},
  };

  for (const trait of quantumTraits[pos]) {
    const historicalMatches = posHistorical.filter(h => trait.test(h.pff));
    const summary = summarizeMatches(pos, historicalMatches);

    const currentMatches = posCurrent
      .filter(c => trait.test(c.pff))
      .slice(0, 40)
      .map(c => ({
        name: c.name,
        year: c.year,
        pick: c.pick,
        source: c.source,
        rawGeneratedScore: c.rawGeneratedScore,
      }));

    report.byPosition[pos].traits[trait.key] = {
      label: trait.label,
      definition: trait.definition,
      inverse: Boolean(trait.inverse),
      ...summary,
      currentMatches,
    };
  }
}

fs.mkdirSync('public/data/model', { recursive: true });
fs.writeFileSync('public/data/model/quantum_translation_report.json', JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  generatedAt: report.generatedAt,
  byPosition: Object.fromEntries(positions.map(pos => [
    pos,
    Object.fromEntries(Object.entries(report.byPosition[pos].traits).map(([key, value]) => [
      key,
      {
        label: value.label,
        historicalMatches: value.historicalMatches,
        effectiveN: value.effectiveN,
        avgDeltaVsExpected: value.avgDeltaVsExpected,
        starterRate: value.starterRate,
        starRate: value.starRate,
        bustRate: value.bustRate,
        recommendedAdjustment: value.recommendedAdjustment,
        confidence: value.confidence,
        currentMatches: value.currentMatches.slice(0, 12).map(p => `${p.name} ${p.year}`),
      }
    ]))
  ])),
}, null, 2));

console.log('Wrote public/data/model/quantum_translation_report.json');
