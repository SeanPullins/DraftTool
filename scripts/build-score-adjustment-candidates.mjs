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

function key(year, pos, name) {
  return `${Number(year)}|${String(pos || '').toUpperCase()}|${clean(name)}`;
}

const compReport = loadJson('public/data/model/position_comp_adjustment_report.json', {});
const quantumReport = loadJson('public/data/model/quantum_translation_report.json', {});

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

  const scored = scoreCandidate(p.pos, comp, quantumTraits);

  candidates.push({
    ...p,
    realDraftPrior: Boolean(comp?.realDraftPrior),
    compAdjustment: comp ? num(comp.compAdjustment, 0) : 0,
    compConfidence: comp ? num(comp.confidence, 0) : 0,
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

const report = {
  generatedAt: new Date().toISOString(),
  notes: [
    'Offline report only. Does not change site scores.',
    'Recommended adjustment is capped and uses only conservative comp + score-ready quantum traits.',
    'Future/no-draft players remain context-only unless a real draft prior exists.',
    'WR quantum traits are intentionally excluded from score-ready adjustment for now.',
  ],
  caps: {
    QB: 2.0,
    RB: 3.0,
    WR: 1.0,
    TE: 1.5,
  },
  byPosition: Object.fromEntries(POSITIONS.map(pos => {
    const rows = candidates
      .filter(c => c.pos === pos)
      .sort((a, b) => Math.abs(b.recommendedAdjustment) - Math.abs(a.recommendedAdjustment))
      .slice(0, 60);

    return [pos, rows];
  })),
  topMovers: candidates
    .slice()
    .sort((a, b) => Math.abs(b.recommendedAdjustment) - Math.abs(a.recommendedAdjustment))
    .slice(0, 80),
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
  byPositionCounts: Object.fromEntries(POSITIONS.map(pos => [pos, report.byPosition[pos].length])),
}, null, 2));

console.log('Wrote public/data/model/score_adjustment_candidates.json');
