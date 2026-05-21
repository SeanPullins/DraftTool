// Pure model functions and types — no React dependencies.
// Extracted to enable unit testing without the full component tree.

// ── Types ─────────────────────────────────────────────────────────────────────

export type Category = 'Bust' | 'Reserve' | 'Role' | 'Starter' | 'High-end starter' | 'Star'

export type Prospect = {
  name: string
  school: string
  pos: string
  draftSeason: number
  pick: number
  age: number
  height: number
  weight: number
  forty: number
  vertical: number
  broad: number
  cone: number
  shuttle: number
  bench: number
  pffProfileId: string
  pffComposite: number
  pffGrade: number
  pffProduction: number
  pffEfficiency: number
  pffClean: number
  schemeTag: string
  officialRas?: number | null
  alltimeRas?: number | null
}

export type Historical = {
  id: string
  name: string
  school: string
  year: number
  pos: string
  pick: number
  age: number | null
  height: number | null
  weight: number | null
  forty: number | null
  vertical: number | null
  broad: number | null
  cone: number | null
  shuttle: number | null
  bench: number | null
  games: number
  av: number
  starts: number
  proBowls: number
  allPros: number
  category: Category
}

export type PffProfile = {
  id: string
  name: string
  college: string
  position: string
  draftSeason: number
  games: number
  pff: {
    composite: number
    grade: number
    production: number
    efficiency: number
    clean: number
  }
  nfl: {
    draftPick: number
    games: number
    starts: number
    snaps: number
    awards: number
    score: number
    category: Category
    av: number
  } | null
}

export type QbSeason = {
  key: string
  name: string
  season: number
  team: string
  games: number
  gs: number
  att: number
  cmp_pct: number | null
  rtg: number | null
  td_pct: number | null
  int_pct: number | null
  sk_pct: number | null
  any_a: number | null
  succ: number | null
  ypa: number | null
}

export type WrSeason = {
  key: string
  name: string
  season: number
  team: string
  games: number
  gs: number
  tgt: number | null
  rec: number | null
  yds: number | null
  ypr: number | null
  td: number | null
  ypg: number | null
  ctch_pct: number | null
  succ: number | null
  pos: string
}

export type RbSeason = {
  key: string
  name: string
  season: number
  team: string
  games: number
  gs: number
  rush_att: number | null
  rush_yds: number | null
  rush_ypa: number | null
  rush_td: number | null
  rush_succ: number | null
  tgt: number | null
  rec: number | null
  rec_yds: number | null
  ctch_pct: number | null
  rec_succ: number | null
  pos: string
}

export type Y1Data = { qb: QbSeason[]; wr: WrSeason[]; rb: RbSeason[] }

export type CareerSeasonStat = {
  season: number
  pos: string
  games: number
  att?: number
  yds?: number
  tds?: number
  ints?: number
  cmp_pct?: number
  ypa?: number
  epa_per_att?: number
  tgt?: number
  rec?: number
  ypr?: number
  ctch_pct?: number
  epa_per_tgt?: number
  car?: number
  rush_yds?: number
  rush_tds?: number
  ypc?: number
  rush_epa_per_carry?: number
  rec_yds?: number
}

export type CareerStatMap = Record<string, CareerSeasonStat[]>

export type ModelSignal = 'draftScore' | 'logPick' | 'pffComp' | 'pffGrade' | 'pffProd' | 'pffEff' | 'pffClean' | 'ageScore' | 'athletic' | 'size' | 'isQB' | 'isSkill' | 'isOL' | 'isFront' | 'isDB'

// ── Constants ─────────────────────────────────────────────────────────────────

export const matureOutcomeCutoff = 2023

export const outcomeOrder: Category[] = ['Bust', 'Reserve', 'Role', 'Starter', 'High-end starter', 'Star']

// OL/FRONT mature slowly — require 6 seasons (≤2020) so AV reflects sustained contribution,
// not just early development. SKILL/DB contribute immediately — 4 seasons (≤2022) is adequate.
// QB/LB use the middle ground at 5 seasons (≤2021).
export const compCutoffYear = 2021
export const compCutoffForGroup: Record<string, number> = { SKILL: 2022, DB: 2022, QB: 2021, OL: 2020, FRONT: 2020 }

export const calibratedAvModel: { intercept: number; features: Array<{ name: ModelSignal; coef: number; mean: number; sd: number }> } = {
  intercept: 2.2004014562310035,
  features: [
    { name: 'draftScore', coef: 0.31947947119672315, mean: 65.99576186138597, sd: 23.344517317385453 },
    { name: 'logPick', coef: -0.35498588886959903, mean: 4.512995778202057, sd: 0.9852590481027931 },
    { name: 'pffComp', coef: 0.1006089042230861, mean: 59.37972116603295, sd: 12.105489832279053 },
    { name: 'pffGrade', coef: 0.2127170956880477, mean: 59.21089987325728, sd: 11.209071232597717 },
    { name: 'pffProd', coef: 0.1217359963782789, mean: 44.823447401774374, sd: 26.970209736123333 },
    { name: 'pffEff', coef: -0.16542264368432483, mean: 76.55031685678067, sd: 14.41636658020626 },
    { name: 'pffClean', coef: 0.02570371785419989, mean: 66.59353612167301, sd: 15.646482576825223 },
    { name: 'ageScore', coef: 0.0629739702621933, mean: 61.667934093789604, sd: 13.903387389522521 },
    { name: 'athletic', coef: 0.08308460771343065, mean: 53.28770293332807, sd: 16.108057294946907 },
    { name: 'size', coef: -0.02159427729646015, mean: 57.2611301521237, sd: 22.821943730203717 },
    { name: 'isQB', coef: -0.3413377811446161, mean: 0.08238276299112801, sd: 0.27494698280409635 },
    { name: 'isSkill', coef: -0.1898380898326027, mean: 0.2572877059569075, sd: 0.43713927107998507 },
    { name: 'isOL', coef: 0.2564974833852538, mean: 0.19011406844106463, sd: 0.3923910159800472 },
    { name: 'isFront', coef: 0.07089016406692487, mean: 0.2674271229404309, sd: 0.4426170544118608 },
    { name: 'isDB', coef: 0.11144897240710176, mean: 0.20278833967046894, sd: 0.40207614821593646 },
  ],
}

export const group: Record<string, string> = {
  QB: 'QB',
  RB: 'SKILL',
  WR: 'SKILL',
  TE: 'SKILL',
  OL: 'OL',
  DL: 'FRONT',
  LB: 'FRONT',
  CB: 'DB',
  S: 'DB',
}

// Scout/film inputs removed — users have no film data and the signal added noise.
// Weights redistribute proportionally from the original scout weight (QB .38 / SKILL .33 etc.)
// Official RAS blend weight by group — how much official RAS (0-10 mapped to 0-100)
// replaces the internal combine percentile athletic score when RAS is available.
// QB: low because athletic testing is less predictive than production/accuracy/age for QBs.
// OL/DB: higher because size+agility thresholds are primary evaluation criteria.
export const rasBlendByGroup: Record<string, number> = {
  QB: 0.20, SKILL: 0.55, OL: 0.60, FRONT: 0.55, DB: 0.65,
}

export const signalWeights: Record<string, { draft: number; athletic: number; size: number; age: number; strength: number }> = {
  QB:    { draft: .55, athletic: .08, size: .08, age: .19, strength: .10 },
  SKILL: { draft: .45, athletic: .28, size: .05, age: .15, strength: .07 },
  // OL: athletic strongly predictive (r=−0.25 to −0.30); age and size both matter
  OL:    { draft: .37, athletic: .21, size: .19, age: .13, strength: .10 },
  // FRONT: age r=−0.327 and bench r=0.219 are the dominant signals
  FRONT: { draft: .33, athletic: .18, size: .09, age: .18, strength: .22 },
  // DB: cone/shuttle r=−0.21 to −0.22, age r=−0.294 → raise athletic+age
  DB:    { draft: .38, athletic: .34, size: .05, age: .19, strength: .04 },
}

// ── Utility ───────────────────────────────────────────────────────────────────

export function clamp(value: number, min = 0, max = 99) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 50))
}

export function clean(s = '') {
  return s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')
}

export function avg(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function blend(a: number, b: number, weight: number) {
  return a * (1 - weight) + b * weight
}

export function q(values: number[], p: number) {
  return values[Math.min(values.length - 1, Math.max(0, Math.floor(values.length * p)))] || 0
}

// Euclidean distance helpers used in similarity functions
function z(a: number, b: number | null, sd: number) {
  return b == null ? .4 : Math.min(2, Math.abs(a - b) / sd)
}

function z2(a: number, b: number, sd: number) {
  return Math.min(2, Math.abs(a - b) / sd)
}

export function isMatureOutcome(draftSeason: number) {
  return draftSeason <= matureOutcomeCutoff
}

function avToScore(av: number) {
  return clamp(100 * (1 - Math.exp(-Math.max(0, av) / 34)), 0, 99)
}

function gradeLabel(score: number) {
  if (score >= 85) return 'Grade A+'
  if (score >= 75) return 'Grade A'
  if (score >= 65) return 'Grade B+'
  if (score >= 55) return 'Grade B'
  if (score >= 45) return 'Grade C+'
  return 'Grade C'
}

// ── Age signal ────────────────────────────────────────────────────────────────

export function ageSignal(age: number, pos: string): number {
  if (pos === 'QB') {
    // Age r=−0.397 (strongest position effect). Slight soften at ≥24: selection
    // bias means teams only invest in older QBs when the profile is genuinely elite.
    return age <= 20.8 ? 92 : age <= 21.6 ? 82 : age <= 22.8 ? 70 : age <= 24.0 ? 56 : age <= 25.5 ? 44 : 32
  }
  if (pos === 'RB') {
    // Many successful RBs are drafted at 22–23; the previous cliff from 54→28 at
    // age 22.6 punished nearly half of drafted RBs too harshly. Graduated step instead.
    return age <= 20.3 ? 94 : age <= 21.0 ? 84 : age <= 21.8 ? 72 : age <= 22.6 ? 60 : age <= 23.5 ? 48 : 34
  }
  if (group[pos] === 'OL') {
    // OL develop slowly; age 25–26 OL still valuable (later peak than skill positions).
    return age <= 21.5 ? 84 : age <= 22.5 ? 74 : age <= 24.0 ? 64 : age <= 25.5 ? 54 : age <= 27.0 ? 44 : 36
  }
  if (group[pos] === 'FRONT') {
    // DL/LB age r=−0.250 to −0.327 — steeper curve than skill; dedicated branch vs default.
    return age <= 21.0 ? 90 : age <= 22.0 ? 80 : age <= 23.0 ? 68 : age <= 24.0 ? 58 : age <= 25.0 ? 48 : 36
  }
  // Default (WR, TE, CB, S): age r=−0.187 to −0.294.
  // Empirical: ≤21 = 45.9% starter, 22 = 37.9%, 23 = 39.1%, ≥24 = 40.7% (R2-5).
  // 22–24 starters are nearly identical — flatten that zone; add a 24.5 breakpoint.
  return age <= 20.8 ? 90 : age <= 21.6 ? 80 : age <= 22.5 ? 68 : age <= 23.5 ? 58 : age <= 24.5 ? 50 : 38
}

// ── Athleticism ───────────────────────────────────────────────────────────────

export function rasScore(input: Prospect, pool: Historical[]): number {
  if (pool.length < 20) return 5
  function zStat(values: (number | null)[], raw: number | null, invert = false): number | null {
    if (raw == null) return null
    const valid = values.filter((v): v is number => v != null && Number.isFinite(v))
    if (valid.length < 10) return null
    const m = avg(valid)
    const sd = Math.sqrt(avg(valid.map((v) => (v - m) ** 2)))
    if (sd < 0.001) return null
    const z = (raw - m) / sd
    return clamp((invert ? -z : z) * 1.5 + 5, 0, 10)
  }
  const scores = [
    zStat(pool.map((p) => p.height), input.height),
    zStat(pool.map((p) => p.weight), input.weight),
    zStat(pool.map((p) => p.forty), input.forty, true),
    zStat(pool.map((p) => p.vertical), input.vertical),
    zStat(pool.map((p) => p.broad), input.broad),
    zStat(pool.map((p) => p.cone), input.cone, true),
    zStat(pool.map((p) => p.shuttle), input.shuttle, true),
    zStat(pool.map((p) => p.bench), input.bench > 0 ? input.bench : null),
  ].filter((s): s is number => s != null)
  return scores.length ? clamp(avg(scores), 0, 10) : 5
}

// ── PFF normalization ─────────────────────────────────────────────────────────

export function normalizePffInput(input: Prospect, pffProfiles: PffProfile[]) {
  const posGroup = group[input.pos] ?? 'SKILL'
  const pool = pffProfiles.filter((p) => group[p.position] === posGroup)
  if (pool.length < 10) return { composite: input.pffComposite, grade: input.pffGrade, production: input.pffProduction, efficiency: input.pffEfficiency, clean: input.pffClean }
  function normField(values: number[], raw: number): number {
    const m = avg(values)
    const sd = Math.sqrt(avg(values.map((v) => (v - m) ** 2)))
    if (sd < 0.01) return 50
    return clamp(50 + ((raw - m) / sd) * 15, 1, 99)
  }
  return {
    composite: normField(pool.map((p) => p.pff.composite), input.pffComposite),
    grade: normField(pool.map((p) => p.pff.grade), input.pffGrade),
    production: normField(pool.map((p) => p.pff.production), input.pffProduction),
    efficiency: normField(pool.map((p) => p.pff.efficiency), input.pffEfficiency),
    clean: normField(pool.map((p) => p.pff.clean), input.pffClean),
  }
}

// ── Calibrated AV model ───────────────────────────────────────────────────────

// Empirical mean wAV by pick range (2016-2022, n=1,792 picks).
// Used to anchor calibratedExpectedAv — prevents systematic overestimation for late picks
// where model signal is weakest. Baseline weight increases with pick# (higher uncertainty).
function pickRangeBaseline(pick: number): { av: number; weight: number } {
  if (pick <= 32)  return { av: 35.0, weight: 0.15 }
  if (pick <= 64)  return { av: 24.2, weight: 0.20 }
  if (pick <= 100) return { av: 18.5, weight: 0.25 }
  if (pick <= 160) return { av: 12.3, weight: 0.30 }
  return                   { av:  7.4, weight: 0.35 }
}

export function calibratedExpectedAv(input: Prospect, signals: { draft: number; athletic: number; size: number; age: number }) {
  const values: Record<ModelSignal, number> = {
    draftScore: signals.draft,
    logPick: Math.log(clamp(input.pick, 1, 260)),
    pffComp: input.pffComposite,
    pffGrade: input.pffGrade,
    pffProd: input.pffProduction,
    pffEff: input.pffEfficiency,
    pffClean: input.pffClean,
    ageScore: signals.age,
    athletic: signals.athletic,
    size: signals.size,
    isQB: input.pos === 'QB' ? 1 : 0,
    isSkill: group[input.pos] === 'SKILL' ? 1 : 0,
    isOL: group[input.pos] === 'OL' ? 1 : 0,
    isFront: group[input.pos] === 'FRONT' ? 1 : 0,
    isDB: group[input.pos] === 'DB' ? 1 : 0,
  }
  const logAv = calibratedAvModel.features.reduce(
    (sum, feature) => sum + feature.coef * ((values[feature.name] - feature.mean) / feature.sd),
    calibratedAvModel.intercept,
  )
  const modelAv = clamp(Math.expm1(logAv), 0, 110)
  const { av: baselineAv, weight } = pickRangeBaseline(input.pick)
  return blend(modelAv, baselineAv, weight)
}

// ── Y1/Y2/Y3/Y4 similarity factors ───────────────────────────────────────────

function y1SimFactor(player: Historical, y1Data: Y1Data): number {
  if (player.pos === 'QB') {
    const s = y1Data.qb.find((r) => r.key === clean(player.name) && r.season === player.year)
    if (s?.rtg != null) {
      return clamp(0.5 + (s.rtg / 100) * 0.7, 0.88, 1.12)
    }
  } else if (player.pos === 'WR') {
    const s = y1Data.wr.find((r) => r.key === clean(player.name) && r.season === player.year)
    if (s?.yds != null) {
      return clamp(0.84 + (s.yds / 1000) * 0.17, 0.88, 1.12)
    }
  } else if (player.pos === 'RB') {
    const s = y1Data.rb.find((r) => r.key === clean(player.name) && r.season === player.year)
    if (s?.rush_yds != null) {
      return clamp(0.5 + (s.rush_yds / 900) * 0.5, 0.88, 1.12)
    }
  }
  return 1.0
}

function y2SimFactor(player: Historical, careerStats: CareerStatMap): number {
  const key = clean(player.name)
  const seasons = careerStats[key]
  if (!seasons?.length) return 1.0
  const y2 = seasons.find((s) => s.season === player.year + 1)
  if (!y2) return 1.0
  if (player.pos === 'QB' && y2.att && y2.att >= 200 && y2.epa_per_att != null) {
    return clamp(1.0 + y2.epa_per_att * 0.3, 0.94, 1.08)
  }
  if ((player.pos === 'WR' || player.pos === 'TE') && y2.tgt && y2.tgt >= 40 && y2.yds != null) {
    return clamp(0.9 + (y2.yds / 1000) * 0.14, 0.94, 1.08)
  }
  if (player.pos === 'RB' && y2.car && y2.car >= 50 && y2.rush_yds != null) {
    return clamp(0.88 + (y2.rush_yds / 1000) * 0.2, 0.94, 1.08)
  }
  return 1.0
}

function y3SimFactor(player: Historical, careerStats: CareerStatMap): number {
  const key = clean(player.name)
  const seasons = careerStats[key]
  if (!seasons?.length) return 1.0
  const y3 = seasons.find((s) => s.season === player.year + 2)
  if (!y3) return 1.0
  if (player.pos === 'QB' && y3.att && y3.att >= 200 && y3.epa_per_att != null)
    return clamp(1.0 + y3.epa_per_att * 0.25, 0.96, 1.06)
  if ((player.pos === 'WR' || player.pos === 'TE') && y3.tgt && y3.tgt >= 40 && y3.yds != null)
    return clamp(0.92 + (y3.yds / 1000) * 0.12, 0.96, 1.06)
  if (player.pos === 'RB' && y3.car && y3.car >= 50 && y3.rush_yds != null)
    return clamp(0.90 + (y3.rush_yds / 1000) * 0.17, 0.96, 1.06)
  return 1.0
}

function y4SimFactor(player: Historical, careerStats: CareerStatMap): number {
  const key = clean(player.name)
  const seasons = careerStats[key]
  if (!seasons?.length) return 1.0
  const y4 = seasons.find((s) => s.season === player.year + 3)
  if (!y4) return 1.0
  if (player.pos === 'QB' && y4.att && y4.att >= 200 && y4.epa_per_att != null)
    return clamp(1.0 + y4.epa_per_att * 0.20, 0.97, 1.04)
  if ((player.pos === 'WR' || player.pos === 'TE') && y4.tgt && y4.tgt >= 40 && y4.yds != null)
    return clamp(0.93 + (y4.yds / 1000) * 0.10, 0.97, 1.04)
  if (player.pos === 'RB' && y4.car && y4.car >= 50 && y4.rush_yds != null)
    return clamp(0.91 + (y4.rush_yds / 1000) * 0.14, 0.97, 1.04)
  return 1.0
}

// ── Historical similarity ─────────────────────────────────────────────────────

export function sim(input: Prospect, player: Historical, y1Data?: Y1Data, careerStats?: CareerStatMap, refYear = 2022) {
  const distance =
    Math.abs(Math.log(input.pick + 1) - Math.log(player.pick + 1)) * .45 +
    z(input.height, player.height, 3) * .08 +
    z(input.weight, player.weight, 18) * .08 +
    z(input.forty, player.forty, .16) * .16 +
    z(input.vertical, player.vertical, 5) * .07 +
    z(input.broad, player.broad, 9) * .07 +
    z(input.cone, player.cone, .28) * .05 +
    z(input.shuttle, player.shuttle, .2) * .05 +
    (input.bench > 0 && player.bench ? z(input.bench, player.bench, 6) * .04 : 0) +
    (input.pos === player.pos ? 0 : .12)
  const recency = Math.pow(0.96, Math.max(0, refYear - player.year))
  const y1Factor = y1Data ? y1SimFactor(player, y1Data) : 1.0
  const y2Factor = careerStats ? y2SimFactor(player, careerStats) : 1.0
  const y3Factor = careerStats ? y3SimFactor(player, careerStats) : 1.0
  const y4Factor = careerStats ? y4SimFactor(player, careerStats) : 1.0
  return Math.exp(-distance) * recency * y1Factor * y2Factor * y3Factor * y4Factor
}

// Position-aware PFF similarity for comp pool construction.
// Each group weights the PFF dimensions that actually predict outcomes (matching pffSignal weights).
// pffDist components sum to .96 in every branch to keep the distance scale consistent.
export function pffSim(input: Prospect, profile: PffProfile, grp?: string, preDraft = false) {
  const g = grp ?? group[input.pos] ?? 'SKILL'
  const nflPick = profile.nfl?.draftPick ?? input.pick
  let pffDist: number
  if (g === 'SKILL') {
    pffDist = z2(input.pffComposite, profile.pff.composite, 8)    * .36 +
              z2(input.pffGrade, profile.pff.grade, 10)           * .24 +
              z2(input.pffProduction, profile.pff.production, 12) * .18 +
              z2(input.pffEfficiency, profile.pff.efficiency, 10) * .14 +
              z2(input.pffClean, profile.pff.clean, 12)           * .04
  } else if (g === 'QB') {
    pffDist = z2(input.pffComposite, profile.pff.composite, 8)    * .24 +
              z2(input.pffGrade, profile.pff.grade, 10)           * .24 +
              z2(input.pffEfficiency, profile.pff.efficiency, 10) * .28 +
              z2(input.pffProduction, profile.pff.production, 12) * .14 +
              z2(input.pffClean, profile.pff.clean, 12)           * .06
  } else if (g === 'OL') {
    // composite/grade near-zero or negative; match on production, efficiency, clean
    pffDist = z2(input.pffProduction, profile.pff.production, 12) * .44 +
              z2(input.pffEfficiency, profile.pff.efficiency, 10) * .38 +
              z2(input.pffClean, profile.pff.clean, 12)           * .14
  } else if (input.pos === 'LB') {
    pffDist = z2(input.pffGrade, profile.pff.grade, 10)           * .48 +
              z2(input.pffEfficiency, profile.pff.efficiency, 10) * .30 +
              z2(input.pffProduction, profile.pff.production, 12) * .18
  } else {
    // FRONT (DL) and DB: skip composite; production/efficiency/grade
    pffDist = z2(input.pffProduction, profile.pff.production, 12) * .44 +
              z2(input.pffEfficiency, profile.pff.efficiency, 10) * .32 +
              z2(input.pffGrade, profile.pff.grade, 10)           * .20
  }
  const distance =
    Math.abs(Math.log(input.pick + 1) - Math.log(nflPick + 1)) * .2 +
    pffDist +
    (input.pos === profile.position ? 0 : .16)
  const recency = Math.pow(0.97, Math.max(0, 2024 - profile.draftSeason))
  // preDraft mode: disable NFL-outcome weighting so comp selection is based purely on
  // pre-draft signals (pick, position, PFF metrics). Used in walk-forward evaluation
  // to avoid circular reasoning: known NFL success influencing which comps are selected.
  const experienceBonus = preDraft ? 1.0 : (profile.games >= 36 ? 1.06 : profile.games >= 24 ? 1.03 : profile.games >= 12 ? 1.0 : 0.93)
  const nflSnaps = profile.nfl?.snaps ?? 0
  const snapBoost = preDraft ? 1.0 : (nflSnaps >= 2000 ? 1.05 : nflSnaps >= 800 ? 1.02 : 1.0)
  const tierWeight = preDraft ? 1.0 : (
    profile.nfl?.category === 'Star'              ? 1.25 :
    profile.nfl?.category === 'High-end starter'  ? 1.15 :
    profile.nfl?.category === 'Starter'           ? 1.05 :
    profile.nfl?.category === 'Reserve'           ? 0.75 :
    profile.nfl?.category === 'Bust'              ? 0.65 : 1.0)
  return Math.exp(-distance) * recency * experienceBonus * tierWeight * snapBoost
}

// ── School production tier ────────────────────────────────────────────────────
// Programs with elite historical draft production relative to recruiting rank.
// Tier 1 (SEC/Big Ten blue-chips): consistent 30%+ starter rates over 2000-2022.
// Tier 2 (other P4 heavyweights): meaningful but smaller edge.
// Applied as a small scout-signal nudge; no positional differentiation.

const SCHOOL_TIER1 = new Set([
  'alabama', 'georgia', 'ohio state', 'michigan', 'lsu', 'clemson', 'notre dame',
  'penn state', 'florida', 'florida state', 'auburn', 'oklahoma', 'texas', 'miami',
  'usc', 'tennessee', 'louisville', 'iowa', 'wisconsin', 'washington',
])
const SCHOOL_TIER2 = new Set([
  'oregon', 'stanford', 'nebraska', 'michigan state', 'pittsburgh', 'north carolina',
  'kentucky', 'arkansas', 'mississippi state', 'baylor', 'tcu', 'west virginia',
  'virginia tech', 'north carolina state', 'utah', 'ucla', 'texas a&m', 'ole miss',
  'arizona state', 'georgia tech', 'kansas state', 'illinois',
])

export function schoolTierBoost(school: string): number {
  const s = school.toLowerCase().trim()
  if (SCHOOL_TIER1.has(s)) return 2.5
  if (SCHOOL_TIER2.has(s)) return 1.0
  return 0
}

// Age-adjusted PFF production multiplier (Phase 7).
// Younger prospects producing at the same PFF level have more remaining ceiling;
// older prospects have already demonstrated their peak output. Applied to pffSignal only,
// not to draft capital, so it doesn't interfere with the draft-slot-based ranking.
// Conservative multipliers to avoid overfitting; evaluated via ablation.
function ageProductionMultiplier(age: number | null, pos: string): number {
  const a = age ?? 22
  if (pos === 'QB') {
    if (a <= 20.8) return 1.08
    if (a <= 21.6) return 1.04
    if (a <= 22.8) return 1.00
    if (a <= 24.0) return 0.96
    return 0.91
  }
  if (a <= 20.5) return 1.08
  if (a <= 21.2) return 1.04
  if (a <= 22.0) return 1.00
  if (a <= 23.0) return 0.96
  return 0.91
}

function dangerFlags(input: Prospect, proj: { ceiling: number; floor: number; pffBlend: number }): string[] {
  const flags: string[] = []
  if (input.age > 23.5) flags.push('Late entry age')
  if (input.pos === 'RB' && input.pick > 100) flags.push('Late-round RB')
  else if (input.pos === 'RB' && input.pick > 50) flags.push('RB depreciation risk')
  if (proj.ceiling - proj.floor > 35) flags.push('High outcome variance')
  if (proj.pffBlend === 0 && input.pick > 80) flags.push('Limited comp data')
  return flags
}

// ── Main projection engine ────────────────────────────────────────────────────

export type ProjectOpts = {
  disableElitePremium?: boolean
  calibBlendOverride?: number
  disableAgeAdjPff?: boolean
  disableOfficialRas?: boolean
}

export function project(input: Prospect, history: Historical[], pffProfiles: PffProfile[], excludeId?: string, y1Data?: Y1Data, careerStats?: CareerStatMap, injurySeverity?: 'major' | 'moderate' | 'minor', gradeDelta?: number | null, preDraft = false, opts?: ProjectOpts) {
  // Position-specific maturation cutoffs prevent underestimating AV for slow-developing groups.
  // OL/FRONT need 6+ seasons for AV to reflect sustained contribution (cutoff 2020).
  // SKILL/DB contribute immediately so 4 seasons is adequate (cutoff 2022).
  const grpCutoff = compCutoffForGroup[group[input.pos] ?? 'SKILL'] ?? compCutoffYear
  const grp = group[input.pos] ?? 'SKILL'
  // For SKILL positions, require exact position match in comp pool — WRs should only
  // comp to WRs, RBs to RBs, TEs to TEs. Other groups (DB, FRONT) share a pool.
  const pool = history.filter((p) => {
    const posMatch = grp === 'SKILL' ? p.pos === input.pos : (p.pos === input.pos || group[p.pos] === group[input.pos])
    return posMatch && p.id !== excludeId && p.year <= grpCutoff
  })
  const ras = rasScore(input, pool)
  const stats = (k: keyof Historical) => pool.map((p) => p[k]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const pct = (value: number, values: number[], low = false) => values.length ? values.filter((v) => low ? v >= value : v <= value).length / values.length * 100 : 50
  const draft = 100 * Math.pow(1 - (input.pick - 1) / 259, .58)
  const combineAthleticScore = avg([pct(input.forty, stats('forty'), true), pct(input.vertical, stats('vertical')), pct(input.broad, stats('broad')), pct(input.cone, stats('cone'), true), pct(input.shuttle, stats('shuttle'), true)])
  const officialRasSignal = (input.officialRas != null && !opts?.disableOfficialRas)
    ? clamp(input.officialRas * 10, 0, 100) : null
  const athletic = officialRasSignal != null
    ? blend(combineAthleticScore, officialRasSignal, rasBlendByGroup[grp] ?? 0.55)
    : combineAthleticScore
  const size = avg([pct(input.height, stats('height')), pct(input.weight, stats('weight'))])
  // School tier contributes a small direct score adjustment (not via a scout intermediate)
  const schoolBoost = schoolTierBoost(input.school)
  const age = ageSignal(input.age, input.pos)
  const benchPool = stats('bench').filter((v) => v > 0)
  const strength = input.bench > 0 && benchPool.length >= 10 ? pct(input.bench, benchPool) : 50
  const normPff = normalizePffInput(input, pffProfiles)
  // Position-aware PFF signal — Pearson r with wAV at picks 33-160 by group:
  //   SKILL: composite r=0.382 > grade r=0.334 → composite leads at 60%
  //   QB:    composite ≈ grade (r≈0.24); efficiency encodes decision-making quality
  //   OL:    composite r=−0.017 — skip; production/efficiency/clean have marginal value
  //   FRONT: production (disruption) is the strongest PFF metric (grade r=0.029)
  //   LB:    grade r=0.126 is best available; composite r=−0.079 excluded
  //   DB:    composite r=0.053 — near-zero; production/efficiency/grade marginally better
  let pffSignal: number
  if (grp === 'SKILL') {
    pffSignal = normPff.composite * .60 + normPff.grade * .40
  } else if (grp === 'QB') {
    pffSignal = normPff.composite * .48 + normPff.grade * .36 + normPff.efficiency * .16
  } else if (grp === 'OL') {
    pffSignal = normPff.production * .50 + normPff.efficiency * .32 + normPff.clean * .18
  } else if (grp === 'FRONT') {
    pffSignal = normPff.production * .58 + normPff.grade * .24 + normPff.clean * .18
  } else if (input.pos === 'LB') {
    pffSignal = normPff.grade * .58 + normPff.efficiency * .30 + normPff.clean * .12
  } else {
    // DB
    pffSignal = normPff.production * .42 + normPff.efficiency * .36 + normPff.grade * .22
  }
  if (!opts?.disableAgeAdjPff) {
    pffSignal = clamp(pffSignal * ageProductionMultiplier(input.age, input.pos), 0, 100)
  }
  const wt = signalWeights[grp] ?? signalWeights['SKILL']
  const baseScore = draft * wt.draft + athletic * wt.athletic + size * wt.size + age * wt.age + strength * wt.strength
  // For SKILL, require exact position match; for other groups allow same-group comps
  const pffPool = pffProfiles.filter((p) => {
    const posMatch = grp === 'SKILL' ? p.position === input.pos : (p.position === input.pos || group[p.position] === group[input.pos])
    return p.nfl && isMatureOutcome(p.draftSeason) && p.id !== input.pffProfileId && posMatch
  })
  const pffComps = pffPool.map((profile) => ({ profile, sim: pffSim(input, profile, grp, preDraft) })).sort((a, b) => b.sim - a.sim).slice(0, 80)
  // Position and pick-aware PFF blend: SKILL has real signal; QB gated by projected pick
  // range (PFF near-zero for picks 33+ QBs); OL/LB/DB/FRONT get small blends only.
  const pffBlend = pffComps.length >= 12 ? (
    grp === 'SKILL'    ? .35 :
    grp === 'QB'       ? (input.pick <= 32 ? .28 : input.pick <= 64 ? .14 : .07) :
    grp === 'OL'       ? .12 :
    input.pos === 'LB' ? .08 :
    .10
  ) : 0
  const rawScore = baseScore * (1 - pffBlend) + pffSignal * pffBlend
  const calibratedAv = calibratedExpectedAv(input, { draft, athletic, size, age })

  const comps = pool.map((p) => ({ player: p, sim: sim(input, p, y1Data, careerStats, grpCutoff) })).sort((a, b) => b.sim - a.sim).slice(0, 80)
  const histWeight = comps.reduce((sum, c) => sum + c.sim, 0) || 1
  const pffWeight = pffComps.reduce((sum, c) => sum + c.sim, 0) || 1
  const histExpectedAv = comps.reduce((sum, c) => sum + c.player.av * c.sim, 0) / histWeight
  const pffExpectedAv = pffComps.reduce((sum, c) => sum + (c.profile.nfl?.av || 0) * c.sim, 0) / pffWeight
  const compExpectedAv = blend(histExpectedAv, pffExpectedAv, pffBlend)
  // Top picks benefit from institutional investment (more snaps, coaching) that comps underpredict;
  // leaning more on the calibrated regression for Rd1-2 corrects systematic AV underprediction.
  // QB comps outperform the position-agnostic regression (QBs have distinct AV dynamics);
  // use a lower blend for QB so comps dominate. Non-QB top picks benefit from the regression.
  const calibBlend = opts?.calibBlendOverride ?? (grp === 'QB' ? 0.06 : (input.pick <= 32 ? 0.26 : input.pick <= 64 ? 0.16 : 0.10))
  const expectedAv = blend(compExpectedAv, calibratedAv, calibBlend)
  const posAvValues = pool.filter((p) => p.av >= 0).map((p) => p.av)
  const posRelScore = posAvValues.length >= 15 ? pct(expectedAv, posAvValues) : avToScore(expectedAv)
  const avScore = posRelScore
  // A2: injury penalty shifts the score down based on severity
  const injuryPenalty = injurySeverity === 'major' ? 8 : injurySeverity === 'moderate' ? 4 : injurySeverity === 'minor' ? 2 : 0
  // A3: QB grade trajectory — declining arc projects 4-7 pts lower; rising arc gets a small boost
  const trajectoryAdj = (input.pos === 'QB' && gradeDelta != null) ? (
    gradeDelta <= -12 ? -7 : gradeDelta <= -6 ? -4 : gradeDelta >= 10 ? 3 : gradeDelta >= 5 ? 2 : 0
  ) : 0
  // Top picks receive more coaching investment and playing time than comps alone predict;
  // premium decays from ~5pts at pick 1 to ~1pt at pick 40.
  const elitePremium = (!opts?.disableElitePremium && input.pick <= 40) ? Math.max(0, (41 - input.pick) * 0.13) : 0
  const scoreAdj = trajectoryAdj - injuryPenalty + schoolBoost * 0.05 + elitePremium
  const score = clamp(rawScore * 0.46 + avScore * 0.54 + scoreAdj, 1, 99)
  const games = blend(comps.reduce((sum, c) => sum + c.player.games * c.sim, 0) / histWeight, pffComps.reduce((sum, c) => sum + (c.profile.nfl?.games || 0) * c.sim, 0) / pffWeight, pffBlend)
  const starts = blend(comps.reduce((sum, c) => sum + c.player.starts * c.sim, 0) / histWeight, pffComps.reduce((sum, c) => sum + (c.profile.nfl?.starts || 0) * c.sim, 0) / pffWeight / 16, pffBlend)
  const impactScore = blend(score, avScore, 0.35)

  const rangeValues = [
    ...comps.map((c) => c.player.av),
    ...(pffBlend ? pffComps.slice(0, 40).map((c) => c.profile.nfl?.av || 0) : []),
    calibratedAv,
    expectedAv,
  ].sort((a, b) => a - b)
  // Floor: bust rate rises sharply past round 3; QB busts even at top picks (Russell, etc.).
  // floorMult shrinks by pick range and is QB-specific to match empirical below-floor rates.
  // floorBlend controls how much we trust the data 10th-pct vs the pick-calibrated mult;
  // late-round comps have noisy 10th-pct floors so we lean more on the mult there.
  const floorMult = grp === 'QB'
    ? (input.pick <= 32 ? 0.15 : input.pick <= 100 ? 0.10 : 0.06)
    : (input.pick <= 32 ? 0.42 : input.pick <= 100 ? 0.28 : input.pick <= 160 ? 0.10 : 0.05)
  // QB busts even at top picks (Russell, Locker, Gabbert) more often than comp distributions imply;
  // lean more on the multiplier so the floor isn't anchored by comps' survivor-biased 5th pct.
  const floorBlend = grp === 'QB'
    ? (input.pick <= 64 ? 0.42 : 0.55)
    : (input.pick <= 32 ? 0.22 : input.pick <= 100 ? 0.32 : input.pick <= 160 ? 0.48 : 0.62)
  // Use 5th-percentile of comp AVs rather than 10th; actual bust rates are higher than
  // comp-pool distributions suggest because comps are similarity-filtered (survivor bias).
  const floor = blend(q(rangeValues, .05), Math.max(0, expectedAv * floorMult), floorBlend)
  const median = blend(q(rangeValues, .5), expectedAv, .35)
  // Ceiling: widen for early picks and all QBs to capture the lottery effect.
  // QBs drafted anywhere can become elite — Brady (199), Wilson (75), Dak (135).
  // Rd1 non-QB picks at 3.0× corrects empirical 19% above-ceiling (target ~10%).
  const ceilMult = grp === 'QB'
    ? (input.pick <= 64 ? 3.5 : 2.8)
    : (input.pick <= 32 ? 4.0 : input.pick <= 64 ? 3.0 : input.pick <= 100 ? 2.2 : 1.85)
  const ceiling = blend(q(rangeValues, .92), Math.max(expectedAv, expectedAv * ceilMult), .25)
  const scoreLow = clamp(rawScore * 0.46 + (posAvValues.length >= 15 ? pct(floor, posAvValues) : avToScore(floor)) * 0.54 + scoreAdj, 1, 99)
  const scoreHigh = clamp(rawScore * 0.46 + (posAvValues.length >= 15 ? pct(ceiling, posAvValues) : avToScore(ceiling)) * 0.54 + scoreAdj, 1, 99)
  const max = Math.max(90, ceiling * 1.1)
  const histOdds = Object.fromEntries(outcomeOrder.map((cat) => [cat, comps.filter((c) => c.player.category === cat).reduce((sum, c) => sum + c.sim, 0) / histWeight])) as Record<Category, number>
  const pffOdds = Object.fromEntries(outcomeOrder.map((cat) => [cat, pffComps.filter((c) => c.profile.nfl?.category === cat).reduce((sum, c) => sum + c.sim, 0) / pffWeight])) as Record<Category, number>
  const odds = Object.fromEntries(outcomeOrder.map((cat) => [cat, blend(histOdds[cat], pffOdds[cat], pffBlend)])) as Record<Category, number>

  const slotComps = pool.filter((p) => p.year <= 2020 && Math.abs(p.pick - input.pick) <= 32)
  const percentile = slotComps.length >= 8
    ? Math.round(slotComps.filter((p) => p.av < expectedAv).length / slotComps.length * 100)
    : null
  const flags = dangerFlags(input, { ceiling, floor, pffBlend })

  const top10 = comps.slice(0, 10)
  const y1Coverage = y1Data ? top10.filter((c) => {
    if (c.player.pos === 'QB') return y1Data.qb.some((s) => s.key === clean(c.player.name) && s.season === c.player.year)
    if (c.player.pos === 'WR') return y1Data.wr.some((s) => s.key === clean(c.player.name) && s.season === c.player.year)
    if (c.player.pos === 'RB') return y1Data.rb.some((s) => s.key === clean(c.player.name) && s.season === c.player.year)
    return false
  }).length : 0

  // Confidence scoring (Phase 8): how much to trust this projection.
  // Combines data completeness (fields present), comp density, and position volatility.
  const missingFields: string[] = []
  if (input.age == null) missingFields.push('age')
  if (input.height == null) missingFields.push('height')
  if (input.weight == null) missingFields.push('weight')
  if (input.forty == null) missingFields.push('forty')
  if (input.vertical == null) missingFields.push('vertical')
  if (input.broad == null) missingFields.push('broad')
  if (input.cone == null) missingFields.push('cone')
  if (input.shuttle == null) missingFields.push('shuttle')
  if (!pffBlend) missingFields.push('PFF profile')
  // Weighted completeness: combine (57pts) + bio (13pts) + PFF (30pts) = 100
  const dataCompleteness = Math.round(
    (input.forty != null ? 14 : 0) + (input.vertical != null ? 10 : 0) +
    (input.broad != null ? 10 : 0) + (input.cone != null ? 11 : 0) + (input.shuttle != null ? 12 : 0) +
    (input.age != null ? 5 : 0) + (input.height != null ? 4 : 0) + (input.weight != null ? 4 : 0) +
    (pffBlend > 0 ? 30 : 0)
  )
  const qualityComps = comps.slice(0, 20).filter((c) => c.sim > 0.3).length
  const compDensityScore = Math.round(Math.min(qualityComps / 10, 1) * 100)
  const posVolatilityPenalty = grp === 'QB' ? 8 : (input.pos === 'RB' ? 4 : 0)
  const confidenceScore = Math.max(5, Math.min(99, Math.round(
    dataCompleteness * 0.65 + compDensityScore * 0.35 - posVolatilityPenalty
  )))

  return {
    score,
    scoreLow,
    scoreHigh,
    grade: gradeLabel(score),
    expectedAv,
    impactScore,
    games,
    starts,
    floor,
    median,
    ceiling,
    floorPct: floor / max * 100,
    midPct: median / max * 100,
    ceilPct: ceiling / max * 100,
    odds,
    comps: comps.slice(0, 12),
    fullComps: comps,
    pffComps: pffComps.slice(0, 12),
    pffBlend,
    percentile,
    ras,
    officialRAS: input.officialRas ?? null,
    alltimeRAS: input.alltimeRas ?? null,
    combineAthleticScore,
    athleticSource: (officialRasSignal != null ? 'official_ras' : 'combine_percentile') as 'official_ras' | 'combine_percentile',
    flags,
    y1Coverage,
    signals: { draft, athletic, size, age, strength, pff: pffSignal },
    confidence: { score: confidenceScore, dataCompleteness, compDensity: compDensityScore, hasPff: pffBlend > 0, missingFields },
  }
}
