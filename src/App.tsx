import { useDeferredValue, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode } from 'react'
import type { Category, Prospect, Historical, PffProfile, QbSeason, QbPffSeason, WrPffSeason, WrSeason, RbSeason, Y1Data, CareerSeasonStat, CareerStatMap, ModelSignal } from './model'
import { matureOutcomeCutoff, outcomeOrder, compCutoffYear, compCutoffForGroup, calibratedAvModel, group, signalWeights, clamp, clean, avg, q, project, isMatureOutcome, computeQbTrajectory, getQbPffContext, getWrPffContext } from './model'

type Row = Record<string, string>
type SavedProspect = Prospect & { id: string; updatedAt: string; notes?: string; savedScore?: number }
type CompactPffOutcome = [number, number, number, number, number, number, Category, number?]
type CompactPffProfile = [string, string, string, number, number, number, number, number, number, CompactPffOutcome | null]
type RawPffProfile = PffProfile | CompactPffProfile
type PffPayload = {
  generatedAt: string
  summary: { profiles: number; matched: number; collegeOnly: number }
  profiles: RawPffProfile[]
}
type ConsensusPick = { name: string; pos: string; school: string; consensus: number; lo: number; hi: number }
type ScoutNote = { name: string; summary: string }
type InjuryFlag = { name: string; pos: string; severity: 'major' | 'moderate' | 'minor'; note: string }
type ProspectRawStats = {
  season: number; games: number; dropbacks: number; att: number
  ypa: number | null; cmp_pct: number | null; btt_rate: number | null; twp_rate: number | null
  grades_offense: number | null; grades_pass: number | null
  accuracy_percent: number | null; positive_epa_percent: number | null
  yards: number; tds: number; ints: number
}
type ProspectTrajectory = { gradeDelta: number | null; label: 'rising' | 'stable' | 'declining' | 'unknown' }
type ProspectQB = Prospect & { rawStats: ProspectRawStats; priorStats: ProspectRawStats | null; trajectory: ProspectTrajectory }
type RiskFlag = {
  id: string
  label: string
  severity: 'high' | 'medium'
  bustRate: number | null
  sampleN: number
  reason: string
}
type QbBustRates = {
  twp: { rate: number; n: number }
  eff: { rate: number; n: number }
  prod: { rate: number; n: number }
}
type HistoricalOutcomeFlag = {
  type: 'bust' | 'gem'
  label: string
  detail: string
  tooltip: string
}
type PatternAlert = {
  type: 'bust-risk' | 'gem-upside'
  label: string
  matches: Array<{ name: string; year: number; pick: number; av: number; pos: string; reason: string }>
  description: string
}
type Projection = ReturnType<typeof project>
type PositionProjectionOverlay = {
  score: number
  av: number
  model: string
  source: string
  grade?: number
  forecast?: Record<string, unknown>
  pff?: Record<string, unknown>
}

type PositionCompSignal = {
  compAdjustment: number
  confidence: number
  realDraftPrior: boolean
  avgCompDelta?: number
  projectionComps: Array<{ name: string; year: number; pick: number; delta: number; weight?: number; dist?: number }>
  styleComps: Array<{ name: string; year: number; pick: number; delta: number; weight?: number; dist?: number }>
}

type RbScoreReadySignal = {
  recommendedAdjustment: number
  reasons: string[]
  quantumTraits: Array<{
    traitKey: string
    label: string
    recommendedAdjustment?: number
    confidence?: string
    scoreReady?: boolean
  }>
}
type LoaderMessage = { tone: 'good' | 'warn'; text: string } | null
type MobileTab = 'edit' | 'results' | 'board'
type Page = 'workbench' | 'class' | 'players' | 'compare' | 'trade' | 'rankings' | 'guide' | 'prospects'
type BrowserSortKey = 'av' | 'games' | 'starts' | 'pb' | 'ap' | 'pick' | 'name' | 'outcome' | 'year' | 'forty'
type SortKey = 'av' | 'projAv' | 'projScore' | 'games' | 'starts' | 'pb' | 'ap' | 'pick' | 'name' | 'outcome'
type SortDir = 'asc' | 'desc'

const positions = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S']
const sortLabels: Record<SortKey, string> = {
  av: 'AV',
  projAv: 'Projected AV',
  projScore: 'Projected score',
  games: 'Games',
  starts: 'Starts',
  pb: 'Pro Bowls',
  ap: 'All-Pros',
  pick: 'Pick',
  name: 'Name',
  outcome: 'Outcome',
}
const positionFilters = ['All', ...positions]
function PICK_VALUE(pick: number): number {
  return Math.max(1, Math.round(3000 * Math.exp(-0.02 * (pick - 1))))
}
function pickBandClass(pick: number): string {
  if (pick <= 32) return 'pick1'
  if (pick <= 64) return 'pick2'
  if (pick <= 100) return 'pick3'
  if (pick <= 140) return 'pick4'
  if (pick <= 180) return 'pick5'
  return 'pick6'
}

function pickRangeLabel(pick: number): string {
  if (pick <= 5)   return 'Top 5'
  if (pick <= 10)  return 'Top 10'
  if (pick <= 20)  return 'Mid 1st'
  if (pick <= 32)  return 'Late 1st'
  if (pick <= 48)  return 'Early 2nd'
  if (pick <= 64)  return 'Late 2nd'
  if (pick <= 100) return 'Round 3'
  if (pick <= 150) return 'Rounds 4–5'
  if (pick <= 220) return 'Rounds 6–7'
  return 'UDFA range'
}

const assetBase = import.meta.env.BASE_URL
const savedKey = 'draftlens.savedProspects.v2'
const previousSavedKey = 'draftlens.savedProspects.v1'
const csvTemplate = [
  'name,school,pos,draftSeason,pick,age,height,weight,forty,vertical,broad,cone,shuttle,bench,pffComposite,pffGrade,pffProduction,pffEfficiency,pffClean',
  'Example Receiver,State,WR,2026,42,21.4,73,204,4.45,37,124,6.92,4.18,0,82,83,82,79,86',
].join('\n')

const start: Prospect = {
  name: 'Elite Prospect',
  school: 'College',
  pos: 'WR',
  draftSeason: 2026,
  pick: 18,
  age: 21,
  height: 74,
  weight: 205,
  forty: 4.43,
  vertical: 38,
  broad: 126,
  cone: 6.9,
  shuttle: 4.15,
  bench: 0,
  pffProfileId: '',
  pffComposite: 82,
  pffGrade: 83,
  pffProduction: 84,
  pffEfficiency: 81,
  pffClean: 76,
  schemeTag: '',
}

const blankProspect: Prospect = {
  name: 'New Prospect',
  school: '',
  pos: 'WR',
  draftSeason: 2026,
  pick: 100,
  age: 21.5,
  height: 73,
  weight: 205,
  forty: 4.55,
  vertical: 34,
  broad: 120,
  cone: 7.1,
  shuttle: 4.3,
  bench: 0,
  pffProfileId: '',
  pffComposite: 70,
  pffGrade: 70,
  pffProduction: 70,
  pffEfficiency: 70,
  pffClean: 70,
  schemeTag: '',
}

const positionDefaults: Record<string, Partial<Prospect>> = {
  QB: { height: 75, weight: 220, forty: 4.75, vertical: 32, broad: 112, cone: 7.15, shuttle: 4.35 },
  RB: { height: 70, weight: 214, forty: 4.5, vertical: 35, broad: 121, cone: 7.05, shuttle: 4.25 },
  WR: { height: 73, weight: 202, forty: 4.5, vertical: 36, broad: 123, cone: 6.95, shuttle: 4.22 },
  TE: { height: 77, weight: 250, forty: 4.72, vertical: 34, broad: 119, cone: 7.15, shuttle: 4.35 },
  OL: { height: 77, weight: 313, forty: 5.20, vertical: 29, broad: 104, cone: 7.79, shuttle: 4.75 },
  DL: { height: 76, weight: 278, forty: 4.90, vertical: 32, broad: 112, cone: 7.40, shuttle: 4.50 },
  LB: { height: 74, weight: 235, forty: 4.65, vertical: 34, broad: 118, cone: 7.12, shuttle: 4.3 },
  CB: { height: 71, weight: 195, forty: 4.48, vertical: 36, broad: 122, cone: 6.95, shuttle: 4.18 },
  S: { height: 72, weight: 205, forty: 4.55, vertical: 35, broad: 120, cone: 7.0, shuttle: 4.22 },
}

export default 
const DRAFTLENS_DATA_VERSION = 'qb-v10-2-visible-scores-primary-comps-2026-05-24';

function clearStaleDraftLensStorage() {
  try {
    const versionKey = 'draftlens.dataVersion';
    const current = window.localStorage.getItem(versionKey);

    if (current === DRAFTLENS_DATA_VERSION) return;

    const theme = window.localStorage.getItem('draftlens.theme');

    Object.keys(window.localStorage)
      .filter((key) =>
        key.toLowerCase().includes('draft') ||
        key.toLowerCase().includes('prospect') ||
        key.toLowerCase().includes('player') ||
        key.toLowerCase().includes('board') ||
        key.toLowerCase().includes('class')
      )
      .forEach((key) => window.localStorage.removeItem(key));

    if (theme) window.localStorage.setItem('draftlens.theme', theme);
    window.localStorage.setItem(versionKey, DRAFTLENS_DATA_VERSION);
  } catch {
    // no-op
  }
}

function App() {
  const [prospects, setProspects] = useState<Historical[]>([])
  const [lookupPool, setLookupPool] = useState<Historical[]>([])
  const [pffProfiles, setPffProfiles] = useState<PffProfile[]>([])
  const [pffSummary, setPffSummary] = useState<PffPayload['summary'] | null>(null)
  const [saved, setSaved] = useState<SavedProspect[]>(readSavedProspects)
  const [selectedSavedId, setSelectedSavedId] = useState('')
  const [lookupQuery, setLookupQuery] = useState('')
  const [pffQuery, setPffQuery] = useState('')
  const [message, setMessage] = useState<LoaderMessage>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [input, setInput] = useState(start)
  const [notes, setNotes] = useState('')
  const [consensus, setConsensus] = useState<ConsensusPick[]>([])
  const [scoutNotes, setScoutNotes] = useState<ScoutNote[]>([])
  const [injuryFlags, setInjuryFlags] = useState<InjuryFlag[]>([])
  const [compareQuery, setCompareQuery] = useState('')
  const [qbSeasons, setQbSeasons] = useState<QbSeason[]>([])
  const [qbPffSeasons, setQbPffSeasons] = useState<QbPffSeason[]>([])
  const [wrPffSeasons, setWrPffSeasons] = useState<WrPffSeason[]>([])
  const [tePffSeasons, setTePffSeasons] = useState<any[]>([])
  const [rbPffSeasons, setRbPffSeasons] = useState<any[]>([])
  const [wrSeasons, setWrSeasons] = useState<WrSeason[]>([])
  const [rbSeasons, setRbSeasons] = useState<RbSeason[]>([])
  const [careerStats, setCareerStats] = useState<CareerStatMap>({})
  const [prospectsQb2027, setProspectsQb2027] = useState<ProspectQB[]>([])
  const [prospectsTe2027, setProspectsTe2027] = useState<any[]>([])
  const [prospectsRb2027, setProspectsRb2027] = useState<any[]>([])
  const [projectionOverlay, setProjectionOverlay] = useState<Map<string, PositionProjectionOverlay>>(new Map())
  const [compSignalMap, setCompSignalMap] = useState<Map<string, PositionCompSignal>>(new Map())
  const [rbScoreReadyMap, setRbScoreReadyMap] = useState<Map<string, RbScoreReadySignal>>(new Map())
  const [rasLookup, setRasLookup] = useState<AppRasLookup | null>(null)
  const [boardView, setBoardView] = useState<'list' | 'grid'>('list')
  const [boardOrder, setBoardOrder] = useState<string[]>([])
  const [dragId, setDragId] = useState('')
  const [baselineScore, setBaselineScore] = useState<number | null>(null)
  const [mobileTab, setMobileTab] = useState<MobileTab>('edit')
  const [page, setPage] = useState<Page>(() => readPageFromHash())
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({ loader: true, card: false, measurables: false, pff: false })
  const [modalPlayer, setModalPlayer] = useState<Historical | null>(null)
  const [qbTranslationMap, setQbTranslationMap] = useState<Map<string, QbTranslationSignal>>(new Map())
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('draftlens.theme') as 'dark' | 'light') ?? 'dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('draftlens.theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme((t) => t === 'dark' ? 'light' : 'dark')

  const togglePanel = (key: string) => setOpenPanels((p) => ({ ...p, [key]: !p[key] }))

  function openModal(p: Historical) { setModalPlayer(p) }
  function handleCompare(name: string) {
    setCompareQuery(name)
    setPage('compare')
    setModalPlayer(null)
  }
  const y1Data = useMemo<Y1Data>(() => ({ qb: qbSeasons, wr: wrSeasons, rb: rbSeasons }), [qbSeasons, wrSeasons, rbSeasons])
  const activeConsensusPick = useMemo(
    () => consensus.find((c) => clean(c.name) === clean(input.name) && c.pos === input.pos),
    [consensus, input.name, input.pos],
  )
  const activeScoutNote = useMemo(
    () => scoutNotes.find((n) => clean(n.name) === clean(input.name)),
    [scoutNotes, input.name],
  )
  const activeInjuryFlag = useMemo(
    () => injuryFlags.find((f) => clean(f.name) === clean(input.name)),
    [injuryFlags, input.name],
  )
  // Universal QB PFF context: applies to all QBs, not only the 2027 prospect file.
  // Leakage guard lives in getQbPffContext(): it only uses seasons before the player's draftSeason.
  const activeQbPffContext = useMemo(
    () => input.pos === 'QB'
      ? getQbPffContext(input.draftSeason, input.name, qbPffSeasons)
      : null,
    [input.pos, input.draftSeason, input.name, qbPffSeasons],
  )

  const activeQbTrajectory = activeQbPffContext?.trajectory ?? null

  const activeWrPffContext = useMemo(
    () => input.pos === 'WR'
      ? getWrPffContext(input.draftSeason, input.name, wrPffSeasons)
      : null,
    [input.pos, input.draftSeason, input.name, wrPffSeasons],
  )

  const activeWrTrajectory = activeWrPffContext?.trajectory ?? null

  const fallbackQbGradeDelta = useMemo(
    () => input.pos === 'QB'
      ? (prospectsQb2027.find((p) => clean(p.name) === clean(input.name))?.trajectory.gradeDelta ?? null)
      : null,
    [prospectsQb2027, input.pos, input.name],
  )

  const activeQbGradeDelta = activeQbTrajectory?.gradeDelta ?? fallbackQbGradeDelta

  const projectedInput = useMemo<Prospect>(
    () => {
      if (input.pos === 'QB' && activeQbTrajectory) return { ...input, qbTrajectory: activeQbTrajectory }
      if (input.pos === 'WR' && activeWrTrajectory) return { ...input, wrTrajectory: activeWrTrajectory }
      return input
    },
    [input, activeQbTrajectory, activeWrTrajectory],
  )

  const projection = useMemo(
    () => project(projectedInput, prospects, pffProfiles, undefined, y1Data, careerStats, activeInjuryFlag?.severity, activeQbGradeDelta),
    [projectedInput, prospects, pffProfiles, y1Data, careerStats, activeInjuryFlag, activeQbGradeDelta],
  )
  const histFlagMap = useMemo(
    () => buildHistoricalFlagMap(
      lookupPool.filter((p) => p.year >= 2000 && p.year <= 2026 && p.pick < 260),
      pffProfiles,
    ),
    [lookupPool, pffProfiles],
  )
  // O(1) PFF profile lookup keyed by cleanName|draftSeason|posGroup
  const pffLookup = useMemo(() => {
    const map = new Map<string, PffProfile>()
    for (const p of pffProfiles) {
      const key = `${clean(p.name)}|${p.draftSeason}|${group[p.position] ?? p.position}`
      map.set(key, p)
    }
    return map
  }, [pffProfiles])
  const patternAlerts = useMemo(() => extractPatternAlerts(projection.fullComps, histFlagMap), [projection.fullComps, histFlagMap])
  const draftBoard = useMemo(
    () => saved
      .map((player) => {
        const qbContext = player.pos === 'QB' ? getQbPffContext(player.draftSeason, player.name, qbPffSeasons) : null
        const wrContext = player.pos === 'WR' ? getWrPffContext(player.draftSeason, player.name, wrPffSeasons) : null
        const playerWithContext = qbContext?.trajectory
          ? { ...player, qbTrajectory: qbContext.trajectory }
          : wrContext?.trajectory
            ? { ...player, wrTrajectory: wrContext.trajectory }
            : player
        const projection = project(playerWithContext, prospects, pffProfiles, undefined, y1Data, careerStats, undefined, qbContext?.trajectory?.gradeDelta ?? null)
        const patternAlerts = extractPatternAlerts(projection.fullComps, histFlagMap)
        const historical = lookupPool.find((h) => clean(h.name) === clean(player.name) && h.year === player.draftSeason && h.pos === player.pos) ?? null
        const earlyFlag = historical ? (histFlagMap.get(historical.id) ?? null) : null
        return { player, projection, patternAlerts, earlyFlag }
      })
      .sort((a, b) => b.projection.score - a.projection.score),
    [saved, prospects, pffProfiles, y1Data, careerStats, histFlagMap, lookupPool, qbPffSeasons, wrPffSeasons],
  )

  const orderedBoard = useMemo(() => {
    if (!boardOrder.length) return draftBoard
    const idxMap = new Map(boardOrder.map((id, i) => [id, i]))
    return [...draftBoard].sort(
      (a, b) => (idxMap.get(a.player.id) ?? 9999) - (idxMap.get(b.player.id) ?? 9999),
    )
  }, [draftBoard, boardOrder])
  const scarcityData = useMemo(() => {
    if (!lookupPool.length || !prospects.length) return null
    const posGroup = group[input.pos] ?? 'SKILL'
    const currentClassPlayers = lookupPool.filter(
      (p) => p.year === input.draftSeason && (p.pos === input.pos || group[p.pos] === posGroup)
    )
    const currentCount = currentClassPlayers.length
    if (currentCount === 0) return null
    const years = Array.from(new Set(prospects.map((p) => p.year)))
    const historicalCounts = years.map(
      (y) => prospects.filter((p) => p.year === y && (p.pos === input.pos || group[p.pos] === posGroup)).length
    ).filter((c) => c > 0)
    if (historicalCounts.length === 0) return null
    const avgCount = historicalCounts.reduce((sum, c) => sum + c, 0) / historicalCounts.length
    const ratio = currentCount / avgCount
    const depth: 'deep' | 'shallow' | 'average' = ratio > 1.15 ? 'deep' : ratio < 0.85 ? 'shallow' : 'average'
    return { currentCount, avgCount: Math.round(avgCount), depth, pos: input.pos, year: input.draftSeason }
  }, [input.pos, input.draftSeason, lookupPool, prospects])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const hashMap: Partial<Record<Page, string>> = { class: '#class', players: '#players', compare: '#compare', trade: '#trade', guide: '#guide', prospects: '#prospects' }
    const target = hashMap[page] ?? ''
    if (window.location.hash !== target) {
      const url = target || `${window.location.pathname}${window.location.search}`
      window.history.replaceState(null, '', url)
    }
  }, [page])

  useEffect(() => {
    if (typeof window === 'undefined') return
    function onHash() {
      setPage(readPageFromHash())
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    let cancelled = false
    const base = import.meta.env.BASE_URL || './'

    fetch(`${base}data/model/qb_translation_signal_candidates.json`)
      .then((r) => r.ok ? r.json() : null)
      .then((payload) => {
        if (cancelled) return
        const candidateMap = buildQbTranslationCandidateMap(payload)
        setQbTranslationMap((prev: Map<string, QbTranslationSignal>) => {
          const merged = new Map(prev)
          for (const [key, value] of candidateMap) merged.set(key, value)
          return merged
        })
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    async function load() {
      try {
        const [combineCsv, draftCsv, pffPayload, extraData, consensusData, scoutData, injuryData, qbSeasonData, qbPffSeasonData, wrPffSeasonData, tePffSeasonData, rbPffSeasonData, wrSeasonData, rbSeasonData, careerStatsData, prospectsQbData, prospectsTeData, prospectsRbData, rasCsv] = await Promise.all([
          fetch(`${assetBase}data/combine.csv`).then((r) => r.text()),
          fetch(`${assetBase}data/draft_picks.csv`).then((r) => r.text()),
          loadPffPayload(),
          fetch(`${assetBase}data/extra_prospects.json`).then((r) => r.json()).catch(() => null),
          fetch(`${assetBase}data/consensus_2025.json`).then((r) => r.json()).catch(() => null),
          fetch(`${assetBase}data/scout_notes_2025.json`).then((r) => r.json()).catch(() => null),
          fetch(`${assetBase}data/injury_flags_2025.json`).then((r) => r.json()).catch(() => null),
          fetch(`${assetBase}data/qb_seasons.json`).then((r) => r.json()).catch(() => null),
          fetch(`${assetBase}data/qb_pff_seasons.json`).then((r) => r.json()).catch(() => null),
          fetch(`${assetBase}data/wr_pff_seasons.json`).then((r) => r.json()).catch(() => null),
          fetch(`${assetBase}data/te_pff_seasons.json`).then((r) => r.json()).catch(() => null),
          fetch(`${assetBase}data/rb_pff_seasons.json`).then((r) => r.json()).catch(() => null),
          fetch(`${assetBase}data/wr_seasons.json`).then((r) => r.json()).catch(() => null),
          fetch(`${assetBase}data/rb_seasons.json`).then((r) => r.json()).catch(() => null),
          fetch(`${assetBase}data/career_stats.json`).then((r) => r.json()).catch(() => null),
          fetch(`${assetBase}data/prospects_2027_qb.json`).then((r) => r.json()).catch(() => null),
          fetch(`${assetBase}data/prospects_2027_te.json`).then((r) => r.json()).catch(() => null),
          fetch(`${assetBase}data/prospects_2027_rb.json`).then((r) => r.json()).catch(() => null),
          fetch(`${assetBase}data/ras_main_table.csv`).then((r) => r.text()).catch(() => ''),
        ])
        const allProspects = buildProspectPool(parseCsv(combineCsv), parseCsv(draftCsv))
        const extraProspects = buildExtraProspects(extraData)
        const existingKeys = new Set(allProspects.map((p) => `${p.year}-${clean(p.name)}`))
        const uniqueExtras = extraProspects.filter((p) => !existingKeys.has(`${p.year}-${clean(p.name)}`))
        setLookupPool([...allProspects, ...uniqueExtras])
        setProspects(allProspects.filter((p) => p.year >= 2000 && p.year <= 2022 && p.pick < 260 && (p.year > 2020 || p.games >= 16)))
        if (pffPayload?.profiles?.length) {
          setPffProfiles(normalizePffProfiles(pffPayload.profiles))
          setPffSummary(pffPayload.summary)
        }
        if (consensusData?.picks?.length) setConsensus(consensusData.picks)
        if (scoutData?.notes?.length) setScoutNotes(scoutData.notes)
        if (injuryData?.flags?.length) setInjuryFlags(injuryData.flags)
        if (qbSeasonData?.records?.length) setQbSeasons(qbSeasonData.records)
        if (qbPffSeasonData?.records?.length) setQbPffSeasons(qbPffSeasonData.records)
        if (wrPffSeasonData?.records?.length) setWrPffSeasons(wrPffSeasonData.records)
        if (tePffSeasonData?.records?.length) setTePffSeasons(tePffSeasonData.records)
        if (rbPffSeasonData?.records?.length) setRbPffSeasons(rbPffSeasonData.records)
        if (wrSeasonData?.records?.length) setWrSeasons(wrSeasonData.records)
        if (rbSeasonData?.records?.length) setRbSeasons(rbSeasonData.records)
        if (careerStatsData && typeof careerStatsData === 'object') setCareerStats(careerStatsData as CareerStatMap)
        if (Array.isArray(prospectsQbData) && prospectsQbData.length) setProspectsQb2027(prospectsQbData as ProspectQB[])
        if (rasCsv) setRasLookup(buildAppRasLookup(parseCsv(rasCsv)))
      } catch {
        setError('Data files are missing. Run npm run data:refresh, then reload.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadProjectionOverlay() {
      const files = [
        'prospects_2024_qb.json',
        'prospects_2025_qb.json',
        'prospects_2026_qb.json',
        'prospects_2027_qb.json',

        'prospects_2024_wr.json',
        'prospects_2025_wr.json',
        'prospects_2026_wr.json',
        'prospects_2027_wr.json',

        'prospects_2024_te.json',
        'prospects_2025_te.json',
        'prospects_2026_te.json',
        'prospects_2027_te.json',

        'prospects_2025_rb.json',
        'prospects_2026_rb.json',
        'prospects_2027_rb.json',
      ]

      const payloads = await Promise.all(
        files.map((file) =>
          fetch(`${assetBase}data/${file}`)
            .then((r) => r.ok ? r.json() : null)
            .catch(() => null)
        )
      )

      if (!cancelled) setProjectionOverlay(buildProjectionOverlayMap(payloads))
    }

    loadProjectionOverlay()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    const base = import.meta.env.BASE_URL || './'

    fetch(`${base}data/model/position_comp_adjustment_report.json`)
      .then((r) => r.ok ? r.json() : null)
      .then((payload) => {
        if (!cancelled) setCompSignalMap(buildCompSignalMap(payload))
      })
      .catch(() => {
        if (!cancelled) setCompSignalMap(new Map())
      })

    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    const base = import.meta.env.BASE_URL || './'

    fetch(`${base}data/model/score_adjustment_candidates.json`)
      .then((r) => r.ok ? r.json() : null)
      .then((payload) => {
        if (!cancelled) setRbScoreReadyMap(buildRbScoreReadyMap(payload))
      })
      .catch(() => {
        if (!cancelled) setRbScoreReadyMap(new Map())
      })

    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        saveCurrentProspect()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [input, notes, saved, selectedSavedId])

  useEffect(() => {
    writeSavedProspects(saved)
  }, [saved])

  const lookupOptions = useMemo(
    () => lookupPool
      .slice()
      .sort((a, b) => b.year - a.year || a.pick - b.pick || a.name.localeCompare(b.name))
      .slice(0, 9000)
      .map((player) => ({ id: player.id, label: lookupLabel(player) })),
    [lookupPool],
  )

  const pffOptions = useMemo(
    () => pffProfiles
      .slice()
      .sort((a, b) => b.draftSeason - a.draftSeason || b.pff.composite - a.pff.composite || a.name.localeCompare(b.name))
      .map((player) => ({ id: player.id, label: pffLabel(player) })),
    [pffProfiles],
  )

  function update<K extends keyof Prospect>(key: K, value: Prospect[K]) {
    setInput((current) => ({ ...current, [key]: value }))
  }

  function loadExistingProspect() {
    const normalized = clean(lookupQuery)
    if (!normalized) {
      setMessage({ tone: 'warn', text: 'Type a player name first.' })
      return
    }

    const option = lookupOptions.find((item) => item.label === lookupQuery)
      ?? lookupOptions.find((item) => clean(item.label).includes(normalized))
    const match = lookupPool.find((player) => player.id === option?.id)

    if (!match) {
      setMessage({ tone: 'warn', text: 'No matching player found.' })
      return
    }

    const pffMatch = pffProfiles.find((profile) => samePlayerSeason(profile, match.name, match.year, match.pos))
    const rasMatch = rasLookup ? getAppRas(match.name, match.year, match.pos, rasLookup) : null
    setInput(prospectFromHistorical(match, pffMatch, rasMatch))
    setSelectedSavedId('')
    setNotes('')
    setPffQuery(pffMatch ? pffLabel(pffMatch) : '')
    setMessage({ tone: 'good', text: `Loaded ${match.name}.` })
  }

  function loadPffProspect() {
    const normalized = clean(pffQuery)
    if (!normalized) {
      setMessage({ tone: 'warn', text: 'Type a PFF player name first.' })
      return
    }

    const option = pffOptions.find((item) => item.label === pffQuery)
      ?? pffOptions.find((item) => clean(item.label).includes(normalized))
    const match = pffProfiles.find((player) => player.id === option?.id)

    if (!match) {
      setMessage({ tone: 'warn', text: 'No matching PFF profile found.' })
      return
    }

    const historical = findHistoricalForPff(match, lookupPool)
    setInput(prospectFromPff(match, historical, input))
    setLookupQuery(historical ? lookupLabel(historical) : '')
    setSelectedSavedId('')
    setNotes('')
    setMessage({ tone: 'good', text: `Loaded ${match.name} with college PFF signals.` })
  }

  function saveCurrentProspect() {
    const now = new Date().toISOString()
    const id = selectedSavedId && saved.some((player) => player.id === selectedSavedId)
      ? selectedSavedId
      : `${Date.now()}-${slug(input.name || 'prospect')}`
    const score = Math.round(projection.score)
    const record: SavedProspect = { ...input, id, updatedAt: now, notes: notes.trim() || undefined, savedScore: score }

    setSaved((current) => {
      const next = current.some((player) => player.id === id)
        ? current.map((player) => player.id === id ? record : player)
        : [record, ...current]
      return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 250)
    })
    setSelectedSavedId(id)
    setBaselineScore(score)
    setMessage({ tone: 'good', text: `Saved ${input.name} to My prospects.` })
  }

  function loadSavedProspect(id: string) {
    setSelectedSavedId(id)
    const match = saved.find((player) => player.id === id)
    if (!match) return
    setInput(stripSavedFields(match))
    setNotes(match.notes ?? '')
    setLookupQuery('')
    setBaselineScore(match.savedScore ?? null)
    const pffMatch = pffProfiles.find((profile) => profile.id === match.pffProfileId)
    setPffQuery(pffMatch ? pffLabel(pffMatch) : '')
    setMessage({ tone: 'good', text: `Loaded saved prospect ${match.name}.` })
  }

  function deleteSavedProspect() {
    if (!selectedSavedId) return
    const deleted = saved.find((player) => player.id === selectedSavedId)
    setSaved((current) => current.filter((player) => player.id !== selectedSavedId))
    setSelectedSavedId('')
    setNotes('')
    setMessage({ tone: 'warn', text: deleted ? `Removed ${deleted.name} from My prospects.` : 'Saved prospect removed.' })
  }

  function exportCard() {
    const score = Math.round(projection.score)
    const lines = [
      '=== DraftLens Scouting Card ===',
      `${input.name || 'Unnamed'} | ${input.pos} | ${input.school || 'Unknown school'}`,
      `Draft Class: ${input.draftSeason} | Projected Pick: ${input.pick} | Age: ${input.age}`,
      '',
      'PROJECTION',
      `Score: ${score} (${Math.round(projection.scoreLow)}–${Math.round(projection.scoreHigh)}) · ${projection.grade}`,
      `Expected AV: ${projection.expectedAv.toFixed(1)} | Floor: ${projection.floor.toFixed(1)} | Ceiling: ${projection.ceiling.toFixed(1)}`,
      `Games: ${Math.round(projection.games)} | Starter yrs: ${projection.starts.toFixed(1)} | ${projection.officialRAS != null ? `Off. RAS: ${projection.officialRAS.toFixed(2)}` : `RAS: ${projection.ras.toFixed(1)}`}`,
      '',
      'OUTCOME ODDS',
      ...([...outcomeOrder].reverse().map((o) => `  ${outcomeAVRange[o as Category]}: ${Math.round((projection.odds[o as Category] || 0) * 100)}%`)),
      '',
      'TOP COMPS',
      ...projection.comps.slice(0, 6).map((c, i) =>
        `  ${i + 1}. ${c.player.name} (${c.player.year} · Pick ${c.player.pick} · ${c.player.category}) — Sim ${Math.round(c.sim * 100)}`
      ),
      ...(notes ? ['', 'SCOUT NOTES', notes] : []),
      '',
      `Generated by DraftLens · ${new Date().toLocaleDateString()}`,
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(input.name || 'prospect').replace(/\s+/g, '_')}_${input.draftSeason}_card.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleDragStart(id: string) {
    setDragId(id)
  }

  function handleDrop(targetId: string) {
    if (!dragId || dragId === targetId) return
    const base = boardOrder.length ? boardOrder : draftBoard.map((r) => r.player.id)
    const from = base.indexOf(dragId)
    const to = base.indexOf(targetId)
    if (from === -1 || to === -1) return
    const next = [...base]
    next.splice(from, 1)
    next.splice(to, 0, dragId)
    setBoardOrder(next)
    setDragId('')
  }

  function resetBoardOrder() {
    setBoardOrder([])
  }

  function startNewProspect() {
    setInput(blankProspect)
    setSelectedSavedId('')
    setNotes('')
    setLookupQuery('')
    setPffQuery('')
    setMessage({ tone: 'good', text: 'New prospect is ready.' })
  }

  function loadProspect2027(p: ProspectQB) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { rawStats, priorStats, trajectory, ...prospect } = p
    setInput(prospect)
    setSelectedSavedId('')
    setNotes('')
    setLookupQuery('')
    setPffQuery('')
    setPage('workbench')
    setMessage({ tone: 'good', text: `Loaded ${p.name} (2027 QB prospect).` })
  }

  function exportSavedProspects() {
    if (!saved.length) {
      setMessage({ tone: 'warn', text: 'There are no saved prospects to export yet.' })
      return
    }

    const blob = new Blob([JSON.stringify(saved, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'draftlens-prospects.json'
    link.click()
    URL.revokeObjectURL(url)
    setMessage({ tone: 'good', text: 'Exported My prospects.' })
  }

  function downloadCsvTemplate() {
    const blob = new Blob([`${csvTemplate}\n`], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'draftlens-prospect-template.csv'
    link.click()
    URL.revokeObjectURL(url)
    setMessage({ tone: 'good', text: 'Downloaded CSV import template.' })
  }

  async function importSavedProspects(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const importedProspects = parseProspectImport(await file.text())
      if (!importedProspects.length) throw new Error('No prospects')

      const now = new Date().toISOString()
      const imported = importedProspects.map((prospect, index) => ({
        ...prospect,
        id: `${Date.now()}-${index}-${slug(prospect.name)}`,
        updatedAt: now,
      }))

      setSaved((current) => [...imported, ...current].slice(0, 250))
      setMessage({ tone: 'good', text: `Imported ${imported.length} prospect${imported.length === 1 ? '' : 's'} into My prospects.` })
    } catch {
      setMessage({ tone: 'warn', text: 'Import failed. Use the exported JSON format or the CSV template.' })
    } finally {
      event.target.value = ''
    }
  }

  return <main className="shell" data-tab={mobileTab} data-page={page}>
    <div className="topBar">
      <header className="top">
        <div className="brand">
          <h1>DraftLens</h1>
          <span className="brandDivider" />
          <p>NFL Draft Intelligence</p>
        </div>
        
{page === 'guide' && (
<section className="panel qbGuidePanel">
  <div className="panelHeader">
    <h2>QB Model Guide</h2>
    <p>Plain-English explanation of how the quarterback score works.</p>
  </div>
  <div className="guideGrid">
    {QB_MODEL_GUIDE_LAYMAN.map((item) => (
      <div className="guideCard" key={item.title}>
        <h3>{item.title}</h3>
        <p>{item.body}</p>
      </div>
    ))}
  </div>
</section>
)}

<div className="dataPills">
          <span>{loading ? 'Loading…' : `${prospects.length.toLocaleString()} comps`}</span>
          <span>{pffSummary ? `${pffSummary.matched.toLocaleString()} PFF matches` : 'PFF pending'}</span>
          <span>{saved.length} saved</span>
        </div>
      </header>

      <nav className="pageNav" aria-label="Primary">
        <button type="button" className={page === 'workbench' ? 'on' : ''} onClick={() => setPage('workbench')}>Workbench</button>
        <button type="button" className={page === 'class' ? 'on' : ''} onClick={() => setPage('class')}>Class</button>
        <button type="button" className={page === 'players' ? 'on' : ''} onClick={() => setPage('players')}>Players</button>
        <button type="button" className={page === 'rankings' ? 'on' : ''} onClick={() => setPage('rankings')}>Rankings</button>
        <button type="button" className={page === 'compare' ? 'on' : ''} onClick={() => setPage('compare')}>Compare</button>
        <button type="button" className={page === 'trade' ? 'on' : ''} onClick={() => setPage('trade')}>Trade</button>
        <button type="button" className={`${page === 'prospects' ? 'on' : ''} prospectsNavBtn`} onClick={() => setPage('prospects')}>2027 QBs</button>
        <button type="button" className={page === 'guide' ? 'on' : ''} onClick={() => setPage('guide')}>Guide</button>
        <span className="navSpacer" />
        <button type="button" className="themeNavBtn" onClick={toggleTheme} aria-label="Toggle light/dark mode">
          {theme === 'dark' ? '☀ Day' : '☾ Night'}
        </button>
      </nav>

      {page === 'workbench' ? <nav className="mobileTabs" role="tablist" aria-label="Workbench sections">
        <button type="button" role="tab" aria-selected={mobileTab === 'edit'} className={mobileTab === 'edit' ? 'on' : ''} onClick={() => setMobileTab('edit')}>Edit</button>
        <button type="button" role="tab" aria-selected={mobileTab === 'results'} className={mobileTab === 'results' ? 'on' : ''} onClick={() => setMobileTab('results')}>Results</button>
        <button type="button" role="tab" aria-selected={mobileTab === 'board'} className={mobileTab === 'board' ? 'on' : ''} onClick={() => setMobileTab('board')}>Board</button>
      </nav> : null}
    </div>

    {error ? <section className="panel empty">{error}</section> : page === 'class' ? <div className="classPage">
      <ClassExplorer pool={lookupPool} history={prospects} pffProfiles={pffProfiles} pffLookup={pffLookup} y1Data={y1Data} careerStats={careerStats} histFlagMap={histFlagMap} currentName={input.name} currentYear={input.draftSeason} saved={saved} projectionOverlay={projectionOverlay} compSignalMap={compSignalMap} rbScoreReadyMap={rbScoreReadyMap} qbTranslationMap={qbTranslationMap} qbPffSeasons={qbPffSeasons} wrPffSeasons={wrPffSeasons} tePffSeasons={tePffSeasons} rbPffSeasons={rbPffSeasons} />
    </div> : page === 'players' ? <div className="classPage">
      <PlayerBrowser pool={lookupPool} history={prospects} histFlagMap={histFlagMap} onOpenModal={openModal} onCompare={handleCompare} />
    </div> : page === 'compare' ? <div className="classPage">
      <CompareView pool={lookupPool} history={prospects} pffProfiles={pffProfiles} y1Data={y1Data} careerStats={careerStats} initialQuery={compareQuery} rasLookup={rasLookup} qbPffSeasons={qbPffSeasons} wrPffSeasons={wrPffSeasons} />
    </div> : page === 'trade' ? <div className="classPage">
      <TradeCalculator />
    </div> : page === 'rankings' ? <div className="classPage">
      <RankingsPage history={prospects} onOpenModal={openModal} onCompare={handleCompare} />
    </div> : page === 'guide' ? <div className="classPage">
      <GuideView />
    </div> : page === 'prospects' ? <div className="classPage">
      <ProspectsView prospects2027={[...prospectsQb2027, ...prospectsTe2027, ...prospectsRb2027] as any} history={prospects} pffProfiles={pffProfiles} careerStats={careerStats} histFlagMap={histFlagMap} qbPffSeasons={qbPffSeasons} wrPffSeasons={wrPffSeasons} onLoad={loadProspect2027} />
    </div> : <div className="layout">
      <aside className="controlPanel" data-pane="edit">
        <section className="panel loadPanel">
          <div className="panelTitle">
            <div>
              <p>Player Loader</p>
              <h2>Add or Edit Prospect</h2>
            </div>
            <button type="button" className={`panelToggle ${openPanels.loader ? 'open' : 'closed'}`} onClick={() => togglePanel('loader')} aria-label="Toggle panel">▾</button>
          </div>
          <div className={`panelBody${openPanels.loader ? '' : ' collapsed'}`}>
            <label className="field wide"><span>Historical draft/combine player</span><input list="prospect-lookup" value={lookupQuery} onChange={(e) => setLookupQuery(e.target.value)} placeholder="Search name, school, year, position" /></label>
            <datalist id="prospect-lookup">{lookupOptions.map((item) => <option key={item.id} value={item.label} />)}</datalist>
            <label className="field wide"><span>College PFF profile</span><input list="pff-lookup" value={pffQuery} onChange={(e) => setPffQuery(e.target.value)} placeholder="Search PFF profile by player, school, class" /></label>
            <datalist id="pff-lookup">{pffOptions.map((item) => <option key={item.id} value={item.label} />)}</datalist>
            <div className="buttonRow">
              <button type="button" onClick={loadPffProspect}>Load PFF</button>
              <button type="button" className="secondary" onClick={loadExistingProspect}>Load historical</button>
              <button type="button" className="secondary" onClick={startNewProspect}>New</button>
            </div>
            <label className="field wide"><span>My prospects</span><select value={selectedSavedId} onChange={(e) => loadSavedProspect(e.target.value)}><option value="">Select saved player</option>{saved.map((player) => <option key={player.id} value={player.id}>{player.name} / {player.pos} / {player.school || 'No school'}</option>)}</select></label>
            <div className="buttonRow compact">
              <button type="button" onClick={saveCurrentProspect}>Save</button>
              <button type="button" className="secondary" onClick={exportSavedProspects}>Export</button>
              <button type="button" className="secondary" onClick={downloadCsvTemplate}>Template</button>
              <label className="fileButton">Import<input type="file" accept="application/json,.json,text/csv,.csv" onChange={importSavedProspects} /></label>
              <button type="button" className="danger" onClick={deleteSavedProspect} disabled={!selectedSavedId}>Delete</button>
            </div>
            <label className="field wide"><span>Scout notes</span><textarea className="notesArea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add scouting observations, traits, concerns…" rows={3} /></label>
            {activeScoutNote && <div className="scoutNoteBox">
              <p className="scoutNoteLabel">2025 Scouting Consensus</p>
              <p className="scoutNoteText">{activeScoutNote.summary}</p>
            </div>}
            {message ? <p className={`status ${message.tone}`}>{message.text}</p> : null}
          </div>
        </section>

        <section className="panel formPanel">
          <div className="panelTitle">
            <div><p>Identity</p><h2>Prospect Card</h2></div>
            <button type="button" className={`panelToggle ${openPanels.card ? 'open' : 'closed'}`} onClick={() => togglePanel('card')} aria-label="Toggle panel">▾</button>
          </div>
          <div className={`panelBody${openPanels.card ? '' : ' collapsed'}`}>
            <div className="formGrid">
              <Text label="Name" value={input.name} onChange={(v) => update('name', v)} />
              <Text label="School" value={input.school} onChange={(v) => update('school', v)} />
              <label className="field"><span>Position</span><select value={input.pos} onChange={(e) => { const pos = e.target.value; setInput((current) => withPositionDefaults({ ...current, pos }, pos)) }}>{positions.map((p) => <option key={p}>{p}</option>)}</select></label>
              <Num label="Draft class" value={input.draftSeason} min={2016} max={2030} onChange={(v) => update('draftSeason', v)} />
              <Num label="Projected pick" value={input.pick} min={1} max={260} onChange={(v) => update('pick', v)} />
              <Num label="Age" value={input.age} step={0.1} onChange={(v) => update('age', v)} />
              <label className="field"><span>Scheme tag</span>
                <select value={input.schemeTag} onChange={(e) => update('schemeTag', e.target.value)}>
                  <option value="">— none —</option>
                  <option value="Spread offense">Spread offense</option>
                  <option value="Pro-style">Pro-style</option>
                  <option value="Air raid">Air raid</option>
                  <option value="Option/RPO">Option / RPO</option>
                  <option value="West Coast">West Coast</option>
                  <option value="Gap/power run">Gap / power run</option>
                  <option value="Zone blocking">Zone blocking</option>
                  <option value="4-3 defense">4-3 defense</option>
                  <option value="3-4 defense">3-4 defense</option>
                  <option value="Multiple defense">Multiple defense</option>
                </select>
              </label>
            </div>
          </div>
        </section>

        <section className="panel formPanel">
          <div className="panelTitle">
            <div><p>Testing</p><h2>Measurables</h2></div>
            <button type="button" className={`panelToggle ${openPanels.measurables ? 'open' : 'closed'}`} onClick={() => togglePanel('measurables')} aria-label="Toggle panel">▾</button>
          </div>
          <div className={`panelBody${openPanels.measurables ? '' : ' collapsed'}`}>
            <div className="formGrid">
              <Num label="Height in." value={input.height} onChange={(v) => update('height', v)} />
              <Num label="Weight" value={input.weight} onChange={(v) => update('weight', v)} />
              <Num label="40-yard" value={input.forty} step={0.01} onChange={(v) => update('forty', v)} />
              <Num label="Vertical" value={input.vertical} step={0.5} onChange={(v) => update('vertical', v)} />
              <Num label="Broad" value={input.broad} onChange={(v) => update('broad', v)} />
              <Num label="3-cone" value={input.cone} step={0.01} onChange={(v) => update('cone', v)} />
              <Num label="Shuttle" value={input.shuttle} step={0.01} onChange={(v) => update('shuttle', v)} />
              <Num label="Bench reps" value={input.bench} onChange={(v) => update('bench', v)} />
            </div>
          </div>
        </section>

        <section className="panel formPanel pffPanel">
          <div className="panelTitle">
            <div><p>PFF College Signal</p><h2>Performance Profile</h2></div>
            {!input.pffProfileId && <span className="pffEstBadge">⚠ No PFF match</span>}
            <strong>{input.pffComposite.toFixed(0)}</strong>
            <button type="button" className={`panelToggle ${openPanels.pff ? 'open' : 'closed'}`} onClick={() => togglePanel('pff')} aria-label="Toggle panel">▾</button>
          </div>
          <div className={`panelBody${openPanels.pff ? '' : ' collapsed'}`}>
            <Slider label="Composite" value={input.pffComposite} onChange={(v) => update('pffComposite', v)} />
            <Slider label="Grade" value={input.pffGrade} onChange={(v) => update('pffGrade', v)} />
            <Slider label="Production" value={input.pffProduction} onChange={(v) => update('pffProduction', v)} />
            <Slider label="Efficiency" value={input.pffEfficiency} onChange={(v) => update('pffEfficiency', v)} />
            <Slider label="Clean play" value={input.pffClean} onChange={(v) => update('pffClean', v)} />
          </div>
        </section>
      </aside>

      <section className="dashboard">
        <section className="panel heroPanel" data-pane="results">
          <div className="scoreDial" style={{ '--angle': `${projection.score * 3.6}deg`, '--dial-color': scoreColor(Math.round(projection.score)) } as CSSProperties}>
            <b>{Math.round(projection.score)}</b>
            <span className="dialRange">{Math.round(projection.scoreLow)}–{Math.round(projection.scoreHigh)}</span>
            <span>score</span>
            {baselineScore !== null && Math.round(projection.score) !== baselineScore && (
              <span className={`scoreDelta ${projection.score > baselineScore ? 'deltaUp' : 'deltaDown'}`}>
                {projection.score > baselineScore ? '+' : ''}{Math.round(projection.score) - baselineScore}
              </span>
            )}
          </div>
          <div className="heroCopy">
            <p>{input.draftSeason} / {input.pos} / round {round(input.pick)}</p>
            <h2>{input.name}</h2>
            <h3>{projection.grade}</h3>
            {projection.percentile != null && <p className="scoreRank">Top {100 - projection.percentile}% at this pick slot</p>}
            {projection.pffBlend === 0 && <p className="slotWarn">Pick-slot projection only — no PFF comps</p>}
            {activeConsensusPick && <p className="consensusRange">
              Consensus #{activeConsensusPick.consensus} · range {activeConsensusPick.lo}–{activeConsensusPick.hi}
            </p>}
            {(projection.flags.length > 0 || projection.rasHighlight || projection.trajectoryHighlight) && <div className="flagRow">
              {projection.trajectoryHighlight && <span className="rasHighlightFlag">{projection.trajectoryHighlight}</span>}
              {projection.rasHighlight && <span className="rasHighlightFlag">{projection.rasHighlight}</span>}
              {projection.flags.map((f) => <span key={f} className="dangerFlag">{f}</span>)}
            </div>}
            {patternAlerts.map((alert) => (
              <div key={alert.type} className={`patternAlert patternAlert-${alert.type}`}>
                <span className="patternAlertLabel">{alert.type === 'bust-risk' ? '⚠' : '↑'} {alert.label}</span>
                <p className="patternAlertDesc">{alert.description}</p>
                <div className="patternAlertMatches">
                  {alert.matches.map((m) => (
                    <span key={`${m.name}${m.year}`} className="patternMatchItem">{m.name} ({m.year}, #{m.pick >= 260 ? 'UDFA' : m.pick}) · AV {m.av} · {m.reason}</span>
                  ))}
                </div>
              </div>
            ))}
            {activeInjuryFlag && (
              <div className={`injuryBadge injurySeverity-${activeInjuryFlag.severity}`}>
                {activeInjuryFlag.severity === 'major' ? '🩹 Injury concern: ' : activeInjuryFlag.severity === 'moderate' ? '⚠ Injury note: ' : 'ℹ '}
                {activeInjuryFlag.note}
              </div>
            )}
            {scarcityData && (
              <p className={`scarcityTag scarcity-${scarcityData.depth}`}>
                {scarcityData.depth === 'deep' ? '▼ Deep class' : scarcityData.depth === 'shallow' ? '▲ Thin class' : '— Average depth'} · {scarcityData.currentCount} {scarcityData.pos} in {scarcityData.year} (avg {scarcityData.avgCount}/yr)
              </p>
            )}
            <div className="heroMeta">
              <span>{input.school || 'No school'}</span>
              <span>PFF {Math.round(input.pffComposite)}</span>
              <span>{projection.pffComps.length} PFF comps</span>
            </div>
            <div className="heroActions">
              <button type="button" className="secondary smallButton" onClick={() => { setCompareQuery(input.name); setPage('compare') }}>Compare</button>
              <button type="button" className="secondary smallButton" onClick={exportCard}>Export card</button>
            </div>
          </div>
          <div className="statStrip">
            <Metric label="Expected AV" value={projection.expectedAv.toFixed(1)} />
            <Metric label="NFL impact" value={projection.impactScore.toFixed(1)} />
            <Metric label="Games" value={Math.round(projection.games).toString()} />
            <Metric label="Starter yrs" value={projection.starts.toFixed(1)} />
            <Metric label={projection.officialRAS != null ? 'Off. RAS' : 'RAS'} value={projection.officialRAS != null ? projection.officialRAS.toFixed(2) : projection.ras.toFixed(1)} />
          </div>
        </section>

        <section className="summaryGrid" data-pane="results">
          <section className="panel">
            <div className="panelTitle"><div><p>Probability</p><h2>Outcome Odds</h2></div></div>
            {outcomeOrder.map((cat, i) => <Bar key={cat} label={outcomeAVRange[cat]} value={projection.odds[cat] || 0} colorIdx={i} />)}
          </section>

          <section className="panel">
            <div className="panelTitle"><div><p>Range</p><h2>Career AV Band</h2></div></div>
            <div className="range"><i style={{ left: `${projection.floorPct}%`, width: `${projection.ceilPct - projection.floorPct}%` }} /><b style={{ left: `${projection.midPct}%` }} /></div>
            <div className="miniMetrics">
              <Metric label="Floor" value={projection.floor.toFixed(1)} />
              <Metric label="Median" value={projection.median.toFixed(1)} />
              <Metric label="Ceiling" value={projection.ceiling.toFixed(1)} />
            </div>
          </section>
        </section>

        <section className="panel" data-pane="results">
          <div className="panelTitle"><div><p>Weights</p><h2>Model Signals</h2></div><strong>{Math.round(projection.pffBlend * 100)}% PFF blend</strong></div>
          <div className="signalGrid">
            <Signal label="Draft" value={projection.signals.draft} />
            <Signal label="Athletic" value={projection.signals.athletic} />
            <Signal label="Size" value={projection.signals.size} />
            <Signal label="Strength" value={projection.signals.strength} />
            <Signal label="Age" value={projection.signals.age} />
            <Signal label="PFF" value={projection.signals.pff} />
          </div>
        </section>

        <section className="panel tablePanel" data-pane="board">
          <div className="panelTitle">
            <div><p>Saved Prospects</p><h2>My Draft Board</h2></div>
            <div className="boardControls">
              {boardOrder.length > 0 && <button type="button" className="secondary smallButton" onClick={resetBoardOrder}>Reset order</button>}
              <strong>{draftBoard.length} players</strong>
              <div className="viewToggle">
                <button type="button" className={boardView === 'list' ? 'on' : ''} onClick={() => setBoardView('list')}>List</button>
                <button type="button" className={boardView === 'grid' ? 'on' : ''} onClick={() => setBoardView('grid')}>Cards</button>
              </div>
            </div>
          </div>
          {orderedBoard.length ? (
            boardView === 'list' ? (
              <TableWrap>
                <table className="boardTable">
                  <thead><tr><th>Rank</th><th>Prospect</th><th>Pos</th><th>Pick</th><th>Score</th><th>Median AV</th><th>Best Outcome</th><th></th></tr></thead>
                  <tbody>{orderedBoard.slice(0, 40).map((row, index) => {
                    const best = outcomeOrder.slice().sort((a, b) => (row.projection.odds[b] || 0) - (row.projection.odds[a] || 0))[0]
                    const score = Math.round(row.projection.score)
                    return <>
                      <tr key={row.player.id} className={`classRow-${scoreClass(score)}${row.player.id === selectedSavedId ? ' currentRow' : ''}`}>
                        <td><b className="boardRank">{index + 1}</b></td>
                        <td><b>{row.player.name}</b><small>{row.player.school || 'No school'}</small></td>
                        <td>{row.player.pos}</td>
                        <td>{row.player.pick}</td>
                        <td style={{ color: scoreColor(score), fontWeight: 800 }}>{score}</td>
                        <td>{row.projection.median.toFixed(1)}</td>
                        <td>
                          <OutcomeTag category={best} />
                          {row.earlyFlag && <FlagBadge flag={row.earlyFlag} />}
                          {row.patternAlerts.map((a) => <PatternBadge key={a.type} alert={a} />)}
                        </td>
                        <td><button type="button" className="smallButton" onClick={() => loadSavedProspect(row.player.id)}>Load</button></td>
                      </tr>
                    </>
                  })}</tbody>
                </table>
              </TableWrap>
            ) : (
              <div className="boardGrid">
                {orderedBoard.slice(0, 40).map((row, index) => {
                  const best = outcomeOrder.slice().sort((a, b) => (row.projection.odds[b] || 0) - (row.projection.odds[a] || 0))[0]
                  const isActive = row.player.id === selectedSavedId
                  const isDragging = row.player.id === dragId
                  return (
                    <div
                      key={row.player.id}
                      className={`boardCard ${isActive ? 'boardCardActive' : ''} ${isDragging ? 'boardCardDragging' : ''}`}
                      style={{ '--card-score-color': scoreColor(Math.round(row.projection.score)) } as CSSProperties}
                      draggable
                      onDragStart={() => handleDragStart(row.player.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleDrop(row.player.id)}
                    >
                      <div className="cardHeader">
                        <span className="cardRank">#{index + 1}</span>
                        <span className="cardPos">{row.player.pos}</span>
                      </div>
                      <div className="cardName">{row.player.name}</div>
                      <div className="cardMeta">{row.player.school || 'No school'} · Pk {row.player.pick}</div>
                      <div className="cardFooter">
                        <span className="cardScore">{Math.round(row.projection.score)}</span>
                        <OutcomeTag category={best} />
                        {row.earlyFlag && <FlagBadge flag={row.earlyFlag} />}
                        {row.patternAlerts.map((a) => <PatternBadge key={a.type} alert={a} />)}
                        <button type="button" className="smallButton" onClick={() => loadSavedProspect(row.player.id)}>Load</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          ) : <p className="emptyLine">Save or import prospects to build a ranked board.</p>}
        </section>

        <section className="panel tablePanel" data-pane="board">
          <div className="panelTitle"><div><p>nflverse Baseline</p><h2>Closest Draft/Combine Comps</h2></div></div>
          <TableWrap>
            <table>
              <thead><tr>
                <th>Player</th><th>Yr</th><th>Pos</th><th>Pick</th><th>40</th><th>AV</th><th>Career</th><th>Outcome</th><th>Sim</th>
                {input.pos === 'QB' && <><th className="qbStatCol" title="Year 1 passer rating">Y1 Rtg</th><th className="qbStatCol" title="Year 1 adjusted net yards per attempt">Y1 ANY/A</th></>}
                {input.pos === 'WR' && <><th className="qbStatCol" title="Year 1 receiving yards">Y1 Yds</th><th className="qbStatCol" title="Year 1 receptions">Y1 Rec</th></>}
                {input.pos === 'RB' && <><th className="qbStatCol" title="Year 1 rushing yards">Y1 Yds</th><th className="qbStatCol" title="Year 1 yards per carry">Y1 YPC</th></>}
                <th></th>
              </tr></thead>
              <tbody>{projection.comps.map((c) => {
                const hr = schoolHitRate(c.player.school, prospects)
                const sim = Math.round(c.sim * 100)
                const qbY1 = input.pos === 'QB' ? qbSeasons.find((s) => s.key === clean(c.player.name) && s.season === c.player.year) : undefined
                const wrY1 = input.pos === 'WR' ? wrSeasons.find((s) => s.key === clean(c.player.name) && s.season === c.player.year) : undefined
                const rbY1 = input.pos === 'RB' ? rbSeasons.find((s) => s.key === clean(c.player.name) && s.season === c.player.year) : undefined
                return <tr key={c.player.id} className="compRow">
                  <td><b>{c.player.name}</b><small>{c.player.school}{hr ? <span className="schoolBadge">{Math.round(hr.rate * 100)}%</span> : null}</small></td>
                  <td>{c.player.year}</td>
                  <td>{c.player.pos}</td>
                  <td>{c.player.pick}</td>
                  <td>{c.player.forty?.toFixed(2) || '-'}</td>
                  <td>{c.player.av}</td>
                  <td><Sparkline values={syntheticArcValues(c.player)} /></td>
                  <td><OutcomeTag category={c.player.category} /></td>
                  <td><span className={simClass(sim)}>{sim}</span></td>
                  {input.pos === 'QB' && <>
                    <td className="qbStatCell"><span className={qbRtgClass(qbY1?.rtg ?? null)}>{qbY1 ? (qbY1.rtg?.toFixed(1) ?? '—') : '—'}</span></td>
                    <td className="qbStatCell"><span className={qbAnyaClass(qbY1?.any_a ?? null)}>{qbY1 ? (qbY1.any_a?.toFixed(1) ?? '—') : '—'}</span></td>
                  </>}
                  {input.pos === 'WR' && <>
                    <td className="qbStatCell"><span className={wrYdsClass(wrY1?.yds ?? null)}>{wrY1 ? (wrY1.yds ?? '—') : '—'}</span></td>
                    <td className="qbStatCell"><span className={wrRecClass(wrY1?.rec ?? null)}>{wrY1 ? (wrY1.rec ?? '—') : '—'}</span></td>
                  </>}
                  {input.pos === 'RB' && <>
                    <td className="qbStatCell"><span className={rbRushYdsClass(rbY1?.rush_yds ?? null)}>{rbY1 ? (rbY1.rush_yds ?? '—') : '—'}</span></td>
                    <td className="qbStatCell"><span className={rbYpcClass(rbY1?.rush_ypa ?? null)}>{rbY1 ? (rbY1.rush_ypa?.toFixed(1) ?? '—') : '—'}</span></td>
                  </>}
                  <td><button type="button" className="compCmpBtn smallButton" title="Compare" onClick={() => handleCompare(c.player.name)}>↔</button></td>
                </tr>
              })}</tbody>
            </table>
          </TableWrap>
        </section>

        <section className="panel tablePanel" data-pane="board">
          <div className="panelTitle"><div><p>PFF + NFL Outcomes</p><h2>College Production Comps</h2></div></div>
          {projection.pffComps.length ? <TableWrap>
            <table>
              <thead><tr>
                <th>Player</th><th>Class</th><th>Pos</th><th>PFF</th>
<th>Pick</th><th>AV</th><th>Outcome</th><th>Sim</th>
                {input.pos === 'QB' && <><th className="qbStatCol" title="Year 1 passer rating">Y1 Rtg</th><th className="qbStatCol" title="Year 1 adjusted net yards per attempt">Y1 ANY/A</th></>}
                {input.pos === 'WR' && <><th className="qbStatCol" title="Year 1 receiving yards">Y1 Yds</th><th className="qbStatCol" title="Year 1 receptions">Y1 Rec</th></>}
                {input.pos === 'RB' && <><th className="qbStatCol" title="Year 1 rushing yards">Y1 Yds</th><th className="qbStatCol" title="Year 1 yards per carry">Y1 YPC</th></>}
                <th></th>
              </tr></thead>
              <tbody>{projection.pffComps.map((c) => {
                const sim = Math.round(c.sim * 100)
                const qbY1 = input.pos === 'QB' ? qbSeasons.find((s) => s.key === clean(c.profile.name) && s.season === c.profile.draftSeason) : undefined
                const wrY1 = input.pos === 'WR' ? wrSeasons.find((s) => s.key === clean(c.profile.name) && s.season === c.profile.draftSeason) : undefined
                const rbY1 = input.pos === 'RB' ? rbSeasons.find((s) => s.key === clean(c.profile.name) && s.season === c.profile.draftSeason) : undefined
                return <tr key={c.profile.id} className="compRow">
                  <td><b>{c.profile.name}</b><small>{c.profile.college}</small></td>
                  <td>{c.profile.draftSeason}</td>
                  <td>{c.profile.position}</td>
                  <td>{c.profile.pff.composite.toFixed(1)}</td>
                  <td>{c.profile.nfl?.draftPick ?? '-'}</td>
                  <td>{c.profile.nfl?.av.toFixed(1) ?? '-'}</td>
                  <td>{c.profile.nfl ? <OutcomeTag category={c.profile.nfl.category} /> : '-'}</td>
                  <td><span className={simClass(sim)}>{sim}</span></td>
                  {input.pos === 'QB' && <>
                    <td className="qbStatCell"><span className={qbRtgClass(qbY1?.rtg ?? null)}>{qbY1 ? (qbY1.rtg?.toFixed(1) ?? '—') : '—'}</span></td>
                    <td className="qbStatCell"><span className={qbAnyaClass(qbY1?.any_a ?? null)}>{qbY1 ? (qbY1.any_a?.toFixed(1) ?? '—') : '—'}</span></td>
                  </>}
                  {input.pos === 'WR' && <>
                    <td className="qbStatCell"><span className={wrYdsClass(wrY1?.yds ?? null)}>{wrY1 ? (wrY1.yds ?? '—') : '—'}</span></td>
                    <td className="qbStatCell"><span className={wrRecClass(wrY1?.rec ?? null)}>{wrY1 ? (wrY1.rec ?? '—') : '—'}</span></td>
                  </>}
                  {input.pos === 'RB' && <>
                    <td className="qbStatCell"><span className={rbRushYdsClass(rbY1?.rush_yds ?? null)}>{rbY1 ? (rbY1.rush_yds ?? '—') : '—'}</span></td>
                    <td className="qbStatCell"><span className={rbYpcClass(rbY1?.rush_ypa ?? null)}>{rbY1 ? (rbY1.rush_ypa?.toFixed(1) ?? '—') : '—'}</span></td>
                  </>}
                  <td><button type="button" className="compCmpBtn smallButton" title="Compare" onClick={() => handleCompare(c.profile.name)}>↔</button></td>
                </tr>
              })}</tbody>
            </table>
          </TableWrap> : <p className="emptyLine">Load a PFF profile or enter college PFF scores to activate production comps.</p>}
        </section>
      </section>
    </div>}

    <nav className="bottomNav" aria-label="Navigation">
      <button type="button" className={page === 'workbench' ? 'on' : ''} onClick={() => setPage('workbench')}>
        <span className="bottomNavIcon">✎</span>Scout
      </button>
      <button type="button" className={page === 'class' ? 'on' : ''} onClick={() => setPage('class')}>
        <span className="bottomNavIcon">≡</span>Class
      </button>
      <button type="button" className={page === 'players' ? 'on' : ''} onClick={() => setPage('players')}>
        <span className="bottomNavIcon">◉</span>Players
      </button>
      <button type="button" className={page === 'compare' ? 'on' : ''} onClick={() => setPage('compare')}>
        <span className="bottomNavIcon">⇌</span>Compare
      </button>
      <button type="button" className={page === 'rankings' ? 'on' : ''} onClick={() => setPage('rankings')}>
        <span className="bottomNavIcon">★</span>Rankings
      </button>
      <button type="button" className={page === 'trade' ? 'on' : ''} onClick={() => setPage('trade')}>
        <span className="bottomNavIcon">⇋</span>Trade
      </button>
      <button type="button" className={page === 'guide' ? 'on' : ''} onClick={() => setPage('guide')}>
        <span className="bottomNavIcon">?</span>Guide
      </button>
      <button type="button" className="bottomNavTheme" onClick={toggleTheme} aria-label="Toggle light/dark mode">
        <span className="bottomNavIcon">{theme === 'dark' ? '☀' : '☾'}</span>{theme === 'dark' ? 'Day' : 'Night'}
      </button>
    </nav>

    {modalPlayer && (
      <PlayerModal
        player={modalPlayer}
        history={prospects}
        pffProfiles={pffProfiles}
        careerStats={careerStats}
        qbPffSeasons={qbPffSeasons}
        wrPffSeasons={wrPffSeasons}
        onClose={() => setModalPlayer(null)}
        onCompare={handleCompare}
      />
    )}
  </main>
}

function Text({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label className="field"><span>{label}</span><input value={value} onChange={(e) => onChange(e.target.value)} /></label>
}

function Num({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return <label className="field"><span>{label}</span><input type="number" min={min} max={max} step={step} value={value} onChange={(e) => {
    const parsed = Number(e.target.value)
    if (Number.isFinite(parsed)) onChange(parsed)
  }} /></label>
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return <label className="slider"><span>{label}</span><input type="range" min={1} max={99} value={Math.round(value)} onChange={(e) => onChange(Number(e.target.value))} /><b>{Math.round(value)}</b></label>
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><b>{value}</b></div>
}

function Signal({ label, value }: { label: string; value: number }) {
  return <div className="signal"><span>{label}</span><b>{Math.round(value)}</b><i><em style={{ width: `${clamp(value, 0, 100)}%` }} /></i></div>
}

const barColors = ['barBust', 'barReserve', 'barRole', 'barSolid', 'barHigh', 'barStar']
function Bar({ label, value, colorIdx }: { label: string; value: number; colorIdx?: number }) {
  return <div className={`bar ${colorIdx != null ? barColors[colorIdx] : ''}`}><span>{label}</span><i><b style={{ width: `${value * 100}%` }} /></i><strong>{(value * 100).toFixed(1)}%</strong></div>
}

function OutcomeTag({ category }: { category: Category }) {
  return <span className={`tag tag${outcomeOrder.indexOf(category)}`}>{outcomeAVRange[category]}</span>
}

function FlagBadge({ flag, className = '' }: { flag: HistoricalOutcomeFlag; className?: string }) {
  const icon = flag.type === 'bust' ? '⚠' : '↑'
  return (
    <span className={`flagBadge flagBadge-${flag.type}${className ? ' ' + className : ''}`}>
      {icon} {flag.label}
      <span className="flagTip">{flag.tooltip}</span>
    </span>
  )
}

function PatternBadge({ alert }: { alert: PatternAlert }) {
  const isBust = alert.type === 'bust-risk'
  const lines = [
    isBust ? '⚠ Miss-pattern alert' : '↑ Hidden-gem signal',
    alert.description,
    '',
    'Matched comps:',
    ...alert.matches.map((m) => `• ${m.name} (${m.year}) #${m.pick >= 260 ? 'UDFA' : m.pick} · AV ${m.av} · ${m.reason}`),
  ]
  return (
    <span className={`flagBadge flagBadge-${isBust ? 'bust' : 'gem'}`}>
      {isBust ? '⚠' : '↑'} {alert.label}
      <span className="flagTip">{lines.join('\n')}</span>
    </span>
  )
}

function TableWrap({ children }: { children: ReactNode }) {
  return <div className="tableWrap">{children}</div>
}

function CompareView({ pool, history, pffProfiles, y1Data, careerStats, initialQuery = '', rasLookup = null, qbPffSeasons, wrPffSeasons }: { pool: Historical[]; history: Historical[]; pffProfiles: PffProfile[]; y1Data?: Y1Data; careerStats?: CareerStatMap; initialQuery?: string; rasLookup?: AppRasLookup | null; qbPffSeasons: QbPffSeason[]; wrPffSeasons: WrPffSeason[]; }) {
  const [q1, setQ1] = useState(initialQuery)
  const [q2, setQ2] = useState('')
  const [p1, setP1] = useState<Historical | null>(null)
  const [p2, setP2] = useState<Historical | null>(null)
  const [msg, setMsg] = useState('')

  const opts = useMemo(() =>
    pool.slice().sort((a, b) => b.year - a.year || a.pick - b.pick)
      .map((p) => ({ id: p.id, label: lookupLabel(p) })),
    [pool])

  function resolve(query: string): Historical | null {
    const normalized = clean(query)
    if (!normalized) return null
    const opt = opts.find((o) => o.label === query) ?? opts.find((o) => clean(o.label).includes(normalized))
    return pool.find((p) => p.id === opt?.id) ?? null
  }

  function load() {
    const a = resolve(q1)
    const b = resolve(q2)
    if (!a && !b) { setMsg('Type at least one player name.'); return }
    if (!a) { setMsg(`No match for "${q1}".`); return }
    if (!b) { setMsg(`No match for "${q2}".`); return }
    if (a.id === b.id) { setMsg('Select two different players.'); return }
    if (a.pos !== b.pos) { setMsg(`Position mismatch: ${a.pos} vs ${b.pos}. Select two players at the same position.`); return }
    setP1(a); setP2(b); setMsg('')
  }

  const pff1 = useMemo(() => p1 ? pffProfiles.find((pf) => samePlayerSeason(pf, p1.name, p1.year, p1.pos)) : undefined, [p1, pffProfiles])
  const pff2 = useMemo(() => p2 ? pffProfiles.find((pf) => samePlayerSeason(pf, p2.name, p2.year, p2.pos)) : undefined, [p2, pffProfiles])
  const ras1 = useMemo(() => p1 && rasLookup ? getAppRas(p1.name, p1.year, p1.pos, rasLookup) : null, [p1, rasLookup])
  const ras2 = useMemo(() => p2 && rasLookup ? getAppRas(p2.name, p2.year, p2.pos, rasLookup) : null, [p2, rasLookup])
  const qbContext1 = useMemo(() => p1?.pos === 'QB' ? getQbPffContext(p1.year, p1.name, qbPffSeasons) : null, [p1, qbPffSeasons])
  const qbContext2 = useMemo(() => p2?.pos === 'QB' ? getQbPffContext(p2.year, p2.name, qbPffSeasons) : null, [p2, qbPffSeasons])
  const wrContext1 = useMemo(() => p1?.pos === 'WR' ? getWrPffContext(p1.year, p1.name, wrPffSeasons) : null, [p1, wrPffSeasons])
  const wrContext2 = useMemo(() => p2?.pos === 'WR' ? getWrPffContext(p2.year, p2.name, wrPffSeasons) : null, [p2, wrPffSeasons])

  const proj1 = useMemo(() => {
    if (!p1) return null
    const base = prospectFromHistorical(p1, pff1, ras1)
    const withContext = qbContext1?.trajectory
      ? { ...base, qbTrajectory: qbContext1.trajectory }
      : wrContext1?.trajectory
        ? { ...base, wrTrajectory: wrContext1.trajectory }
        : base
    return project(withContext, history, pffProfiles, p1.id, y1Data, careerStats, undefined, qbContext1?.trajectory?.gradeDelta ?? null)
  }, [p1, pff1, ras1, history, pffProfiles, y1Data, careerStats, qbContext1, wrContext1])

  const proj2 = useMemo(() => {
    if (!p2) return null
    const base = prospectFromHistorical(p2, pff2, ras2)
    const withContext = qbContext2?.trajectory
      ? { ...base, qbTrajectory: qbContext2.trajectory }
      : wrContext2?.trajectory
        ? { ...base, wrTrajectory: wrContext2.trajectory }
        : base
    return project(withContext, history, pffProfiles, p2.id, y1Data, careerStats, undefined, qbContext2?.trajectory?.gradeDelta ?? null)
  }, [p2, pff2, ras2, history, pffProfiles, y1Data, careerStats, qbContext2, wrContext2])

  return <section className="panel tablePanel classPanel">
    <div className="panelTitle">
      <div><p>Side-by-side</p><h2>Player Comparison</h2></div>
    </div>
    <div className="compareSearch">
      <div className="compareSlot">
        <label className="field wide"><span>Player 1</span>
          <input list="cmp-1" value={q1} onChange={(e) => setQ1(e.target.value)} placeholder="Search name, school, year…" />
        </label>
        <datalist id="cmp-1">{opts.map((o) => <option key={o.id} value={o.label} />)}</datalist>
      </div>
      <div className="compareSlot">
        <label className="field wide"><span>Player 2</span>
          <input list="cmp-2" value={q2} onChange={(e) => setQ2(e.target.value)} placeholder="Search name, school, year…" />
        </label>
        <datalist id="cmp-2">{opts.map((o) => <option key={o.id} value={o.label} />)}</datalist>
      </div>
      <button type="button" onClick={load}>Compare</button>
    </div>
    {msg ? <p className="status warn">{msg}</p> : null}
    {p1 && p2 && proj1 && proj2 && <>
      <div className="compareVisual">
        <RadarChart a={proj1.signals} b={proj2.signals} aLabel={p1.name} bLabel={p2.name} />
      </div>
      <CompareTable p1={p1} p2={p2} proj1={proj1} proj2={proj2} pff1={pff1} pff2={pff2} ras1={ras1} ras2={ras2} />
    </>}
  </section>
}

function CompareTable({ p1, p2, proj1, proj2, pff1, pff2, ras1 = null, ras2 = null }: {
  p1: Historical; p2: Historical
  proj1: ReturnType<typeof project>; proj2: ReturnType<typeof project>
  pff1: PffProfile | undefined; pff2: PffProfile | undefined
  ras1?: AppRasRecord | null; ras2?: AppRasRecord | null
}) {
  type Dir = 'h' | 'l' | 'n'
  type CR = { label: string; v1: string; v2: string; n1: number | null; n2: number | null; dir: Dir }

  function row(label: string, raw1: string | number | null, raw2: string | number | null, dir: Dir = 'h', fmt?: (v: number) => string): CR {
    const n1 = typeof raw1 === 'number' ? raw1 : null
    const n2 = typeof raw2 === 'number' ? raw2 : null
    const fmt1 = raw1 == null ? '—' : typeof raw1 === 'number' ? (fmt ? fmt(raw1) : String(raw1)) : raw1
    const fmt2 = raw2 == null ? '—' : typeof raw2 === 'number' ? (fmt ? fmt(raw2) : String(raw2)) : raw2
    return { label, v1: fmt1, v2: fmt2, n1, n2, dir }
  }

  const sections: { title: string; rows: CR[] }[] = [
    {
      title: 'Profile',
      rows: [
        row('School', p1.school || null, p2.school || null, 'n'),
        row('Position', p1.pos, p2.pos, 'n'),
        row('Year', p1.year, p2.year, 'n'),
        row('Pick', p1.pick >= 260 ? null : p1.pick, p2.pick >= 260 ? null : p2.pick, 'l'),
        row('Age', p1.age, p2.age, 'l', (v) => v.toFixed(1)),
      ],
    },
    {
      title: 'Measurables',
      rows: [
        row('Height (in.)', p1.height, p2.height, 'h'),
        row('Weight (lb)', p1.weight, p2.weight, 'n'),
        row('40-yard dash', p1.forty, p2.forty, 'l', (v) => v.toFixed(2)),
        row('Vertical (in.)', p1.vertical, p2.vertical, 'h', (v) => v.toFixed(1)),
        row('Broad jump (in.)', p1.broad, p2.broad, 'h'),
        row('3-cone drill', p1.cone, p2.cone, 'l', (v) => v.toFixed(2)),
        row('Shuttle', p1.shuttle, p2.shuttle, 'l', (v) => v.toFixed(2)),
        row('Official RAS', ras1?.ras ?? null, ras2?.ras ?? null, 'h', (v) => v.toFixed(2)),
        row('Alltime RAS', ras1?.alltimeRas ?? null, ras2?.alltimeRas ?? null, 'h', (v) => v.toFixed(2)),
      ],
    },
    ...((pff1 || pff2) ? [{
      title: 'PFF College Profile',
      rows: [
        row('Composite', pff1?.pff.composite ?? null, pff2?.pff.composite ?? null, 'h' as Dir, (v) => v.toFixed(1)),
        row('Grade', pff1?.pff.grade ?? null, pff2?.pff.grade ?? null, 'h' as Dir, (v) => v.toFixed(1)),
        row('Production', pff1?.pff.production ?? null, pff2?.pff.production ?? null, 'h' as Dir, (v) => v.toFixed(1)),
        row('Efficiency', pff1?.pff.efficiency ?? null, pff2?.pff.efficiency ?? null, 'h' as Dir, (v) => v.toFixed(1)),
        row('Clean play', pff1?.pff.clean ?? null, pff2?.pff.clean ?? null, 'h' as Dir, (v) => v.toFixed(1)),
      ],
    }] : []),
    {
      title: 'Projection',
      rows: [
        row('Score', Math.round(proj1.score), Math.round(proj2.score), 'h'),
        row('Grade', proj1.grade, proj2.grade, 'n'),
        row('Expected AV', proj1.expectedAv, proj2.expectedAv, 'h', (v) => v.toFixed(1)),
        row('Floor AV', proj1.floor, proj2.floor, 'h', (v) => v.toFixed(1)),
        row('Median AV', proj1.median, proj2.median, 'h', (v) => v.toFixed(1)),
        row('Ceiling AV', proj1.ceiling, proj2.ceiling, 'h', (v) => v.toFixed(1)),
      ],
    },
    ...((p1.games > 0 || p2.games > 0) ? [{
      title: 'Career Outcomes',
      rows: [
        row('Games played', p1.games, p2.games, 'h' as Dir),
        row('Starts', p1.starts, p2.starts, 'h' as Dir),
        row('Weighted AV', p1.av, p2.av, 'h' as Dir),
        row('Pro Bowls', p1.proBowls, p2.proBowls, 'h' as Dir),
        row('All-Pros', p1.allPros, p2.allPros, 'h' as Dir),
        row('Outcome', p1.category, p2.category, 'n' as Dir),
      ],
    }] : []),
  ]

  const visibleSections = sections.map((s) => ({
    ...s,
    rows: s.rows.filter((r) => r.v1 !== '—' || r.v2 !== '—'),
  })).filter((s) => s.rows.length > 0)

  return <TableWrap>
    <table className="compareTable">
      <thead>
        <tr>
          <th className="compareMetricCol"></th>
          <th className="comparePlayerCol"><b>{p1.name}</b><small>{p1.school || 'No school'} · {p1.year} {p1.pos}</small></th>
          <th className="comparePlayerCol"><b>{p2.name}</b><small>{p2.school || 'No school'} · {p2.year} {p2.pos}</small></th>
        </tr>
      </thead>
      <tbody>
        {visibleSections.flatMap((section) => [
          <tr key={section.title} className="compareSectionRow"><td colSpan={3}>{section.title}</td></tr>,
          ...section.rows.map((r) => {
            const win1 = r.n1 != null && r.n2 != null && r.dir !== 'n' && ((r.dir === 'h' && r.n1 > r.n2) || (r.dir === 'l' && r.n1 < r.n2))
            const win2 = r.n1 != null && r.n2 != null && r.dir !== 'n' && ((r.dir === 'h' && r.n2 > r.n1) || (r.dir === 'l' && r.n2 < r.n1))
            return <tr key={r.label}>
              <td className="compareMetricCol">{r.label}</td>
              <td className={win1 ? 'compareWin' : ''}>{r.v1}</td>
              <td className={win2 ? 'compareWin' : ''}>{r.v2}</td>
            </tr>
          }),
        ])}
      </tbody>
    </table>
  </TableWrap>
}

function RadarChart({ a, b, aLabel, bLabel }: {
  a: { draft: number; athletic: number; size: number; strength: number; age: number; pff: number }
  b: { draft: number; athletic: number; size: number; strength: number; age: number; pff: number }
  aLabel: string; bLabel: string
}) {
  const axes: { key: keyof typeof a; label: string }[] = [
    { key: 'draft', label: 'Draft' },
    { key: 'athletic', label: 'Athletic' },
    { key: 'size', label: 'Size' },
    { key: 'strength', label: 'Strength' },
    { key: 'age', label: 'Age' },
    { key: 'pff', label: 'PFF' },
  ]
  const cx = 130, cy = 130, r = 90
  function pt(i: number, value: number): [number, number] {
    const angle = (i / axes.length) * 2 * Math.PI - Math.PI / 2
    const ratio = Math.min(1, Math.max(0, value / 100))
    return [cx + r * ratio * Math.cos(angle), cy + r * ratio * Math.sin(angle)]
  }
  function poly(sig: typeof a) {
    return axes.map((ax, i) => pt(i, sig[ax.key]).join(',')).join(' ')
  }
  return <div className="radarWrap">
    <svg viewBox="0 0 260 260" className="radarChart" aria-label="Signal comparison chart">
      {[25, 50, 75, 100].map((level) => <polygon key={level}
        points={axes.map((_, i) => pt(i, level).join(',')).join(' ')}
        fill="none" stroke="rgba(15,23,42,0.08)" strokeWidth="1" />)}
      {axes.map((ax, i) => {
        const [x, y] = pt(i, 100)
        return <line key={ax.key} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(15,23,42,0.1)" strokeWidth="1" />
      })}
      <polygon points={poly(a)} fill="rgba(59,130,246,0.18)" stroke="#3b82f6" strokeWidth="2.5" strokeLinejoin="round" />
      <polygon points={poly(b)} fill="rgba(245,158,11,0.18)" stroke="#f59e0b" strokeWidth="2.5" strokeLinejoin="round" />
      {axes.map((ax, i) => {
        const [x, y] = pt(i, 118)
        return <text key={ax.key} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="radarLabel">{ax.label}</text>
      })}
    </svg>
    <div className="compareLegend">
      <span className="legendDot" style={{ background: '#3b82f6' }} /><span className="legendName">{aLabel}</span>
      <span className="legendDot" style={{ background: '#f59e0b' }} /><span className="legendName">{bLabel}</span>
    </div>
  </div>
}

function PlayerBrowser({ pool, history, histFlagMap, onOpenModal, onCompare }: { pool: Historical[]; history: Historical[]; histFlagMap: Map<string, HistoricalOutcomeFlag>; onOpenModal: (p: Historical) => void; onCompare: (name: string) => void }) {
  const [mode, setMode] = useState<'browse' | 'rankings'>('browse')
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState('All')
  const [yearFrom, setYearFrom] = useState(2000)
  const [yearTo, setYearTo] = useState(2030)
  const [outcome, setOutcome] = useState('All')
  const [showMoreFilters, setShowMoreFilters] = useState(false)
  const [sortKey, setSortKey] = useState<BrowserSortKey>('av')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const years = useMemo(() => {
    const set = new Set<number>()
    for (const p of pool) set.add(p.year)
    return Array.from(set).sort((a, b) => a - b)
  }, [pool])

  const normalizedQuery = query.trim() ? clean(query) : ''

  const filtered = useMemo(() => pool.filter((p) => {
    if (pos !== 'All' && p.pos !== pos) return false
    if (p.year < yearFrom || p.year > yearTo) return false
    if (outcome !== 'All' && p.category !== outcome) return false
    if (normalizedQuery && !clean(p.name).includes(normalizedQuery) && !clean(p.school).includes(normalizedQuery)) return false
    return true
  }), [pool, pos, yearFrom, yearTo, outcome, normalizedQuery])

  const sorted = useMemo(() => {
    const factor = sortDir === 'asc' ? 1 : -1
    return filtered.slice().sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'av': cmp = (a.av || 0) - (b.av || 0); break
        case 'games': cmp = (a.games || 0) - (b.games || 0); break
        case 'starts': cmp = (a.starts || 0) - (b.starts || 0); break
        case 'pb': cmp = (a.proBowls || 0) - (b.proBowls || 0); break
        case 'ap': cmp = (a.allPros || 0) - (b.allPros || 0); break
        case 'pick': cmp = (a.pick || 999) - (b.pick || 999); break
        case 'name': cmp = a.name.localeCompare(b.name); break
        case 'outcome': cmp = outcomeOrder.indexOf(a.category) - outcomeOrder.indexOf(b.category); break
        case 'year': cmp = a.year - b.year; break
        case 'forty': cmp = (a.forty ?? 9.99) - (b.forty ?? 9.99); break
      }
      if (cmp !== 0) return cmp * factor
      return (a.pick - b.pick) || a.name.localeCompare(b.name)
    })
  }, [filtered, sortKey, sortDir])

  function toggleSort(key: BrowserSortKey) {
    if (key === sortKey) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(key === 'pick' || key === 'name' || key === 'forty' ? 'asc' : key === 'year' ? 'desc' : 'desc')
    }
  }

  const display = sorted.slice(0, 500)

  return <section className="panel tablePanel classPanel">
    <div className="panelTitle">
      <div><p>Database</p><h2>Player Browser</h2></div>
      <div className="modeToggle">
        <button type="button" className={mode === 'browse' ? 'on' : ''} onClick={() => setMode('browse')}>Browse</button>
        <button type="button" className={mode === 'rankings' ? 'on' : ''} onClick={() => setMode('rankings')}>Rankings</button>
      </div>
    </div>
    {mode === 'rankings' ? <RankingsView history={history} onOpenModal={onOpenModal} /> : <>
      <div className="browserControls">
        <label className="field browserSearch"><span>Search</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or school…" autoComplete="off" /></label>
        <label className="field browserPosField"><span>Position</span>
          <select value={pos} onChange={(e) => setPos(e.target.value)}>
            {positionFilters.map((p) => <option key={p} value={p}>{p === 'All' ? 'All positions' : p}</option>)}
          </select>
        </label>
        <button
          type="button"
          className={`secondary browserFilterToggle${showMoreFilters ? ' on' : ''}${(yearFrom !== 2000 || yearTo !== 2030 || outcome !== 'All') ? ' browserFilterToggle-active' : ''}`}
          onClick={() => setShowMoreFilters((v) => !v)}
        >
          Filters{(yearFrom !== 2000 || yearTo !== 2030 || outcome !== 'All') ? ' •' : ''}
        </button>
        <div className={`browserAdvancedFilters${showMoreFilters ? ' open' : ''}`}>
          <label className="field"><span>From</span>
            <select value={yearFrom} onChange={(e) => setYearFrom(Number(e.target.value))}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="field"><span>To</span>
            <select value={yearTo} onChange={(e) => setYearTo(Number(e.target.value))}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="field"><span>Outcome</span>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="All">All outcomes</option>
              {outcomeOrder.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </label>
        </div>
      </div>
      {display.length ? <>
        <TableWrap>
          <table className="classTable browserTable">
            <thead>
              <tr>
                <BrowserHeader label="Player" sortKey="name" active={sortKey} dir={sortDir} onSort={toggleSort} />
                <th>School</th>
                <th>Pos</th>
                <BrowserHeader label="Year" sortKey="year" active={sortKey} dir={sortDir} onSort={toggleSort} />
                <BrowserHeader label="Pick" sortKey="pick" active={sortKey} dir={sortDir} onSort={toggleSort} />
                <BrowserHeader label="40yd" sortKey="forty" active={sortKey} dir={sortDir} onSort={toggleSort} />
                <BrowserHeader label="G" sortKey="games" active={sortKey} dir={sortDir} onSort={toggleSort} />
                <BrowserHeader label="St" sortKey="starts" active={sortKey} dir={sortDir} onSort={toggleSort} />
                <BrowserHeader label="AV" sortKey="av" active={sortKey} dir={sortDir} onSort={toggleSort} />
                <BrowserHeader label="PB" sortKey="pb" active={sortKey} dir={sortDir} onSort={toggleSort} />
                <BrowserHeader label="AP" sortKey="ap" active={sortKey} dir={sortDir} onSort={toggleSort} />
                <BrowserHeader label="Outcome" sortKey="outcome" active={sortKey} dir={sortDir} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {display.map((player) => {
                const showEarlySample = player.year > matureOutcomeCutoff
                const outcomeFlag = histFlagMap.get(player.id) ?? null
                return <tr key={player.id} className="clickableRow" onClick={() => onOpenModal(player)}>
                  <td><b>{player.name}</b></td>
                  <td><small>{player.school || '—'}</small></td>
                  <td>{player.pos}</td>
                  <td>{player.year}</td>
                  <td>{player.pick >= 260 ? 'UDFA' : player.pick}</td>
                  <td>{player.forty?.toFixed(2) ?? '—'}</td>
                  <td>{player.games || 0}</td>
                  <td>{player.starts || 0}</td>
                  <td>{player.av || 0}</td>
                  <td>{player.proBowls || 0}</td>
                  <td>{player.allPros || 0}</td>
                  <td>
                    {showEarlySample ? <span className="sampleTag">Early</span> : <OutcomeTag category={player.category} />}
                    {outcomeFlag && <FlagBadge flag={outcomeFlag} />}
                  </td>
                </tr>
              })}
            </tbody>
          </table>
        </TableWrap>
        {sorted.length > 500 ? <p className="hint">Showing 500 of {sorted.length.toLocaleString()}. Narrow filters to see more.</p> : null}
      </> : <p className="emptyLine">No players match those filters.</p>}
    </>}
  </section>
}

function RankingsView({ history, onOpenModal, onCompare }: { history: Historical[]; onOpenModal: (p: Historical) => void; onCompare?: (name: string) => void }) {
  const [rankPos, setRankPos] = useState('QB')
  const [scopeYear, setScopeYear] = useState<number | 'all'>('all')
  const [selected, setSelected] = useState<Historical | null>(null)

  const maturePool = useMemo(() => history.filter((p) => p.year <= matureOutcomeCutoff), [history])

  const allYears = useMemo(() => {
    const set = new Set<number>()
    for (const p of maturePool) set.add(p.year)
    return Array.from(set).sort((a, b) => b - a)
  }, [maturePool])

  const rankList = useMemo(() => {
    const base = maturePool.filter((p) => p.pos === rankPos)
    const scoped = scopeYear === 'all' ? base : base.filter((p) => p.year === scopeYear)
    return scoped.slice().sort((a, b) => (b.av || 0) - (a.av || 0))
  }, [maturePool, rankPos, scopeYear])

  const rankCard = useMemo(() => {
    if (!selected) return null
    const allByPos = maturePool.filter((p) => p.pos === selected.pos).sort((a, b) => (b.av || 0) - (a.av || 0))
    const allOverall = maturePool.slice().sort((a, b) => (b.av || 0) - (a.av || 0))
    const classAll = maturePool.filter((p) => p.year === selected.year).sort((a, b) => (b.av || 0) - (a.av || 0))
    const classPos = maturePool.filter((p) => p.year === selected.year && p.pos === selected.pos).sort((a, b) => (b.av || 0) - (a.av || 0))

    const rankInList = (list: Historical[], id: string) => list.findIndex((p) => p.id === id) + 1

    return {
      classRank: rankInList(classAll, selected.id),
      classTotal: classAll.length,
      classPosRank: rankInList(classPos, selected.id),
      classPosTotal: classPos.length,
      allTimePosRank: rankInList(allByPos, selected.id),
      allTimePosTotal: allByPos.length,
      allTimeRank: rankInList(allOverall, selected.id),
      allTimeTotal: allOverall.length,
    }
  }, [selected, maturePool])

  const display = rankList.slice(0, 100)
  const isEarly = (p: Historical) => p.year > matureOutcomeCutoff

  return <div className="rankingsView">
    <div className="rankControls">
      <div className="posChips">
        {positions.map((p) => (
          <button key={p} type="button" className={`posChip ${rankPos === p ? 'on' : ''}`} onClick={() => { setRankPos(p); setSelected(null) }}>{p}</button>
        ))}
      </div>
      <label className="field rankYearField">
        <span>Class</span>
        <select value={scopeYear} onChange={(e) => { setScopeYear(e.target.value === 'all' ? 'all' : Number(e.target.value)); setSelected(null) }}>
          <option value="all">All-time</option>
          {allYears.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>
    </div>

    {selected && rankCard ? <div className="rankCard">
      <div className="rankCardHeader">
        <div>
          <div className="rankCardName">{selected.name}</div>
          <div className="rankCardMeta">{selected.pos} · {selected.school || 'Unknown'} · {selected.year} · Pick {selected.pick >= 260 ? 'UDFA' : selected.pick}</div>
        </div>
        <OutcomeTag category={selected.category} />
      </div>
      <div className="rankCardAv">AV {selected.av} · {selected.games}G · {selected.starts}St{selected.proBowls ? ` · ${selected.proBowls}×PB` : ''}{selected.allPros ? ` · ${selected.allPros}×AP` : ''}</div>
      {syntheticArcValues(selected).length >= 2 && <div className="rankCardSparkRow"><span className="rankCardSparkLabel">Career arc</span><Sparkline values={syntheticArcValues(selected)} /></div>}
      <div className="rankStats">
        <RankStat label={`${selected.year} class rank`} rank={rankCard.classRank} total={rankCard.classTotal} />
        <RankStat label={`${selected.year} ${selected.pos} rank`} rank={rankCard.classPosRank} total={rankCard.classPosTotal} />
        <RankStat label={`All-time ${selected.pos} rank`} rank={rankCard.allTimePosRank} total={rankCard.allTimePosTotal} />
        <RankStat label="All-time overall rank" rank={rankCard.allTimeRank} total={rankCard.allTimeTotal} />
      </div>
      <div className="rankCardActions">
        <button type="button" className="secondary smallButton" onClick={() => onOpenModal(selected)}>Full Profile</button>
        {onCompare && <button type="button" className="secondary smallButton" onClick={() => onCompare(selected.name)}>↔ Compare</button>}
      </div>
    </div> : null}

    <div className="rankListHeader">
      <span className="rankListCol rk">#</span>
      <span className="rankListCol name">Player</span>
      <span className="rankListCol yr">Year</span>
      <span className="rankListCol pk">Pick</span>
      <span className="rankListCol av">AV</span>
      <span className="rankListCol out">Outcome</span>
      <span className="rankListCol act"></span>
    </div>
    {display.length ? display.map((p, i) => {
      const early = isEarly(p)
      return <button key={p.id} type="button" className={`rankRow${selected?.id === p.id ? ' selected' : ''}`} onClick={() => setSelected((prev) => prev?.id === p.id ? null : p)}>
        <span className="rankListCol rk">{i + 1}</span>
        <span className="rankListCol name"><b>{p.name}</b><small>{p.school}</small></span>
        <span className="rankListCol yr">{p.year}</span>
        <span className="rankListCol pk">{p.pick >= 260 ? 'UDFA' : p.pick}</span>
        <span className="rankListCol av">{p.av || 0}</span>
        <span className="rankListCol out">{early ? <span className="sampleTag">Early</span> : <OutcomeTag category={p.category} />}</span>
        <span className="rankListCol act"><button type="button" className="smallButton" onClick={(e) => { e.stopPropagation(); onOpenModal(p) }}>Profile</button></span>
      </button>
    }) : <p className="emptyLine">No mature data for {rankPos}{scopeYear !== 'all' ? ` in ${scopeYear}` : ''}.</p>}
    {rankList.length > 100 ? <p className="hint">Showing top 100 of {rankList.length.toLocaleString()}.</p> : null}
  </div>
}

function RankStat({ label, rank, total }: { label: string; rank: number; total: number }) {
  const pct = total > 0 ? Math.round(((total - rank) / total) * 100) : 0
  return <div className="rankStat">
    <div className="rankStatNum">#{rank}</div>
    <div className="rankStatLabel">{label}</div>
    <div className="rankStatOf">of {total} · top {pct}%</div>
  </div>
}

function PlayerModal({ player, history, pffProfiles, careerStats, qbPffSeasons, wrPffSeasons, onClose, onCompare }: {
  player: Historical
  history: Historical[]
  pffProfiles: PffProfile[]
  careerStats: CareerStatMap
  qbPffSeasons: QbPffSeason[]
  wrPffSeasons: WrPffSeason[]
  onClose: () => void
  onCompare: (name: string) => void
}) {
  const pffMatch = pffProfiles.find((pf) => samePlayerSeason(pf, player.name, player.year, player.pos))
  const qbPffContext = player.pos === 'QB' ? getQbPffContext(player.year, player.name, qbPffSeasons) : null
  const wrPffContext = player.pos === 'WR' ? getWrPffContext(player.year, player.name, wrPffSeasons) : null
  const outcomeFlag = classifyHistoricalOutcome(player, pffMatch ?? null)
  const pct = posPercentile(player, history)
  const arcValues = syntheticArcValues(player)
  const isEarly = player.year > matureOutcomeCutoff
  const maturePool = history.filter((p) => p.year <= matureOutcomeCutoff)
  const classAll = maturePool.filter((p) => p.year === player.year).sort((a, b) => (b.av || 0) - (a.av || 0))
  const classPos = maturePool.filter((p) => p.year === player.year && p.pos === player.pos).sort((a, b) => (b.av || 0) - (a.av || 0))
  const allByPos = maturePool.filter((p) => p.pos === player.pos).sort((a, b) => (b.av || 0) - (a.av || 0))
  const allOverall = maturePool.slice().sort((a, b) => (b.av || 0) - (a.av || 0))
  const findRank = (list: Historical[]) => { const r = list.findIndex((p) => p.id === player.id); return r >= 0 ? r + 1 : 0 }
  const crAll = findRank(classAll), crPos = findRank(classPos), atPos = findRank(allByPos), atAll = findRank(allOverall)
  const playerKey = clean(player.name)
  const seasons = careerStats[playerKey] ?? []
  const rookieSeason = player.year
  const careerSeasons = seasons.filter((s) => s.season >= rookieSeason).slice(0, 10)
  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalBox" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div>
            <div className="modalName">{player.name}</div>
            <div className="modalMeta">{player.pos} · {player.school || 'Unknown'} · {player.year} · Pick {player.pick >= 260 ? 'UDFA' : player.pick}{player.age ? ` · Age ${player.age.toFixed(1)}` : ''}</div>
          </div>
          <div className="modalHeaderRight">
            {isEarly ? <span className="sampleTag">Early</span> : <OutcomeTag category={player.category} />}
            {outcomeFlag && <FlagBadge flag={outcomeFlag} />}
            <button type="button" className="modalClose" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="modalBody">
          <div className="modalSection">
            <div className="modalSectionTitle">Career</div>
            <div className="modalStats">
              <div className="modalStat"><div className="modalStatVal">{player.av || 0}</div><div className="modalStatLbl">AV</div></div>
              <div className="modalStat"><div className="modalStatVal">{player.games || 0}</div><div className="modalStatLbl">Games</div></div>
              <div className="modalStat"><div className="modalStatVal">{player.starts || 0}</div><div className="modalStatLbl">Starts</div></div>
              <div className="modalStat"><div className="modalStatVal">{player.proBowls || 0}</div><div className="modalStatLbl">Pro Bowls</div></div>
              <div className="modalStat"><div className="modalStatVal">{player.allPros || 0}</div><div className="modalStatLbl">All-Pros</div></div>
              {pct !== null && <div className="modalStat"><div className="modalStatVal" style={{ color: 'var(--accent)' }}>Top {100 - pct}%</div><div className="modalStatLbl">{player.pos} all-time</div></div>}
            </div>
            {arcValues.length >= 2 && <div className="modalSparkRow"><span className="modalSparkLabel">Career arc</span><Sparkline values={arcValues} /></div>}
          </div>
          {careerSeasons.length > 0 && (
            <div className="modalSection">
              <div className="modalSectionTitle">Season-by-Season Stats</div>
              <CareerStatsTable seasons={careerSeasons} pos={player.pos} />
            </div>
          )}
          {!isEarly && crAll > 0 && (
            <div className="modalSection">
              <div className="modalSectionTitle">Historical Context</div>
              <div className="rankStats">
                <RankStat label={`${player.year} class rank`} rank={crAll} total={classAll.length} />
                <RankStat label={`${player.year} ${player.pos} rank`} rank={crPos} total={classPos.length} />
                <RankStat label={`All-time ${player.pos}`} rank={atPos} total={allByPos.length} />
                <RankStat label="All-time overall" rank={atAll} total={allOverall.length} />
              </div>
            </div>
          )}
          {(player.height || player.forty) && (
            <div className="modalSection">
              <div className="modalSectionTitle">Combine / Measurables</div>
              <div className="modalMeasures">
                {player.height ? <span>{player.height}"<small>Ht</small></span> : null}
                {player.weight ? <span>{player.weight}<small>Wt</small></span> : null}
                {player.forty ? <span>{player.forty.toFixed(2)}<small>40yd</small></span> : null}
                {player.vertical ? <span>{player.vertical.toFixed(1)}<small>Vert</small></span> : null}
                {player.broad ? <span>{player.broad}<small>Broad</small></span> : null}
                {player.cone ? <span>{player.cone.toFixed(2)}<small>Cone</small></span> : null}
                {player.shuttle ? <span>{player.shuttle.toFixed(2)}<small>Shuttle</small></span> : null}
                {player.bench ? <span>{player.bench}<small>Bench</small></span> : null}
              </div>
            </div>
          )}
          {wrPffContext && (
            <div className="modalSection">
              <div className="modalSectionTitle">WR PFF Context</div>
              <div className="modalStats">
                <div className="modalStat"><div className="modalStatVal">{wrPffContext.preDraftSeasons.length}</div><div className="modalStatLbl">Pre-draft seasons</div></div>
                <div className="modalStat"><div className="modalStatVal">{wrPffContext.totalRoutes}</div><div className="modalStatLbl">Routes</div></div>
                <div className="modalStat"><div className="modalStatVal">{wrPffContext.totalTargets}</div><div className="modalStatLbl">Targets</div></div>
                <div className="modalStat"><div className="modalStatVal">{wrPffContext.careerWeightedRouteGrade != null ? wrPffContext.careerWeightedRouteGrade.toFixed(1) : '—'}</div><div className="modalStatLbl">Weighted route grade</div></div>
                <div className="modalStat"><div className="modalStatVal">{wrPffContext.careerWeightedYprr != null ? wrPffContext.careerWeightedYprr.toFixed(2) : '—'}</div><div className="modalStatLbl">Weighted YPRR</div></div>
                <div className="modalStat"><div className="modalStatVal">{wrPffContext.trajectory?.yprrDelta != null ? (wrPffContext.trajectory.yprrDelta >= 0 ? '+' : '') + wrPffContext.trajectory.yprrDelta.toFixed(2) : '—'}</div><div className="modalStatLbl">YPRR delta</div></div>
                <div className="modalStat"><div className="modalStatVal">{wrPffContext.trajectory?.trajectoryLabel ?? '—'}</div><div className="modalStatLbl">Trajectory</div></div>
              </div>
            </div>
          )}

          {qbPffContext && (
            <div className="modalSection">
              <div className="modalSectionTitle">QB PFF Context</div>
              <div className="modalStats">
                <div className="modalStat"><div className="modalStatVal">{qbPffContext.preDraftSeasons.length}</div><div className="modalStatLbl">Pre-draft seasons</div></div>
                <div className="modalStat"><div className="modalStatVal">{qbPffContext.totalDropbacks}</div><div className="modalStatLbl">Dropbacks</div></div>
                <div className="modalStat"><div className="modalStatVal">{qbPffContext.careerWeightedPassGrade != null ? qbPffContext.careerWeightedPassGrade.toFixed(1) : '—'}</div><div className="modalStatLbl">Weighted pass grade</div></div>
                <div className="modalStat"><div className="modalStatVal">{qbPffContext.trajectory?.gradeDelta != null ? (qbPffContext.trajectory.gradeDelta >= 0 ? '+' : '') + qbPffContext.trajectory.gradeDelta.toFixed(1) : '—'}</div><div className="modalStatLbl">Grade delta</div></div>
                <div className="modalStat"><div className="modalStatVal">{qbPffContext.trajectory?.trajectoryLabel ?? '—'}</div><div className="modalStatLbl">Trajectory</div></div>
              </div>
            </div>
          )}
          {pffMatch && (
            <div className="modalSection">
              <div className="modalSectionTitle">PFF College Profile</div>
              <div className="modalStats">
                <div className="modalStat"><div className="modalStatVal">{pffMatch.pff.composite.toFixed(0)}</div><div className="modalStatLbl">Composite</div></div>
                <div className="modalStat"><div className="modalStatVal">{pffMatch.pff.grade.toFixed(0)}</div><div className="modalStatLbl">Grade</div></div>
                <div className="modalStat"><div className="modalStatVal">{pffMatch.pff.production.toFixed(0)}</div><div className="modalStatLbl">Production</div></div>
                <div className="modalStat"><div className="modalStatVal">{pffMatch.pff.efficiency.toFixed(0)}</div><div className="modalStatLbl">Efficiency</div></div>
                <div className="modalStat"><div className="modalStatVal">{pffMatch.pff.clean.toFixed(0)}</div><div className="modalStatLbl">Clean play</div></div>
              </div>
            </div>
          )}
        </div>
        <div className="modalFooter">
          <button type="button" className="secondary" onClick={() => onCompare(player.name)}>Compare →</button>
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function CareerStatsTable({ seasons, pos }: { seasons: CareerSeasonStat[]; pos: string }) {
  if (pos === 'QB') return (
    <div className="careerTable careerTable9">
      <div className="careerTableHead">
        <span>Season</span><span>G</span><span>Att</span><span>Yds</span><span>TD</span><span>INT</span><span>Cmp%</span><span>YPA</span><span>EPA/A</span>
      </div>
      {seasons.map((s) => (
        <div key={s.season} className="careerTableRow">
          <span className="careerSeason">Y{s.season - seasons[0].season + 1} <small>'{String(s.season).slice(2)}</small></span>
          <span>{s.games}</span>
          <span>{s.att ?? '—'}</span>
          <span>{s.yds ?? '—'}</span>
          <span>{s.tds ?? '—'}</span>
          <span>{s.ints ?? '—'}</span>
          <span>{s.cmp_pct != null ? `${s.cmp_pct}%` : '—'}</span>
          <span>{s.ypa ?? '—'}</span>
          <span className={epaClass(s.epa_per_att ?? null)}>{s.epa_per_att != null ? s.epa_per_att.toFixed(2) : '—'}</span>
        </div>
      ))}
    </div>
  )
  if (pos === 'WR' || pos === 'TE') return (
    <div className="careerTable careerTable9">
      <div className="careerTableHead">
        <span>Season</span><span>G</span><span>Tgt</span><span>Rec</span><span>Yds</span><span>TD</span><span>Ctch%</span><span>YPR</span><span>EPA/T</span>
      </div>
      {seasons.map((s) => (
        <div key={s.season} className="careerTableRow">
          <span className="careerSeason">Y{s.season - seasons[0].season + 1} <small>'{String(s.season).slice(2)}</small></span>
          <span>{s.games}</span>
          <span>{s.tgt ?? '—'}</span>
          <span>{s.rec ?? '—'}</span>
          <span>{s.yds ?? '—'}</span>
          <span>{s.tds ?? '—'}</span>
          <span>{s.ctch_pct != null ? `${s.ctch_pct}%` : '—'}</span>
          <span>{s.ypr ?? '—'}</span>
          <span className={epaClass(s.epa_per_tgt ?? null)}>{s.epa_per_tgt != null ? s.epa_per_tgt.toFixed(2) : '—'}</span>
        </div>
      ))}
    </div>
  )
  if (pos === 'RB') return (
    <div className="careerTable careerTable8">
      <div className="careerTableHead">
        <span>Season</span><span>G</span><span>Car</span><span>Rush Yds</span><span>YPC</span><span>TD</span><span>Rec</span><span>Rec Yds</span>
      </div>
      {seasons.map((s) => (
        <div key={s.season} className="careerTableRow">
          <span className="careerSeason">Y{s.season - seasons[0].season + 1} <small>'{String(s.season).slice(2)}</small></span>
          <span>{s.games}</span>
          <span>{s.car ?? '—'}</span>
          <span>{s.rush_yds ?? '—'}</span>
          <span>{s.ypc ?? '—'}</span>
          <span>{s.rush_tds ?? '—'}</span>
          <span>{s.rec ?? '—'}</span>
          <span>{s.rec_yds ?? '—'}</span>
        </div>
      ))}
    </div>
  )
  return null
}

function epaClass(epa: number | null): string {
  if (epa == null) return ''
  if (epa >= 0.2) return 'epaHigh'
  if (epa >= 0.05) return 'epaMid'
  if (epa < -0.05) return 'epaLow'
  return ''
}

function GuideView() {
  return <div className="guidePage">
    <div className="guideSection">
      <h2>What is AV?</h2>
      <p>
        <strong>Approximate Value (AV)</strong> is a career production metric from Pro-Football-Reference.
        It is position-neutral, meaning a QB's AV is directly comparable to an OL's. One AV point is
        roughly one solid game started; roughly 6–8 AV per year is a full-time starter's pace.
      </p>
      <div className="guideTable">
        <div className="guideTableHead">
          <span>AV range</span><span>What it means</span><span>Examples</span>
        </div>
        {([
          ['70+ AV',    'Elite / Hall-of-Fame track',      'Patrick Mahomes, Aaron Donald'],
          ['45–70 AV',  'Pro Bowl–caliber career',         'Cooper Kupp, Micah Parsons'],
          ['24–45 AV',  'Multi-year NFL starter',          'Brian Burns, James Conner'],
          ['10–24 AV',  'Rotational / role player',        'Typical Day 2 contributor'],
          ['4–10 AV',   'Backup / special-teams value',    'Typical Day 3 pick'],
          ['< 4 AV',    'Minimal NFL impact',              'Most undrafted FAs'],
        ] as [string, string, string][]).map(([range, desc, ex]) => (
          <div key={range} className="guideTableRow">
            <span className="guideAvRange">{range}</span>
            <span>{desc}</span>
            <span className="guideEx">{ex}</span>
          </div>
        ))}
      </div>
    </div>

    <div className="guideSection">
      <h2>What is Projected AV?</h2>
      <p>
        <strong>Projected AV</strong> is the model's estimate of a prospect's career Approximate Value.
        It is computed by finding up to 80 historically similar players (drafted 2000–2021, so all comps
        have at least 4 seasons of real NFL data) and taking a similarity-weighted average of their
        actual career AVs.
      </p>
      <p>
        Similarity is based on draft pick (log-scaled, 45% weight), combine athleticism (39%), and
        size (16%). When a PFF college profile is loaded and at least 12 mature PFF comps exist, a
        position-aware PFF blend is added — the blend weight and which PFF dimensions drive similarity
        depend on the position group (e.g., 35% for SKILL, 7–14% for QBs outside round 1).
      </p>
      <p>
        A calibrated linear model (trained on the same 2000–2021 population) contributes a 10% anchor
        to keep the estimate stable when the comp pool is thin.
      </p>
    </div>

    <div className="guideSection">
      <h2>What is the Score (1–99)?</h2>
      <p>
        The <strong>Score</strong> is a 1–99 composite index that translates the projection into a
        single number. It blends two components:
      </p>
      <ul className="guideList">
        <li><strong>54% Expected AV percentile</strong> — where the Projected AV sits within historical players at the same position group.</li>
        <li><strong>46% Signal composite</strong> — a weighted blend of the input signals below.</li>
      </ul>
      <div className="guideTable guideSignalTable">
        <div className="guideTableHead"><span>Signal</span><span>What it captures</span><span>Weight by group</span></div>
        {([
          ['Draft',    'Draft capital (pick slot)',                            'QB 34% · Skill 27% · OL 28% · Front 26% · DB 29%'],
          ['Athletic', '40-yd, vertical, broad jump, cone, shuttle vs. peers','QB 5% · Skill 21% · OL 8% · Front 20% · DB 22%'],
          ['Strength', 'Bench press reps vs. position group peers',           'QB 6% · Skill 3% · OL 10% · Front 10% · DB 4%'],
          ['Size',     'Height + weight vs. position group',                  'QB 5% · Skill 6% · OL 18% · Front 8% · DB 4%'],
          ['Age',      'Draft age; younger = higher upside ceiling',          'QB 12% · Skill 10% · OL 8% · Front 8% · DB 10%'],
          ['PFF',      'College PFF metrics (position-aware weights)',        'SKILL 35% · QB 7–28% by pick · OL 12% · Front 10% · DB 10%'],
        ] as [string, string, string][]).map(([sig, cap, wt]) => (
          <div key={sig} className="guideTableRow">
            <span className="guideSigName">{sig}</span>
            <span>{cap}</span>
            <span className="guideWt">{wt}</span>
          </div>
        ))}
      </div>
    </div>

    <div className="guideSection">
      <h2>Grade scale</h2>
      <div className="guideTable">
        <div className="guideTableHead"><span>Score</span><span>Grade</span><span>Interpretation</span></div>
        {([
          ['85–99', 'A+', 'Franchise-level traits and projection; comp pool dominated by Pro Bowl / elite careers'],
          ['75–84', 'A',  'Strong starter projection; high % of comps became multi-year starters'],
          ['65–74', 'B+', 'Starter-caliber projection with meaningful variance'],
          ['55–64', 'B',  'Likely contributor; mix of starters and role players in comp pool'],
          ['45–54', 'C+', 'Backup-track projection; limited ceiling from current inputs'],
          ['< 45',  'C',  'Developmental; comp pool skewed toward minimal-impact outcomes'],
        ] as [string, string, string][]).map(([range, grade, desc]) => (
          <div key={grade} className="guideTableRow">
            <span className="guideScoreRange">{range}</span>
            <span className="guideGrade">{grade}</span>
            <span>{desc}</span>
          </div>
        ))}
      </div>
    </div>

    <div className="guideSection">
      <h2>Bust &amp; gem flags</h2>
      <p>
        Flags identify players whose pre-draft college profile was meaningfully misaligned with their
        draft slot — either a concern for a high pick or hidden value for a late pick. Three tiers fire
        at different career stages:
      </p>
      <div className="guideTable">
        <div className="guideTableHead"><span>Tier</span><span>When it fires</span><span>Data used</span></div>
        {([
          ['Mature outcome', 'Drafted ≤2021 (≥20 NFL games)', 'Actual AV + outcome category vs. draft position'],
          ['Early-career signal', '2022–2025, ≥16 NFL games', 'AV/season pace vs. pick expectation (bust < 3.0, gem ≥ 5.0)'],
          ['College-metric signal', '2022–2026, < 16 NFL games', 'College Projection Score calibrated on 2014–2022 outcomes'],
        ] as [string, string, string][]).map(([tier, when, data]) => (
          <div key={tier} className="guideTableRow">
            <span className="guideSigName">{tier}</span>
            <span>{when}</span>
            <span className="guideWt">{data}</span>
          </div>
        ))}
      </div>
      <h3 style={{ marginTop: '1.2rem', marginBottom: '.5rem', fontSize: '0.85rem', color: 'var(--fg-1)' }}>Position-aware PFF signal in Score</h3>
      <p>
        The PFF college signal inside Score is calibrated on 2016–2022 outcome data. Pearson r with NFL wAV
        varies dramatically by position, so the formula now weights metrics accordingly:
      </p>
      <div className="guideTable">
        <div className="guideTableHead"><span>Group</span><span>PFF dimensions used in Score</span><span>PFF blend weight</span></div>
        {([
          ['WR / RB / TE', 'Composite 60% + Grade 40%',                              '35% (strong signal: r = 0.38)'],
          ['QB — R1',      'Composite 48% + Grade 36% + Efficiency 16%',             '28%'],
          ['QB — R2',      'Same blend, gated by pick range',                         '14% (picks 33–64)'],
          ['QB — Day 3+',  'Same blend, heavily discounted',                          '7% (picks 65+; r ≈ 0.03)'],
          ['OL',           'Production 50% + Efficiency 32% + Clean 18%',            '12% (composite r = −0.02, excluded)'],
          ['DL / FRONT',   'Production 58% + Grade 24% + Clean 18%',                 '10% (composite r ≈ 0.005)'],
          ['LB',           'Grade 58% + Efficiency 30% + Clean 12%',                 '8% (composite r = −0.08, excluded)'],
          ['CB / S',       'Production 42% + Efficiency 36% + Grade 22%',            '10% (composite r = 0.05)'],
        ] as [string, string, string][]).map(([pg, dims, blend]) => (
          <div key={pg} className="guideTableRow">
            <span className="guideSigName">{pg}</span>
            <span>{dims}</span>
            <span className="guideWt">{blend}</span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: '0.78rem', color: 'var(--fg-2)', marginTop: '.6rem' }}>
        Age at draft is the single most consistent predictor across all positions (r = −0.19 to −0.40)
        and is already weighted at 8–14% via the signal weights above.
        For OL/DB/FRONT, agility metrics (cone, shuttle) and strength (bench) inside the Athletic and
        Strength signals carry more predictive weight than they do for skill positions.
      </p>
      <p style={{ fontSize: '0.78rem', color: 'var(--fg-2)', marginTop: '.4rem' }}>
        <strong>Bust flag</strong> fires when college metrics are below average for a high pick (≤64).
        &nbsp;<strong>Gem flag</strong> fires for picks ≥33 with elite college metrics — QBs require
        strong composite+grade average (&gt; 70) AND multi-dimension alignment, AND pick ≤ 100.
        Thresholds derived from 2016–2021 draft classes where outcomes are known.
      </p>
      <h3 style={{ marginTop: '1.2rem', marginBottom: '.5rem', fontSize: '0.85rem', color: 'var(--fg-1)' }}>Position-specific PFF metrics</h3>
      <p>
        Each PFF dimension means something different depending on position. The flag labels and tooltips
        use the position-aware name below — not generic "efficiency" or "clean pocket" language.
      </p>
      <div className="guideTable">
        <div className="guideTableHead"><span>Position group</span><span>"Clean" dimension</span><span>"Efficiency" dimension</span><span>"Production"</span></div>
        {([
          ['QB',          'Turnover avoidance (TWP rate)',  'Decision-making (YPA, BTT%)',    'Per-game passing output'],
          ['WR / RB / TE','Ball security (drop rate)',       'Yards per route run',            'Per-game receiving/rushing'],
          ['OL',          'Sack prevention (sack rate)',    'Pass block success rate',        'Block volume (cumulative)'],
          ['DL / LB',     'Discipline (baseline)',          'Pass rush rate (sacks+hits)',     'Per-game disruption'],
          ['CB / S',      'Discipline (baseline)',          'Coverage success (inv. QB rtg)', 'Per-game impact (INTs/PBUs)'],
        ] as [string, string, string, string][]).map(([pg, cl, ef, pr]) => (
          <div key={pg} className="guideTableRow">
            <span className="guideSigName">{pg}</span>
            <span>{cl}</span>
            <span>{ef}</span>
            <span className="guideWt">{pr}</span>
          </div>
        ))}
      </div>
    </div>

    <div className="guideSection">
      <h2>Outcome odds</h2>
      <p>
        The <strong>Outcome Odds</strong> panel shows the probability distribution across AV tiers,
        derived from the weighted outcomes of the comp pool. A player with 40% odds in the
        "24–45 AV" band and 25% in "45–70 AV" has a strong starter projection with real upside.
      </p>
      <p>
        The floor / median / ceiling in the Career AV Band panel are the 10th, 50th, and 90th
        percentiles of the comp pool's actual career AVs, blended 25% toward the calibrated model estimate.
      </p>
    </div>

    <div className="guideSection">
      <h2>Career progression stats</h2>
      <p>
        Season-by-season NFL stats (from nflverse <code>player_stats_season</code>) are shown in every player profile
        and also used to improve the projection model. Two career-trajectory signals adjust how heavily each comp is weighted:
      </p>
      <ul className="guideList">
        <li><strong>Year 1 signal</strong> — Rookie-season passer rating (QB), receiving yards (WR/TE), or rushing yards (RB) shifts the comp's similarity weight by up to ±12%.</li>
        <li><strong>Year 2 signal</strong> — Second-year EPA per attempt (QB), receiving yards (WR/TE), or rushing yards (RB) adds an additional ±8% adjustment, boosting comps with strong sophomore breakouts and down-weighting comps who faded.</li>
      </ul>
      <p>
        Together these signals mean a comp who dominated as a rookie <em>and</em> broke out in Year 2 gets significantly more influence than an equal pre-draft profile who underperformed across both seasons. This helps the model better reflect upside trajectories for younger prospects.
      </p>
    </div>

    <div className="guideSection">
      <h2>Data sources</h2>
      <ul className="guideList">
        <li><strong>Historical outcomes</strong> — nflverse draft picks + combine data (2000–present), updated automatically</li>
        <li><strong>Season stats</strong> — nflverse player_stats_season (1999–present), QB / WR / TE / RB regular-season totals; shown in player profiles and used for trajectory-based comp weighting</li>
        <li><strong>PFF college profiles</strong> — Pro Football Focus college grades matched to NFL outcomes</li>
        <li><strong>Comp cutoff</strong> — Position-specific maturation thresholds: SKILL/DB use ≤2022 (4 seasons adequate), QB/LB ≤2021, OL/FRONT ≤2020 (6 seasons — these groups develop slowly and their AV accumulates over a longer arc)</li>
      </ul>
    </div>
  </div>
}

function RankingsPage({ history, onOpenModal, onCompare }: { history: Historical[]; onOpenModal: (p: Historical) => void; onCompare: (name: string) => void }) {
  return <section className="panel tablePanel classPanel">
    <div className="panelTitle"><div><p>Historical Database</p><h2>Position Rankings</h2></div></div>
    <RankingsView history={history} onOpenModal={onOpenModal} onCompare={onCompare} />
  </section>
}

function BrowserHeader({ label, sortKey, active, dir, onSort }: { label: string; sortKey: BrowserSortKey; active: BrowserSortKey; dir: SortDir; onSort: (key: BrowserSortKey) => void }) {
  const isActive = sortKey === active
  return <th aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
    <button type="button" className={`classSort ${isActive ? 'on' : ''}`} onClick={() => onSort(sortKey)}>
      {label}<i className="sortMark" aria-hidden="true">{isActive ? (dir === 'asc' ? '^' : 'v') : ''}</i>
    </button>
  </th>
}


function safeNum(value: any): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function fmtNum(value: any, digits = 1): string {
  const n = safeNum(value)
  return n == null ? '—' : n.toFixed(digits)
}

function getAny(obj: any, keys: string[]): any {
  if (!obj) return null
  for (const key of keys) {
    if (obj[key] != null) return obj[key]
  }
  return null
}

function buildPlayerExplanation(player: any, ctx: any) {
  const strengths: string[] = []
  const risks: string[] = []
  const drivers: string[] = []
  const badges: string[] = []

  const pos = String(player.pos || '').toUpperCase()
  const pick = safeNum(player.pick)
  const projectedScore = safeNum(ctx?.projected?.score)
  const projectedAv = safeNum(ctx?.projected?.av)
  const pffScore = safeNum(ctx?.pffContextScore)

  if (pick != null) {
    drivers.push(`Projected/actual pick: #${pick}`)
    if (pick <= 32) badges.push('Round 1 profile')
    else if (pick <= 100) badges.push('Top-100 profile')
    else badges.push('Day 3 / value range')
  }

  if (projectedScore != null) {
    drivers.push(`Model score: ${Math.round(projectedScore)}`)
    if (projectedScore >= 85) strengths.push('High model score relative to the class.')
    else if (projectedScore >= 70) strengths.push('Solid model score with starter/value potential.')
    else risks.push('Model score is more developmental than blue-chip.')
  }

  if (projectedAv != null) {
    drivers.push(`Projected AV: ${projectedAv.toFixed(1)}`)
  }

  const hasSeasonContext = Boolean(ctx?.qbContext || ctx?.wrContext || ctx?.teContext)
  const pffLabel = String(ctx?.pffContextLabel || '')
  const isNoPffProfile = /no pff match/i.test(pffLabel)

  if (pffScore != null && pffScore > 0 && !isNoPffProfile) {
    drivers.push(`${ctx?.pffContextLabel || 'PFF context'}: ${pffScore.toFixed(1)}`)
    if (pffScore >= 90) strengths.push('Elite PFF profile/season signal.')
    else if (pffScore >= 80) strengths.push('Strong PFF profile/season signal.')
    else if (pffScore < 65) risks.push('PFF profile is more modest than top-tier prospects.')
  } else if (hasSeasonContext) {
    drivers.push('Season PFF data linked.')
  } else if (isNoPffProfile) {
    risks.push('No full PFF comparison profile matched yet.')
  }

  const qb = ctx?.qbContext
  const wr = ctx?.wrContext || ctx?.teContext || ctx?.teContext

  if (pos === 'QB' && qb) {
    const passGrade = safeNum(getAny(qb, ['pass_grade', 'grades_pass']))
    const offGrade = safeNum(getAny(qb, ['offense_grade', 'grades_offense']))
    const btt = safeNum(getAny(qb, ['btt_rate', 'btt_pct']))
    const twp = safeNum(getAny(qb, ['twp_rate', 'twp_pct']))
    const ttt = safeNum(getAny(qb, ['time_to_throw', 'avg_time_to_throw']))
    const adot = safeNum(getAny(qb, ['adot', 'avg_depth_of_target']))
    const p2s = safeNum(getAny(qb, ['pressure_to_sack_rate', 'pressure_to_sack_pct']))

    if (passGrade != null) drivers.push(`QB pass grade: ${passGrade.toFixed(1)}`)
    if (offGrade != null) drivers.push(`QB offense grade: ${offGrade.toFixed(1)}`)
    if (btt != null) drivers.push(`BTT%: ${btt.toFixed(1)}`)
    if (twp != null) drivers.push(`TWP%: ${twp.toFixed(1)}`)
    if (ttt != null) drivers.push(`Time to throw: ${ttt.toFixed(2)}s`)
    if (adot != null) drivers.push(`ADOT: ${adot.toFixed(1)}`)
    if (p2s != null) drivers.push(`Pressure-to-sack: ${p2s.toFixed(1)}%`)

    if (passGrade != null && passGrade >= 90) strengths.push('Elite passing grade.')
    if (offGrade != null && offGrade >= 90) strengths.push('Elite overall offensive grade.')
    if (btt != null && btt >= 6) strengths.push('High big-time throw creation.')
    if (twp != null && twp <= 2) strengths.push('Strong ball-security profile.')
    if (twp != null && twp >= 4) risks.push('Turnover-worthy play rate is a risk flag.')
    if (ttt != null && ttt >= 3.0) risks.push('Longer time-to-throw profile may create NFL pressure risk.')

    badges.push('QB data linked')
  }


  const rb = ctx?.rbContext

  if (pos === 'RB' && rb) {
    const runGrade = safeNum(getAny(rb, ['run_grade', 'grades_run']))
    const offGrade = safeNum(getAny(rb, ['offense_grade', 'grades_offense']))
    const yards = safeNum(getAny(rb, ['yards']))
    const attempts = safeNum(getAny(rb, ['attempts']))
    const ypa = safeNum(getAny(rb, ['ypa']))
    const yco = safeNum(getAny(rb, ['yco_attempt']))
    const elusive = safeNum(getAny(rb, ['elusive_rating']))
    const avoided = safeNum(getAny(rb, ['avoided_tackles']))
    const breakaway = safeNum(getAny(rb, ['breakaway_percent']))
    const targets = safeNum(getAny(rb, ['targets']))
    const recYards = safeNum(getAny(rb, ['rec_yards']))
    const routeGrade = safeNum(getAny(rb, ['route_grade', 'grades_pass_route']))
    const passBlock = safeNum(getAny(rb, ['pass_block_grade', 'grades_pass_block']))
    const fumbles = safeNum(getAny(rb, ['fumbles']))

    drivers.push('Season PFF data linked.')
    if (runGrade != null) drivers.push(`Run grade: ${runGrade.toFixed(1)}`)
    if (offGrade != null) drivers.push(`Offense grade: ${offGrade.toFixed(1)}`)
    if (yards != null) drivers.push(`Rushing yards: ${yards.toFixed(0)}`)
    if (attempts != null) drivers.push(`Attempts: ${attempts.toFixed(0)}`)
    if (ypa != null) drivers.push(`YPA: ${ypa.toFixed(2)}`)
    if (yco != null) drivers.push(`YCO/attempt: ${yco.toFixed(2)}`)
    if (elusive != null) drivers.push(`Elusive rating: ${elusive.toFixed(1)}`)
    if (avoided != null) drivers.push(`Avoided tackles: ${avoided.toFixed(0)}`)
    if (breakaway != null) drivers.push(`Breakaway %: ${breakaway.toFixed(1)}`)
    if (targets != null) drivers.push(`Targets: ${targets.toFixed(0)}`)
    if (recYards != null) drivers.push(`Receiving yards: ${recYards.toFixed(0)}`)
    if (routeGrade != null) drivers.push(`Route grade: ${routeGrade.toFixed(1)}`)
    if (passBlock != null) drivers.push(`Pass-block grade: ${passBlock.toFixed(1)}`)

    if (runGrade != null && runGrade >= 85) strengths.push('High-end rushing grade.')
    if (yco != null && yco >= 3.2) strengths.push('Strong yards-after-contact profile.')
    if (elusive != null && elusive >= 90) strengths.push('Strong tackle-breaking / elusive profile.')
    if (targets != null && targets >= 25) strengths.push('Useful receiving workload.')
    if (routeGrade != null && routeGrade >= 65) strengths.push('Viable receiving/route profile for a RB.')
    if (passBlock != null && passBlock >= 65) strengths.push('Usable pass-protection profile.')

    if (runGrade != null && runGrade < 70) risks.push('Run grade is below ideal prospect threshold.')
    if (yco != null && yco < 2.4 && attempts != null && attempts >= 120) risks.push('Yards-after-contact profile is modest for workload.')
    if (fumbles != null && fumbles >= 4) risks.push('Fumble count is a ball-security concern.')
    if (targets != null && targets < 10) risks.push('Limited receiving sample.')

    badges.push('RB data linked')
  }


  if ((pos === 'WR' || pos === 'TE') && wr) {
    const routeGrade = safeNum(getAny(wr, ['route_grade', 'grades_pass_route']))
    const offGrade = safeNum(getAny(wr, ['offense_grade', 'grades_offense']))
    const yprr = safeNum(getAny(wr, ['yprr']))
    const targets = safeNum(getAny(wr, ['targets']))
    const yards = safeNum(getAny(wr, ['yards']))

    if (routeGrade != null) drivers.push(`Route grade: ${routeGrade.toFixed(1)}`)
    if (offGrade != null) drivers.push(`Offense grade: ${offGrade.toFixed(1)}`)
    if (yprr != null) drivers.push(`YPRR: ${yprr.toFixed(2)}`)
    if (targets != null) drivers.push(`Targets: ${targets.toFixed(0)}`)
    if (yards != null) drivers.push(`Yards: ${yards.toFixed(0)}`)

    if (routeGrade != null && routeGrade >= 80) strengths.push('Strong route-winning profile.')
    if (yprr != null && yprr >= 2.5) strengths.push('High yards-per-route efficiency.')
    if (offGrade != null && offGrade >= 80) strengths.push('Strong overall receiving profile.')
    if (routeGrade != null && routeGrade < 65) risks.push('Route grade is below ideal draft-value threshold.')

    badges.push(`${pos} data linked`)
  }

  if (player.av != null && Number(player.av) > 0) {
    drivers.push(`Historical AV: ${player.av}`)
  }

  if (player.proBowls) strengths.push(`NFL outcome marker: ${player.proBowls} Pro Bowl(s).`)
  if (player.allPro) strengths.push(`NFL outcome marker: ${player.allPro} All-Pro selection(s).`)

  if (!strengths.length) strengths.push('Ranking is mainly supported by draft slot, model projection, and available profile data.')
  if (!risks.length) risks.push('No major dataset red flag surfaced from the currently loaded fields.')

  const summary = `${player.name} ranks here because the model combines draft slot/value, projected score, available PFF data, and position-specific production signals.`
  const valueRead =
    pick != null && projectedScore != null
      ? projectedScore >= 80 && pick > 50
        ? 'Potential value: model score is strong relative to projected draft slot.'
        : projectedScore < 65 && pick <= 50
          ? 'Possible overpay risk: draft slot is aggressive relative to model score.'
          : 'Fair-value range: model score and draft slot are broadly aligned.'
      : 'Value read is limited because pick or score data is missing.'

  const seasonPffLinked = Boolean(ctx?.qbContext || ctx?.wrContext || ctx?.teContext || ctx?.rbContext)

  const cleanedDrivers = drivers.filter((item) => {
    if (seasonPffLinked && /^No PFF match/i.test(String(item))) return false
    return true
  })

  if (seasonPffLinked && !cleanedDrivers.some((item) => /Season PFF data linked/i.test(String(item)))) {
    cleanedDrivers.unshift('Season PFF data linked.')
  }

  const rbScoreReadySignal = ctx?.rbScoreReadySignal || null
  const rbScoreReadyAdjustment = safeNum(rbScoreReadySignal?.recommendedAdjustment)

  const qbTranslationSignal = ctx?.qbTranslationSignal || buildInlineQbTranslationSignal(player, ctx?.qbContext)
  const qbTranslationAdjustment = safeNum(qbTranslationSignal?.adjustment)

  const compSignal = ctx?.compSignal || null
  const compAdjustment = safeNum(compSignal?.compAdjustment)
  const compConfidence = safeNum(compSignal?.confidence)

  if (compSignal && compAdjustment != null) {
    badges.push('Comp signal')
    drivers.push(`Comp signal: ${compAdjustment >= 0 ? '+' : ''}${compAdjustment.toFixed(1)}`)
    if (compConfidence != null) drivers.push(`Comp confidence: ${compConfidence.toFixed(2)}`)
    if (!compSignal.realDraftPrior) drivers.push('Comp signal context only: no real draft prior yet.')
  }

  if (rbScoreReadySignal && rbScoreReadyAdjustment != null && rbScoreReadyAdjustment !== 0) {
    badges.push('RB score-ready signal')
    drivers.push(`RB score-ready signal: ${rbScoreReadyAdjustment >= 0 ? '+' : ''}${rbScoreReadyAdjustment.toFixed(2)}`)
  }

  if (qbTranslationSignal && qbTranslationAdjustment != null && qbTranslationAdjustment !== 0) {
    badges.push('QB translation signal')
    drivers.push(`QB translation signal: ${qbTranslationAdjustment >= 0 ? '+' : ''}${qbTranslationAdjustment.toFixed(2)}`)
  }

  return {
    player,
    summary,
    valueRead,
    badges,
    strengths,
    risks,
    drivers: cleanedDrivers,
    compSignal,
    rbScoreReadySignal,
    qbTranslationSignal,
  }
}


function fieldNumLoose(source: unknown, keys: string[], fallback = 0): number {
  const r = asRecord(source)
  if (!r) return fallback

  for (const key of keys) {
    const direct = numberField(r, key, Number.NaN)
    if (Number.isFinite(direct)) return direct
  }

  const normalizedKeys = keys.map((k) => norm(k))
  for (const [key, value] of Object.entries(r)) {
    if (!normalizedKeys.includes(norm(key))) continue
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }

  return fallback
}

function buildInlineQbTranslationSignal(player: Historical, qbContext: unknown): QbTranslationSignal | null {
  if (player.pos !== 'QB' || !qbContext) return null

  const pick = Number.isFinite(player.pick) ? player.pick : 999
  const attempts = fieldNumLoose(qbContext, ['attempts', 'dropbacks'], 0)

  const rawBtt = fieldNumLoose(qbContext, ['btt', 'bttPct', 'btt_rate', 'btt_pct', 'btt%', 'big_time_throw_rate'], 0)
  const rawTwp = fieldNumLoose(qbContext, ['twp', 'twpPct', 'twp_rate', 'twp_pct', 'twp%', 'turnover_worthy_play_rate'], 0)

  const btt = rawBtt > 12 && attempts > 0 ? (rawBtt / attempts) * 100 : rawBtt
  const twp = rawTwp > 12 && attempts > 0 ? (rawTwp / attempts) * 100 : rawTwp

  const pass = fieldNumLoose(qbContext, ['pass', 'passGrade', 'pass_grade', 'grades_pass', 'pff'], 0)
  const run = fieldNumLoose(qbContext, ['run', 'runGrade', 'run_grade', 'grades_run'], 0)
  const scrambles = fieldNumLoose(qbContext, ['scrambles'], 0)
  const acc = fieldNumLoose(qbContext, ['acc', 'adjustedAccuracy', 'adjusted_completion_percent', 'accuracy_percent', 'adjustedCompletionPercent'], 0)
  const adot = fieldNumLoose(qbContext, ['adot', 'avgDepthOfTarget', 'avg_depth_of_target'], 0)
  const epa = fieldNumLoose(qbContext, ['epa', 'epa_per_play'], 0)

  const traits: string[] = []
  let adjustment = 0

  const eliteScrambleCreation =
    pick <= 100 &&
    scrambles >= 40 &&
    run >= 75 &&
    acc >= 70

  const top32CreationPlus =
    pick <= 32 &&
    scrambles >= 25 &&
    btt >= 5.5 &&
    adot >= 9.0 &&
    acc >= 70

  const day2LowPassLowAcc =
    pick > 32 &&
    pick <= 100 &&
    pass < 75 &&
    acc < 70

  const highCapitalLowCreation =
    pick <= 64 &&
    btt < 4.5 &&
    adot < 9.5 &&
    epa < 0.35

  const safeLimitedLowCreation =
    pick > 20 &&
    btt < 4.5 &&
    twp <= 2.5 &&
    acc >= 72

  if (eliteScrambleCreation) {
    adjustment += 0.35
    traits.push('Elite scramble creation')
  }

  if (top32CreationPlus) {
    traits.push('Top-32 creation plus')
  }

  if (day2LowPassLowAcc) {
    adjustment -= 0.35
    traits.push('Day-2 low pass/accuracy risk')
  }

  if (highCapitalLowCreation) {
    adjustment -= 0.25
    traits.push('High-capital low-creation risk')
  }

  if (safeLimitedLowCreation) {
    adjustment -= 0.20
    traits.push('Safe-limited low-creation risk')
  }

  if (!traits.length) return null

  return {
    adjustment: Math.max(-0.60, Math.min(0.50, Number(adjustment.toFixed(2)))),
    traits,
    pass,
    run,
    scrambles,
    btt: Number(btt.toFixed(1)),
    acc,
    adot,
    epa,
  }
}


function PlayerExplanationModal({ explanation, onClose }: { explanation: any; onClose: () => void }) {
  if (!explanation) return null

  return <div className="explainOverlay" role="dialog" aria-modal="true">
    <div className="explainModal">
      <div className="explainHeader">
        <div>
          <p>Explain Player</p>
          <h2>{explanation.player.name}</h2>
          <small>{explanation.player.year} · {explanation.player.pos} · {explanation.player.school || 'No school'} · Pick #{explanation.player.pick}</small>
        </div>
        <button type="button" className="secondary" onClick={onClose}>Close</button>
      </div>

      <p className="explainSummary">{explanation.summary}</p>

      <div className="explainBadges">
        {explanation.badges.map((badge: string) => <span key={badge}>{badge}</span>)}
      </div>

      <div className="explainGrid">
        <section>
          <h3>Why the model likes him</h3>
          <ul>{explanation.strengths.map((item: string) => <li key={item}>{item}</li>)}</ul>
        </section>

        <section>
          <h3>Risks / limitations</h3>
          <ul>{explanation.risks.map((item: string) => <li key={item}>{item}</li>)}</ul>
        </section>

        <section>
          <h3>Model drivers</h3>
          <ul>{explanation.drivers.map((item: string) => <li key={item}>{item}</li>)}</ul>
        </section>

        {explanation.qbTranslationSignal ? <section>
          <h3>QB translation signal</h3>
          <p>
            Signal: <strong>{Number(explanation.qbTranslationSignal.adjustment || 0) >= 0 ? '+' : ''}{Number(explanation.qbTranslationSignal.adjustment || 0).toFixed(2)}</strong>
            {' · '}Status: read-only / not applied to ranking
          </p>
          {explanation.qbTranslationSignal.primaryComp?.name ? <>
            <h4>Primary 2027 QB comp</h4>
            <p>
              <strong>{explanation.qbTranslationSignal.primaryComp.name}</strong>
              {explanation.qbTranslationSignal.primaryComp.archetype ? <> · {explanation.qbTranslationSignal.primaryComp.archetype}</> : null}
              {Number(explanation.qbTranslationSignal.primaryComp.distance || 0) > 0 ? <> · Distance: {Number(explanation.qbTranslationSignal.primaryComp.distance || 0).toFixed(2)}</> : null}
            </p>
          </> : null}
          {explanation.qbTranslationSignal.traits?.length ? <>
            <h4>Traits</h4>
            <ul>
              {explanation.qbTranslationSignal.traits.map((t: string, i: number) => (
                <li key={`qb-translation-${i}`}>
                  {t}{t === 'Top-32 creation plus' ? ' — context only' : ''}
                </li>
              ))}
            </ul>
          </> : null}
          <h4>Signal inputs</h4>
          <p>
            Run grade: {Number(explanation.qbTranslationSignal.run || 0).toFixed(1)}
            {' · '}Scrambles: {Number(explanation.qbTranslationSignal.scrambles || 0).toFixed(0)}
            {' · '}BTT%: {Number(explanation.qbTranslationSignal.btt || 0).toFixed(1)}
            {' · '}Adj. accuracy: {Number(explanation.qbTranslationSignal.acc || 0).toFixed(1)}
          </p>
        </section> : null}

        {explanation.rbScoreReadySignal ? <section>
          <h3>RB score-ready signal</h3>
          <p>
            Adjustment candidate: <strong>{Number(explanation.rbScoreReadySignal.recommendedAdjustment || 0) >= 0 ? '+' : ''}{Number(explanation.rbScoreReadySignal.recommendedAdjustment || 0).toFixed(2)}</strong>
            {' · '}Status: read-only / not applied to ranking
          </p>
          {explanation.rbScoreReadySignal.quantumTraits?.length ? <>
            <h4>Validated RB traits</h4>
            <ul>
              {explanation.rbScoreReadySignal.quantumTraits
                .filter((t: any) => t.scoreReady)
                .map((t: any) => (
                  <li key={`rb-signal-${t.traitKey}`}>{t.label}</li>
                ))}
            </ul>
          </> : null}
          {explanation.rbScoreReadySignal.reasons?.length ? <>
            <h4>Reason</h4>
            <ul>
              {explanation.rbScoreReadySignal.reasons.map((r: string, i: number) => (
                <li key={`rb-signal-reason-${i}`}>{r}</li>
              ))}
            </ul>
          </> : null}
        </section> : null}

        {explanation.compSignal ? <section>
          <h3>Historical comp signal</h3>
          <p>
            Adjustment: <strong>{Number(explanation.compSignal.compAdjustment || 0) >= 0 ? '+' : ''}{Number(explanation.compSignal.compAdjustment || 0).toFixed(1)}</strong>
            {' · '}Confidence: {Number(explanation.compSignal.confidence || 0).toFixed(2)}
            {!explanation.compSignal.realDraftPrior ? ' · Context only: no real draft prior' : ''}
          </p>
          {explanation.compSignal.projectionComps?.length ? <>
            <h4>Projection comps</h4>
            <ul>
              {explanation.compSignal.projectionComps.slice(0, 4).map((c: any) => (
                <li key={`proj-${c.name}-${c.year}`}>{c.name} {c.year} · Pick #{c.pick} · Δ{Number(c.delta || 0).toFixed(1)}</li>
              ))}
            </ul>
          </> : null}
          {explanation.compSignal.styleComps?.length ? <>
            <h4>Style comps</h4>
            <ul>
              {explanation.compSignal.styleComps.slice(0, 4).map((c: any) => (
                <li key={`style-${c.name}-${c.year}`}>{c.name} {c.year} · Pick #{c.pick} · Δ{Number(c.delta || 0).toFixed(1)}</li>
              ))}
            </ul>
          </> : null}
        </section> : null}

        <section>
          <h3>Value read</h3>
          <p>{explanation.valueRead}</p>
        </section>
      </div>
    </div>
  </div>
}



function pffSeasonMapKey(year: number, name: string) {
  return `${clean(name)}|${Number(year)}`
}

function buildLatestPffSeasonMap(seasons: any[]) {
  const out = new Map<string, any>()

  for (const row of seasons || []) {
    const name = row.name || row.player || row.player_name || ''
    const season = Number(row.season || row.year)
    if (!name || !Number.isFinite(season)) continue

    for (let draftYear = season + 1; draftYear <= 2030; draftYear++) {
      const key = pffSeasonMapKey(draftYear, name)
      const current = out.get(key)
      const currentSeason = Number(current?.season || current?.year || 0)

      if (!current || season > currentSeason) {
        out.set(key, row)
      }
    }
  }

  return out
}


function ClassExplorer({ pool, history, pffProfiles, pffLookup, y1Data, careerStats, histFlagMap, currentName, currentYear, saved, projectionOverlay, compSignalMap, rbScoreReadyMap, qbTranslationMap, qbPffSeasons, wrPffSeasons, tePffSeasons, rbPffSeasons }: { pool: Historical[]; history: Historical[]; pffProfiles: PffProfile[]; pffLookup: Map<string, PffProfile>; y1Data?: Y1Data; careerStats?: CareerStatMap; histFlagMap: Map<string, HistoricalOutcomeFlag>; currentName: string; currentYear: number; saved: SavedProspect[]; projectionOverlay: Map<string, PositionProjectionOverlay>; compSignalMap: Map<string, PositionCompSignal>; rbScoreReadyMap: Map<string, RbScoreReadySignal>; qbTranslationMap: Map<string, QbTranslationSignal>; qbPffSeasons: QbPffSeason[]; wrPffSeasons: WrPffSeason[]; tePffSeasons: any[]; rbPffSeasons: any[]; }) {
  const years = useMemo(() => {
    const set = new Set<number>()
    for (const player of pool) set.add(player.year)
    return Array.from(set).sort((a, b) => b - a)
  }, [pool])

  const [year, setYear] = useState<number | null>(null)
  const [pos, setPos] = useState<string>('All')
  const [nameQuery, setNameQuery] = useState('')
  const [outcomeFilter, setOutcomeFilter] = useState<'all' | 'gems' | 'busts' | 'flagged'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('pick')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showScatter, setShowScatter] = useState(false)
  const [explanation, setExplanation] = useState<any | null>(null)
  const [v57AuditRows, setV57AuditRows] = useState<any[]>([])

  useEffect(() => {
    let cancelled = false
    const base = import.meta.env.BASE_URL || './'
    fetch(`${base}data/model/v57_current_prospect_audit.json`)
      .then((r) => r.ok ? r.json() : null)
      .then((payload) => {
        if (!cancelled && payload?.allScored?.length) setV57AuditRows(payload.allScored)
      })
      .catch(() => {
        if (!cancelled) setV57AuditRows([])
      })
    return () => { cancelled = true }
  }, [])

  const v57ScoreMap = useMemo(() => {
    const out = new Map<string, any>()
    for (const row of v57AuditRows) {
      const key = `${clean(row.name)}|${String(row.pos || '').toUpperCase()}|${Number(row.year)}`
      out.set(key, row)
    }
    return out
  }, [v57AuditRows])

  const getV57Row = (player: Historical) => {
    const key = `${clean(player.name)}|${String(player.pos || '').toUpperCase()}|${Number(player.year)}`
    return v57ScoreMap.get(key) ?? null
  }

  const latestQbPffMap = useMemo(() => buildLatestPffSeasonMap(qbPffSeasons), [qbPffSeasons])
  const latestWrPffMap = useMemo(() => buildLatestPffSeasonMap(wrPffSeasons), [wrPffSeasons])
  const latestTePffMap = useMemo(() => buildLatestPffSeasonMap(tePffSeasons), [tePffSeasons])
  const latestRbPffMap = useMemo(() => buildLatestPffSeasonMap(rbPffSeasons), [rbPffSeasons])

  // Persistent cache: avoids recomputing the same player on year revisits
  const projCache = useRef(new Map<string, { av: number; score: number }>())

  // Set of "name|year" strings for all saved prospects — used to highlight them in the table
  const savedSet = useMemo(() => {
    const set = new Set<string>()
    for (const s of saved) set.add(`${clean(s.name)}|${s.draftSeason}`)
    return set
  }, [saved])

  useEffect(() => {
    if (!years.length) return
    if (year === null || !years.includes(year)) {
      const fallback = years.includes(currentYear) ? currentYear : years.find((y) => y <= currentYear) ?? years[0]
      setYear(fallback)
    }
  }, [years, year, currentYear])

  useEffect(() => { setOutcomeFilter('all'); setNameQuery('') }, [year, pos])

  const filtered = useMemo(() => {
    if (year === null) return []
    const q = nameQuery.trim().toLowerCase()
    return pool.filter((player) => {
      if (player.year !== year) return false
      if (pos !== 'All' && player.pos !== pos) return false
      if (q && !player.name.toLowerCase().includes(q) && !(player.school ?? '').toLowerCase().includes(q)) return false
      if (outcomeFilter !== 'all') {
        const flag = histFlagMap.get(player.id)
        if (outcomeFilter === 'flagged' && !flag) return false
        if (outcomeFilter === 'gems' && flag?.type !== 'gem') return false
        if (outcomeFilter === 'busts' && flag?.type !== 'bust') return false
      }
      return true
    })
  }, [pool, year, pos, nameQuery, outcomeFilter, histFlagMap])

  const canProject = year !== null && year >= 2018 && history.length > 0
  const useProjections = canProject

  // deferredFiltered drives the expensive computation — filtered drives the visible list.
  // The player rows appear immediately; projections fill in after the deferred pass.
  const deferredFiltered = useDeferredValue(filtered)
  const isPending = useProjections && deferredFiltered !== filtered

  const projections = useMemo(() => {
    const out = new Map<string, { av: number; score: number }>()
    if (!useProjections) return out
    // Cache key encodes inputs that affect projection output
    const inputSig = `${history.length}|${pffProfiles.length}|${y1Data?.qb.length ?? 0}|${y1Data?.wr.length ?? 0}|${y1Data?.rb.length ?? 0}|${Object.keys(careerStats ?? {}).length}|overlay:${projectionOverlay.size}`
    for (const player of deferredFiltered) {
      const cacheKey = `${player.id}|${inputSig}`
      const cached = projCache.current.get(cacheKey)
      if (cached) { out.set(player.id, cached); continue }
      const pffMatch = pffLookup.get(`${clean(player.name)}|${player.year}|${group[player.pos] ?? player.pos}`) ?? undefined
      const qbContext = player.pos === 'QB' ? getQbPffContext(player.year, player.name, qbPffSeasons) : null
      const wrContext = player.pos === 'WR' ? getWrPffContext(player.year, player.name, wrPffSeasons) : null
      const synthesized = prospectFromHistorical(player, pffMatch)
      const synthesizedWithContext = qbContext?.trajectory
        ? { ...synthesized, qbTrajectory: qbContext.trajectory }
        : wrContext?.trajectory
          ? { ...synthesized, wrTrajectory: wrContext.trajectory }
          : synthesized
      const projected = project(synthesizedWithContext, history, pffProfiles, player.id, y1Data, careerStats, undefined, qbContext?.trajectory?.gradeDelta ?? null)
      const result = { av: projected.expectedAv, score: projected.score }
      projCache.current.set(cacheKey, result)
      out.set(player.id, result)
    }
    return out
  }, [deferredFiltered, history, pffProfiles, pffLookup, useProjections, y1Data, careerStats, qbPffSeasons, wrPffSeasons, projectionOverlay])

  // O(1) player-to-PFF lookup for this class
  const pffMap = useMemo(() => {
    const map = new Map<string, PffProfile>()
    for (const player of filtered) {
      const pff = pffLookup.get(`${clean(player.name)}|${player.year}|${group[player.pos] ?? player.pos}`)
      if (pff) map.set(player.id, pff)
    }
    return map
  }, [filtered, pffLookup])

  const effectiveSortKey = !useProjections && (sortKey === 'projAv' || sortKey === 'projScore') ? 'av' : sortKey
  // Use deferredFiltered so rows and projections always come from the same snapshot —
  // avoids a jumpy/wrong sort order while projections are still computing for the new year.
  const rows = useMemo(() => {
    const factor = sortDir === 'asc' ? 1 : -1
    return deferredFiltered.slice().sort((a, b) => {
      const cmp = compareHistorical(a, b, effectiveSortKey, projections)
      if (cmp !== 0) return cmp * factor
      return (a.pick - b.pick) || a.name.localeCompare(b.name)
    })
  }, [deferredFiltered, effectiveSortKey, sortDir, projections])

  const scoreDist = useMemo(() => {
    if (!useProjections || !projections.size) return null
    const scores = rows.flatMap((r) => {
      const p = projections.get(r.id)
      return p ? [Math.round(p.score)] : []
    }).sort((a, b) => a - b)
    if (scores.length < 2) return null
    return {
      min: scores[0],
      p25: q(scores, 0.25),
      p50: q(scores, 0.50),
      p75: q(scores, 0.75),
      max: scores[scores.length - 1],
      avgScore: Math.round(scores.reduce((s, v) => s + v, 0) / scores.length),
    }
  }, [rows, projections, useProjections])

  const classSummary = useMemo(() => {
    const counted = rows.filter((r) => r.year <= matureOutcomeCutoff)
    if (!counted.length) return null
    const avgAv = counted.reduce((s, r) => s + (r.av || 0), 0) / counted.length
    const avgG = counted.reduce((s, r) => s + (r.games || 0), 0) / counted.length
    const avgSt = counted.reduce((s, r) => s + (r.starts || 0), 0) / counted.length
    const totalPb = counted.reduce((s, r) => s + (r.proBowls || 0), 0)
    const totalAp = counted.reduce((s, r) => s + (r.allPros || 0), 0)
    const projScores = rows.flatMap((r) => { const p = projections.get(r.id); return p ? [p] : [] })
    const avgProjAv = projScores.length ? projScores.reduce((s, p) => s + p.av, 0) / projScores.length : null
    const avgProjScore = projScores.length ? Math.round(projScores.reduce((s, p) => s + p.score, 0) / projScores.length) : null
    return { avgAv, avgG, avgSt, totalPb, totalAp, avgProjAv, avgProjScore }
  }, [rows, projections])

  const posRankMap = useMemo(() => {
    const byPos = new Map<string, Array<{ id: string; score: number; pick: number }>>()
    for (const player of rows) {
      const proj = projections.get(player.id)
      const score = proj ? proj.score : -(player.pick || 999)
      if (!byPos.has(player.pos)) byPos.set(player.pos, [])
      byPos.get(player.pos)!.push({ id: player.id, score, pick: player.pick })
    }
    const map = new Map<string, number>()
    for (const players of byPos.values()) {
      players.sort((a, b) => b.score - a.score || a.pick - b.pick)
      players.forEach((p, i) => map.set(p.id, i + 1))
    }
    return map
  }, [rows, projections])

  // Historical class avg score reference (2016-2022 full-class mean ≈ 54)
  const classStrength = scoreDist ? (
    scoreDist.avgScore >= 60 ? { label: 'Strong class', cls: 'csStrong' } :
    scoreDist.avgScore >= 52 ? { label: 'Avg class', cls: 'csAvg' } :
    { label: 'Weak class', cls: 'csWeak' }
  ) : null

  function toggleSort(key: SortKey) {
    if ((key === 'projAv' || key === 'projScore') && !useProjections) return
    if (key === sortKey) {
      setSortDir((current) => current === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(key === 'pick' || key === 'name' ? 'asc' : 'desc')
    }
  }

  const currentKey = clean(currentName)

  return <section className="panel tablePanel classPanel">
    <div className="panelTitle">
      <div>
        <p>Draft Class</p>
        <h2>Class Rankings</h2>
      </div>
      <div className="classTitleRight">
        <strong style={{ opacity: isPending ? 0.5 : 1 }}>{rows.length} players{isPending ? ' …' : ''}</strong>
        {classStrength && scoreDist && <span className={`classStrengthBadge ${classStrength.cls}`} title={`Class avg score ${scoreDist.avgScore} vs ~54 historical avg`}>{classStrength.label}</span>}
        {scoreDist && <ScoreRangeBar dist={scoreDist} />}
        {useProjections && <button type="button" className={`secondary scatterToggle${showScatter ? ' on' : ''}`} onClick={() => setShowScatter((v) => !v)} title="Pick vs Score scatter">scatter</button>}
      </div>
    </div>
    {showScatter && useProjections && rows.length > 0 && (
      <ClassScatter rows={rows} projections={projections} currentKey={currentKey} currentYear={currentYear} />
    )}
    <div className="classControls">
      <label className="field"><span>Year</span>
        <select value={year ?? ''} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>
      <label className="field"><span>Position</span>
        <select value={pos} onChange={(e) => setPos(e.target.value)}>
          {positionFilters.map((p) => <option key={p} value={p}>{p === 'All' ? 'All positions' : p}</option>)}
        </select>
      </label>
      <label className="field classSearch"><span>Search</span>
        <input value={nameQuery} onChange={(e) => setNameQuery(e.target.value)} placeholder="Name or school…" />
      </label>
      <div className="classControlsRight">
        <label className="field"><span>Sort by</span>
          <select value={sortKey} onChange={(e) => toggleSort(e.target.value as SortKey)}>
            {(Object.keys(sortLabels) as SortKey[]).map((key) => <option key={key} value={key} disabled={(key === 'projAv' || key === 'projScore') && !useProjections}>{sortLabels[key]}</option>)}
          </select>
        </label>
        <button type="button" className="secondary directionButton" onClick={() => setSortDir((direction) => direction === 'asc' ? 'desc' : 'asc')} aria-label="Toggle sort direction">
          {sortDir === 'desc' ? 'High to low' : 'Low to high'}
        </button>
      </div>
    </div>
    <div className="flagFilters">
      {(['all', 'gems', 'busts', 'flagged'] as const).map((f) => (
        <button key={f} type="button" className={`flagFilterBtn${outcomeFilter === f ? ' on' : ''} flagFilterBtn-${f}`} onClick={() => setOutcomeFilter(f)}>
          {f === 'all' ? 'All' : f === 'gems' ? 'Gems' : f === 'busts' ? 'Busts' : 'Flagged'}
        </button>
      ))}
    </div>
    {useProjections ? <p className="hint">Projected AV and Score use the calibrated 2016-2023 model plus each player's draft/combine and matched PFF profile when available.</p> : null}
    {explanation ? <PlayerExplanationModal explanation={explanation} onClose={() => setExplanation(null)} /> : null}
    {rows.length ? <TableWrap>
      <table className="classTable">
        <thead>
          <tr>
            <th>Rank</th>
            <ClassHeader label="Player" sortKey="name" active={effectiveSortKey} dir={sortDir} onSort={toggleSort} />
            <th>Pos</th>
            <ClassHeader label="Pick" sortKey="pick" active={effectiveSortKey} dir={sortDir} onSort={toggleSort} />
            <ClassHeader label="G" sortKey="games" active={effectiveSortKey} dir={sortDir} onSort={toggleSort} />
            <ClassHeader label="St" sortKey="starts" active={effectiveSortKey} dir={sortDir} onSort={toggleSort} />
            <ClassHeader label="AV" sortKey="av" active={effectiveSortKey} dir={sortDir} onSort={toggleSort} />
            <th title="PFF college composite grade">PFF</th>
            {useProjections ? <ClassHeader label="Proj AV" sortKey="projAv" active={effectiveSortKey} dir={sortDir} onSort={toggleSort} /> : null}
            {useProjections ? <ClassHeader label="Score" sortKey="projScore" active={effectiveSortKey} dir={sortDir} onSort={toggleSort} /> : null}
            <ClassHeader label="PB" sortKey="pb" active={effectiveSortKey} dir={sortDir} onSort={toggleSort} />
            <ClassHeader label="AP" sortKey="ap" active={effectiveSortKey} dir={sortDir} onSort={toggleSort} />
            <ClassHeader label="Outcome" sortKey="outcome" active={effectiveSortKey} dir={sortDir} onSort={toggleSort} />
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 200).flatMap((player, index) => {
            const isCurrent = currentKey && clean(player.name) === currentKey && player.year === currentYear
            const isSaved = !isCurrent && savedSet.has(`${clean(player.name)}|${player.year}`)
            const projected = projections.get(player.id)
            const showEarlySample = player.year > matureOutcomeCutoff
            const score = projected ? Math.round(projected.score) : 0
            const outcomeFlag = histFlagMap.get(player.id) ?? null
            const pffProfile = pffMap.get(player.id) ?? null
            const qbPffContext = player.pos === 'QB' ? getQbPffContext(player.year, player.name, qbPffSeasons) : null
            const wrPffContext = player.pos === 'WR' ? getWrPffContext(player.year, player.name, wrPffSeasons) : null
            const pffContextScore =
              pffProfile?.pff.composite ??
              qbPffContext?.careerWeightedPassGrade ??
              qbPffContext?.latestSeason?.grades_pass ??
              wrPffContext?.careerWeightedRouteGrade ??
              wrPffContext?.careerWeightedOffenseGrade ??
              wrPffContext?.latestSeason?.route_grade ??
              wrPffContext?.latestSeason?.offense_grade ??
              null
            const pffContextLabel = pffProfile
              ? 'PFF profile composite'
              : qbPffContext
                ? 'QB PFF season context'
                : wrPffContext
                  ? 'WR PFF season context'
                  : 'No PFF match'
            const isExpanded = expandedId === player.id
            const canExpand = pffProfile !== null || outcomeFlag !== null
            const colCount = 12 + (useProjections ? 2 : 0)
            const posRank = posRankMap.get(player.id)
            const rowEls: React.ReactNode[] = [
              <tr
                key={player.id}
                className={`${useProjections ? `classRow-${scoreClass(score)} ` : ''}${isCurrent ? 'currentRow' : isSaved ? 'savedRow' : ''}${canExpand ? ' classRowClickable' : ''}`}
                onClick={canExpand ? () => setExpandedId(isExpanded ? null : player.id) : undefined}
              >
                <td><b className="boardRank">{index + 1}</b></td>
                <td>
                  <b>{player.name}</b>
                  {isSaved && <span className="savedBadge" title="Saved prospect">★</span>}
                  <small>{player.school || 'No school'}</small>
                  <button
                    type="button"
                    className="explainBtn"
                    onClick={(e) => {
                      e.stopPropagation()
                      const pffKey = pffSeasonMapKey(player.year, player.name)
                      setExplanation(buildPlayerExplanation(player, {
                        projected,
                        pffContextScore,
                        pffContextLabel,
                        qbContext: player.pos === 'QB' ? latestQbPffMap.get(pffKey) : null,
                        wrContext: player.pos === 'WR' ? latestWrPffMap.get(pffKey) : null,
                        teContext: player.pos === 'TE' ? latestTePffMap.get(pffKey) : null,
                        rbContext: player.pos === 'RB' ? latestRbPffMap.get(pffKey) : null,
                        compSignal: compSignalMap.get(projectionOverlayKey(player.year, player.pos, player.name)) ?? null,
                        rbScoreReadySignal: rbScoreReadyMap.get(projectionOverlayKey(player.year, player.pos, player.name)) ?? null,
                        qbTranslationSignal:
                          qbTranslationMap.get(projectionOverlayKey(player.year, player.pos, player.name)) ??
                          qbTranslationMap.get(projectionOverlayKey(player.year, 'QB', player.name)) ??
                          qbTranslationMap.get(projectionOverlayKey(currentYear, 'QB', player.name)) ??
                          null,
                      }))
                    }}
                  >
                    Explain
                  </button>
                </td>
                <td><span className="posCell">{player.pos}{posRank != null && <span className="posRank">#{posRank}</span>}</span></td>
                <td>{player.pick >= 260 ? 'UDFA' : player.pick}</td>
                <td>{player.games || 0}</td>
                <td>{player.starts || 0}</td>
                <td>{player.av || 0}</td>
                <td className="pffCol" title={pffContextLabel}>
                  {pffContextScore != null ? pffContextScore.toFixed(0) : '—'}
                </td>
                {useProjections ? <td>{projected ? projected.av.toFixed(1) : '-'}</td> : null}
                {useProjections ? (() => {
                  const v57 = getV57Row(player)
                  const displayScore = v57?.v57Percentile != null ? Number(v57.v57Percentile) : (projected ? projected.score : null)
                  const delta = v57?.v57Delta != null ? Number(v57.v57Delta) : null
                  const title = v57
                    ? `V5.7P score${delta != null ? ` · Δ ${delta > 0 ? '+' : ''}${delta.toFixed(1)}` : ''}${v57.flag ? ` · ${v57.flag}` : ''}`
                    : 'V4 fallback score'
                  return <td
                    title={title}
                    style={{ color: displayScore != null ? scoreColor(displayScore) : undefined, fontWeight: displayScore != null ? 800 : undefined }}
                  >
                    {displayScore != null ? Math.round(displayScore) : '-'}
                  </td>
                })() : null}
                <td>{player.proBowls || 0}</td>
                <td>{player.allPros || 0}</td>
                <td>
                  {showEarlySample ? <span className="sampleTag">Early sample</span> : <OutcomeTag category={player.category} />}
                  {outcomeFlag && <FlagBadge flag={outcomeFlag} />}
                </td>
              </tr>,
            ]
            if (isExpanded && canExpand) {
              rowEls.push(
                <tr key={`detail-${player.id}`} className="classRowDetail">
                  <td colSpan={colCount}>
                    <div className="classDetail">
                      {pffProfile && (() => {
                        const dim = pffDimLabel(player.pos)
                        const uc = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
                        return (
                          <div className="classDetailSection">
                            <span className="classDetailLabel">PFF College Grades</span>
                            <div className="classDetailStats">
                              <div className="classDetailStat"><span>Composite</span><b>{pffProfile.pff.composite.toFixed(0)}</b></div>
                              <div className="classDetailStat"><span>Grade</span><b>{pffProfile.pff.grade.toFixed(0)}</b></div>
                              <div className="classDetailStat"><span>{uc(dim.prod)}</span><b style={{ color: pffProfile.pff.production < 52 ? 'var(--red)' : pffProfile.pff.production > 72 ? 'var(--green)' : undefined }}>{pffProfile.pff.production.toFixed(0)}</b></div>
                              <div className="classDetailStat"><span>{uc(dim.eff)}</span><b style={{ color: pffProfile.pff.efficiency < 52 ? 'var(--red)' : pffProfile.pff.efficiency > 72 ? 'var(--green)' : undefined }}>{pffProfile.pff.efficiency.toFixed(0)}</b></div>
                              <div className="classDetailStat"><span>{uc(dim.clean)}</span><b style={{ color: pffProfile.pff.clean < 52 ? 'var(--red)' : undefined }}>{pffProfile.pff.clean.toFixed(0)}</b></div>
                            </div>
                          </div>
                        )
                      })()}
                      {outcomeFlag && (
                        <div className={`classDetailFlag classDetailFlag-${outcomeFlag.type}`}>
                          <span className="classDetailFlagTitle">{outcomeFlag.type === 'bust' ? '⚠' : '↑'} {outcomeFlag.label}</span>
                          <pre className="classDetailFlagText">{outcomeFlag.tooltip}</pre>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )
            }
            return rowEls
          })}
        </tbody>
        {classSummary && (
          <tfoot>
            <tr className="classSummaryRow">
              <td colSpan={4}><b>Class avg</b></td>
              <td>{classSummary.avgG.toFixed(0)}</td>
              <td>{classSummary.avgSt.toFixed(0)}</td>
              <td>{classSummary.avgAv.toFixed(1)}</td>
              <td>—</td>
              {useProjections ? <td>{classSummary.avgProjAv != null ? classSummary.avgProjAv.toFixed(1) : '—'}</td> : null}
              {useProjections ? <td style={{ color: classSummary.avgProjScore != null ? scoreColor(classSummary.avgProjScore) : undefined }}>{classSummary.avgProjScore ?? '—'}</td> : null}
              <td>{classSummary.totalPb}</td>
              <td>{classSummary.totalAp}</td>
              <td></td>
            </tr>
          </tfoot>
        )}
      </table>
    </TableWrap> : <p className="emptyLine">No players match those filters yet. Pick a different year or position.</p>}
    {rows.length > 0 && (
      <div className="classMobileCards">
        {rows.slice(0, 100).map((player, index) => {
          const projected = projections.get(player.id)
          const score = projected ? Math.round(projected.score) : 0
          const outcomeFlag = histFlagMap.get(player.id) ?? null
          const showEarlySample = player.year > matureOutcomeCutoff
          const isCurrent = currentKey && clean(player.name) === currentKey && player.year === currentYear
          const isSavedCard = !isCurrent && savedSet.has(`${clean(player.name)}|${player.year}`)
          const posRankCard = posRankMap.get(player.id)
          return (
            <div
              key={player.id}
              className={`mobileClassCard${isCurrent ? ' mobileClassCard-current' : isSavedCard ? ' mobileClassCard-saved' : ''}${useProjections ? ` mobileClassCard-${scoreClass(score)}` : ''}`}
            >
              <div className="mobileClassCardRank">{index + 1}</div>
              <div className="mobileClassCardBody">
                <div className="mobileClassCardName">
                  {player.name}
                  {isSavedCard && <span className="savedBadge">★</span>}
                </div>
                <div className="mobileClassCardMeta">
                  {player.pos}{posRankCard != null ? <span className="posRank"> #{posRankCard}</span> : null} · {player.school || 'No school'} · Pk {player.pick >= 260 ? 'UDFA' : player.pick}
                </div>
                <div className="mobileClassCardStats">
                  <span>AV {player.av || 0}</span>
                  <span>G {player.games || 0}</span>
                  {!showEarlySample && <OutcomeTag category={player.category} />}
                </div>
                {outcomeFlag && <div className="mobileClassCardFlag"><FlagBadge flag={outcomeFlag} /></div>}
              </div>
              {useProjections && projected && (
                <div className="mobileClassCardRight">
                  <div className="mobileClassCardScore" style={{ color: scoreColor(score) }}>{score}</div>
                  <div className="mobileClassCardProjAv">AV {projected.av.toFixed(1)}</div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    )}
    {rows.length > 200 ? <p className="hint">Showing top 200 of {rows.length}. Tighten the position filter to narrow.</p> : null}
  </section>
}

function ScoreRangeBar({ dist }: { dist: { min: number; p25: number; p50: number; p75: number; max: number; avgScore: number } }) {
  const W = 160, H = 28
  const pad = 6
  const plotW = W - pad * 2
  const x = (v: number) => pad + (v / 100) * plotW
  const tiers = [
    { lo: 0,  hi: 45, color: 'var(--red)',    opacity: 0.15 },
    { lo: 45, hi: 58, color: 'var(--amber)',   opacity: 0.15 },
    { lo: 58, hi: 70, color: 'var(--green)',   opacity: 0.15 },
    { lo: 70, hi: 82, color: 'var(--accent)',  opacity: 0.15 },
    { lo: 82, hi: 100, color: 'var(--violet)', opacity: 0.15 },
  ]
  return (
    <div className="scoreRangeWrap" title={`Score range: ${dist.min}–${dist.max} · P25=${dist.p25} · P50=${dist.p50} · P75=${dist.p75} · Avg=${dist.avgScore}`}>
      <svg width={W} height={H} className="scoreRangeSvg">
        {tiers.map((t) => (
          <rect key={t.lo} x={x(t.lo)} y={4} width={x(t.hi) - x(t.lo)} height={12} fill={t.color} opacity={t.opacity} />
        ))}
        <rect x={x(dist.p25)} y={4} width={x(dist.p75) - x(dist.p25)} height={12} fill="var(--text-2)" opacity={0.25} rx={2} />
        <line x1={x(dist.min)} y1={10} x2={x(dist.max)} y2={10} stroke="var(--text-2)" strokeWidth={1.5} strokeOpacity={0.5} />
        <line x1={x(dist.p50)} y1={2} x2={x(dist.p50)} y2={18} stroke="var(--text-1)" strokeWidth={2} strokeLinecap="round" />
        <circle cx={x(dist.avgScore)} cy={10} r={3} fill="var(--accent)" />
        <text x={x(dist.p50)} y={27} textAnchor="middle" fontSize={9} fill="var(--text-2)">{dist.p50}</text>
      </svg>
      <span className="scoreRangeLabel">median score</span>
    </div>
  )
}

function ClassScatter({ rows, projections, currentKey, currentYear }: {
  rows: Historical[]
  projections: Map<string, { av: number; score: number }>
  currentKey: string
  currentYear: number
}) {
  const [tooltip, setTooltip] = useState<{ name: string; pick: number; score: number; x: number; y: number } | null>(null)
  const W = 700, H = 160
  const pad = { t: 12, r: 12, b: 28, l: 36 }
  const plotW = W - pad.l - pad.r
  const plotH = H - pad.t - pad.b
  const xScale = (pick: number) => pad.l + (Math.log(Math.min(pick, 260) + 1) / Math.log(261)) * plotW
  const yScale = (score: number) => pad.t + plotH - (clamp(score, 0, 100) / 100) * plotH
  const roundBounds = [1, 33, 65, 101, 141, 181, 221, 261]
  const roundLabels = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7']
  const dots = rows.flatMap((player) => {
    const proj = projections.get(player.id)
    if (!proj) return []
    return [{ player, score: Math.round(proj.score) }]
  })
  return (
    <div className="classScatterWrap">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="classScatterSvg" onMouseLeave={() => setTooltip(null)}>
        {[0, 25, 50, 75, 100].map((v) => (
          <line key={v} x1={pad.l} x2={W - pad.r} y1={yScale(v)} y2={yScale(v)} stroke="var(--border)" strokeWidth={v === 50 ? 1.5 : 0.75} strokeDasharray={v === 50 ? undefined : '3 3'} />
        ))}
        {[0, 25, 50, 75, 100].map((v) => (
          <text key={v} x={pad.l - 4} y={yScale(v) + 4} textAnchor="end" fontSize={9} fill="var(--text-2)">{v}</text>
        ))}
        {roundBounds.slice(0, -1).map((pick, i) => {
          const midPick = (pick + roundBounds[i + 1] - 1) / 2
          return (
            <g key={i}>
              <line x1={xScale(pick)} x2={xScale(pick)} y1={pad.t} y2={H - pad.b} stroke="var(--border)" strokeWidth={0.75} />
              <text x={xScale(midPick)} y={H - 6} textAnchor="middle" fontSize={9} fill="var(--text-2)">{roundLabels[i]}</text>
            </g>
          )
        })}
        {dots.map(({ player, score }) => {
          const cx = xScale(player.pick)
          const cy = yScale(score)
          const isCurrent = currentKey && clean(player.name) === currentKey && player.year === currentYear
          return (
            <circle
              key={player.id}
              cx={cx}
              cy={cy}
              r={isCurrent ? 5 : 3.5}
              fill={scoreColor(score)}
              opacity={isCurrent ? 1 : 0.75}
              stroke={isCurrent ? 'var(--text-1)' : 'none'}
              strokeWidth={1.5}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setTooltip({ name: player.name, pick: player.pick, score, x: cx, y: cy })}
            />
          )
        })}
        {tooltip && (
          <g>
            <rect
              x={clamp(tooltip.x - 52, pad.l, W - pad.r - 104)}
              y={tooltip.y - 36}
              width={104}
              height={28}
              rx={4}
              fill="var(--bg-2)"
              stroke="var(--border)"
            />
            <text x={clamp(tooltip.x, pad.l + 52, W - pad.r - 52)} y={tooltip.y - 22} textAnchor="middle" fontSize={9} fontWeight={700} fill="var(--text-1)">{tooltip.name}</text>
            <text x={clamp(tooltip.x, pad.l + 52, W - pad.r - 52)} y={tooltip.y - 12} textAnchor="middle" fontSize={9} fill="var(--text-2)">Pk {tooltip.pick} · Score {tooltip.score}</text>
          </g>
        )}
      </svg>
    </div>
  )
}

function ClassHeader({ label, sortKey, active, dir, onSort }: { label: string; sortKey: SortKey; active: SortKey; dir: SortDir; onSort: (key: SortKey) => void }) {
  const isActive = sortKey === active
  return <th aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
    <button type="button" className={`classSort ${isActive ? 'on' : ''}`} onClick={() => onSort(sortKey)}>
      {label}<i className="sortMark" aria-hidden="true">{isActive ? (dir === 'asc' ? '^' : 'v') : ''}</i>
    </button>
  </th>
}

function compareHistorical(a: Historical, b: Historical, key: SortKey, projections: Map<string, { av: number; score: number }>): number {
  switch (key) {
    case 'av': return (a.av || 0) - (b.av || 0)
    case 'projAv': return (projections.get(a.id)?.av ?? -Infinity) - (projections.get(b.id)?.av ?? -Infinity)
    case 'projScore': return (projections.get(a.id)?.score ?? -Infinity) - (projections.get(b.id)?.score ?? -Infinity)
    case 'games': return (a.games || 0) - (b.games || 0)
    case 'starts': return (a.starts || 0) - (b.starts || 0)
    case 'pb': return (a.proBowls || 0) - (b.proBowls || 0)
    case 'ap': return (a.allPros || 0) - (b.allPros || 0)
    case 'pick': return (a.pick || 999) - (b.pick || 999)
    case 'outcome': return outcomeOrder.indexOf(a.category) - outcomeOrder.indexOf(b.category)
    case 'name': return a.name.localeCompare(b.name)
  }
}

function prospectScoreClass(score: number): string {
  if (score >= 72) return 'pScoreHigh'
  if (score >= 58) return 'pScoreMid'
  return 'pScoreLow'
}

const QB_PICK_BUCKETS: Array<[number, number]> = [
  [1, 5], [6, 10], [11, 20], [21, 32],
  [33, 48], [49, 64], [65, 100], [101, 150], [151, 220], [221, 999],
]

function buildQbPickBaseline(history: Historical[]): (pick: number) => number {
  const qbs = history.filter(h => h.pos === 'QB' && h.pick < 260 && h.year <= 2021)
  const avgs = QB_PICK_BUCKETS.map(([lo, hi]) => {
    const bucket = qbs.filter(q => q.pick >= lo && q.pick <= hi)
    return bucket.length >= 3 ? bucket.reduce((s, q) => s + q.av, 0) / bucket.length : null
  })
  return (pick: number) => {
    for (let i = 0; i < QB_PICK_BUCKETS.length; i++) {
      const [lo, hi] = QB_PICK_BUCKETS[i]
      if (pick >= lo && pick <= hi) return avgs[i] ?? 4
    }
    return 2
  }
}

function computeQbBustRates(profiles: PffProfile[]): QbBustRates {
  const qbs = profiles.filter(p =>
    p.position === 'QB' && p.nfl !== null &&
    p.nfl.draftPick <= 100 && p.nfl.games >= 20
  )
  const isBust = (p: PffProfile) =>
    (p.nfl?.av ?? 0) < 15 || p.nfl?.category === 'Bust' || p.nfl?.category === 'Reserve'
  function rate(subset: PffProfile[]) {
    return { rate: subset.length ? subset.filter(isBust).length / subset.length : 0.5, n: subset.length }
  }
  return {
    twp:  rate(qbs.filter(p => p.pff.clean < 52)),
    eff:  rate(qbs.filter(p => p.pff.efficiency < 52)),
    prod: rate(qbs.filter(p => p.pff.production < 52)),
  }
}

function prospectRiskFlags(p: ProspectQB, bustRates: QbBustRates): RiskFlag[] {
  const rs = p.rawStats
  const flags: RiskFlag[] = []
  const pct = (n: number) => Math.round(n * 100) + '%'

  if (rs.twp_rate != null && rs.twp_rate > 4.0) {
    const br = bustRates.twp
    flags.push({
      id: 'twp', label: 'Turnover risk',
      severity: rs.twp_rate > 5.0 ? 'high' : 'medium',
      bustRate: br.n >= 5 ? br.rate : null, sampleN: br.n,
      reason: `TWP rate ${rs.twp_rate.toFixed(1)}% exceeds the 4.0% threshold. QBs with low clean-pocket grades drafted in the top 3 rounds bust at ${br.n >= 5 ? pct(br.rate) : 'insufficient data'} (n=${br.n}).`,
    })
  }
  if (rs.accuracy_percent != null && rs.accuracy_percent < 56) {
    const br = bustRates.eff
    flags.push({
      id: 'acc', label: 'Accuracy',
      severity: rs.accuracy_percent < 52 ? 'high' : 'medium',
      bustRate: br.n >= 5 ? br.rate : null, sampleN: br.n,
      reason: `Adjusted accuracy ${rs.accuracy_percent.toFixed(1)}% below the 56% floor. Low efficiency QBs drafted top 3 rounds bust at ${br.n >= 5 ? pct(br.rate) : 'insufficient data'} (n=${br.n}).`,
    })
  }
  if (rs.ypa != null && rs.ypa < 6.5) {
    const br = bustRates.prod
    flags.push({
      id: 'ypa', label: 'Low YPA',
      severity: rs.ypa < 6.0 ? 'high' : 'medium',
      bustRate: br.n >= 5 ? br.rate : null, sampleN: br.n,
      reason: `YPA ${rs.ypa.toFixed(1)} below 6.5. QBs with low production grades drafted top 3 rounds bust at ${br.n >= 5 ? pct(br.rate) : 'insufficient data'} (n=${br.n}).`,
    })
  }
  if (rs.btt_rate != null && rs.btt_rate < 7.5) {
    flags.push({
      id: 'btt', label: 'Low BTT%',
      severity: 'medium', bustRate: null, sampleN: 0,
      reason: `Big-time throw rate ${rs.btt_rate.toFixed(1)}% below 7.5% — limited downfield creation suggests a ceiling concern against NFL-caliber secondaries.`,
    })
  }
  if (p.trajectory.label === 'declining') {
    flags.push({
      id: 'decline', label: 'Declining',
      severity: (p.trajectory.gradeDelta ?? 0) <= -12 ? 'high' : 'medium',
      bustRate: null, sampleN: 0,
      reason: `PFF grade fell ${p.trajectory.gradeDelta != null ? Math.abs(p.trajectory.gradeDelta).toFixed(1) + ' pts' : ''} from 2024→2025. QBs entering the draft on a downward arc project 8–12 pts lower in model outcomes.`,
    })
  }
  if (!p.priorStats) {
    flags.push({
      id: 'sample', label: '1-yr data',
      severity: 'medium', bustRate: null, sampleN: 0,
      reason: `Only 2025 college season available — no prior-year context. Single-season projections carry ±10–15 pts wider confidence range and no trajectory signal.`,
    })
  }
  return flags
}

// Per-position slow/fast 40-yd thresholds
const slowForPos: Partial<Record<string, number>> = { QB: 4.85, WR: 4.55, RB: 4.55, TE: 4.78, OL: 5.38, DL: 4.98, LB: 4.78, CB: 4.55, S: 4.62 }
const fastForPos: Partial<Record<string, number>> = { WR: 4.40, RB: 4.42, CB: 4.40, S: 4.45, LB: 4.56, TE: 4.62, DL: 4.72 }

// Position-aware semantic labels for the 3 PFF dimensions that vary by role
function pffDimLabel(pos: string): { clean: string; eff: string; prod: string } {
  switch (group[pos] ?? 'SKILL') {
    case 'QB':    return { clean: 'turnover avoidance', eff: 'decision-making', prod: 'per-game output' }
    case 'SKILL': return { clean: 'ball security', eff: 'yards per route', prod: 'per-game output' }
    case 'OL':    return { clean: 'sack prevention', eff: 'pass block rate', prod: 'block volume' }
    case 'FRONT': return { clean: 'discipline', eff: 'pass rush rate', prod: 'disruption' }
    case 'DB':    return { clean: 'discipline', eff: 'coverage success', prod: 'per-game impact' }
    default:      return { clean: 'clean', eff: 'efficiency', prod: 'production' }
  }
}

function bustReasonLabel(player: Historical, profile: PffProfile | null): string {
  const dim = pffDimLabel(player.pos)
  if (profile) {
    if (profile.pff.clean < 52 && profile.pff.efficiency < 52)
      return `Poor ${dim.clean} & ${dim.eff} (${profile.pff.clean.toFixed(0)} / ${profile.pff.efficiency.toFixed(0)})`
    if (profile.pff.clean < 52) return `Poor ${dim.clean} (${profile.pff.clean.toFixed(0)})`
    if (profile.pff.efficiency < 52) return `Low ${dim.eff} (${profile.pff.efficiency.toFixed(0)})`
    if (profile.pff.production < 52) return `${dim.prod} gap (${profile.pff.production.toFixed(0)})`
    const thresh = slowForPos[player.pos]
    if (thresh && player.forty != null && player.forty > thresh)
      return `Slow for position (${player.forty.toFixed(2)}s) — grades didn't warn`
    if (player.age != null && player.age >= 24)
      return `Older prospect (age ${player.age.toFixed(1)}) — comp ${profile.pff.composite.toFixed(0)} didn't translate`
    return `High grades, didn't translate (comp ${profile.pff.composite.toFixed(0)}, AV ${player.av})`
  }
  const thresh = slowForPos[player.pos]
  if (thresh && player.forty != null && player.forty > thresh)
    return `Slow for position (${player.forty.toFixed(2)}s)`
  if (player.age != null && player.age >= 24)
    return `Older prospect (age ${player.age.toFixed(1)})`
  if (player.vertical != null && player.vertical < 28)
    return `Poor explosion (vert ${player.vertical.toFixed(0)}")`
  return `No standout college signal (AV ${player.av})`
}

function gemReasonLabel(player: Historical, profile: PffProfile | null): string {
  const dim = pffDimLabel(player.pos)
  if (profile) {
    if (profile.pff.efficiency > 72) return `Elite ${dim.eff} (${profile.pff.efficiency.toFixed(0)})`
    if (profile.pff.grade > 75) return `Elite college grade (${profile.pff.grade.toFixed(0)})`
    if (profile.pff.composite > 70) return `Undervalued composite (${profile.pff.composite.toFixed(0)})`
    if (profile.pff.production > 72) return `High ${dim.prod} (${profile.pff.production.toFixed(0)})`
    const thresh = fastForPos[player.pos]
    if (thresh && player.forty != null && player.forty <= thresh)
      return `Elite speed (${player.forty.toFixed(2)}s) with solid grades`
    if (player.age != null && player.age <= 21.5)
      return `Young for class (age ${player.age.toFixed(1)}) — high ceiling`
    return `Solid profile, undervalued (comp ${profile.pff.composite.toFixed(0)}, AV ${player.av})`
  }
  const thresh = fastForPos[player.pos]
  if (thresh && player.forty != null && player.forty <= thresh)
    return `Elite speed (${player.forty.toFixed(2)}s)`
  if (player.age != null && player.age <= 21.5)
    return `Young for class (age ${player.age.toFixed(1)})`
  if (player.vertical != null && player.vertical >= 38)
    return `Elite explosiveness (vert ${player.vertical.toFixed(0)}")`
  if (player.broad != null && player.broad >= 128)
    return `Elite burst (broad ${player.broad}")`
  return `Outperformed profile (AV ${player.av})`
}

function buildBustTooltip(player: Historical, profile: PffProfile | null, reason: string): string {
  const dim = pffDimLabel(player.pos)
  const lines = [
    `Pick #${player.pick} · ${player.year} · ${player.pos}`,
    `AV ${player.av} · ${player.games} games · ${player.starts} starts`,
    `Outcome: ${player.category}`,
  ]
  if (profile) {
    lines.push(`PFF composite ${profile.pff.composite.toFixed(0)} · grade ${profile.pff.grade.toFixed(0)} · ${dim.prod} ${profile.pff.production.toFixed(0)}`)
    lines.push(`${dim.eff} ${profile.pff.efficiency.toFixed(0)} · ${dim.clean} ${profile.pff.clean.toFixed(0)}`)
  }
  lines.push(`Miss reason: ${reason}`)
  return lines.join('\n')
}

function buildGemTooltip(player: Historical, profile: PffProfile | null, reason: string): string {
  const dim = pffDimLabel(player.pos)
  const lines = [
    `Pick #${player.pick} · ${player.year} · ${player.pos}`,
    `AV ${player.av} · ${player.games} games${player.proBowls > 0 ? ` · ${player.proBowls}× Pro Bowl` : ''}`,
    `Outcome: ${player.category}`,
  ]
  if (profile) {
    lines.push(`PFF composite ${profile.pff.composite.toFixed(0)} · grade ${profile.pff.grade.toFixed(0)} · ${dim.prod} ${profile.pff.production.toFixed(0)}`)
    lines.push(`${dim.eff} ${profile.pff.efficiency.toFixed(0)} · ${dim.clean} ${profile.pff.clean.toFixed(0)}`)
  }
  lines.push(`Success driver: ${reason}`)
  return lines.join('\n')
}

function collegeTooltip(player: Historical, profile: PffProfile | null, kind: 'bust' | 'gem', reason: string): string {
  const dim = pffDimLabel(player.pos)
  const nflLine = player.games > 0 ? `NFL so far: ${player.games} games, AV ${player.av}` : 'No NFL games yet'
  return [
    `Pick #${player.pick >= 260 ? 'UDFA' : player.pick} · ${player.year} · ${player.pos}`,
    nflLine,
    `${kind === 'bust' ? 'Risk factor' : 'Standout factor'}: ${reason}`,
    ...(profile ? [
      `PFF composite ${profile.pff.composite.toFixed(0)} · grade ${profile.pff.grade.toFixed(0)} · ${dim.prod} ${profile.pff.production.toFixed(0)}`,
      `${dim.eff} ${profile.pff.efficiency.toFixed(0)} · ${dim.clean} ${profile.pff.clean.toFixed(0)}`,
    ] : []),
    'College-metric flag — no mature NFL data yet',
  ].join('\n')
}

function classifyHistoricalOutcome(player: Historical, profile: PffProfile | null): HistoricalOutcomeFlag | null {
  // ── Mature outcomes (2021 and earlier) ───────────────────────────────────
  if (player.year <= compCutoffYear) {
    if (player.games < 20) return null
    const isBust = player.pick < 100 &&
      (player.av < 12 || player.category === 'Bust' || player.category === 'Reserve')
    const isGem =
      (player.pick >= 33 && player.pick < 100 && (player.category === 'Star' || player.category === 'High-end starter')) ||
      (player.pick >= 100 && (player.category === 'Star' || player.category === 'High-end starter' || player.category === 'Starter'))
    if (isBust) {
      const detail = bustReasonLabel(player, profile)
      return { type: 'bust', label: detail, detail, tooltip: buildBustTooltip(player, profile, detail) }
    }
    if (isGem) {
      const detail = gemReasonLabel(player, profile)
      return { type: 'gem', label: detail, detail, tooltip: buildGemTooltip(player, profile, detail) }
    }
    return null
  }

  // ── Early-career signals (2022-2025) ─────────────────────────────────────
  if (player.year >= 2022 && player.year <= 2025 && player.games >= 16) {
    const avRate = player.av / (player.games / 17)
    const isEarlyBust = player.pick < 64 && avRate < 3.0
    const isEarlyGem = player.pick >= 64 && avRate >= 5.0
    if (isEarlyBust) {
      const dim = pffDimLabel(player.pos)
      let metric = `${avRate.toFixed(1)} AV/season`
      if (profile) {
        if (profile.pff.clean < 52 && profile.pff.efficiency < 52)
          metric = `poor ${dim.clean} & ${dim.eff} in college (${profile.pff.clean.toFixed(0)} / ${profile.pff.efficiency.toFixed(0)})`
        else if (profile.pff.clean < 52)
          metric = `poor ${dim.clean} in college (${profile.pff.clean.toFixed(0)})`
        else if (profile.pff.efficiency < 52)
          metric = `low ${dim.eff} in college (${profile.pff.efficiency.toFixed(0)})`
        else if (profile.pff.production < 52)
          metric = `low ${dim.prod} in college (${profile.pff.production.toFixed(0)})`
      } else {
        const thresh = slowForPos[player.pos]
        if (thresh && player.forty != null && player.forty > thresh)
          metric = `slow 40 (${player.forty.toFixed(2)}s)`
        else if (player.age != null && player.age >= 24)
          metric = `older prospect (age ${player.age.toFixed(1)})`
      }
      const label = `Early bust signal: ${metric}`
      const tooltip = [
        `Pick #${player.pick} · ${player.year} · ${player.pos} — Early-career signal`,
        `AV ${player.av} in ${player.games} games (${avRate.toFixed(1)}/season pace)`,
        `Round ${player.pick <= 32 ? '1' : '2'} pick underperforming slot`,
        ...(profile ? [
          `PFF college: composite ${profile.pff.composite.toFixed(0)} · grade ${profile.pff.grade.toFixed(0)} · ${dim.prod} ${profile.pff.production.toFixed(0)}`,
          `${dim.eff} ${profile.pff.efficiency.toFixed(0)} · ${dim.clean} ${profile.pff.clean.toFixed(0)}`,
        ] : []),
        `Note: early sample — outcome may change`,
      ].join('\n')
      return { type: 'bust', label, detail: label, tooltip }
    }
    if (isEarlyGem) {
      const dim = pffDimLabel(player.pos)
      let metric = `${avRate.toFixed(1)} AV/season pace`
      if (profile) {
        if (profile.pff.efficiency > 72)
          metric = `elite ${dim.eff} in college (${profile.pff.efficiency.toFixed(0)})`
        else if (profile.pff.grade > 75)
          metric = `elite college grade (${profile.pff.grade.toFixed(0)})`
        else if (profile.pff.composite > 70)
          metric = `top-tier composite (${profile.pff.composite.toFixed(0)})`
      } else {
        const thresh = fastForPos[player.pos]
        if (thresh && player.forty != null && player.forty <= thresh)
          metric = `elite speed (${player.forty.toFixed(2)}s)`
        else if (player.age != null && player.age <= 21.5)
          metric = `young for class (age ${player.age.toFixed(1)})`
      }
      const label = `Early gem signal: ${metric}`
      const tooltip = [
        `Pick #${player.pick} · ${player.year} · ${player.pos} — Early-career signal`,
        `AV ${player.av} in ${player.games} games (${avRate.toFixed(1)}/season pace)`,
        `Round 3+ pick outperforming slot`,
        ...(profile ? [
          `PFF college: composite ${profile.pff.composite.toFixed(0)} · grade ${profile.pff.grade.toFixed(0)} · ${dim.prod} ${profile.pff.production.toFixed(0)}`,
          `${dim.eff} ${profile.pff.efficiency.toFixed(0)} · ${dim.clean} ${profile.pff.clean.toFixed(0)}`,
        ] : []),
        `Note: early sample — outcome may improve further`,
      ].join('\n')
      return { type: 'gem', label, detail: label, tooltip }
    }
  }

  // ── College-metric signals (2022-2026, < 16 NFL games) ───────────────────
  if (player.year >= 2022 && player.year <= 2026 && player.games < 16) {
    const dim = pffDimLabel(player.pos)
    if (profile) {
      // Bust risk: top-64 pick with below-average college metrics (CPS < 44)
      if (player.pick <= 64) {
        if (profile.pff.clean < 52 && profile.pff.efficiency < 52) {
          const reason = `poor ${dim.clean} & ${dim.eff} (${profile.pff.clean.toFixed(0)} / ${profile.pff.efficiency.toFixed(0)})`
          const label = `College risk: ${reason}`
          return { type: 'bust', label, detail: label, tooltip: collegeTooltip(player, profile, 'bust', reason) }
        }
        if (profile.pff.clean < 52) {
          const reason = `poor ${dim.clean} in college (${profile.pff.clean.toFixed(0)})`
          const label = `College risk: ${reason}`
          return { type: 'bust', label, detail: label, tooltip: collegeTooltip(player, profile, 'bust', reason) }
        }
        if (profile.pff.efficiency < 52) {
          const reason = `below-avg ${dim.eff} in college (${profile.pff.efficiency.toFixed(0)})`
          const label = `College risk: ${reason}`
          return { type: 'bust', label, detail: label, tooltip: collegeTooltip(player, profile, 'bust', reason) }
        }
        if (profile.pff.production < 52) {
          const reason = `below-avg ${dim.prod} in college (${profile.pff.production.toFixed(0)})`
          const label = `College risk: ${reason}`
          return { type: 'bust', label, detail: label, tooltip: collegeTooltip(player, profile, 'bust', reason) }
        }
      }
      // Gem signal: pick 33+ with elite college metrics
      if (player.pick >= 33) {
        const isQB = player.pos === 'QB'
        // QBs: data shows PFF is near-zero predictive for picks 65+. Gate gems to picks ≤100
        // and require both strong average metrics AND multi-dimension alignment.
        const qbMultiSignal = isQB
          ? (profile.pff.efficiency > 70 ? 1 : 0) + (profile.pff.grade > 72 ? 1 : 0) + (profile.pff.composite > 68 ? 1 : 0) >= 2
          : true
        const qbGate = !isQB || (player.pick <= 100 && (profile.pff.composite + profile.pff.grade) / 2 > 70 && qbMultiSignal)
        if (qbGate) {
          if (profile.pff.efficiency > 72) {
            const reason = `elite ${dim.eff} in college (${profile.pff.efficiency.toFixed(0)})`
            const label = `College standout: ${reason}`
            return { type: 'gem', label, detail: label, tooltip: collegeTooltip(player, profile, 'gem', reason) }
          }
          if (player.pick >= 65 && profile.pff.grade > 75) {
            const reason = `elite college grade (${profile.pff.grade.toFixed(0)})`
            const label = `College standout: ${reason}`
            return { type: 'gem', label, detail: label, tooltip: collegeTooltip(player, profile, 'gem', reason) }
          }
          if (player.pick >= 65 && profile.pff.composite > 70) {
            const reason = `top-tier composite for position (${profile.pff.composite.toFixed(0)})`
            const label = `College standout: ${reason}`
            return { type: 'gem', label, detail: label, tooltip: collegeTooltip(player, profile, 'gem', reason) }
          }
        }
      }
    }
    // No PFF profile: fall back to combine metrics
    if (player.pick <= 64) {
      const thresh = slowForPos[player.pos]
      if (thresh && player.forty != null && player.forty > thresh) {
        const reason = `slow for position (${player.forty.toFixed(2)}s 40)`
        const label = `College risk: ${reason}`
        return { type: 'bust', label, detail: label, tooltip: collegeTooltip(player, null, 'bust', reason) }
      }
      if (player.age != null && player.age >= 24) {
        const reason = `older prospect (age ${player.age.toFixed(1)})`
        const label = `College risk: ${reason}`
        return { type: 'bust', label, detail: label, tooltip: collegeTooltip(player, null, 'bust', reason) }
      }
    }
    // QBs without PFF data can't be reliably gem-flagged on athleticism alone
    if (player.pick >= 65 && player.pos !== 'QB') {
      const thresh = fastForPos[player.pos]
      if (thresh && player.forty != null && player.forty <= thresh) {
        const reason = `elite speed (${player.forty.toFixed(2)}s 40)`
        const label = `College standout: ${reason}`
        return { type: 'gem', label, detail: label, tooltip: collegeTooltip(player, null, 'gem', reason) }
      }
      if (player.age != null && player.age <= 21.5) {
        const reason = `young for class (age ${player.age.toFixed(1)})`
        const label = `College standout: ${reason}`
        return { type: 'gem', label, detail: label, tooltip: collegeTooltip(player, null, 'gem', reason) }
      }
    }
  }

  return null
}

function buildHistoricalFlagMap(history: Historical[], pffProfiles: PffProfile[]): Map<string, HistoricalOutcomeFlag> {
  const map = new Map<string, HistoricalOutcomeFlag>()
  for (const player of history) {
    const profile = pffProfiles.find((pf) => samePlayerSeason(pf, player.name, player.year, player.pos)) ?? null
    const flag = classifyHistoricalOutcome(player, profile)
    if (flag) map.set(player.id, flag)
  }
  return map
}

function extractPatternAlerts(
  fullComps: Array<{ player: Historical; sim: number }>,
  histFlagMap: Map<string, HistoricalOutcomeFlag>,
): PatternAlert[] {
  const alerts: PatternAlert[] = []
  const bustMatches = fullComps
    .filter((c) => c.sim >= 0.22 && histFlagMap.get(c.player.id)?.type === 'bust')
    .slice(0, 5)
    .map((c) => {
      const flag = histFlagMap.get(c.player.id)!
      return { name: c.player.name, year: c.player.year, pick: c.player.pick, av: c.player.av, pos: c.player.pos, reason: flag.detail }
    })
  const gemMatches = fullComps
    .filter((c) => c.sim >= 0.22 && histFlagMap.get(c.player.id)?.type === 'gem')
    .slice(0, 5)
    .map((c) => {
      const flag = histFlagMap.get(c.player.id)!
      return { name: c.player.name, year: c.player.year, pick: c.player.pick, av: c.player.av, pos: c.player.pos, reason: flag.detail }
    })
  if (bustMatches.length >= 2) {
    const reasons = [...new Set(bustMatches.map((m) => m.reason))]
    alerts.push({
      type: 'bust-risk',
      label: 'Miss-pattern alert',
      matches: bustMatches,
      description: `${bustMatches.length} close comps busted despite high draft investment. Shared miss reason${reasons.length > 1 ? 's' : ''}: ${reasons.join(', ')}.`,
    })
  }
  if (gemMatches.length >= 2) {
    const reasons = [...new Set(gemMatches.map((m) => m.reason))]
    alerts.push({
      type: 'gem-upside',
      label: 'Hidden-gem signal',
      matches: gemMatches,
      description: `${gemMatches.length} close comps outperformed their draft slot. Shared success driver${reasons.length > 1 ? 's' : ''}: ${reasons.join(', ')}.`,
    })
  }
  return alerts
}

function pickValueLabel(surplus: number): { label: string; cls: string } {
  if (surplus >= 12)  return { label: 'Elite value',  cls: 'pValueElite' }
  if (surplus >= 6)   return { label: 'Good value',   cls: 'pValueGood' }
  if (surplus >= 0)   return { label: 'Fair value',   cls: 'pValueFair' }
  if (surplus >= -6)  return { label: 'Slight reach', cls: 'pValueReach' }
  if (surplus >= -12) return { label: 'Reach',        cls: 'pValueBig' }
  return { label: 'Big reach', cls: 'pValueBig' }
}

function trajectoryDisplay(t: ProspectTrajectory): { icon: string; label: string; cls: string } {
  if (t.label === 'rising')   return { icon: '↑', label: t.gradeDelta != null ? `+${t.gradeDelta.toFixed(1)}` : '↑', cls: 'tRising' }
  if (t.label === 'declining') return { icon: '↓', label: t.gradeDelta != null ? `${t.gradeDelta.toFixed(1)}` : '↓', cls: 'tDeclining' }
  if (t.label === 'stable')   return { icon: '→', label: t.gradeDelta != null ? (t.gradeDelta >= 0 ? `+${t.gradeDelta.toFixed(1)}` : `${t.gradeDelta.toFixed(1)}`) : '→', cls: 'tStable' }
  return { icon: '–', label: '1 yr', cls: 'tUnknown' }
}

function ProspectsView({ prospects2027, history, pffProfiles, careerStats, histFlagMap, qbPffSeasons, wrPffSeasons, onLoad }: {
  prospects2027: ProspectQB[]
  history: Historical[]
  pffProfiles: PffProfile[]
  careerStats: CareerStatMap
  histFlagMap: Map<string, HistoricalOutcomeFlag>
  qbPffSeasons: QbPffSeason[]
  wrPffSeasons: WrPffSeason[]
  onLoad: (p: ProspectQB) => void
}) {
  const [nameFilter, setNameFilter] = useState('')
  const [minGrade, setMinGrade] = useState(0)
  const [sortBy, setSortBy] = useState<'score' | 'pff' | 'pick' | 'trend' | 'value'>('score')
  const [trendFilter, setTrendFilter] = useState<'all' | 'rising' | 'stable' | 'declining'>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const pickBaseline = useMemo(() => buildQbPickBaseline(history), [history])
  const bustRates = useMemo(() => computeQbBustRates(pffProfiles), [pffProfiles])

  const ranked = useMemo(() => {
    if (!history.length) return []
    return prospects2027.map((p) => {
      const qbContext = getQbPffContext(p.draftSeason, p.name, qbPffSeasons)
      const prospectWithQbContext = qbContext?.trajectory ? { ...p, qbTrajectory: qbContext.trajectory } : p
      const gradeDelta = qbContext?.trajectory?.gradeDelta ?? p.trajectory.gradeDelta
      const proj = project(prospectWithQbContext, history, pffProfiles, undefined, undefined, careerStats, undefined, gradeDelta)
      const baseline = pickBaseline(p.pick)
      const pickSurplus = proj.expectedAv - baseline
      const riskFlags = prospectRiskFlags(p, bustRates)
      const patternAlerts = extractPatternAlerts(proj.fullComps, histFlagMap)
      return { prospect: p, proj, pickBaseline: baseline, pickSurplus, riskFlags, patternAlerts }
    })
  }, [prospects2027, history, pffProfiles, careerStats, pickBaseline, bustRates, histFlagMap, qbPffSeasons])

  const sorted = useMemo(() => {
    const base = [...ranked]
    if (sortBy === 'pff')   base.sort((a, b) => b.prospect.pffComposite - a.prospect.pffComposite)
    else if (sortBy === 'pick')  base.sort((a, b) => a.prospect.pick - b.prospect.pick)
    else if (sortBy === 'trend') base.sort((a, b) => (b.prospect.trajectory.gradeDelta ?? -999) - (a.prospect.trajectory.gradeDelta ?? -999))
    else if (sortBy === 'value') base.sort((a, b) => b.pickSurplus - a.pickSurplus)
    else base.sort((a, b) => b.proj.score - a.proj.score)
    return base
  }, [ranked, sortBy])

  const filtered = useMemo(() => {
    const q = nameFilter.trim().toLowerCase()
    return sorted.filter((r) => {
      if (minGrade > 0 && r.prospect.pffComposite < minGrade) return false
      if (trendFilter !== 'all' && r.prospect.trajectory.label !== trendFilter) return false
      if (q && !r.prospect.name.toLowerCase().includes(q) && !r.prospect.school.toLowerCase().includes(q)) return false
      return true
    })
  }, [sorted, nameFilter, minGrade, trendFilter])

  if (!history.length) return <div className="panel empty"><p>Loading model data…</p></div>
  if (!prospects2027.length) return <div className="panel empty"><p>No 2027 QB prospect data loaded.</p></div>

  const qbHistCount = history.filter((p) => p.pos === 'QB').length

  return (
    <div className="prospectsPage">
      <div className="prospectsPageHeader">
        <div>
          <h2>Future Prospects</h2>
          <p className="prospectsPageSub">
            {filtered.length} of {ranked.length} QBs · 2025 college season PFF data
          </p>
        </div>
        <div className="prospectsFilters">
          <input
            className="prospectsSearch"
            placeholder="Filter by name or school"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
          />
          <select value={minGrade} onChange={(e) => setMinGrade(Number(e.target.value))}>
            <option value={0}>All grades</option>
            <option value={80}>80+ PFF grade</option>
            <option value={85}>85+ PFF grade</option>
            <option value={90}>90+ PFF grade</option>
          </select>
          <select value={trendFilter} onChange={(e) => setTrendFilter(e.target.value as typeof trendFilter)}>
            <option value="all">All trends</option>
            <option value="rising">Rising ↑</option>
            <option value="stable">Stable →</option>
            <option value="declining">Declining ↓</option>
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
            <option value="score">Sort: Proj score</option>
            <option value="value">Sort: Pick value</option>
            <option value="pff">Sort: PFF grade</option>
            <option value="pick">Sort: Pick range</option>
            <option value="trend">Sort: '24→'25 trend</option>
          </select>
        </div>
      </div>

      <div className="prospectsNote">
        <strong>Scoring:</strong> PFF college signals (grade, BTT%, YPA, accuracy%, TWP%) map to the same
        model inputs used for NFL prospects, matched against {qbHistCount} historical QBs (2000–2021).
        Athletic/size signals use QB positional averages — no combine data until after the 2026 season.{' '}
        <strong>Trend</strong> (↑↓→) shows the 2024→2025 PFF grade change and adjusts the projection forward
        for each QB's expected 2026 arc: rising prospects receive a modest score boost, declining ones a penalty.
        QBs with only one year of data show "1 yr."
      </div>

      <div className="prospectsTable">
        <div className="prospectsTableHead">
          <span>#</span>
          <span>Name</span>
          <span>School</span>
          <span className="pColNum">Pick Range</span>
          <span className="pColNum">Score</span>
          <span className="pColNum">Value</span>
          <span className="pColNum">PFF Off</span>
          <span className="pColNum">Trend</span>
          <span className="pColNum">YPA</span>
          <span className="pColNum">BTT%</span>
          <span className="pColNum">TWP%</span>
          <span></span>
        </div>
        {filtered.flatMap((r, i) => {
          const p = r.prospect
          const proj = r.proj
          const rs = p.rawStats
          const td = trajectoryDisplay(p.trajectory)
          const rowId = p.name + p.school
          const isExpanded = expandedId === rowId
          const surplus = r.pickSurplus
          const vl = pickValueLabel(surplus)
          const twpClass = rs.twp_rate != null
            ? rs.twp_rate <= 2.5 ? 'epaHigh' : rs.twp_rate >= 4.0 ? 'epaLow' : ''
            : ''
          const rows = [
            <div key={rowId} className={`prospectsTableRow${isExpanded ? ' pRowExpanded' : ''}`}
              onClick={(e) => { if ((e.target as HTMLElement).closest('.pActions')) return; setExpandedId(isExpanded ? null : rowId) }}>
              <span className="pRank">{i + 1}</span>
              <span className="pName">
                <span className="pNameText">{p.name}</span>
                <span className="pSchoolSub">{p.school}</span>
              </span>
              <span className="pSchool pSchoolDesk">{p.school}</span>
              <span className={`pColNum pPickRange ${pickBandClass(p.pick)}`}>{pickRangeLabel(p.pick)}</span>
              <span className={`pColNum pScore ${prospectScoreClass(proj.score)}`}>
                {Math.round(proj.score)}
                <span className="pScoreRange">{Math.round(proj.scoreLow)}–{Math.round(proj.scoreHigh)}</span>
              </span>
              <span className={`pColNum pValue ${vl.cls}`}>
                {surplus >= 0 ? '+' : ''}{surplus.toFixed(1)}
                <span className="pValueLabel">{vl.label}</span>
              </span>
              <span className="pColNum pPffGrade">{rs.grades_offense?.toFixed(1) ?? '—'}</span>
              <span className={`pColNum pTrend ${td.cls}`} title={p.trajectory.label}>
                <span className="pTrendIcon">{td.icon}</span>
                <span className="pTrendVal">{td.label}</span>
              </span>
              <span className="pColNum">{rs.ypa?.toFixed(1) ?? '—'}</span>
              <span className="pColNum">{rs.btt_rate?.toFixed(1) ?? '—'}</span>
              <span className={`pColNum ${twpClass}`}>{rs.twp_rate?.toFixed(1) ?? '—'}</span>
              <span className="pActions">
                <button type="button" className="secondary smallButton" onClick={() => onLoad(p)}>Load</button>
              </span>
            </div>,
          ]
          if (isExpanded) rows.push(
            <div key={`detail-${rowId}`} className="prospectsDetailRow">
              <div className="pDetailPick">
                <span>Est. pick <b>#{p.pick}</b> · {pickRangeLabel(p.pick)}</span>
                <span>Historical avg AV at slot: <b>{r.pickBaseline.toFixed(1)}</b></span>
                <span>Model projected AV: <b>{proj.expectedAv.toFixed(1)}</b></span>
                <span className={vl.cls}>Value vs. pick: <b>{surplus >= 0 ? '+' : ''}{surplus.toFixed(1)}</b> — {vl.label}</span>
              </div>
              <div className="pDetailOdds">
                <span className="pDetailSectionLabel">Outcome odds</span>
                {([...outcomeOrder].reverse() as Category[]).map((cat) => {
                  const oddsVal = Math.round((proj.odds[cat] ?? 0) * 100)
                  return (
                    <div key={cat} className="pOddsRow">
                      <span className="pOddsLabel">{cat}</span>
                      <div className="pOddsBarWrap"><div className="pOddsBar" style={{ width: `${oddsVal}%` }} /></div>
                      <span className="pOddsPct">{oddsVal}%</span>
                    </div>
                  )
                })}
              </div>
              {r.riskFlags.length > 0 ? (
                <div className="pDetailRisks">
                  <span className="pDetailSectionLabel">Miss risk factors</span>
                  {r.riskFlags.map((f) => (
                    <div key={f.id} className={`pDetailRisk ${f.severity === 'high' ? 'riskHigh' : 'riskMed'}`}>
                      <div className="pRiskHeader">
                        <span className="pRiskLabel">{f.label}</span>
                        {f.bustRate != null && (
                          <span className="pRiskRate">{Math.round(f.bustRate * 100)}% bust rate · n={f.sampleN}</span>
                        )}
                      </div>
                      <p className="pRiskReason">{f.reason}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="pDetailRisks pDetailNoRisk">
                  <span>✓ No significant risk flags identified for this prospect.</span>
                </div>
              )}
              {r.patternAlerts.length > 0 && (
                <div className="pDetailPatterns">
                  {r.patternAlerts.map((alert) => (
                    <div key={alert.type} className={`patternAlert patternAlert-${alert.type}`}>
                      <span className="patternAlertLabel">{alert.type === 'bust-risk' ? '⚠' : '↑'} {alert.label}</span>
                      <p className="patternAlertDesc">{alert.description}</p>
                      <div className="patternAlertMatches">
                        {alert.matches.map((m) => (
                          <span key={`${m.name}${m.year}`} className="patternMatchItem">{m.name} ({m.year}, #{m.pick >= 260 ? 'UDFA' : m.pick}) · AV {m.av} · {m.reason}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
          return rows
        })}
      </div>
    </div>
  )
}

function readPageFromHash(): Page {
  if (typeof window === 'undefined') return 'workbench'
  const map: Record<string, Page> = { '#class': 'class', '#players': 'players', '#compare': 'compare', '#trade': 'trade', '#guide': 'guide', '#prospects': 'prospects' }
  return map[window.location.hash] ?? 'workbench'
}

function readSavedProspects(): SavedProspect[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(savedKey) || window.localStorage.getItem(previousSavedKey) || '[]'
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item, index) => {
        const prospect = prospectFromUnknown(item)
        if (!prospect) return null
        const record = asRecord(item)
        return { ...prospect, id: stringField(record, 'id', `${Date.now()}-${index}`), updatedAt: stringField(record, 'updatedAt', new Date().toISOString()) }
      })
      .filter((item): item is SavedProspect => item !== null)
  } catch {
    return []
  }
}

function writeSavedProspects(saved: SavedProspect[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(savedKey, JSON.stringify(saved))
}

function stripSavedFields(saved: SavedProspect): Prospect {
  const { id: _id, updatedAt: _updatedAt, notes: _notes, ...prospect } = saved
  return prospect
}

function prospectFromHistorical(player: Historical, pff?: PffProfile, ras?: AppRasRecord | null): Prospect {
  const baseline = player.pick <= 32 ? 84 : player.pick <= 64 ? 78 : player.pick <= 100 ? 72 : player.pick <= 150 ? 66 : 60
  const template = withPositionDefaults(blankProspect, player.pos)
  return {
    ...template,
    name: player.name,
    school: player.school,
    pos: player.pos,
    draftSeason: player.year,
    pick: player.pick || template.pick,
    age: player.age ?? template.age,
    height: player.height ?? template.height,
    weight: player.weight ?? template.weight,
    forty: player.forty ?? template.forty,
    vertical: player.vertical ?? template.vertical,
    broad: player.broad ?? template.broad,
    cone: player.cone ?? template.cone,
    shuttle: player.shuttle ?? template.shuttle,
    bench: player.bench ?? 0,
    pffProfileId: pff?.id ?? '',
    pffComposite: pff?.pff.composite ?? baseline,
    pffGrade: pff?.pff.grade ?? baseline,
    pffProduction: pff?.pff.production ?? Math.max(55, baseline - 2),
    pffEfficiency: pff?.pff.efficiency ?? baseline,
    pffClean: pff?.pff.clean ?? 70,
    schemeTag: '',
    officialRas: ras?.ras ?? null,
    alltimeRas: ras?.alltimeRas ?? null,
  }
}

function prospectFromPff(profile: PffProfile, historical: Historical | undefined, current: Prospect): Prospect {
  const template = historical ? prospectFromHistorical(historical, profile) : withPositionDefaults(blankProspect, profile.position)
  return {
    ...template,
    name: profile.name,
    school: titleSchool(profile.college),
    pos: profile.position,
    draftSeason: profile.draftSeason,
    pick: profile.nfl?.draftPick ?? historical?.pick ?? current.pick,
    pffProfileId: profile.id,
    pffComposite: clamp(profile.pff.composite, 1, 99),
    pffGrade: clamp(profile.pff.grade, 1, 99),
    pffProduction: clamp(profile.pff.production, 1, 99),
    pffEfficiency: clamp(profile.pff.efficiency, 1, 99),
    pffClean: clamp(profile.pff.clean, 1, 99),
    schemeTag: '',
  }
}

function prospectFromUnknown(value: unknown): Prospect | null {
  const record = asRecord(value)
  if (!record) return null
  const pos = norm(stringField(record, 'pos', 'WR'))
  const template = withPositionDefaults(blankProspect, pos)
  return {
    ...template,
    name: stringField(record, 'name', 'Saved Prospect'),
    school: stringField(record, 'school', ''),
    pos,
    draftSeason: numberField(record, 'draftSeason', template.draftSeason),
    pick: numberField(record, 'pick', template.pick),
    age: numberField(record, 'age', template.age),
    height: numberField(record, 'height', template.height),
    weight: numberField(record, 'weight', template.weight),
    forty: numberField(record, 'forty', template.forty),
    vertical: numberField(record, 'vertical', template.vertical),
    broad: numberField(record, 'broad', template.broad),
    cone: numberField(record, 'cone', template.cone),
    shuttle: numberField(record, 'shuttle', template.shuttle),
    bench: numberField(record, 'bench', 0),
    pffProfileId: stringField(record, 'pffProfileId', ''),
    pffComposite: clamp(numberField(record, 'pffComposite', template.pffComposite), 1, 99),
    pffGrade: clamp(numberField(record, 'pffGrade', template.pffGrade), 1, 99),
    pffProduction: clamp(numberField(record, 'pffProduction', template.pffProduction), 1, 99),
    pffEfficiency: clamp(numberField(record, 'pffEfficiency', template.pffEfficiency), 1, 99),
    pffClean: clamp(numberField(record, 'pffClean', template.pffClean), 1, 99),
    schemeTag: stringField(record, 'schemeTag', ''),
  }
}

function parseProspectImport(text: string): Prospect[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown
    return Array.isArray(parsed)
      ? parsed.map(prospectFromUnknown).filter((item): item is Prospect => item !== null)
      : []
  }

  return parseCsv(trimmed)
    .map(prospectFromCsvRow)
    .filter((item): item is Prospect => item !== null)
}

function prospectFromCsvRow(row: Row): Prospect | null {
  const name = rowText(row, ['name', 'player', 'player_name', 'prospect'])
  if (!name) return null

  const pos = norm(rowText(row, ['pos', 'position'], 'WR'))
  const template = withPositionDefaults(blankProspect, pos)
  const pffGrade = rowNum(row, ['pffGrade', 'pff_grade', 'film', 'grade', 'scouting_grade'], template.pffGrade)
  const pffProduction = rowNum(row, ['pffProduction', 'pff_production', 'production', 'prod'], template.pffProduction)
  const pffEfficiency = rowNum(row, ['pffEfficiency', 'pff_efficiency', 'efficiency', 'processing', 'processor'], template.pffEfficiency)
  const pffComposite = rowNum(row, ['pffComposite', 'pff_composite', 'pff', 'composite'], avg([pffGrade, pffProduction, pffEfficiency]))

  return {
    ...template,
    name,
    school: rowText(row, ['school', 'college', 'team'], template.school),
    pos,
    draftSeason: rowNum(row, ['draftSeason', 'draft_season', 'draftClass', 'draft_class', 'draftYear', 'draft_year', 'class', 'year'], template.draftSeason),
    pick: rowNum(row, ['pick', 'projectedPick', 'projected_pick', 'draftPick', 'draft_pick'], template.pick),
    age: rowNum(row, ['age'], template.age),
    height: rowHeight(row, ['height', 'ht'], template.height),
    weight: rowNum(row, ['weight', 'wt'], template.weight),
    forty: rowNum(row, ['forty', 'forty_yard', '40', '40_yard'], template.forty),
    vertical: rowNum(row, ['vertical', 'vert'], template.vertical),
    broad: rowNum(row, ['broad', 'broad_jump'], template.broad),
    cone: rowNum(row, ['cone', 'three_cone', '3cone', '3_cone'], template.cone),
    shuttle: rowNum(row, ['shuttle', 'short_shuttle'], template.shuttle),
    bench: rowNum(row, ['bench', 'bench_reps', 'benchPress'], 0),
    pffProfileId: '',
    pffComposite: clamp(pffComposite, 1, 99),
    pffGrade: clamp(pffGrade, 1, 99),
    pffProduction: clamp(pffProduction, 1, 99),
    pffEfficiency: clamp(pffEfficiency, 1, 99),
    pffClean: clamp(rowNum(row, ['pffClean', 'pff_clean', 'clean', 'clean_play'], template.pffClean), 1, 99),
    schemeTag: '',
  }
}

function rowText(row: Row, aliases: string[], fallback = '') {
  const wanted = aliases.map(headerKey)
  for (const [key, value] of Object.entries(row)) {
    if (wanted.includes(headerKey(key)) && value.trim()) return value.trim()
  }
  return fallback
}

function rowNum(row: Row, aliases: string[], fallback: number) {
  const value = rowText(row, aliases)
  return n(value) ?? fallback
}

function rowHeight(row: Row, aliases: string[], fallback: number) {
  const value = rowText(row, aliases)
  return height(value) ?? fallback
}

function headerKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function withPositionDefaults(base: Prospect, pos: string): Prospect {
  return { ...base, ...positionDefaults[pos], pos }
}

// ── RAS lookup ────────────────────────────────────────────────────────────────

type AppRasRecord = { ras: number | null; alltimeRas: number | null; sourceUrl: string }
type AppRasLookup = { byNYP: Map<string, AppRasRecord>; byNY: Map<string, AppRasRecord | null> }

function normRasPos(p: string): string {
  const x = p.toUpperCase().trim()
  if (['OT', 'OG', 'OC', 'G', 'T', 'C', 'OL'].includes(x)) return 'OL'
  if (['DE', 'DT', 'NT', 'OLB'].includes(x)) return 'DL'
  if (['ILB', 'MLB'].includes(x)) return 'LB'
  if (['FS', 'SS', 'DB', 'SAF'].includes(x)) return 'S'
  if (x === 'FB') return 'RB'
  return x
}

const KNOWN_POSITIONS_RAS = new Set(['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S'])

function buildAppRasLookup(rows: Row[]): AppRasLookup {
  const byNYP = new Map<string, AppRasRecord>()
  const byNY  = new Map<string, AppRasRecord | null>()
  for (const row of rows) {
    const rPos = normRasPos(row.pos ?? '')
    if (!KNOWN_POSITIONS_RAS.has(rPos)) continue
    const yr = parseInt(row.year ?? '')
    if (!isFinite(yr)) continue
    const rec: AppRasRecord = {
      ras:       row.ras && row.ras.trim() !== '' ? parseFloat(row.ras) : null,
      alltimeRas: row.alltime_ras && row.alltime_ras.trim() !== '' ? parseFloat(row.alltime_ras) : null,
      sourceUrl: row.source_url ?? '',
    }
    const pk = `${clean(row.name ?? '')}|${yr}|${rPos}`
    byNYP.set(pk, rec)
    const fk = `${clean(row.name ?? '')}|${yr}`
    if (!byNY.has(fk)) byNY.set(fk, rec)
    else byNY.set(fk, null) // ambiguous — skip fallback for this name+year
  }
  return { byNYP, byNY }
}

function getAppRas(name: string, year: number, pos: string, lookup: AppRasLookup): AppRasRecord | null {
  const pk = `${clean(name)}|${year}|${pos}`
  if (lookup.byNYP.has(pk)) return lookup.byNYP.get(pk)!
  const fk = `${clean(name)}|${year}`
  return lookup.byNY.get(fk) ?? null
}

function parseCsv(text: string): Row[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]
    if (ch === '"') {
      if (quoted && next === '"') {
        cell += '"'
        i += 1
      } else {
        quoted = !quoted
      }
    } else if (ch === ',' && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += ch
    }
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  const [head, ...body] = rows.filter((r) => r.some(Boolean))
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] || ''])))
}

async function loadPffPayload(): Promise<PffPayload | null> {
  const jsonResponse = await fetch(`${assetBase}data/pff_comparison_profiles.json`).catch(() => null)
  if (jsonResponse?.ok) {
    const jsonText = await jsonResponse.text()
    if (jsonText.trim().startsWith('{')) return JSON.parse(jsonText) as PffPayload
  }

  const compressedResponse = await fetch(`${assetBase}data/pff_comparison_profiles.json.gz.b64`).catch(() => null)
  if (!compressedResponse?.ok) return null

  const encoded = (await compressedResponse.text()).replace(/\s/g, '')
  const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))
  const Decompression = (globalThis as unknown as { DecompressionStream?: new (format: string) => TransformStream<Uint8Array, Uint8Array> }).DecompressionStream
  if (!Decompression) return null

  const stream = new Blob([bytes]).stream().pipeThrough(new Decompression('gzip'))
  return await new Response(stream).json() as PffPayload
}

function normalizePffProfiles(profiles: RawPffProfile[]): PffProfile[] {
  return profiles.map((profile) => {
    if (!Array.isArray(profile)) return { ...profile, position: norm(profile.position) }
    const [name, college, rawPos, draftSeason, composite, grade, production, efficiency, cleanPlay, nfl] = profile
    const position = norm(rawPos)
    return {
      id: `${clean(name)}|${draftSeason}|${position}`,
      name,
      college,
      position,
      draftSeason,
      games: 0,
      pff: { composite, grade, production, efficiency, clean: cleanPlay },
      nfl: nfl ? {
        draftPick: nfl[0],
        games: nfl[1],
        starts: nfl[2],
        snaps: nfl[3],
        awards: nfl[4],
        score: nfl[5],
        category: nfl[6],
        av: nfl[7] ?? nfl[5] * .82,
      } : null,
    }
  }).filter((profile) => profile.name && positions.includes(profile.position))
}


function projectionOverlayKey(year: number, pos: string, name: string): string {
  return `${Number(year)}|${String(pos || '').toUpperCase()}|${clean(name)}`
}


function normalizeCompList(value: unknown): PositionCompSignal['projectionComps'] {
  if (!Array.isArray(value)) return []

  return value.map((item) => {
    const r = asRecord(item)
    if (!r) return null

    return {
      name: stringField(r, 'name', ''),
      year: numberField(r, 'year', 0),
      pick: numberField(r, 'pick', 0),
      delta: numberField(r, 'delta', 0),
      weight: numberField(r, 'weight', 1),
      dist: numberField(r, 'dist', 0),
    }
  }).filter(Boolean) as PositionCompSignal['projectionComps']
}


function normalizeRbQuantumTraits(value: unknown): RbScoreReadySignal['quantumTraits'] {
  if (!Array.isArray(value)) return []

  return value.map((item) => {
    const r = asRecord(item)
    if (!r) return null

    return {
      traitKey: stringField(r, 'traitKey', ''),
      label: stringField(r, 'label', ''),
      recommendedAdjustment: numberField(r, 'recommendedAdjustment', 0),
      confidence: stringField(r, 'confidence', ''),
      scoreReady: Boolean(r.scoreReady),
    }
  }).filter(Boolean) as RbScoreReadySignal['quantumTraits']
}



type QbTranslationSignal = {
  adjustment: number
  traits: string[]
  actual?: number
  delta?: number
  pass?: number
  run?: number
  scrambles?: number
  btt?: number
  acc?: number
  adot?: number
  epa?: number
  primaryComp?: {
    name: string
    archetype?: string
    distance?: number
  } | null
}




const QB_MODEL_GUIDE_LAYMAN = [
  {
    title: 'What the QB score means',
    body: 'The QB score is trying to answer one simple question: based on college traits, draft value, and historical QB outcomes, how likely is this quarterback profile to become a useful NFL starter? A higher score means the player looks more like past successful quarterbacks.'
  },
  {
    title: 'Why there is a separate miss-risk label',
    body: 'Some quarterbacks put up huge college numbers but historically have not translated well. The miss-risk label looks for those traps, such as clean system passers, low-creation pocket profiles, fake mobility, or Day-2 production that lacks NFL-level tools.'
  },
  {
    title: 'Traditional score vs. outlier score',
    body: 'The model uses two paths. The traditional path rewards accuracy, pressure performance, depth passing, decision-making, and clean passing traits. The outlier path protects rare profiles like elite creators, explosive throwers, or rushing threats who may not look perfect in a normal pocket-passer model.'
  },
  {
    title: 'How to read the final QB card',
    body: 'Use the projection score and miss risk together. A quarterback with a good score and low risk is a cleaner bet. A quarterback with a good score and high risk has real upside, but his profile looks like past misses too. The closest comp is not a career prediction — it is the historical QB whose college profile most resembles him.'
  }
];

function qbDisplayScore(player: any): number {
  const candidates = [
    player?.qbProjectionScore,
    player?.modelScore,
    player?.score,
    player?.grade,
  ];

  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }

  return 0;
}

function qbRiskLabel(player: any): string {
  return String(player?.qbMissRiskLabel || player?.missRiskLabel || '').trim();
}

function qbRiskTraits(player: any): string[] {
  const traits = player?.qbMissRiskTraits || player?.missRiskTraits || [];
  return Array.isArray(traits) ? traits.map(String).filter(Boolean) : [];
}

function qbPrimaryComp(player: any): any {
  if (player?.primaryQbProfileComp?.name) return player.primaryQbProfileComp;
  if (player?.qbTranslationSignal?.primaryComp?.name) return player.qbTranslationSignal.primaryComp;

  const lists = [player?.projectionComps, player?.styleComps, player?.qbComps, player?.comps];
  for (const list of lists) {
    if (Array.isArray(list) && list[0]?.name) return list[0];
  }

  return null;
}

function buildQbTranslationCandidateMap(payload: unknown): Map<string, QbTranslationSignal> {
  const map = new Map<string, QbTranslationSignal>()
  const root = asRecord(payload)
  const rows: unknown[] = Array.isArray(root?.candidates) ? root.candidates : []

  for (const item of rows) {
    const r = asRecord(item)
    if (!r) continue

    const year = numberField(r, 'year', 0)
    const name = stringField(r, 'name', '')
    if (!year || !name) continue

    const traitsRaw = r.traits
    const traits = Array.isArray(traitsRaw)
      ? traitsRaw.map((x) => {
          const trait = asRecord(x)
          return trait ? stringField(trait, 'label', '') : String(x)
        }).filter(Boolean)
      : []

    const inputs = asRecord(r.inputs) ?? {}
    const primaryCompRaw = asRecord(r.primaryComp)

    map.set(projectionOverlayKey(year, 'QB', name), {
      adjustment: numberField(r, 'adjustment', 0),
      traits,
      pass: numberField(inputs, 'pass', 0),
      run: numberField(inputs, 'run', 0),
      scrambles: numberField(inputs, 'scrambles', 0),
      btt: numberField(inputs, 'btt', 0),
      acc: numberField(inputs, 'acc', 0),
      adot: numberField(inputs, 'adot', 0),
      epa: numberField(inputs, 'epa', 0),
      primaryComp: primaryCompRaw ? {
        name: stringField(primaryCompRaw, 'name', ''),
        archetype: stringField(primaryCompRaw, 'archetype', ''),
        distance: numberField(primaryCompRaw, 'distance', 0),
      } : null,
    })
  }

  return map
}


function buildQbTranslationMap(payload: unknown): Map<string, QbTranslationSignal> {
  const map = new Map<string, QbTranslationSignal>()
  const root = asRecord(payload)
  const rows: unknown[] = Array.isArray(root?.movers) ? root.movers : []

  for (const item of rows) {
    const r = asRecord(item)
    if (!r) continue

    const year = numberField(r, 'year', 0)
    const name = stringField(r, 'name', '')
    if (!year || !name) continue

    const traitsRaw = r.traits
    const traits = Array.isArray(traitsRaw)
      ? traitsRaw.map((x) => String(x))
      : []

    map.set(projectionOverlayKey(year, 'QB', name), {
      adjustment: numberField(r, 'adjustment', 0),
      traits,
      actual: numberField(r, 'actual', 0),
      delta: numberField(r, 'delta', 0),
      pass: numberField(r, 'pass', 0),
      run: numberField(r, 'run', 0),
      scrambles: numberField(r, 'scrambles', 0),
      btt: numberField(r, 'btt', 0),
      acc: numberField(r, 'acc', 0),
      adot: numberField(r, 'adot', 0),
      epa: numberField(r, 'epa', 0),
    })
  }

  return map
}


function buildRbScoreReadyMap(payload: unknown): Map<string, RbScoreReadySignal> {
  const map = new Map<string, RbScoreReadySignal>()
  const root = asRecord(payload)
  const scoreReady = asRecord(root?.scoreReady)
  const rows: unknown[] = Array.isArray(scoreReady?.topMovers)
    ? scoreReady.topMovers
    : Array.isArray(root?.topMovers)
      ? root.topMovers
      : []

  for (const item of rows) {
    const r = asRecord(item)
    if (!r) continue

    const pos = norm(stringField(r, 'pos', ''))
    if (pos !== 'RB') continue

    const year = numberField(r, 'year', 0)
    const name = stringField(r, 'name', '')
    if (!year || !name) continue

    const reasonsRaw = r.reasons
    const reasons = Array.isArray(reasonsRaw)
      ? reasonsRaw.map((x) => String(x))
      : []

    map.set(projectionOverlayKey(year, pos, name), {
      recommendedAdjustment: numberField(r, 'recommendedAdjustment', 0),
      reasons,
      quantumTraits: normalizeRbQuantumTraits(r.quantumTraits),
    })
  }

  return map
}


function buildCompSignalMap(payload: unknown): Map<string, PositionCompSignal> {
  const map = new Map<string, PositionCompSignal>()
  const root = asRecord(payload)
  const byPosition = asRecord(root?.byPosition)
  if (!byPosition) return map

  for (const pos of Object.keys(byPosition)) {
    const block = asRecord(byPosition[pos])
    const candidates = Array.isArray(block?.candidates) ? block.candidates : []

    for (const item of candidates) {
      const r = asRecord(item)
      if (!r) continue

      const name = stringField(r, 'name', '')
      const year = numberField(r, 'year', 0)
      const cleanPos = norm(pos)

      if (!name || !year || !positions.includes(cleanPos)) continue

      map.set(projectionOverlayKey(year, cleanPos, name), {
        compAdjustment: numberField(r, 'compAdjustment', 0),
        confidence: numberField(r, 'confidence', 0),
        realDraftPrior: Boolean(r.realDraftPrior),
        avgCompDelta: numberField(r, 'avgCompDelta', 0),
        projectionComps: normalizeCompList(r.projectionComps),
        styleComps: normalizeCompList(r.styleComps),
      })
    }
  }

  return map
}


function buildProjectionOverlayMap(payloads: unknown): Map<string, PositionProjectionOverlay> {
  const map = new Map<string, PositionProjectionOverlay>()
  if (!Array.isArray(payloads)) return map

  for (const payload of payloads) {
    if (!payload || typeof payload !== 'object') continue

    const model = stringField(payload as Record<string, unknown>, 'model', 'generated_projection')
    const records = (payload as { records?: unknown[] }).records
    if (!Array.isArray(records)) continue

    for (const entry of records) {
      const r = asRecord(entry)
      if (!r) continue

      const name = stringField(r, 'name', '')
      const pos = norm(stringField(r, 'pos', stringField(r, 'position', '')))
      const year = numberField(r, 'year', numberField(r, 'draftYear', 0))
      if (!name || !year || !positions.includes(pos)) continue

      const forecast = asRecord(r.forecast) ?? undefined
      const pff = asRecord(r.pff) ?? undefined

      const score =
        numberField(r, 'grade', 0) ||
        numberField(r, 'score', 0) ||
        (forecast ? numberField(forecast, 'final', 0) : 0)

      if (!score) continue

      const av =
        forecast ? (
          numberField(forecast, 'projectedAv', 0) ||
          numberField(forecast, 'av', 0) ||
          Math.round(score * 0.55)
        ) : Math.round(score * 0.55)

      map.set(projectionOverlayKey(year, pos, name), {
        score,
        av,
        grade: numberField(r, 'grade', score),
        model,
        source: stringField(r, 'source', model),
        forecast,
        pff,
      })
    }
  }

  return map
}


function buildExtraProspects(data: unknown): Historical[] {
  if (!data || typeof data !== 'object') return []
  const payload = data as { prospects?: unknown[] }
  if (!Array.isArray(payload.prospects)) return []
  return payload.prospects.flatMap((entry, i) => {
    const r = asRecord(entry)
    if (!r) return []
    const name = stringField(r, 'name', '')
    if (!name) return []
    const year = numberField(r, 'year', 0)
    if (!year) return []
    const pos = norm(stringField(r, 'pos', 'WR'))
    if (!positions.includes(pos)) return []
    return [{
      id: `extra-${year}-${clean(name)}-${i}`,
      name,
      school: stringField(r, 'school', ''),
      year,
      pos,
      pick: numberField(r, 'pick', 260),
      age: n(r.age),
      height: n(r.height),
      weight: n(r.weight),
      forty: n(r.forty),
      vertical: n(r.vertical),
      broad: n(r.broad),
      cone: n(r.cone),
      shuttle: n(r.shuttle),
      bench: n(r.bench),
      games: 0,
      av: 0,
      starts: 0,
      proBowls: 0,
      allPros: 0,
      category: 'Bust' as Category,
    }]
  })
}

function n(v: unknown): number | null {
  const raw = String(v ?? '').replaceAll(',', '').trim()
  if (!raw || raw.toUpperCase() === 'NA') return null
  const x = Number(raw)
  return Number.isFinite(x) ? x : null
}

function height(v: string): number | null {
  if (!v) return null
  const cleaned = v.replaceAll('"', '').replaceAll("'", '-').trim()
  if (cleaned.includes('-')) {
    const [feet, inches] = cleaned.split('-').map(Number)
    if (Number.isFinite(feet) && Number.isFinite(inches)) return feet * 12 + inches
  }
  if (/^\d\s+\d{1,2}$/.test(cleaned)) {
    const [feet, inches] = cleaned.split(/\s+/).map(Number)
    return feet * 12 + inches
  }
  return n(cleaned)
}

function norm(p: string): string {
  const x = p.toUpperCase().trim()
  if (['OT', 'G', 'T', 'LT', 'RT', 'OG', 'C', 'OL', 'IOL', 'OC'].includes(x)) return 'OL'
  if (['DE', 'DT', 'NT', 'DL', 'IDL', 'DI', 'OLB', 'EDGE', 'ED'].includes(x)) return 'DL'
  if (['ILB', 'MLB', 'WILL', 'MIKE', 'SAM'].includes(x)) return 'LB'
  if (['FS', 'SS', 'DB', 'SAF'].includes(x)) return 'S'
  if (x === 'FB') return 'RB'
  // Unknown positions (K, P, LS, etc.) return as-is; buildProspectPool filters non-positions
  return x
}

function buildProspectPool(combine: Row[], draft: Row[]): Historical[] {
  const byPfr = new Map(draft.filter((r) => r.pfr_player_id).map((r) => [r.pfr_player_id, r]))
  const byNameYear = new Map(draft.map((r) => [`${r.season}-${clean(r.pfr_player_name)}`, r]))
  const usedDraftRows = new Set<Row>()
  const fromCombine = combine.map((r, i) => {
    const year = n(r.draft_year) || n(r.season) || 0
    const d = byPfr.get(r.pfr_id) || byNameYear.get(`${year}-${clean(r.player_name)}`)
    if (d) usedDraftRows.add(d)
    return rowToHistorical(r, d, i, year)
  })

  const fromDraftOnly = draft
    .filter((r) => !usedDraftRows.has(r))
    .map((r, i) => rowToHistorical({}, r, combine.length + i, n(r.season) || 0))

  return [...fromCombine, ...fromDraftOnly]
    .filter((p) => p.year >= 2000 && p.name !== 'Unknown' && positions.includes(p.pos))
}

function rowToHistorical(combineRow: Row, draftRow: Row | undefined, index: number, year: number): Historical {
  const av = n(draftRow?.w_av) || n(draftRow?.car_av) || 0
  const games = n(draftRow?.games) || 0
  const starts = n(draftRow?.seasons_started) || 0
  const proBowls = n(draftRow?.probowls) || 0
  const allPros = n(draftRow?.allpro) || 0
  return {
    id: `${year}-${combineRow.player_name || draftRow?.pfr_player_name || 'unknown'}-${index}`,
    name: combineRow.player_name || draftRow?.pfr_player_name || 'Unknown',
    school: combineRow.school || draftRow?.college || '',
    year,
    pos: norm(combineRow.pos || draftRow?.position || ''),
    pick: n(combineRow.draft_ovr) || n(draftRow?.pick) || 260,
    age: n(draftRow?.age),
    height: height(combineRow.ht),
    weight: n(combineRow.wt),
    forty: n(combineRow.forty),
    vertical: n(combineRow.vertical),
    broad: n(combineRow.broad_jump),
    cone: n(combineRow.cone),
    shuttle: n(combineRow.shuttle),
    bench: n(combineRow.bench),
    games,
    av,
    starts,
    proBowls,
    allPros,
    category: category(av, games, starts, proBowls, allPros),
  }
}


function schoolHitRate(school: string, pool: Historical[]): { rate: number; n: number } | null {
  if (!school) return null
  const matches = pool.filter((p) => p.school && clean(p.school) === clean(school) && p.year <= 2022)
  if (matches.length < 6) return null
  const starters = matches.filter((p) => ['Starter', 'High-end starter', 'Star'].includes(p.category))
  return { rate: starters.length / matches.length, n: matches.length }
}

function careerArc(player: Historical): string {
  const { av, games, starts, proBowls, allPros } = player
  if (allPros >= 1 || (proBowls >= 2 && av >= 50)) return 'Elite career'
  if (proBowls >= 1 || av >= 45) return 'Pro Bowl career'
  if (av >= 28 || starts >= 5) return 'Solid starter'
  if (games >= 80 && av < 20) return 'Long-term depth'
  if (games >= 48) return 'Role player'
  if (games >= 17) return 'Reserve'
  return 'Minimal impact'
}

function syntheticArcValues(player: Historical): number[] {
  const { av, games } = player
  if (av <= 0 || games <= 0) return []
  const seasons = Math.max(2, Math.min(15, Math.round(games / 15)))
  const peak = Math.max(1, Math.min(seasons - 1, Math.round(seasons * 0.38)))
  const weights = Array.from({ length: seasons }, (_, i) => {
    const x = (i - peak) / Math.max(seasons * 0.35, 1)
    return Math.exp(-x * x)
  })
  const total = weights.reduce((s, w) => s + w, 0)
  return weights.map((w) => Math.round((w / total) * av * 10) / 10)
}

function posPercentile(player: Historical, history: Historical[]): number | null {
  const pool = history.filter((p) => p.pos === player.pos && p.year <= matureOutcomeCutoff)
  if (pool.length < 10) return null
  const below = pool.filter((p) => (p.av || 0) < (player.av || 0)).length
  return Math.round(below / pool.length * 100)
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const w = 56, h = 20
  const max = Math.max(...values, 0.1)
  const pts = values
    .map((v, i) => `${Math.round((i / (values.length - 1)) * w)},${Math.round(h - (v / max) * h * 0.85)}`)
    .join(' ')
  return (
    <svg width={w} height={h} className="arcSparkline" aria-hidden="true" style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function category(av: number, games: number, starts: number, pb: number, ap: number): Category {
  if (ap || pb >= 2 || av >= 70) return 'Star'
  if (pb || av >= 45 || (starts >= 5 && av >= 35)) return 'High-end starter'
  if (av >= 24 || starts >= 3 || (games >= 64 && av >= 18)) return 'Starter'
  if (av >= 10 || games >= 48) return 'Role'
  if (av >= 4 || games >= 17) return 'Reserve'
  return 'Bust'
}

const outcomeAVRange: Record<Category, string> = {
  'Bust':             '< 4 AV',
  'Reserve':          '4–10 AV',
  'Role':             '10–24 AV',
  'Starter':          '24–45 AV',
  'High-end starter': '45–70 AV',
  'Star':             '70+ AV',
}

function findHistoricalForPff(profile: PffProfile, history: Historical[]) {
  return history.find((player) => samePlayerSeason(profile, player.name, player.year, player.pos))
}

function samePlayerSeason(profile: PffProfile, name: string, year: number, pos: string) {
  return clean(profile.name) === clean(name) && profile.draftSeason === year && (profile.position === pos || group[profile.position] === group[pos])
}

function lookupLabel(player: Historical) {
  return `${player.name} | ${player.year} | ${player.pos} | ${player.school || 'No school'} | pick ${player.pick}`
}

function TradeCalculator() {
  const [aStr, setAStr] = useState('')
  const [bStr, setBStr] = useState('')

  function parsePicks(str: string): number[] {
    return str.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n >= 1 && n <= 260)
  }

  const aPicks = parsePicks(aStr)
  const bPicks = parsePicks(bStr)
  const aValue = aPicks.reduce((sum, p) => sum + PICK_VALUE(p), 0)
  const bValue = bPicks.reduce((sum, p) => sum + PICK_VALUE(p), 0)
  const diff = aValue - bValue
  const hasData = aPicks.length > 0 && bPicks.length > 0
  const fair = hasData && Math.abs(diff) < Math.max(aValue, bValue) * 0.08

  return <section className="panel tablePanel classPanel">
    <div className="panelTitle"><div><p>Draft Capital</p><h2>Trade Calculator</h2></div></div>
    <p className="hint">Enter picks for each side (comma-separated). Surplus value uses an exponential depreciation curve (pick 1 = 3000 pts).</p>
    <div className="tradeGrid">
      <div className="tradeSlot">
        <label className="field wide"><span>Team A picks</span>
          <input value={aStr} onChange={(e) => setAStr(e.target.value)} placeholder="e.g. 5, 37, 102" />
        </label>
        <div className="tradeValue">{aValue.toLocaleString()} pts</div>
        <div className="tradePicks">
          {aPicks.map((p, i) => <span key={i} className={`pickBand ${pickBandClass(p)}`}>#{p} ({PICK_VALUE(p).toLocaleString()})</span>)}
        </div>
      </div>
      <div className="tradeVs">vs</div>
      <div className="tradeSlot">
        <label className="field wide"><span>Team B picks</span>
          <input value={bStr} onChange={(e) => setBStr(e.target.value)} placeholder="e.g. 1, 200" />
        </label>
        <div className="tradeValue">{bValue.toLocaleString()} pts</div>
        <div className="tradePicks">
          {bPicks.map((p, i) => <span key={i} className={`pickBand ${pickBandClass(p)}`}>#{p} ({PICK_VALUE(p).toLocaleString()})</span>)}
        </div>
      </div>
    </div>
    {hasData && <div className={`tradeVerdict ${fair ? 'tradeFair' : diff > 0 ? 'tradeA' : 'tradeB'}`}>
      {fair
        ? '≈ Fair trade'
        : `Team ${diff > 0 ? 'A' : 'B'} wins by ${Math.abs(diff).toLocaleString()} pts (${((Math.abs(diff) / Math.max(aValue, bValue)) * 100).toFixed(0)}%)`}
    </div>}
  </section>
}

function pffLabel(player: PffProfile) {
  return `${player.name} | ${player.draftSeason} | ${player.position} | ${titleSchool(player.college)} | PFF ${player.pff.composite.toFixed(1)}${player.nfl ? ` | NFL ${isMatureOutcome(player.draftSeason) ? player.nfl.category : 'early sample'}` : ''}`
}

function titleSchool(value: string) {
  return value.toLowerCase().split(' ').filter(Boolean).map((part) => part.length <= 2 ? part.toUpperCase() : `${part[0].toUpperCase()}${part.slice(1)}`).join(' ')
}

function qbRtgClass(v: number | null): string {
  if (v === null) return ''
  if (v >= 95) return 'qbStatGood'
  if (v >= 85) return 'qbStatOk'
  if (v < 78) return 'qbStatBad'
  return ''
}

function qbAnyaClass(v: number | null): string {
  if (v === null) return ''
  if (v >= 6.4) return 'qbStatGood'
  if (v >= 5.5) return 'qbStatOk'
  if (v < 4.8) return 'qbStatBad'
  return ''
}

function wrYdsClass(v: number | null): string {
  if (v === null) return ''
  if (v >= 1100) return 'qbStatGood'
  if (v >= 700) return 'qbStatOk'
  if (v < 400) return 'qbStatBad'
  return ''
}

function wrRecClass(v: number | null): string {
  if (v === null) return ''
  if (v >= 80) return 'qbStatGood'
  if (v >= 55) return 'qbStatOk'
  if (v < 35) return 'qbStatBad'
  return ''
}

function rbRushYdsClass(v: number | null): string {
  if (v === null) return ''
  if (v >= 1000) return 'qbStatGood'
  if (v >= 600) return 'qbStatOk'
  if (v < 350) return 'qbStatBad'
  return ''
}

function rbYpcClass(v: number | null): string {
  if (v === null) return ''
  if (v >= 4.8) return 'qbStatGood'
  if (v >= 4.0) return 'qbStatOk'
  if (v < 3.5) return 'qbStatBad'
  return ''
}

function simClass(v: number): string {
  if (v >= 70) return 'simHigh'
  if (v >= 50) return 'simMid'
  return 'simLow'
}

function slug(s = '') {
  return clean(s).slice(0, 30) || 'prospect'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function stringField(record: Record<string, unknown> | null, key: string, fallback: string) {
  const value = record?.[key]
  return typeof value === 'string' && value.trim() ? value : fallback
}

function numberField(record: Record<string, unknown>, key: string, fallback: number) {
  return n(record[key]) ?? fallback
}

function scoreColor(s: number) {
  if (s >= 82) return 'var(--violet)'
  if (s >= 70) return 'var(--accent)'
  if (s >= 58) return 'var(--green)'
  if (s >= 45) return 'var(--amber)'
  return 'var(--red)'
}

function scoreClass(s: number) {
  if (s >= 82) return 'star'
  if (s >= 70) return 'high'
  if (s >= 58) return 'solid'
  if (s >= 45) return 'backup'
  return 'depth'
}

function round(pick: number) {
  return pick <= 32 ? '1' : pick <= 64 ? '2' : pick <= 100 ? '3' : pick <= 140 ? '4' : pick <= 180 ? '5' : pick <= 220 ? '6' : '7/UDFA'
}
