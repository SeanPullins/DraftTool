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
  qbTrajectory?: QbTrajectorySignal | null
  wrTrajectory?: WrTrajectorySignal | null
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

export type QbPffSeason = {
  name: string
  player_id: number
  season: number
  team: string
  games: number
  dropbacks: number | null
  grades_pass: number | null
  grades_offense: number | null
  accuracy_percent: number | null
  btt_rate: number | null
  twp_rate: number | null
  epa: number | null
  positive_epa_percent: number | null
  ypa: number | null
  avg_depth_of_target: number | null
  avg_time_to_throw: number | null
  pressure_to_sack_rate: number | null
  sack_percent: number | null
}

export type QbVolumeConfidence = 'high' | 'medium' | 'low_sample' | 'insufficient'
export type QbTrajectoryLabel = 'elite_breakout' | 'rising' | 'stable_good' | 'stable_limited' | 'volatile_spike' | 'regressing' | 'unknown'

export type QbTrajectorySignal = {
  latestSeason: number
  priorSeason: number | null
  latestVolume: QbVolumeConfidence
  priorVolume: QbVolumeConfidence | null
  gradeDelta: number | null
  accuracyDelta: number | null
  bttRateDelta: number | null
  twpRateDelta: number | null
  epaDelta: number | null
  positiveEpaDelta: number | null
  trajectoryScore: number        // 0–100
  trajectoryLabel: QbTrajectoryLabel
}

export type QbPffContext = {
  source: 'qb_pff_seasons.json'
  matchedSeasons: QbPffSeason[]
  preDraftSeasons: QbPffSeason[]
  latestSeason: QbPffSeason | null
  priorSeason: QbPffSeason | null
  careerWeightedPassGrade: number | null
  careerWeightedAccuracy: number | null
  careerWeightedBttRate: number | null
  careerWeightedTwpRate: number | null
  careerWeightedEpa: number | null
  careerWeightedPositiveEpa: number | null
  totalDropbacks: number
  trajectory: QbTrajectorySignal | null
}

export type WrPffSeason = {
  name: string
  player_id: number | null
  season: number
  source_file?: string
  position: string
  team: string | null
  games: number | null
  adot: number | null
  avoided_tackles: number | null
  catch_rate: number | null
  contested_catch_rate: number | null
  contested_receptions: number | null
  contested_targets: number | null
  drop_rate: number | null
  drops: number | null
  epa: number | null
  first_downs: number | null
  fumbles: number | null
  hands_drop_grade: number | null
  hands_fumble_grade: number | null
  offense_grade: number | null
  route_grade: number | null
  inline_rate: number | null
  inline_snaps: number | null
  longest: number | null
  pass_block_rate: number | null
  pass_blocks: number | null
  pass_plays: number | null
  penalties: number | null
  positive_epa_percent: number | null
  receptions: number | null
  route_rate: number | null
  routes: number | null
  slot_rate: number | null
  slot_snaps: number | null
  targeted_qb_rating: number | null
  targets: number | null
  touchdowns: number | null
  wide_rate: number | null
  wide_snaps: number | null
  yards: number | null
  yards_after_catch: number | null
  yards_after_catch_per_reception: number | null
  yards_per_reception: number | null
  yprr: number | null
}

export type WrVolumeConfidence = 'high' | 'medium' | 'low_sample' | 'insufficient'
export type WrTrajectoryLabel = 'elite_breakout' | 'rising' | 'stable_good' | 'stable_limited' | 'volatile_spike' | 'regressing' | 'unknown'

export type WrTrajectorySignal = {
  latestSeason: number
  priorSeason: number | null
  latestVolume: WrVolumeConfidence
  priorVolume: WrVolumeConfidence | null
  routeGradeDelta: number | null
  yprrDelta: number | null
  targetDelta: number | null
  routeDelta: number | null
  dropRateDelta: number | null
  epaDelta: number | null
  positiveEpaDelta: number | null
  trajectoryScore: number
  trajectoryLabel: WrTrajectoryLabel
}

export type WrPffContext = {
  source: 'wr_pff_seasons.json'
  matchedSeasons: WrPffSeason[]
  preDraftSeasons: WrPffSeason[]
  latestSeason: WrPffSeason | null
  priorSeason: WrPffSeason | null
  careerWeightedRouteGrade: number | null
  careerWeightedOffenseGrade: number | null
  careerWeightedYprr: number | null
  careerWeightedDropRate: number | null
  careerWeightedAdot: number | null
  careerWeightedEpa: number | null
  careerWeightedPositiveEpa: number | null
  totalRoutes: number
  totalTargets: number
  totalReceptions: number
  totalYards: number
  trajectory: WrTrajectorySignal | null
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
  "intercept": 2.2784192621518504,
  "features": [
    {
      "name": "draftScore",
      "coef": 0.39839143849360503,
      "mean": 19.523883459784596,
      "sd": 17.603139739037005
    },
    {
      "name": "logPick",
      "coef": -0.24355579701957905,
      "mean": 4.475362354416563,
      "sd": 0.9805907524086608
    },
    {
      "name": "pffComp",
      "coef": 0.03303679165233535,
      "mean": 51.04321728691473,
      "sd": 5.093641829579353
    },
    {
      "name": "pffGrade",
      "coef": -0.007541067916961973,
      "mean": 51.02176870748301,
      "sd": 4.7435183882436425
    },
    {
      "name": "pffProd",
      "coef": 0.031138220095352248,
      "mean": 49.27314925970389,
      "sd": 9.885059893079246
    },
    {
      "name": "pffEff",
      "coef": -0.061885031818842494,
      "mean": 53.07408963585435,
      "sd": 9.76565031587794
    },
    {
      "name": "pffClean",
      "coef": 0.057528310760892015,
      "mean": 52.03985594237696,
      "sd": 7.728104656375217
    },
    {
      "name": "ageScore",
      "coef": 0.1425155570156769,
      "mean": 67.45858343337335,
      "sd": 10.829861481756266
    },
    {
      "name": "athletic",
      "coef": 0.09991531947871193,
      "mean": 49.24630711880713,
      "sd": 12.51088903019528
    },
    {
      "name": "size",
      "coef": 0.0520202999704647,
      "mean": 53.08960727147994,
      "sd": 6.107897395883266
    },
    {
      "name": "isQB",
      "coef": -0.06794004701590725,
      "mean": 0.04321728691476591,
      "sd": 0.20334589503231748
    },
    {
      "name": "isSkill",
      "coef": -0.09397904561832544,
      "mean": 0.27871148459383754,
      "sd": 0.4483652450283577
    },
    {
      "name": "isOL",
      "coef": 0.1561528016029701,
      "mean": 0.1600640256102441,
      "sd": 0.3666654242162558
    },
    {
      "name": "isFront",
      "coef": 0.0025942868377599147,
      "mean": 0.30912364945978393,
      "sd": 0.462132252504046
    },
    {
      "name": "isDB",
      "coef": -0.006155969213553466,
      "mean": 0.20888355342136855,
      "sd": 0.4065110263343695
    }
  ]
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

export function cleanPlayerName(s = '') {
  return clean(
    s
      .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/gi, '')
      .replace(/\bjunior\b/gi, '')
      .replace(/\bsenior\b/gi, '')
  )
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
  if (input.officialRas != null) {
    if (input.officialRas < 5.0 && input.pick <= 100) flags.push(`Athletic risk · RAS ${input.officialRas.toFixed(2)}`)
    else if (input.officialRas < 6.0 && input.pick <= 32) flags.push(`Rd1 athletic concern · RAS ${input.officialRas.toFixed(2)}`)
  }
  if (input.pos === 'QB' && input.qbTrajectory) {
    const t = input.qbTrajectory
    const highVol = t.latestVolume === 'high' || t.latestVolume === 'medium'
    if ((t.trajectoryLabel === 'regressing' || t.trajectoryLabel === 'volatile_spike') && highVol) {
      const tag = t.trajectoryLabel === 'volatile_spike' ? 'Volatile spike' : 'Grade regression'
      const delta = t.gradeDelta != null ? ` · ${t.gradeDelta > 0 ? '+' : ''}${t.gradeDelta.toFixed(1)} pts` : ''
      flags.push(`${tag}${delta}`)
    }
  }
  return flags
}

// ── QB PFF trajectory ─────────────────────────────────────────────────────────

function volumeConfidence(dropbacks: number | null): QbVolumeConfidence {
  if (dropbacks == null) return 'insufficient'
  if (dropbacks >= 300) return 'high'
  if (dropbacks >= 150) return 'medium'
  if (dropbacks >= 100) return 'low_sample'
  return 'insufficient'
}

export function computeQbTrajectory(
  draftYear: number,
  playerName: string,
  pffSeasons: QbPffSeason[],
): QbTrajectorySignal | null {
  const latestYear = draftYear - 1
  const priorYear  = draftYear - 2
  const cleanName  = clean(playerName)

  const latestSeason = pffSeasons.find(
    (s) => cleanPlayerName(s.name) === cleanName && s.season === latestYear,
  )
  if (!latestSeason) return null

  const latestVolume = volumeConfidence(latestSeason.dropbacks)
  if (latestVolume === 'insufficient') return null

  const priorSeason = pffSeasons.find(
    (s) => cleanPlayerName(s.name) === cleanName && s.season === priorYear,
  )
  const priorVolume = priorSeason ? volumeConfidence(priorSeason.dropbacks) : null
  const hasPrior = priorSeason != null && priorVolume !== 'insufficient'

  let gradeDelta:       number | null = null
  let accuracyDelta:    number | null = null
  let bttRateDelta:     number | null = null
  let twpRateDelta:     number | null = null
  let epaDelta:         number | null = null
  let positiveEpaDelta: number | null = null

  if (hasPrior && priorSeason) {
    if (latestSeason.grades_pass != null && priorSeason.grades_pass != null)
      gradeDelta = latestSeason.grades_pass - priorSeason.grades_pass
    if (latestSeason.accuracy_percent != null && priorSeason.accuracy_percent != null)
      accuracyDelta = latestSeason.accuracy_percent - priorSeason.accuracy_percent
    if (latestSeason.btt_rate != null && priorSeason.btt_rate != null)
      bttRateDelta = latestSeason.btt_rate - priorSeason.btt_rate
    if (latestSeason.twp_rate != null && priorSeason.twp_rate != null)
      twpRateDelta = latestSeason.twp_rate - priorSeason.twp_rate
    if (latestSeason.epa != null && priorSeason.epa != null)
      epaDelta = latestSeason.epa - priorSeason.epa
    if (latestSeason.positive_epa_percent != null && priorSeason.positive_epa_percent != null)
      positiveEpaDelta = latestSeason.positive_epa_percent - priorSeason.positive_epa_percent
  }

  let trajectoryScore = 50
  let trajectoryLabel: QbTrajectoryLabel = 'unknown'

  if (hasPrior) {
    // gradeDelta: each +1 pt = +1.0, each -1 = -1.0 (cap ±15)
    if (gradeDelta != null) {
      const contribution = clamp(gradeDelta, -15, 15) * 1.0
      trajectoryScore += contribution
    }
    // accuracyDelta: each +1% = +1.5, each -1% = -1.5 (cap ±10)
    if (accuracyDelta != null) {
      const contribution = clamp(accuracyDelta * 1.5, -10, 10)
      trajectoryScore += contribution
    }
    // twpRateDelta: lower is better — each +1% = -2.0, each -1% = +2.0 (cap ±8)
    if (twpRateDelta != null) {
      const contribution = clamp(-twpRateDelta * 2.0, -8, 8)
      trajectoryScore += contribution
    }
    // epaDelta: each +0.05 = +1.0, each -0.05 = -1.0 (cap ±5)
    if (epaDelta != null) {
      const contribution = clamp((epaDelta / 0.05) * 1.0, -5, 5)
      trajectoryScore += contribution
    }
    // positiveEpaDelta: each +1% = +0.5, each -1% = -0.5 (cap ±5)
    if (positiveEpaDelta != null) {
      const contribution = clamp(positiveEpaDelta * 0.5, -5, 5)
      trajectoryScore += contribution
    }
    // Volume bonus/penalty
    const deltasPositive =
      (gradeDelta ?? 0) > 0 ||
      (accuracyDelta ?? 0) > 0 ||
      (positiveEpaDelta ?? 0) > 0

    if (latestVolume === 'high' && deltasPositive) {
      trajectoryScore += 3
    } else if (latestVolume === 'low_sample') {
      trajectoryScore -= 5
    }

    // Clamp to [20, 80]
    trajectoryScore = clamp(trajectoryScore, 20, 80)

    // Assign label
    if (
      gradeDelta != null && gradeDelta >= 8 &&
      latestVolume === 'high' &&
      (twpRateDelta == null || twpRateDelta <= 0.5) &&
      (positiveEpaDelta == null || positiveEpaDelta > 0)
    ) {
      trajectoryLabel = 'elite_breakout'
    } else if (
      gradeDelta != null && gradeDelta >= 8 &&
      (latestVolume !== 'high' || (twpRateDelta != null && twpRateDelta >= 1.5))
    ) {
      trajectoryLabel = 'volatile_spike'
    } else if (trajectoryScore >= 57) {
      trajectoryLabel = 'rising'
    } else if (trajectoryScore <= 43) {
      trajectoryLabel = 'regressing'
    } else if (latestSeason.grades_pass != null && latestSeason.grades_pass >= 78) {
      trajectoryLabel = 'stable_good'
    } else {
      trajectoryLabel = 'stable_limited'
    }
  } else {
    // No prior data
    trajectoryScore = 50
    trajectoryLabel = 'unknown'
  }

  return {
    latestSeason: latestYear,
    priorSeason:  hasPrior ? priorYear : null,
    latestVolume,
    priorVolume:  hasPrior ? priorVolume : null,
    gradeDelta,
    accuracyDelta,
    bttRateDelta,
    twpRateDelta,
    epaDelta,
    positiveEpaDelta,
    trajectoryScore,
    trajectoryLabel,
  }
}


function weightedQbMetric(
  seasons: QbPffSeason[],
  field: keyof Pick<QbPffSeason, 'grades_pass' | 'accuracy_percent' | 'btt_rate' | 'twp_rate' | 'epa' | 'positive_epa_percent'>,
): number | null {
  let numerator = 0
  let denominator = 0

  for (const season of seasons) {
    const raw = season[field]
    const weight = season.dropbacks ?? 0
    if (raw == null || !Number.isFinite(raw) || weight <= 0) continue
    numerator += raw * weight
    denominator += weight
  }

  return denominator > 0 ? numerator / denominator : null
}

export function getQbPffContext(
  draftYear: number,
  playerName: string,
  pffSeasons: QbPffSeason[],
): QbPffContext | null {
  const cleanName = cleanPlayerName(playerName)
  const matchedSeasons = pffSeasons
    .filter((s) => cleanPlayerName(s.name) === cleanName)
    .sort((a, b) => a.season - b.season)

  if (!matchedSeasons.length) return null

  // Leakage guard: for every QB, historical or future, only use seasons before draft year.
  const preDraftSeasons = matchedSeasons
    .filter((s) => s.season < draftYear)
    .sort((a, b) => a.season - b.season)

  if (!preDraftSeasons.length) return null

  const latestSeason = preDraftSeasons[preDraftSeasons.length - 1] ?? null
  const priorSeason = preDraftSeasons.length >= 2 ? preDraftSeasons[preDraftSeasons.length - 2] : null
  const totalDropbacks = preDraftSeasons.reduce((sum, s) => sum + (s.dropbacks ?? 0), 0)

  return {
    source: 'qb_pff_seasons.json',
    matchedSeasons,
    preDraftSeasons,
    latestSeason,
    priorSeason,
    careerWeightedPassGrade: weightedQbMetric(preDraftSeasons, 'grades_pass'),
    careerWeightedAccuracy: weightedQbMetric(preDraftSeasons, 'accuracy_percent'),
    careerWeightedBttRate: weightedQbMetric(preDraftSeasons, 'btt_rate'),
    careerWeightedTwpRate: weightedQbMetric(preDraftSeasons, 'twp_rate'),
    careerWeightedEpa: weightedQbMetric(preDraftSeasons, 'epa'),
    careerWeightedPositiveEpa: weightedQbMetric(preDraftSeasons, 'positive_epa_percent'),
    totalDropbacks,
    trajectory: computeQbTrajectory(draftYear, playerName, pffSeasons),
  }
}

function wrVolumeConfidence(routes: number | null, targets: number | null): WrVolumeConfidence {
  const r = routes ?? 0
  const t = targets ?? 0
  if (r >= 300 || t >= 85) return 'high'
  if (r >= 175 || t >= 50) return 'medium'
  if (r >= 80 || t >= 25) return 'low_sample'
  return 'insufficient'
}

export function computeWrTrajectory(
  draftYear: number,
  playerName: string,
  pffSeasons: WrPffSeason[],
): WrTrajectorySignal | null {
  const latestYear = draftYear - 1
  const priorYear = draftYear - 2
  const cleanName = cleanPlayerName(playerName)

  const latestSeason = pffSeasons.find(
    (s) => cleanPlayerName(s.name) === cleanName && s.season === latestYear,
  )
  if (!latestSeason) return null

  const latestVolume = wrVolumeConfidence(latestSeason.routes, latestSeason.targets)
  if (latestVolume === 'insufficient') return null

  const priorSeason = pffSeasons.find(
    (s) => cleanPlayerName(s.name) === cleanName && s.season === priorYear,
  )
  const priorVolume = priorSeason ? wrVolumeConfidence(priorSeason.routes, priorSeason.targets) : null
  const hasPrior = priorSeason != null && priorVolume !== 'insufficient'

  let routeGradeDelta: number | null = null
  let yprrDelta: number | null = null
  let targetDelta: number | null = null
  let routeDelta: number | null = null
  let dropRateDelta: number | null = null
  let epaDelta: number | null = null
  let positiveEpaDelta: number | null = null

  if (hasPrior && priorSeason) {
    if (latestSeason.route_grade != null && priorSeason.route_grade != null)
      routeGradeDelta = latestSeason.route_grade - priorSeason.route_grade
    if (latestSeason.yprr != null && priorSeason.yprr != null)
      yprrDelta = latestSeason.yprr - priorSeason.yprr
    if (latestSeason.targets != null && priorSeason.targets != null)
      targetDelta = latestSeason.targets - priorSeason.targets
    if (latestSeason.routes != null && priorSeason.routes != null)
      routeDelta = latestSeason.routes - priorSeason.routes
    if (latestSeason.drop_rate != null && priorSeason.drop_rate != null)
      dropRateDelta = latestSeason.drop_rate - priorSeason.drop_rate
    if (latestSeason.epa != null && priorSeason.epa != null)
      epaDelta = latestSeason.epa - priorSeason.epa
    if (latestSeason.positive_epa_percent != null && priorSeason.positive_epa_percent != null)
      positiveEpaDelta = latestSeason.positive_epa_percent - priorSeason.positive_epa_percent
  }

  let trajectoryScore = 50
  let trajectoryLabel: WrTrajectoryLabel = 'unknown'

  if (hasPrior) {
    // Route grade is the WR skill-quality anchor.
    if (routeGradeDelta != null) trajectoryScore += clamp(routeGradeDelta, -14, 14) * 0.95

    // YPRR is the most important efficiency signal; +0.50 YPRR is a major jump.
    if (yprrDelta != null) trajectoryScore += clamp(yprrDelta * 10, -12, 12)

    // Drop rate: lower is better.
    if (dropRateDelta != null) trajectoryScore += clamp(-dropRateDelta * 0.8, -8, 8)

    // EPA and positive EPA are contextual but useful as secondary efficiency signals.
    if (epaDelta != null) trajectoryScore += clamp((epaDelta / 0.05) * 0.8, -5, 5)
    if (positiveEpaDelta != null) trajectoryScore += clamp(positiveEpaDelta * 0.35, -5, 5)

    // Volume growth matters, but avoid over-rewarding empty volume.
    if (targetDelta != null && targetDelta >= 25 && (yprrDelta == null || yprrDelta >= -0.15)) trajectoryScore += 3
    if (routeDelta != null && routeDelta >= 100 && latestVolume === 'high') trajectoryScore += 2

    if (latestVolume === 'high' && ((routeGradeDelta ?? 0) > 0 || (yprrDelta ?? 0) > 0)) {
      trajectoryScore += 3
    } else if (latestVolume === 'low_sample') {
      trajectoryScore -= 5
    }

    trajectoryScore = clamp(trajectoryScore, 20, 80)

    if (
      routeGradeDelta != null && routeGradeDelta >= 8 &&
      yprrDelta != null && yprrDelta >= 0.45 &&
      latestVolume === 'high' &&
      (dropRateDelta == null || dropRateDelta <= 1.5)
    ) {
      trajectoryLabel = 'elite_breakout'
    } else if (
      routeGradeDelta != null && routeGradeDelta >= 8 &&
      (latestVolume !== 'high' || (dropRateDelta != null && dropRateDelta >= 4))
    ) {
      trajectoryLabel = 'volatile_spike'
    } else if (trajectoryScore >= 57) {
      trajectoryLabel = 'rising'
    } else if (trajectoryScore <= 43) {
      trajectoryLabel = 'regressing'
    } else if ((latestSeason.route_grade ?? latestSeason.offense_grade ?? 0) >= 78 || (latestSeason.yprr ?? 0) >= 2.2) {
      trajectoryLabel = 'stable_good'
    } else {
      trajectoryLabel = 'stable_limited'
    }
  }

  return {
    latestSeason: latestYear,
    priorSeason: hasPrior ? priorYear : null,
    latestVolume,
    priorVolume: hasPrior ? priorVolume : null,
    routeGradeDelta,
    yprrDelta,
    targetDelta,
    routeDelta,
    dropRateDelta,
    epaDelta,
    positiveEpaDelta,
    trajectoryScore,
    trajectoryLabel,
  }
}

function weightedWrMetric(
  seasons: WrPffSeason[],
  field: keyof Pick<WrPffSeason, 'route_grade' | 'offense_grade' | 'yprr' | 'drop_rate' | 'adot' | 'epa' | 'positive_epa_percent'>,
): number | null {
  let numerator = 0
  let denominator = 0

  for (const season of seasons) {
    const raw = season[field]
    const weight = season.routes ?? season.targets ?? 0
    if (raw == null || !Number.isFinite(raw) || weight <= 0) continue
    numerator += raw * weight
    denominator += weight
  }

  return denominator > 0 ? numerator / denominator : null
}

export function getWrPffContext(
  draftYear: number,
  playerName: string,
  pffSeasons: WrPffSeason[],
): WrPffContext | null {
  const cleanName = cleanPlayerName(playerName)
  const matchedSeasons = pffSeasons
    .filter((s) => cleanPlayerName(s.name) === cleanName)
    .sort((a, b) => a.season - b.season)

  if (!matchedSeasons.length) return null

  // Leakage guard: for every WR, historical or future, only use seasons before draft year.
  const preDraftSeasons = matchedSeasons
    .filter((s) => s.season < draftYear)
    .sort((a, b) => a.season - b.season)

  if (!preDraftSeasons.length) return null

  const latestSeason = preDraftSeasons[preDraftSeasons.length - 1] ?? null
  const priorSeason = preDraftSeasons.length >= 2 ? preDraftSeasons[preDraftSeasons.length - 2] : null
  const totalRoutes = preDraftSeasons.reduce((sum, s) => sum + (s.routes ?? 0), 0)
  const totalTargets = preDraftSeasons.reduce((sum, s) => sum + (s.targets ?? 0), 0)
  const totalReceptions = preDraftSeasons.reduce((sum, s) => sum + (s.receptions ?? 0), 0)
  const totalYards = preDraftSeasons.reduce((sum, s) => sum + (s.yards ?? 0), 0)

  return {
    source: 'wr_pff_seasons.json',
    matchedSeasons,
    preDraftSeasons,
    latestSeason,
    priorSeason,
    careerWeightedRouteGrade: weightedWrMetric(preDraftSeasons, 'route_grade'),
    careerWeightedOffenseGrade: weightedWrMetric(preDraftSeasons, 'offense_grade'),
    careerWeightedYprr: weightedWrMetric(preDraftSeasons, 'yprr'),
    careerWeightedDropRate: weightedWrMetric(preDraftSeasons, 'drop_rate'),
    careerWeightedAdot: weightedWrMetric(preDraftSeasons, 'adot'),
    careerWeightedEpa: weightedWrMetric(preDraftSeasons, 'epa'),
    careerWeightedPositiveEpa: weightedWrMetric(preDraftSeasons, 'positive_epa_percent'),
    totalRoutes,
    totalTargets,
    totalReceptions,
    totalYards,
    trajectory: computeWrTrajectory(draftYear, playerName, pffSeasons),
  }
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
  // Ablation (walk-forward): 'Calib only (cb=1)' → +0.030 ρ vs current blend.
  // Comp AV estimates degrade in WF mode because 90%+ of historical players lack real
  // PFF data, making comp selection near-random beyond draft capital. Increasing
  // calibBlend captures most of the regression benefit while preserving comp influence
  // for floor/ceiling range. QB comps stay at low blend (QB dynamics differ from OLS).
  const calibBlend = opts?.calibBlendOverride ?? (grp === 'QB' ? 0.08 : (input.pick <= 32 ? 0.55 : input.pick <= 64 ? 0.40 : 0.25))
  const expectedAv = blend(compExpectedAv, calibratedAv, calibBlend)
  const posAvValues = pool.filter((p) => p.av >= 0).map((p) => p.av)
  const posRelScore = posAvValues.length >= 15 ? pct(expectedAv, posAvValues) : avToScore(expectedAv)
  const avScore = posRelScore
  // A2: injury penalty shifts the score down based on severity
  const injuryPenalty = injurySeverity === 'major' ? 8 : injurySeverity === 'moderate' ? 4 : injurySeverity === 'minor' ? 2 : 0
  // A3: QB grade trajectory — volume-gated; walk-forward ablation showed raw step-function
  // at full weight (Δρ=-0.007) so weight is halved and gated by dropback volume confidence.
  // 'high' volume (300+ db) → full factor; 'medium' (150+) → 60%; 'low_sample' → 25%.
  const traj = input.qbTrajectory ?? null
  const volFactor = traj?.latestVolume === 'high' ? 1.0
    : traj?.latestVolume === 'medium' ? 0.6
    : traj?.latestVolume === 'low_sample' ? 0.25 : 0
  const trajectoryAdj = (input.pos === 'QB' && gradeDelta != null && traj != null && volFactor > 0) ? (
    (gradeDelta <= -12 ? -4 : gradeDelta <= -6 ? -2 : gradeDelta >= 10 ? 2 : gradeDelta >= 5 ? 1 : 0) * volFactor
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
  const rasHighlight: string | null = (input.officialRas != null && input.officialRas >= 9.0)
    ? (input.pick > 128 ? `Athletic sleeper · RAS ${input.officialRas.toFixed(2)}` : `Elite athleticism · RAS ${input.officialRas.toFixed(2)}`)
    : null
  const trajectoryHighlight: string | null = (input.pos === 'QB' && input.qbTrajectory != null) ? (() => {
    const t = input.qbTrajectory!
    const delta = t.gradeDelta != null ? ` · +${t.gradeDelta.toFixed(1)} pts` : ''
    if (t.trajectoryLabel === 'elite_breakout' && (t.latestVolume === 'high' || t.latestVolume === 'medium'))
      return `Elite breakout trajectory${delta}`
    if (t.trajectoryLabel === 'rising' && t.latestVolume === 'high')
      return `Rising trajectory${delta}`
    return null
  })() : null

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
    rasHighlight,
    trajectoryHighlight,
    qbTrajectory: input.qbTrajectory ?? null,
    y1Coverage,
    signals: { draft, athletic, size, age, strength, pff: pffSignal },
    confidence: { score: confidenceScore, dataCompleteness, compDensity: compDensityScore, hasPff: pffBlend > 0, missingFields },
  }
}
