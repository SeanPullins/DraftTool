import { useEffect, useMemo, useState, type ChangeEvent, type CSSProperties, type ReactNode } from 'react'

type Row = Record<string, string>
type Category = 'Bust' | 'Reserve' | 'Role' | 'Starter' | 'High-end starter' | 'Star'
type Prospect = {
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
  film: number
  production: number
  fit: number
  health: number
  processing: number
  pffProfileId: string
  pffComposite: number
  pffGrade: number
  pffProduction: number
  pffEfficiency: number
  pffClean: number
  schemeTag: string
}
type SavedProspect = Prospect & { id: string; updatedAt: string; notes?: string }
type Historical = {
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
  games: number
  av: number
  starts: number
  proBowls: number
  allPros: number
  category: Category
}
type PffProfile = {
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
type Projection = ReturnType<typeof project>
type LoaderMessage = { tone: 'good' | 'warn'; text: string } | null
type MobileTab = 'edit' | 'results' | 'board'
type Page = 'workbench' | 'class' | 'players' | 'compare' | 'trade'
type BrowserSortKey = 'av' | 'games' | 'starts' | 'pb' | 'ap' | 'pick' | 'name' | 'outcome' | 'year' | 'forty'
type ModelSignal = 'draftScore' | 'logPick' | 'pffComp' | 'pffGrade' | 'pffProd' | 'pffEff' | 'pffClean' | 'ageScore' | 'athletic' | 'size' | 'isQB' | 'isSkill' | 'isOL' | 'isFront' | 'isDB'
type SortKey = 'av' | 'projAv' | 'projScore' | 'games' | 'starts' | 'pb' | 'ap' | 'pick' | 'name' | 'outcome'
type SortDir = 'asc' | 'desc'

const positions = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S']
const outcomeOrder: Category[] = ['Bust', 'Reserve', 'Role', 'Starter', 'High-end starter', 'Star']
const matureOutcomeCutoff = 2023
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
const calibratedAvModel: { intercept: number; features: Array<{ name: ModelSignal; coef: number; mean: number; sd: number }> } = {
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
const group: Record<string, string> = {
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
const signalWeights: Record<string, { draft: number; athletic: number; size: number; scout: number; age: number }> = {
  QB:    { draft: .36, athletic: .06, size: .06, scout: .40, age: .12 },
  SKILL: { draft: .28, athletic: .22, size: .06, scout: .34, age: .10 },
  OL:    { draft: .30, athletic: .10, size: .20, scout: .30, age: .10 },
  FRONT: { draft: .28, athletic: .22, size: .10, scout: .30, age: .10 },
  DB:    { draft: .30, athletic: .24, size: .04, scout: .32, age: .10 },
}
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

const assetBase = import.meta.env.BASE_URL
const savedKey = 'draftlens.savedProspects.v2'
const previousSavedKey = 'draftlens.savedProspects.v1'
const csvTemplate = [
  'name,school,pos,draftSeason,pick,age,height,weight,forty,vertical,broad,cone,shuttle,film,production,fit,health,processing,pffComposite,pffGrade,pffProduction,pffEfficiency,pffClean',
  'Example Receiver,State,WR,2026,42,21.4,73,204,4.45,37,124,6.92,4.18,84,82,80,86,76,82,83,82,79,86',
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
  film: 86,
  production: 84,
  fit: 82,
  health: 80,
  processing: 78,
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
  film: 70,
  production: 70,
  fit: 70,
  health: 80,
  processing: 70,
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

export default function App() {
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
  const [boardView, setBoardView] = useState<'list' | 'grid'>('list')
  const [boardOrder, setBoardOrder] = useState<string[]>([])
  const [dragId, setDragId] = useState('')
  const [mobileTab, setMobileTab] = useState<MobileTab>('edit')
  const [page, setPage] = useState<Page>(() => readPageFromHash())
  const projection = useMemo(() => project(input, prospects, pffProfiles), [input, prospects, pffProfiles])
  const draftBoard = useMemo(
    () => saved
      .map((player) => ({ player, projection: project(player, prospects, pffProfiles) }))
      .sort((a, b) => b.projection.score - a.projection.score),
    [saved, prospects, pffProfiles],
  )

  const orderedBoard = useMemo(() => {
    if (!boardOrder.length) return draftBoard
    const idxMap = new Map(boardOrder.map((id, i) => [id, i]))
    return [...draftBoard].sort(
      (a, b) => (idxMap.get(a.player.id) ?? 9999) - (idxMap.get(b.player.id) ?? 9999),
    )
  }, [draftBoard, boardOrder])

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
    const hashMap: Partial<Record<Page, string>> = { class: '#class', players: '#players', compare: '#compare', trade: '#trade' }
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
    async function load() {
      try {
        const [combineCsv, draftCsv, pffPayload, extraData, consensusData, scoutData, injuryData] = await Promise.all([
          fetch(`${assetBase}data/combine.csv`).then((r) => r.text()),
          fetch(`${assetBase}data/draft_picks.csv`).then((r) => r.text()),
          loadPffPayload(),
          fetch(`${assetBase}data/extra_prospects.json`).then((r) => r.json()).catch(() => null),
          fetch(`${assetBase}data/consensus_2025.json`).then((r) => r.json()).catch(() => null),
          fetch(`${assetBase}data/scout_notes_2025.json`).then((r) => r.json()).catch(() => null),
          fetch(`${assetBase}data/injury_flags_2025.json`).then((r) => r.json()).catch(() => null),
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
      } catch {
        setError('Data files are missing. Run npm run data:refresh, then reload.')
      } finally {
        setLoading(false)
      }
    }
    load()
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
    setInput(prospectFromHistorical(match, pffMatch))
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
    const record: SavedProspect = { ...input, id, updatedAt: now, notes: notes.trim() || undefined }

    setSaved((current) => {
      const next = current.some((player) => player.id === id)
        ? current.map((player) => player.id === id ? record : player)
        : [record, ...current]
      return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 250)
    })
    setSelectedSavedId(id)
    setMessage({ tone: 'good', text: `Saved ${input.name} to My prospects.` })
  }

  function loadSavedProspect(id: string) {
    setSelectedSavedId(id)
    const match = saved.find((player) => player.id === id)
    if (!match) return
    setInput(stripSavedFields(match))
    setNotes(match.notes ?? '')
    setLookupQuery('')
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
        <div className="dataPills">
          <span>{loading ? 'Loading…' : `${prospects.length.toLocaleString()} comps`}</span>
          <span>{pffSummary ? `${pffSummary.matched.toLocaleString()} PFF matches` : 'PFF pending'}</span>
          <span>{saved.length} saved</span>
        </div>
      </header>

      <nav className="pageNav" aria-label="Primary">
        <button type="button" className={page === 'workbench' ? 'on' : ''} onClick={() => setPage('workbench')}>Workbench</button>
        <button type="button" className={page === 'class' ? 'on' : ''} onClick={() => setPage('class')}>Class Rankings</button>
        <button type="button" className={page === 'players' ? 'on' : ''} onClick={() => setPage('players')}>Players</button>
        <button type="button" className={page === 'compare' ? 'on' : ''} onClick={() => setPage('compare')}>Compare</button>
        <button type="button" className={page === 'trade' ? 'on' : ''} onClick={() => setPage('trade')}>Trade Calc</button>
      </nav>

      {page === 'workbench' ? <nav className="mobileTabs" role="tablist" aria-label="Workbench sections">
        <button type="button" role="tab" aria-selected={mobileTab === 'edit'} className={mobileTab === 'edit' ? 'on' : ''} onClick={() => setMobileTab('edit')}>Edit</button>
        <button type="button" role="tab" aria-selected={mobileTab === 'results'} className={mobileTab === 'results' ? 'on' : ''} onClick={() => setMobileTab('results')}>Results</button>
        <button type="button" role="tab" aria-selected={mobileTab === 'board'} className={mobileTab === 'board' ? 'on' : ''} onClick={() => setMobileTab('board')}>Board</button>
      </nav> : null}
    </div>

    {error ? <section className="panel empty">{error}</section> : page === 'class' ? <div className="classPage">
      <ClassExplorer pool={lookupPool} history={prospects} pffProfiles={pffProfiles} currentName={input.name} currentYear={input.draftSeason} />
    </div> : page === 'players' ? <div className="classPage">
      <PlayerBrowser pool={lookupPool} />
    </div> : page === 'compare' ? <div className="classPage">
      <CompareView pool={lookupPool} history={prospects} pffProfiles={pffProfiles} initialQuery={compareQuery} />
    </div> : page === 'trade' ? <div className="classPage">
      <TradeCalculator />
    </div> : <div className="layout">
      <aside className="controlPanel" data-pane="edit">
        <section className="panel loadPanel">
          <div className="panelTitle">
            <div>
              <p>Player Loader</p>
              <h2>Add or Edit Prospect</h2>
            </div>
          </div>

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
        </section>

        <section className="panel formPanel">
          <div className="panelTitle"><div><p>Identity</p><h2>Prospect Card</h2></div></div>
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
        </section>

        <section className="panel formPanel">
          <div className="panelTitle"><div><p>Testing</p><h2>Measurables</h2></div></div>
          <div className="formGrid">
            <Num label="Height in." value={input.height} onChange={(v) => update('height', v)} />
            <Num label="Weight" value={input.weight} onChange={(v) => update('weight', v)} />
            <Num label="40-yard" value={input.forty} step={0.01} onChange={(v) => update('forty', v)} />
            <Num label="Vertical" value={input.vertical} step={0.5} onChange={(v) => update('vertical', v)} />
            <Num label="Broad" value={input.broad} onChange={(v) => update('broad', v)} />
            <Num label="3-cone" value={input.cone} step={0.01} onChange={(v) => update('cone', v)} />
            <Num label="Shuttle" value={input.shuttle} step={0.01} onChange={(v) => update('shuttle', v)} />
          </div>
        </section>

        <section className="panel formPanel">
          <div className="panelTitle"><div><p>Evaluation</p><h2>Scouting Inputs</h2></div></div>
          <Slider label="Film" value={input.film} onChange={(v) => update('film', v)} />
          <Slider label="Production" value={input.production} onChange={(v) => update('production', v)} />
          <Slider label="Role fit" value={input.fit} onChange={(v) => update('fit', v)} />
          <Slider label="Availability" value={input.health} onChange={(v) => update('health', v)} />
          <Slider label="Processing" value={input.processing} onChange={(v) => update('processing', v)} />
        </section>

        <section className="panel formPanel pffPanel">
          <div className="panelTitle"><div><p>PFF College Signal</p><h2>Performance Profile</h2></div><strong>{input.pffComposite.toFixed(0)}</strong></div>
          <Slider label="Composite" value={input.pffComposite} onChange={(v) => update('pffComposite', v)} />
          <Slider label="Grade" value={input.pffGrade} onChange={(v) => update('pffGrade', v)} />
          <Slider label="Production" value={input.pffProduction} onChange={(v) => update('pffProduction', v)} />
          <Slider label="Efficiency" value={input.pffEfficiency} onChange={(v) => update('pffEfficiency', v)} />
          <Slider label="Clean play" value={input.pffClean} onChange={(v) => update('pffClean', v)} />
        </section>
      </aside>

      <section className="dashboard">
        <section className="panel heroPanel" data-pane="results">
          <div className="scoreDial" style={{ '--angle': `${projection.score * 3.6}deg` } as CSSProperties}>
            <b>{Math.round(projection.score)}</b>
            <span>score</span>
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
            {projection.flags.length > 0 && <div className="flagRow">
              {projection.flags.map((f) => <span key={f} className="dangerFlag">{f}</span>)}
            </div>}
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
            <button type="button" className="secondary smallButton compareBtn" onClick={() => { setCompareQuery(input.name); setPage('compare') }}>Compare</button>
          </div>
          <div className="statStrip">
            <Metric label="Expected AV" value={projection.expectedAv.toFixed(1)} />
            <Metric label="NFL impact" value={projection.impactScore.toFixed(1)} />
            <Metric label="Games" value={Math.round(projection.games).toString()} />
            <Metric label="Starter yrs" value={projection.starts.toFixed(1)} />
            <Metric label="RAS" value={projection.ras.toFixed(1)} />
          </div>
        </section>

        <section className="summaryGrid" data-pane="results">
          <section className="panel">
            <div className="panelTitle"><div><p>Probability</p><h2>Outcome Odds</h2></div></div>
            {outcomeOrder.map((name) => <Bar key={name} label={name} value={projection.odds[name] || 0} />)}
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
            <Signal label="Scouting" value={projection.signals.scout} />
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
                    return <tr key={row.player.id} className={row.player.id === selectedSavedId ? 'currentRow' : ''}>
                      <td><b className="boardRank">{index + 1}</b></td>
                      <td><b>{row.player.name}</b><small>{row.player.school || 'No school'}</small></td>
                      <td>{row.player.pos}</td>
                      <td>{row.player.pick}</td>
                      <td>{Math.round(row.projection.score)}</td>
                      <td>{row.projection.median.toFixed(1)}</td>
                      <td><OutcomeTag category={best} /></td>
                      <td><button type="button" className="smallButton" onClick={() => loadSavedProspect(row.player.id)}>Load</button></td>
                    </tr>
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
              <thead><tr><th>Player</th><th>Yr</th><th>Pos</th><th>Pick</th><th>40</th><th>AV</th><th>Arc</th><th>Outcome</th><th>Sim</th></tr></thead>
              <tbody>{projection.comps.map((c) => {
                const hr = schoolHitRate(c.player.school, prospects)
                return <tr key={c.player.id}>
                  <td><b>{c.player.name}</b><small>{c.player.school}{hr ? <span className="schoolBadge">{Math.round(hr.rate * 100)}%</span> : null}</small></td>
                  <td>{c.player.year}</td>
                  <td>{c.player.pos}</td>
                  <td>{c.player.pick}</td>
                  <td>{c.player.forty?.toFixed(2) || '-'}</td>
                  <td>{c.player.av}</td>
                  <td><small className="arcLabel">{careerArc(c.player)}</small></td>
                  <td><OutcomeTag category={c.player.category} /></td>
                  <td>{Math.round(c.sim * 100)}</td>
                </tr>
              })}</tbody>
            </table>
          </TableWrap>
        </section>

        <section className="panel tablePanel" data-pane="board">
          <div className="panelTitle"><div><p>PFF + NFL Outcomes</p><h2>College Production Comps</h2></div></div>
          {projection.pffComps.length ? <TableWrap>
            <table>
              <thead><tr><th>Player</th><th>Class</th><th>Pos</th><th>PFF</th><th>Pick</th><th>AV</th><th>Outcome</th><th>Sim</th></tr></thead>
              <tbody>{projection.pffComps.map((c) => <tr key={c.profile.id}><td><b>{c.profile.name}</b><small>{c.profile.college}</small></td><td>{c.profile.draftSeason}</td><td>{c.profile.position}</td><td>{c.profile.pff.composite.toFixed(1)}</td><td>{c.profile.nfl?.draftPick ?? '-'}</td><td>{c.profile.nfl?.av.toFixed(1) ?? '-'}</td><td>{c.profile.nfl ? <OutcomeTag category={c.profile.nfl.category} /> : '-'}</td><td>{Math.round(c.sim * 100)}</td></tr>)}</tbody>
            </table>
          </TableWrap> : <p className="emptyLine">Load a PFF profile or enter college PFF scores to activate production comps.</p>}
        </section>
      </section>
    </div>}
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

function Bar({ label, value }: { label: string; value: number }) {
  return <div className="bar"><span>{label}</span><i><b style={{ width: `${value * 100}%` }} /></i><strong>{(value * 100).toFixed(1)}%</strong></div>
}

function OutcomeTag({ category }: { category: Category }) {
  return <span className={`tag tag${outcomeOrder.indexOf(category)}`}>{category}</span>
}

function TableWrap({ children }: { children: ReactNode }) {
  return <div className="tableWrap">{children}</div>
}

function CompareView({ pool, history, pffProfiles, initialQuery = '' }: { pool: Historical[]; history: Historical[]; pffProfiles: PffProfile[]; initialQuery?: string }) {
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
    setP1(a); setP2(b); setMsg('')
  }

  const pff1 = useMemo(() => p1 ? pffProfiles.find((pf) => samePlayerSeason(pf, p1.name, p1.year, p1.pos)) : undefined, [p1, pffProfiles])
  const pff2 = useMemo(() => p2 ? pffProfiles.find((pf) => samePlayerSeason(pf, p2.name, p2.year, p2.pos)) : undefined, [p2, pffProfiles])
  const proj1 = useMemo(() => p1 ? project(prospectFromHistorical(p1, pff1), history, pffProfiles, p1.id) : null, [p1, pff1, history, pffProfiles])
  const proj2 = useMemo(() => p2 ? project(prospectFromHistorical(p2, pff2), history, pffProfiles, p2.id) : null, [p2, pff2, history, pffProfiles])

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
      <CompareTable p1={p1} p2={p2} proj1={proj1} proj2={proj2} pff1={pff1} pff2={pff2} />
    </>}
  </section>
}

function CompareTable({ p1, p2, proj1, proj2, pff1, pff2 }: {
  p1: Historical; p2: Historical
  proj1: ReturnType<typeof project>; proj2: ReturnType<typeof project>
  pff1: PffProfile | undefined; pff2: PffProfile | undefined
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
  a: { draft: number; athletic: number; size: number; scout: number; age: number; pff: number }
  b: { draft: number; athletic: number; size: number; scout: number; age: number; pff: number }
  aLabel: string; bLabel: string
}) {
  const axes: { key: keyof typeof a; label: string }[] = [
    { key: 'draft', label: 'Draft' },
    { key: 'athletic', label: 'Athletic' },
    { key: 'size', label: 'Size' },
    { key: 'scout', label: 'Scouting' },
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

function PlayerBrowser({ pool }: { pool: Historical[] }) {
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState('All')
  const [yearFrom, setYearFrom] = useState(2000)
  const [yearTo, setYearTo] = useState(2030)
  const [outcome, setOutcome] = useState('All')
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
      <strong>{filtered.length.toLocaleString()} players</strong>
    </div>
    <div className="browserControls">
      <label className="field browserSearch"><span>Search</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or school…" /></label>
      <label className="field"><span>Position</span>
        <select value={pos} onChange={(e) => setPos(e.target.value)}>
          {positionFilters.map((p) => <option key={p} value={p}>{p === 'All' ? 'All positions' : p}</option>)}
        </select>
      </label>
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
              return <tr key={player.id}>
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
                <td>{showEarlySample ? <span className="sampleTag">Early</span> : <OutcomeTag category={player.category} />}</td>
              </tr>
            })}
          </tbody>
        </table>
      </TableWrap>
      {sorted.length > 500 ? <p className="hint">Showing 500 of {sorted.length.toLocaleString()}. Narrow filters to see more.</p> : null}
    </> : <p className="emptyLine">No players match those filters.</p>}
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

function ClassExplorer({ pool, history, pffProfiles, currentName, currentYear }: { pool: Historical[]; history: Historical[]; pffProfiles: PffProfile[]; currentName: string; currentYear: number }) {
  const years = useMemo(() => {
    const set = new Set<number>()
    for (const player of pool) set.add(player.year)
    return Array.from(set).sort((a, b) => b - a)
  }, [pool])

  const [year, setYear] = useState<number | null>(null)
  const [pos, setPos] = useState<string>('All')
  const [sortKey, setSortKey] = useState<SortKey>('projAv')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  useEffect(() => {
    if (!years.length) return
    if (year === null || !years.includes(year)) {
      const fallback = years.includes(currentYear) ? currentYear : years.find((y) => y <= currentYear) ?? years[0]
      setYear(fallback)
    }
  }, [years, year, currentYear])

  const filtered = useMemo(() => {
    if (year === null) return []
    return pool.filter((player) => player.year === year && (pos === 'All' || player.pos === pos))
  }, [pool, year, pos])

  const useProjections = year !== null && year >= 2018 && history.length > 0
  const projections = useMemo(() => {
    const out = new Map<string, { av: number; score: number }>()
    if (!useProjections) return out
    for (const player of filtered) {
      const pffMatch = pffProfiles.find((profile) => samePlayerSeason(profile, player.name, player.year, player.pos))
      const synthesized = prospectFromHistorical(player, pffMatch)
      const projected = project(synthesized, history, pffProfiles, player.id)
      out.set(player.id, { av: projected.expectedAv, score: projected.score })
    }
    return out
  }, [filtered, history, pffProfiles, useProjections])

  const effectiveSortKey = !useProjections && (sortKey === 'projAv' || sortKey === 'projScore') ? 'av' : sortKey
  const rows = useMemo(() => {
    const factor = sortDir === 'asc' ? 1 : -1
    return filtered.slice().sort((a, b) => {
      const cmp = compareHistorical(a, b, effectiveSortKey, projections)
      if (cmp !== 0) return cmp * factor
      return (a.pick - b.pick) || a.name.localeCompare(b.name)
    })
  }, [filtered, effectiveSortKey, sortDir, projections])

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
      <strong>{rows.length} players</strong>
    </div>
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
      <label className="field"><span>Sort by</span>
        <select value={sortKey} onChange={(e) => toggleSort(e.target.value as SortKey)}>
          {(Object.keys(sortLabels) as SortKey[]).map((key) => <option key={key} value={key} disabled={(key === 'projAv' || key === 'projScore') && !useProjections}>{sortLabels[key]}</option>)}
        </select>
      </label>
      <button type="button" className="secondary directionButton" onClick={() => setSortDir((direction) => direction === 'asc' ? 'desc' : 'asc')} aria-label="Toggle sort direction">
        {sortDir === 'desc' ? 'High to low' : 'Low to high'}
      </button>
    </div>
    {useProjections ? <p className="hint">Projected AV and Score use the calibrated 2016-2023 model plus each player's draft/combine and matched PFF profile when available.</p> : null}
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
            {useProjections ? <ClassHeader label="Proj AV" sortKey="projAv" active={effectiveSortKey} dir={sortDir} onSort={toggleSort} /> : null}
            {useProjections ? <ClassHeader label="Score" sortKey="projScore" active={effectiveSortKey} dir={sortDir} onSort={toggleSort} /> : null}
            <ClassHeader label="PB" sortKey="pb" active={effectiveSortKey} dir={sortDir} onSort={toggleSort} />
            <ClassHeader label="AP" sortKey="ap" active={effectiveSortKey} dir={sortDir} onSort={toggleSort} />
            <ClassHeader label="Outcome" sortKey="outcome" active={effectiveSortKey} dir={sortDir} onSort={toggleSort} />
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 200).map((player, index) => {
            const isCurrent = currentKey && clean(player.name) === currentKey && player.year === currentYear
            const projected = projections.get(player.id)
            const showEarlySample = player.year > matureOutcomeCutoff
            return <tr key={player.id} className={isCurrent ? 'currentRow' : ''}>
              <td><b className="boardRank">{index + 1}</b></td>
              <td><b>{player.name}</b><small>{player.school || 'No school'}</small></td>
              <td>{player.pos}</td>
              <td>{player.pick >= 260 ? 'UDFA' : player.pick}</td>
              <td>{player.games || 0}</td>
              <td>{player.starts || 0}</td>
              <td>{player.av || 0}</td>
              {useProjections ? <td>{projected ? projected.av.toFixed(1) : '-'}</td> : null}
              {useProjections ? <td>{projected ? Math.round(projected.score) : '-'}</td> : null}
              <td>{player.proBowls || 0}</td>
              <td>{player.allPros || 0}</td>
              <td>{showEarlySample ? <span className="sampleTag">Early sample</span> : <OutcomeTag category={player.category} />}</td>
            </tr>
          })}
        </tbody>
      </table>
    </TableWrap> : <p className="emptyLine">No players match those filters yet. Pick a different year or position.</p>}
    {rows.length > 200 ? <p className="hint">Showing top 200 of {rows.length}. Tighten the position filter to narrow.</p> : null}
  </section>
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

function readPageFromHash(): Page {
  if (typeof window === 'undefined') return 'workbench'
  const map: Record<string, Page> = { '#class': 'class', '#players': 'players', '#compare': 'compare', '#trade': 'trade' }
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

function prospectFromHistorical(player: Historical, pff?: PffProfile): Prospect {
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
    film: pff?.pff.grade ?? baseline,
    production: pff?.pff.production ?? Math.max(55, baseline - 2),
    fit: pff?.pff.composite ?? baseline,
    health: pff?.pff.clean ?? 80,
    processing: pff?.pff.efficiency ?? (player.pos === 'QB' ? baseline : Math.max(55, baseline - 4)),
    pffProfileId: pff?.id ?? '',
    pffComposite: pff?.pff.composite ?? baseline,
    pffGrade: pff?.pff.grade ?? baseline,
    pffProduction: pff?.pff.production ?? Math.max(55, baseline - 2),
    pffEfficiency: pff?.pff.efficiency ?? baseline,
    pffClean: pff?.pff.clean ?? 70,
    schemeTag: '',
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
    film: clamp(profile.pff.grade, 1, 99),
    production: clamp(profile.pff.production, 1, 99),
    fit: clamp(avg([profile.pff.composite, profile.pff.efficiency]), 1, 99),
    health: clamp(profile.pff.clean, 1, 99),
    processing: clamp(profile.position === 'QB' ? profile.pff.efficiency : avg([profile.pff.grade, profile.pff.clean]), 1, 99),
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
    film: clamp(numberField(record, 'film', template.film), 1, 99),
    production: clamp(numberField(record, 'production', template.production), 1, 99),
    fit: clamp(numberField(record, 'fit', template.fit), 1, 99),
    health: clamp(numberField(record, 'health', template.health), 1, 99),
    processing: clamp(numberField(record, 'processing', template.processing), 1, 99),
    pffProfileId: stringField(record, 'pffProfileId', ''),
    pffComposite: clamp(numberField(record, 'pffComposite', numberField(record, 'production', template.pffComposite)), 1, 99),
    pffGrade: clamp(numberField(record, 'pffGrade', numberField(record, 'film', template.pffGrade)), 1, 99),
    pffProduction: clamp(numberField(record, 'pffProduction', numberField(record, 'production', template.pffProduction)), 1, 99),
    pffEfficiency: clamp(numberField(record, 'pffEfficiency', numberField(record, 'processing', template.pffEfficiency)), 1, 99),
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
  const production = rowNum(row, ['production', 'prod'], template.production)
  const film = rowNum(row, ['film', 'grade', 'scouting_grade'], template.film)
  const processing = rowNum(row, ['processing', 'processor'], template.processing)
  const pffGrade = rowNum(row, ['pffGrade', 'pff_grade', 'grade'], film)
  const pffProduction = rowNum(row, ['pffProduction', 'pff_production', 'production'], production)
  const pffEfficiency = rowNum(row, ['pffEfficiency', 'pff_efficiency', 'efficiency'], processing)
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
    film: clamp(film, 1, 99),
    production: clamp(production, 1, 99),
    fit: clamp(rowNum(row, ['fit', 'role_fit'], template.fit), 1, 99),
    health: clamp(rowNum(row, ['health', 'availability'], template.health), 1, 99),
    processing: clamp(processing, 1, 99),
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
  const x = p.toUpperCase()
  if (['OT', 'T', 'LT', 'RT', 'G', 'OG', 'C', 'OL', 'IOL'].includes(x)) return 'OL'
  if (['DE', 'OLB', 'EDGE', 'ED', 'DT', 'NT', 'DL', 'IDL', 'DI'].includes(x)) return 'DL'
  if (['ILB', 'MLB'].includes(x)) return 'LB'
  if (['FS', 'SS', 'DB', 'S'].includes(x)) return 'S'
  return positions.includes(x) ? x : 'S'
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
    games,
    av,
    starts,
    proBowls,
    allPros,
    category: category(av, games, starts, proBowls, allPros),
  }
}

function project(input: Prospect, history: Historical[], pffProfiles: PffProfile[], excludeId?: string) {
  const pool = history.filter((p) => (p.pos === input.pos || group[p.pos] === group[input.pos]) && p.id !== excludeId)
  const ras = rasScore(input, pool)
  const stats = (k: keyof Historical) => pool.map((p) => p[k]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const pct = (value: number, values: number[], low = false) => values.length ? values.filter((v) => low ? v >= value : v <= value).length / values.length * 100 : 50
  const draft = 100 * Math.pow(1 - (input.pick - 1) / 259, .58)
  const athletic = avg([pct(input.forty, stats('forty'), true), pct(input.vertical, stats('vertical')), pct(input.broad, stats('broad')), pct(input.cone, stats('cone'), true), pct(input.shuttle, stats('shuttle'), true)])
  const size = avg([pct(input.height, stats('height')), pct(input.weight, stats('weight'))])
  const scout = input.film * .32 + input.production * .23 + input.fit * .17 + input.health * .12 + input.processing * .16
  const age = input.age <= 20.8 ? 92 : input.age <= 21.6 ? 82 : input.age <= 22.5 ? 68 : input.age <= 23.5 ? 52 : 36
  const normPff = normalizePffInput(input, pffProfiles)
  const pffSignal = normPff.composite * .38 + normPff.grade * .18 + normPff.production * .18 + normPff.efficiency * .17 + normPff.clean * .09
  const grp = group[input.pos] ?? 'SKILL'
  const wt = signalWeights[grp] ?? signalWeights['SKILL']
  const baseScore = draft * wt.draft + athletic * wt.athletic + size * wt.size + scout * wt.scout + age * wt.age
  const pffPool = pffProfiles.filter((p) => p.nfl && isMatureOutcome(p.draftSeason) && p.id !== input.pffProfileId && (p.position === input.pos || group[p.position] === group[input.pos]))
  const pffComps = pffPool.map((profile) => ({ profile, sim: pffSim(input, profile) })).sort((a, b) => b.sim - a.sim).slice(0, 80)
  const pffBlend = pffComps.length >= 12 ? .35 : 0
  const rawScore = baseScore * (1 - pffBlend) + pffSignal * pffBlend
  const calibratedAv = calibratedExpectedAv(input, { draft, athletic, size, age })

  const comps = pool.map((p) => ({ player: p, sim: sim(input, p) })).sort((a, b) => b.sim - a.sim).slice(0, 80)
  const histWeight = comps.reduce((sum, c) => sum + c.sim, 0) || 1
  const pffWeight = pffComps.reduce((sum, c) => sum + c.sim, 0) || 1
  const histExpectedAv = comps.reduce((sum, c) => sum + c.player.av * c.sim, 0) / histWeight
  const pffExpectedAv = pffComps.reduce((sum, c) => sum + (c.profile.nfl?.av || 0) * c.sim, 0) / pffWeight
  const compExpectedAv = blend(histExpectedAv, pffExpectedAv, pffBlend)
  const expectedAv = blend(compExpectedAv, calibratedAv, 0.40)
  const posAvValues = pool.filter((p) => p.av >= 0).map((p) => p.av)
  const posRelScore = posAvValues.length >= 15 ? pct(expectedAv, posAvValues) : avToScore(expectedAv)
  const avScore = avToScore(expectedAv) * 0.35 + posRelScore * 0.65
  const score = clamp(rawScore * 0.46 + avScore * 0.54, 1, 99)
  const games = blend(comps.reduce((sum, c) => sum + c.player.games * c.sim, 0) / histWeight, pffComps.reduce((sum, c) => sum + (c.profile.nfl?.games || 0) * c.sim, 0) / pffWeight, pffBlend)
  const starts = blend(comps.reduce((sum, c) => sum + c.player.starts * c.sim, 0) / histWeight, pffComps.reduce((sum, c) => sum + (c.profile.nfl?.starts || 0) * c.sim, 0) / pffWeight / 16, pffBlend)
  const impactScore = blend(score, avScore, 0.35)

  const rangeValues = [
    ...comps.map((c) => c.player.av),
    ...(pffBlend ? pffComps.slice(0, 40).map((c) => c.profile.nfl?.av || 0) : []),
    calibratedAv,
    expectedAv,
  ].sort((a, b) => a - b)
  const floor = blend(q(rangeValues, .1), Math.max(0, expectedAv * .42), .25)
  const median = blend(q(rangeValues, .5), expectedAv, .35)
  const ceiling = blend(q(rangeValues, .9), Math.max(expectedAv, expectedAv * 1.85), .25)
  const max = Math.max(90, ceiling * 1.1)
  const histOdds = Object.fromEntries(outcomeOrder.map((cat) => [cat, comps.filter((c) => c.player.category === cat).reduce((sum, c) => sum + c.sim, 0) / histWeight])) as Record<Category, number>
  const pffOdds = Object.fromEntries(outcomeOrder.map((cat) => [cat, pffComps.filter((c) => c.profile.nfl?.category === cat).reduce((sum, c) => sum + c.sim, 0) / pffWeight])) as Record<Category, number>
  const odds = Object.fromEntries(outcomeOrder.map((cat) => [cat, blend(histOdds[cat], pffOdds[cat], pffBlend)])) as Record<Category, number>

  const slotComps = pool.filter((p) => p.year <= 2020 && Math.abs(p.pick - input.pick) <= 32)
  const percentile = slotComps.length >= 8
    ? Math.round(slotComps.filter((p) => p.av < expectedAv).length / slotComps.length * 100)
    : null
  const flags = dangerFlags(input, { ceiling, floor, pffBlend })

  return {
    score,
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
    pffComps: pffComps.slice(0, 12),
    pffBlend,
    percentile,
    ras,
    flags,
    signals: { draft, athletic, size, scout, age, pff: pffSignal },
  }
}

function sim(input: Prospect, player: Historical) {
  const distance =
    Math.abs(Math.log(input.pick + 1) - Math.log(player.pick + 1)) * .45 +
    z(input.height, player.height, 3) * .08 +
    z(input.weight, player.weight, 18) * .08 +
    z(input.forty, player.forty, .16) * .16 +
    z(input.vertical, player.vertical, 5) * .07 +
    z(input.broad, player.broad, 9) * .07 +
    z(input.cone, player.cone, .28) * .05 +
    z(input.shuttle, player.shuttle, .2) * .05 +
    (input.pos === player.pos ? 0 : .12)
  const recency = Math.pow(0.96, Math.max(0, 2022 - player.year))
  return Math.exp(-distance) * recency
}

function pffSim(input: Prospect, profile: PffProfile) {
  const nflPick = profile.nfl?.draftPick ?? input.pick
  const distance =
    Math.abs(Math.log(input.pick + 1) - Math.log(nflPick + 1)) * .2 +
    z2(input.pffComposite, profile.pff.composite, 8) * .34 +
    z2(input.pffGrade, profile.pff.grade, 10) * .18 +
    z2(input.pffProduction, profile.pff.production, 12) * .18 +
    z2(input.pffEfficiency, profile.pff.efficiency, 10) * .18 +
    z2(input.pffClean, profile.pff.clean, 12) * .08 +
    (input.pos === profile.position ? 0 : .16)
  return Math.exp(-distance)
}

function calibratedExpectedAv(input: Prospect, signals: { draft: number; athletic: number; size: number; age: number }) {
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
  return clamp(Math.expm1(logAv), 0, 110)
}

function normalizePffInput(input: Prospect, pffProfiles: PffProfile[]) {
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

function rasScore(input: Prospect, pool: Historical[]): number {
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
  ].filter((s): s is number => s != null)
  return scores.length ? clamp(avg(scores), 0, 10) : 5
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

function avToScore(av: number) {
  return clamp(100 * (1 - Math.exp(-Math.max(0, av) / 34)), 0, 99)
}

function isMatureOutcome(draftSeason: number) {
  return draftSeason <= matureOutcomeCutoff
}

function z(a: number, b: number | null, sd: number) {
  return b == null ? .4 : Math.min(2, Math.abs(a - b) / sd)
}

function z2(a: number, b: number, sd: number) {
  return Math.min(2, Math.abs(a - b) / sd)
}

function category(av: number, games: number, starts: number, pb: number, ap: number): Category {
  if (ap || pb >= 2 || av >= 70) return 'Star'
  if (pb || av >= 45 || (starts >= 5 && av >= 35)) return 'High-end starter'
  if (av >= 24 || starts >= 3 || (games >= 64 && av >= 18)) return 'Starter'
  if (av >= 10 || games >= 48) return 'Role'
  if (av >= 4 || games >= 17) return 'Reserve'
  return 'Bust'
}

function gradeLabel(score: number) {
  if (score > 84) return 'Blue-chip starter profile'
  if (score > 74) return 'Strong starter profile'
  if (score > 63) return 'Developmental starter profile'
  if (score > 52) return 'Role-player profile'
  return 'Long-shot profile'
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

function clean(s = '') {
  return s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')
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

function clamp(value: number, min = 0, max = 99) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 50))
}

function avg(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function blend(a: number, b: number, weight: number) {
  return a * (1 - weight) + b * weight
}

function q(values: number[], p: number) {
  return values[Math.min(values.length - 1, Math.max(0, Math.floor(values.length * p)))] || 0
}

function round(pick: number) {
  return pick <= 32 ? '1' : pick <= 64 ? '2' : pick <= 100 ? '3' : pick <= 140 ? '4' : pick <= 180 ? '5' : pick <= 220 ? '6' : '7/UDFA'
}
