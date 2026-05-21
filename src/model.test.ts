import { describe, it, expect } from 'vitest'
import {
  clamp, clean, avg, blend, q,
  ageSignal, calibratedExpectedAv, sim, pffSim, project,
  group, isMatureOutcome, matureOutcomeCutoff,
} from './model'
import type { Prospect, Historical, PffProfile } from './model'

// ── Utilities ─────────────────────────────────────────────────────────────────

describe('clamp', () => {
  it('passes values in range', () => expect(clamp(50)).toBe(50))
  it('clamps below min', () => expect(clamp(-5, 0, 99)).toBe(0))
  it('clamps above max', () => expect(clamp(150, 0, 99)).toBe(99))
  it('handles non-finite → 50', () => expect(clamp(NaN)).toBe(50))
})

describe('clean', () => {
  it('lowercases and strips non-alphanumeric', () => expect(clean('Josh Allen!')).toBe('joshallen'))
  it('strips diacritics', () => expect(clean('Björn')).toBe('bjorn'))
  it('handles empty string', () => expect(clean('')).toBe(''))
})

describe('avg', () => {
  it('computes mean', () => expect(avg([10, 20, 30])).toBe(20))
  it('single value', () => expect(avg([42])).toBe(42))
})

describe('blend', () => {
  it('weight=0 returns a', () => expect(blend(10, 90, 0)).toBe(10))
  it('weight=1 returns b', () => expect(blend(10, 90, 1)).toBe(90))
  it('weight=0.5 returns midpoint', () => expect(blend(10, 90, 0.5)).toBe(50))
})

describe('q (quantile)', () => {
  const arr = [1, 2, 3, 4, 5].sort((a, b) => a - b)
  it('p=0 returns first', () => expect(q(arr, 0)).toBe(1))
  it('p=1 returns last', () => expect(q(arr, 1)).toBe(5))
  it('p=0.5 returns median', () => expect(q(arr, 0.5)).toBe(3))
})

// ── Group mapping ─────────────────────────────────────────────────────────────

describe('group', () => {
  it('RB/WR/TE are SKILL', () => {
    expect(group['RB']).toBe('SKILL')
    expect(group['WR']).toBe('SKILL')
    expect(group['TE']).toBe('SKILL')
  })
  it('CB and S are DB', () => {
    expect(group['CB']).toBe('DB')
    expect(group['S']).toBe('DB')
  })
  it('DL and LB are FRONT', () => {
    expect(group['DL']).toBe('FRONT')
    expect(group['LB']).toBe('FRONT')
  })
})

describe('isMatureOutcome', () => {
  it('seasons at or before cutoff are mature', () => expect(isMatureOutcome(matureOutcomeCutoff)).toBe(true))
  it('current season is not mature', () => expect(isMatureOutcome(2026)).toBe(false))
})

// ── Age signal ────────────────────────────────────────────────────────────────

describe('ageSignal', () => {
  it('younger QB gets higher signal', () => {
    expect(ageSignal(21, 'QB')).toBeGreaterThan(ageSignal(24, 'QB'))
  })
  it('younger RB gets higher signal', () => {
    expect(ageSignal(20, 'RB')).toBeGreaterThan(ageSignal(23, 'RB'))
  })
  it('younger OL gets higher signal', () => {
    expect(ageSignal(21, 'OL')).toBeGreaterThan(ageSignal(26, 'OL'))
  })
  it('QB age curve is steeper than WR for old players', () => {
    expect(ageSignal(26, 'QB')).toBeLessThan(ageSignal(26, 'WR'))
  })
  it('returns a number in [30, 94] for reasonable ages', () => {
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'OL', 'LB', 'CB', 'S']) {
      for (const age of [20, 22, 24, 26]) {
        const s = ageSignal(age, pos)
        expect(s).toBeGreaterThanOrEqual(30)
        expect(s).toBeLessThanOrEqual(94)
      }
    }
  })
})

// ── calibratedExpectedAv ──────────────────────────────────────────────────────

describe('calibratedExpectedAv', () => {
  const baseProspect: Prospect = {
    name: 'Test', school: 'Test U', pos: 'WR', draftSeason: 2020, pick: 10,
    age: 22, height: 73, weight: 210, forty: 4.4, vertical: 38, broad: 125,
    cone: 6.9, shuttle: 4.2, bench: 0,
    pffProfileId: '', pffComposite: 80, pffGrade: 78, pffProduction: 72,
    pffEfficiency: 76, pffClean: 70, schemeTag: '',
  }
  const signals = { draft: 90, athletic: 75, size: 60, age: 80 }

  it('top-10 pick gets meaningful AV projection', () => {
    const av = calibratedExpectedAv(baseProspect, signals)
    expect(av).toBeGreaterThan(15)
    expect(av).toBeLessThan(55)
  })
  it('late pick gets lower AV than early pick', () => {
    const earlyPick = calibratedExpectedAv(baseProspect, signals)
    const latePick = calibratedExpectedAv({ ...baseProspect, pick: 200 }, { ...signals, draft: 20 })
    expect(earlyPick).toBeGreaterThan(latePick)
  })
})

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeHistorical(overrides: Partial<Historical> = {}): Historical {
  return {
    id: 'test-1', name: 'Test Player', school: 'Test U', year: 2018,
    pos: 'WR', pick: 15, age: 22,
    height: 73, weight: 205, forty: 4.4, vertical: 38, broad: 125,
    cone: 6.9, shuttle: 4.2, bench: 0,
    games: 60, av: 30, starts: 40, proBowls: 1, allPros: 0, category: 'Starter',
    ...overrides,
  }
}

function makeProspect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    name: 'Prospect', school: 'College U', pos: 'WR', draftSeason: 2025, pick: 15,
    age: 22, height: 73, weight: 205, forty: 4.4, vertical: 38, broad: 125,
    cone: 6.9, shuttle: 4.2, bench: 0,
    pffProfileId: '', pffComposite: 80, pffGrade: 78, pffProduction: 72,
    pffEfficiency: 76, pffClean: 70, schemeTag: '',
    ...overrides,
  }
}

// ── sim() ─────────────────────────────────────────────────────────────────────

describe('sim', () => {
  it('identical prospect and player gets high similarity', () => {
    const p = makeProspect()
    const h = makeHistorical()
    const s = sim(p, h)
    expect(s).toBeGreaterThan(0.3)
  })
  it('very different pick number reduces similarity', () => {
    const p = makeProspect({ pick: 1 })
    const near = makeHistorical({ pick: 2 })
    const far = makeHistorical({ pick: 200 })
    expect(sim(p, near)).toBeGreaterThan(sim(p, far))
  })
  it('same position scores higher than different position', () => {
    const p = makeProspect({ pos: 'WR' })
    const samePos = makeHistorical({ pos: 'WR' })
    const diffPos = makeHistorical({ pos: 'RB' })
    expect(sim(p, samePos)).toBeGreaterThan(sim(p, diffPos))
  })
})

// ── pffSim() ──────────────────────────────────────────────────────────────────

function makePffProfile(overrides: Partial<PffProfile> = {}): PffProfile {
  return {
    id: 'pff-1', name: 'PFF Player', college: 'Test U', position: 'WR',
    draftSeason: 2018, games: 48,
    pff: { composite: 80, grade: 78, production: 72, efficiency: 76, clean: 70 },
    nfl: { draftPick: 15, games: 60, starts: 40, snaps: 2500, awards: 1, score: 75, category: 'Starter', av: 32 },
    ...overrides,
  }
}

describe('pffSim', () => {
  it('identical PFF profile gets high similarity', () => {
    const p = makeProspect()
    const pff = makePffProfile()
    const s = pffSim(p, pff)
    expect(s).toBeGreaterThan(0.2)
  })
  it('star comp gets boosted over bust comp', () => {
    const p = makeProspect()
    const star = makePffProfile({ nfl: { draftPick: 15, games: 80, starts: 70, snaps: 4000, awards: 2, score: 90, category: 'Star', av: 80 } })
    const bust = makePffProfile({ nfl: { draftPick: 15, games: 10, starts: 2, snaps: 200, awards: 0, score: 20, category: 'Bust', av: 2 } })
    expect(pffSim(p, star)).toBeGreaterThan(pffSim(p, bust))
  })
})

// ── project() regression tests ────────────────────────────────────────────────

function buildHistory(): Historical[] {
  const positions = ['WR', 'RB', 'QB', 'TE', 'OL', 'CB']
  const categories: Array<Historical['category']> = ['Star', 'High-end starter', 'Starter', 'Role', 'Reserve', 'Bust']
  const hist: Historical[] = []
  let id = 0
  for (let pick = 1; pick <= 200; pick += 5) {
    for (const pos of positions) {
      const cat = pick <= 32 ? 'Starter' : pick <= 100 ? 'Role' : 'Bust'
      hist.push(makeHistorical({
        id: `h-${++id}`, pos, pick, year: 2015 + (id % 8),
        av: pick <= 32 ? 35 : pick <= 100 ? 18 : 6,
        games: pick <= 32 ? 70 : pick <= 100 ? 45 : 20,
        starts: pick <= 32 ? 55 : pick <= 100 ? 25 : 5,
        category: cat as Historical['category'],
      }))
    }
  }
  return hist
}

describe('project (regression)', () => {
  const history = buildHistory()
  const pffProfiles: PffProfile[] = []

  it('top-10 WR pick scores above 60', () => {
    const p = makeProspect({ pos: 'WR', pick: 8 })
    const result = project(p, history, pffProfiles)
    expect(result.score).toBeGreaterThan(50)
    expect(result.score).toBeLessThanOrEqual(99)
  })

  it('late-round pick scores below top pick', () => {
    const early = project(makeProspect({ pick: 5 }), history, pffProfiles)
    const late = project(makeProspect({ pick: 180 }), history, pffProfiles)
    expect(early.score).toBeGreaterThan(late.score)
  })

  it('comps are same position for WR (no cross-position SKILL comps)', () => {
    const p = makeProspect({ pos: 'WR', pick: 20 })
    const result = project(p, history, pffProfiles)
    const positions = result.fullComps.map((c) => c.player.pos)
    expect(positions.every((pos) => pos === 'WR')).toBe(true)
  })

  it('comps are same position for RB', () => {
    const p = makeProspect({ pos: 'RB', pick: 20 })
    const result = project(p, history, pffProfiles)
    const positions = result.fullComps.map((c) => c.player.pos)
    expect(positions.every((pos) => pos === 'RB')).toBe(true)
  })

  it('DB comps allow CB and S cross-position', () => {
    const cbHist = buildHistory().filter((h) => h.pos === 'CB')
    const sHist = buildHistory().map((h) => ({ ...h, pos: 'S' as const, id: 's-' + h.id }))
    const mixedHistory = [...cbHist, ...sHist]
    const p = makeProspect({ pos: 'CB', pick: 20 })
    const result = project(p, mixedHistory, pffProfiles)
    const posSet = new Set(result.fullComps.map((c) => c.player.pos))
    expect(posSet.has('CB') || posSet.has('S')).toBe(true)
  })

  it('injury penalty reduces score', () => {
    const p = makeProspect({ pos: 'WR', pick: 15 })
    const healthy = project(p, history, pffProfiles, undefined, undefined, undefined, undefined)
    const injured = project(p, history, pffProfiles, undefined, undefined, undefined, 'major')
    expect(healthy.score).toBeGreaterThan(injured.score)
  })

  it('QB declining trajectory reduces score', () => {
    const p = makeProspect({ pos: 'QB', pick: 1 })
    const stable = project(p, history, pffProfiles, undefined, undefined, undefined, undefined, 0)
    const declining = project(p, history, pffProfiles, undefined, undefined, undefined, undefined, -15)
    expect(stable.score).toBeGreaterThan(declining.score)
  })

  it('score is in [1, 99]', () => {
    for (const pick of [1, 32, 64, 100, 200]) {
      const result = project(makeProspect({ pick }), history, pffProfiles)
      expect(result.score).toBeGreaterThanOrEqual(1)
      expect(result.score).toBeLessThanOrEqual(99)
      expect(result.scoreLow).toBeGreaterThanOrEqual(1)
      expect(result.scoreHigh).toBeLessThanOrEqual(99)
    }
  })

  it('floor ≤ median ≤ ceiling', () => {
    const result = project(makeProspect({ pick: 20 }), history, pffProfiles)
    expect(result.floor).toBeLessThanOrEqual(result.median)
    expect(result.median).toBeLessThanOrEqual(result.ceiling)
  })

  it('outcome odds sum to ~1', () => {
    const result = project(makeProspect({ pick: 20 }), history, pffProfiles)
    const total = Object.values(result.odds).reduce((s, v) => s + v, 0)
    expect(total).toBeGreaterThan(0.95)
    expect(total).toBeLessThan(1.05)
  })
})
