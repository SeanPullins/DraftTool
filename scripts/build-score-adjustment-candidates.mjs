import fs from 'fs';

function clean(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(v) ? v : 0));
}

function loadJson(path, fallback = null) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
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

function buildActualDraftPickMaps() {
  const byYearPosName = new Map();
  const byPosName = new Map();

  if (!fs.existsSync('public/data/draft_picks.csv')) {
    return { byYearPosName, byPosName };
  }

  const rows = parseCsv(fs.readFileSync('public/data/draft_picks.csv', 'utf8'));

  for (const r of rows) {
    const year = Number(r.season || r.year || r.draft_year);
    const pos = String(r.position || r.pos || '').toUpperCase();
    const name = r.pfr_player_name || r.player_name || r.name || '';
    const pick = Number(r.pick || r.overall || r.draft_pick);

    if (!year || !pos || !name || !Number.isFinite(pick)) continue;

    const record = {
      year,
      pos,
      name,
      pick,
      team: r.team || r.draft_team || '',
      source: 'actual_draft_picks_csv',
    };

    byYearPosName.set(key(year, pos, name), record);
    byPosName.set(`${pos}|${clean(name)}`, record);
  }

  return { byYearPosName, byPosName };
}

function draftCapitalDamping(pick) {
  const p = Number(pick) || 260;

  if (p <= 64) return 1.0;
  if (p <= 100) return 0.80;
  if (p <= 180) return 0.65;
  return 0.50;
}

function key(year, pos, name) {
  return `${Number(year)}|${String(pos || '').toUpperCase()}|${clean(name)}`;
}

const compReport = loadJson('public/data/model/position_comp_adjustment_report.json', {});
const quantumReport = loadJson('public/data/model/quantum_translation_report.json', {});
const actualDraftPickMaps = buildActualDraftPickMaps();

const POSITIONS = ['QB', 'WR', 'RB', 'TE'];

function buildCompMap() {
  const map = new Map();

  for (const pos of POSITIONS) {
    const rows = compReport.byPosition?.[pos]?.candidates || [];
    for (const r of rows) {
      map.set(key(r.year, pos, r.name), r);
    }
  }

  return map;
}

function buildQuantumMatchMap() {
  const map = new Map();

  for (const pos of POSITIONS) {
    const traits = quantumReport.byPosition?.[pos]?.traits || {};

    for (const [traitKey, trait] of Object.entries(traits)) {
      const adj = num(trait.recommendedAdjustment, 0);
      const confidence = String(trait.confidence || 'context-only');

      for (const player of trait.currentMatches || []) {
        const playerKey = key(player.year, pos, player.name);

        if (!map.has(playerKey)) map.set(playerKey, []);

        map.get(playerKey).push({
          traitKey,
          label: trait.label,
          recommendedAdjustment: adj,
          confidence,
          inverse: Boolean(trait.inverse),
          historicalMatches: trait.historicalMatches,
          avgDeltaVsExpected: trait.avgDeltaVsExpected,
          starterRate: trait.starterRate,
          starRate: trait.starRate,
          bustRate: trait.bustRate,
        });
      }
    }
  }

  return map;
}

function isQuantumScoreReady(pos, trait) {
  // Only let historically meaningful and stable buckets influence candidate adjustment.
  if (trait.confidence !== 'high' && trait.confidence !== 'medium') return false;
  if (num(trait.historicalMatches, 0) < 10) return false;

  if (pos === 'RB') {
    return ['contact_creator', 'three_down_viability', 'volume_efficiency'].includes(trait.traitKey);
  }

  if (pos === 'QB') {
    return ['creation_without_chaos', 'pressure_translator', 'danger_profile'].includes(trait.traitKey);
  }

  if (pos === 'TE') {
    return ['inline_survivor'].includes(trait.traitKey);
  }

  // WR quantum traits were flat/noisy in the last run. Keep them context-only for now.
  return false;
}

function posCap(pos) {
  if (pos === 'QB') return 2.0;
  if (pos === 'RB') return 3.0;
  if (pos === 'TE') return 1.5;
  if (pos === 'WR') return 1.0;
  return 1.0;
}

function scoreCandidate(pos, comp, quantumTraits) {
  const reasons = [];

  const realDraftPrior = Boolean(comp?.realDraftPrior);
  const compAdj = num(comp?.compAdjustment, 0);
  const compConfidence = num(comp?.confidence, 0);

  let compComponent = 0;

  if (realDraftPrior && compConfidence > 0) {
    const compWeight =
      pos === 'QB' ? 0.45 :
      pos === 'RB' ? 0.30 :
      pos === 'TE' ? 0.35 :
      pos === 'WR' ? 0.25 :
      0.25;

    compComponent = compAdj * compConfidence * compWeight;

    if (Math.abs(compComponent) > 0.05) {
      reasons.push(`Comp signal ${compAdj >= 0 ? '+' : ''}${compAdj.toFixed(1)} at confidence ${compConfidence.toFixed(2)}`);
    }
  } else if (comp && !realDraftPrior) {
    reasons.push('Comp signal context-only: no real draft prior');
  }

  let quantumComponent = 0;
  const quantumUsed = [];

  for (const t of quantumTraits || []) {
    if (!isQuantumScoreReady(pos, t)) continue;

    // Do not let no-draft future players get score movement from quantum traits yet.
    if (!realDraftPrior) {
      quantumUsed.push(`${t.label}: context-only`);
      continue;
    }

    const qWeight =
      pos === 'RB' ? 0.85 :
      pos === 'QB' ? 0.55 :
      pos === 'TE' ? 0.50 :
      0.20;

    const contribution = num(t.recommendedAdjustment, 0) * qWeight;
    quantumComponent += contribution;

    quantumUsed.push(`${t.label}: ${contribution >= 0 ? '+' : ''}${contribution.toFixed(1)}`);
  }

  if (quantumUsed.length) {
    reasons.push(...quantumUsed);
  }

  const cap = posCap(pos);
  const total = clamp(compComponent + quantumComponent, -cap, cap);

  return {
    compComponent: Number(compComponent.toFixed(2)),
    quantumComponent: Number(quantumComponent.toFixed(2)),
    recommendedAdjustment: Number(total.toFixed(2)),
    reasons,
  };
}

function loadProspects() {
  const out = [];

  for (const year of [2024, 2025, 2026, 2027]) {
    for (const pos of POSITIONS) {
      const path = `public/data/prospects_${year}_${pos.toLowerCase()}.json`;
      if (!fs.existsSync(path)) continue;

      const payload = loadJson(path, {});
      const rows = payload.records || [];

      for (const r of rows) {
        out.push({
          year,
          pos,
          name: r.name,
          school: r.school || r.team || '',
          pick: r.projectedPick ?? r.pick ?? null,
          rawGeneratedScore: r.grade ?? r.score ?? null,
          source: r.source || payload.model || '',
        });
      }
    }
  }

  return out;
}

const compMap = buildCompMap();
const quantumMap = buildQuantumMatchMap();
const prospects = loadProspects();

const candidates = [];

for (const p of prospects) {
  const k = key(p.year, p.pos, p.name);
  const comp = compMap.get(k) || null;
  const quantumTraits = quantumMap.get(k) || [];

  if (!comp && !quantumTraits.length) continue;

  const actualDraft = actualDraftPickMaps.byYearPosName.get(k) || null;
  const actualDraftAnyYear = actualDraftPickMaps.byPosName.get(`${p.pos}|${clean(p.name)}`) || null;

  // If a generated future row contains a player already drafted in another year,
  // skip that stale/wrong-year generated row.
  if (!actualDraft && actualDraftAnyYear && Number(actualDraftAnyYear.year) !== Number(p.year)) {
    continue;
  }

  const compWithActualDraft = actualDraft
    ? { ...(comp || {}), realDraftPrior: true, pick: actualDraft.pick }
    : comp;

  const scoredRaw = scoreCandidate(p.pos, compWithActualDraft, quantumTraits);
  const effectivePick = actualDraft?.pick ?? p.pick;
  const damping = actualDraft ? draftCapitalDamping(actualDraft.pick) : 1;

  const scored = {
    ...scoredRaw,
    quantumComponent: Number((scoredRaw.quantumComponent * damping).toFixed(2)),
    compComponent: Number((scoredRaw.compComponent * damping).toFixed(2)),
    recommendedAdjustment: Number((scoredRaw.recommendedAdjustment * damping).toFixed(2)),
    reasons: actualDraft && damping < 1
      ? [...scoredRaw.reasons, `Draft capital damping: x${damping.toFixed(2)}`]
      : scoredRaw.reasons,
  };

  candidates.push({
    ...p,
    pick: effectivePick,
    actualDraftPick: actualDraft?.pick ?? null,
    realDraftPrior: Boolean(compWithActualDraft?.realDraftPrior),
    compAdjustment: compWithActualDraft ? num(compWithActualDraft.compAdjustment, 0) : 0,
    compConfidence: compWithActualDraft ? num(compWithActualDraft.confidence, 0) : 0,
    quantumTraits: quantumTraits.map(t => ({
      traitKey: t.traitKey,
      label: t.label,
      recommendedAdjustment: t.recommendedAdjustment,
      confidence: t.confidence,
      avgDeltaVsExpected: t.avgDeltaVsExpected,
      starterRate: t.starterRate,
      starRate: t.starRate,
      bustRate: t.bustRate,
      scoreReady: isQuantumScoreReady(p.pos, t),
    })),
    ...scored,
  });
}

function dedupeCandidates(rows) {
  const map = new Map();

  for (const row of rows) {
    const k = key(row.year, row.pos, row.name);
    const existing = map.get(k);

    if (!existing) {
      map.set(k, row);
      continue;
    }

    const rowPriority =
      row.actualDraftPick != null ? 3 :
      row.realDraftPrior ? 2 :
      1;

    const existingPriority =
      existing.actualDraftPick != null ? 3 :
      existing.realDraftPrior ? 2 :
      1;

    if (
      rowPriority > existingPriority ||
      (rowPriority === existingPriority && Math.abs(row.recommendedAdjustment) > Math.abs(existing.recommendedAdjustment))
    ) {
      map.set(k, row);
    }
  }

  return Array.from(map.values());
}

const dedupedCandidates = dedupeCandidates(candidates);

function isScoreReady(row) {
  return Boolean(
    row.realDraftPrior &&
    Math.abs(Number(row.recommendedAdjustment || 0)) > 0.01
  );
}

function isContextOnly(row) {
  return !isScoreReady(row);
}

const scoreReadyCandidates = dedupedCandidates.filter(isScoreReady);
const contextOnlyCandidates = dedupedCandidates.filter(isContextOnly);

function sortByMovement(rows) {
  return rows
    .slice()
    .sort((a, b) => Math.abs(b.recommendedAdjustment) - Math.abs(a.recommendedAdjustment));
}

const report = {
  generatedAt: new Date().toISOString(),
  notes: [
    'Offline report only. Does not change site scores.',
    'scoreReady contains only real-draft-prior players with nonzero recommended adjustment.',
    'contextOnly contains future/no-draft or zero-adjustment players for scouting context only.',
    'Recommended adjustment is capped and uses only conservative comp + score-ready quantum traits.',
    'Actual drafted rows are preferred over generated/rank-based rows.',
    'Late draft picks are damped by draft capital.',
    'WR quantum traits are intentionally excluded from score-ready adjustment for now.',
  ],
  caps: {
    QB: 2.0,
    RB: 3.0,
    WR: 1.0,
    TE: 1.5,
  },
  counts: {
    all: dedupedCandidates.length,
    scoreReady: scoreReadyCandidates.length,
    contextOnly: contextOnlyCandidates.length,
  },
  scoreReady: {
    byPosition: Object.fromEntries(POSITIONS.map(pos => {
      const rows = sortByMovement(scoreReadyCandidates.filter(c => c.pos === pos)).slice(0, 60);
      return [pos, rows];
    })),
    topMovers: sortByMovement(scoreReadyCandidates).slice(0, 80),
  },
  contextOnly: {
    byPosition: Object.fromEntries(POSITIONS.map(pos => {
      const rows = contextOnlyCandidates
        .filter(c => c.pos === pos)
        .slice(0, 80);
      return [pos, rows];
    })),
    sample: contextOnlyCandidates.slice(0, 80),
  },

  // Backward-compatible fields for older audit snippets.
  byPosition: Object.fromEntries(POSITIONS.map(pos => {
    const rows = sortByMovement(scoreReadyCandidates.filter(c => c.pos === pos)).slice(0, 60);
    return [pos, rows];
  })),
  topMovers: sortByMovement(scoreReadyCandidates).slice(0, 80),
};

fs.mkdirSync('public/data/model', { recursive: true });
fs.writeFileSync('public/data/model/score_adjustment_candidates.json', JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  generatedAt: report.generatedAt,
  topMovers: report.topMovers.slice(0, 30).map(c => ({
    year: c.year,
    pos: c.pos,
    name: c.name,
    pick: c.pick,
    realDraftPrior: c.realDraftPrior,
    compAdjustment: c.compAdjustment,
    compConfidence: c.compConfidence,
    quantumTraits: c.quantumTraits.filter(t => t.scoreReady).map(t => t.label),
    compComponent: c.compComponent,
    quantumComponent: c.quantumComponent,
    recommendedAdjustment: c.recommendedAdjustment,
    reasons: c.reasons,
  })),
  counts: report.counts,
  scoreReadyByPositionCounts: Object.fromEntries(POSITIONS.map(pos => [pos, report.scoreReady.byPosition[pos].length])),
  contextOnlyByPositionCounts: Object.fromEntries(POSITIONS.map(pos => [pos, report.contextOnly.byPosition[pos].length])),
}, null, 2));

console.log('Wrote public/data/model/score_adjustment_candidates.json');
