import { useEffect, useMemo, useState } from 'react'

type Row = Record<string, string>
type Category = 'Bust' | 'Reserve' | 'Role' | 'Starter' | 'High-end starter' | 'Star'
type Prospect = {
  name: string
  school: string
  pos: string
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
}
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

type Projection = ReturnType<typeof project>

const start: Prospect = {
  name: 'Elite Prospect', school: 'College', pos: 'WR', pick: 18, age: 21, height: 74, weight: 205,
  forty: 4.43, vertical: 38, broad: 126, cone: 6.9, shuttle: 4.15, film: 86, production: 84, fit: 82, health: 80, processing: 78,
}

const positions = ['QB', 'RB', 'WR', 'TE', 'OT', 'IOL', 'EDGE', 'IDL', 'LB', 'CB', 'S']
const outcomeOrder: Category[] = ['Bust', 'Reserve', 'Role', 'Starter', 'High-end starter', 'Star']
const group: Record<string, string> = { QB: 'QB', RB: 'SKILL', WR: 'SKILL', TE: 'SKILL', OT: 'OL', IOL: 'OL', EDGE: 'FRONT', IDL: 'FRONT', LB: 'FRONT', CB: 'DB', S: 'DB' }
const assetBase = import.meta.env.BASE_URL

export default function App() {
  const [prospects, setProspects] = useState<Historical[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [input, setInput] = useState(start)
  const projection = useMemo(() => project(input, prospects), [input, prospects])

  useEffect(() => {
    async function load() {
      try {
        const [combineCsv, draftCsv] = await Promise.all([
          fetch(`${assetBase}data/combine.csv`).then((r) => r.text()),
          fetch(`${assetBase}data/draft_picks.csv`).then((r) => r.text()),
        ])
        setProspects(buildHistory(parseCsv(combineCsv), parseCsv(draftCsv)))
      } catch {
        setError('Data files are missing. Run npm run data:refresh, then reload.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  function update<K extends keyof Prospect>(key: K, value: Prospect[K]) {
    setInput((current) => ({ ...current, [key]: value }))
  }

  return <main className="shell">
    <header className="top">
      <div><p>NFL Prospect Projection Lab</p><h1>DraftLens</h1></div>
      <strong>{loading ? 'Loading data' : `${prospects.length.toLocaleString()} calibrated prospects`}</strong>
    </header>

    {error ? <section className="card empty">{error}</section> : <div className="grid">
      <aside className="card inputs">
        <div className="cardHead"><h2>Prospect Board</h2><button onClick={() => setInput(start)}>Reset</button></div>
        <Text label="Name" value={input.name} onChange={(v) => update('name', v)} />
        <Text label="School" value={input.school} onChange={(v) => update('school', v)} />
        <label><span>Position</span><select value={input.pos} onChange={(e) => update('pos', e.target.value)}>{positions.map((p) => <option key={p}>{p}</option>)}</select></label>
        <Num label="Projected pick" value={input.pick} min={1} max={260} onChange={(v) => update('pick', v)} />
        <Num label="Age" value={input.age} step={0.1} onChange={(v) => update('age', v)} />
        <Num label="Height inches" value={input.height} onChange={(v) => update('height', v)} />
        <Num label="Weight" value={input.weight} onChange={(v) => update('weight', v)} />
        <Num label="40-yard" value={input.forty} step={0.01} onChange={(v) => update('forty', v)} />
        <Num label="Vertical" value={input.vertical} step={0.5} onChange={(v) => update('vertical', v)} />
        <Num label="Broad jump" value={input.broad} onChange={(v) => update('broad', v)} />
        <Num label="3-cone" value={input.cone} step={0.01} onChange={(v) => update('cone', v)} />
        <Num label="Shuttle" value={input.shuttle} step={0.01} onChange={(v) => update('shuttle', v)} />
        <Slider label="Film" value={input.film} onChange={(v) => update('film', v)} />
        <Slider label="Production" value={input.production} onChange={(v) => update('production', v)} />
        <Slider label="Role fit" value={input.fit} onChange={(v) => update('fit', v)} />
        <Slider label="Availability" value={input.health} onChange={(v) => update('health', v)} />
        <Slider label="Processing" value={input.processing} onChange={(v) => update('processing', v)} />
      </aside>

      <section className="results">
        <section className="card hero">
          <div className="gauge" style={{ '--angle': `${projection.score * 3.6}deg` } as React.CSSProperties}><b>{Math.round(projection.score)}</b><span>/100</span></div>
          <div><p>{input.pos} / round {round(input.pick)}</p><h2>{input.name}</h2><h3>{projection.grade}</h3></div>
          <Metric label="Expected AV" value={projection.expectedAv.toFixed(1)} />
          <Metric label="Games" value={Math.round(projection.games).toString()} />
          <Metric label="Starter yrs" value={projection.starts.toFixed(1)} />
        </section>

        <section className="cards2">
          <section className="card"><h2>Outcome Odds</h2>{outcomeOrder.map((name) => <Bar key={name} label={name} value={projection.odds[name] || 0} />)}</section>
          <section className="card"><h2>Career Range</h2><div className="range"><i style={{ left: `${projection.floorPct}%`, width: `${projection.ceilPct - projection.floorPct}%` }} /><b style={{ left: `${projection.midPct}%` }} /></div><div className="metrics"><Metric label="Floor" value={projection.floor.toFixed(1)} /><Metric label="Median" value={projection.median.toFixed(1)} /><Metric label="Ceiling" value={projection.ceiling.toFixed(1)} /></div></section>
        </section>

        <section className="card"><h2>Model Signals</h2><div className="signals"><Metric label="Draft capital" value={Math.round(projection.signals.draft).toString()} /><Metric label="Athleticism" value={Math.round(projection.signals.athletic).toString()} /><Metric label="Size" value={Math.round(projection.signals.size).toString()} /><Metric label="Scouting" value={Math.round(projection.signals.scout).toString()} /><Metric label="Age" value={Math.round(projection.signals.age).toString()} /></div><p className="note">Projection is calibrated on mature outcome windows from drafted prospects. Treat it as a decision-support tool, not prophecy.</p></section>

        <section className="card"><h2>Closest Historical Comps</h2><table><thead><tr><th>Player</th><th>Yr</th><th>Pos</th><th>Pick</th><th>40</th><th>AV</th><th>Outcome</th><th>Sim</th></tr></thead><tbody>{projection.comps.map((c) => <tr key={c.player.id}><td><b>{c.player.name}</b><small>{c.player.school}</small></td><td>{c.player.year}</td><td>{c.player.pos}</td><td>{c.player.pick}</td><td>{c.player.forty?.toFixed(2) || '-'}</td><td>{c.player.av}</td><td>{c.player.category}</td><td>{Math.round(c.sim * 100)}</td></tr>)}</tbody></table></section>
      </section>
    </div>}
  </main>
}

function Text({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) { return <label><span>{label}</span><input value={value} onChange={(e) => onChange(e.target.value)} /></label> }
function Num({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) { return <label><span>{label}</span><input type="number" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} /></label> }
function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) { return <label className="slider"><span>{label}</span><input type="range" min={1} max={99} value={value} onChange={(e) => onChange(Number(e.target.value))} /><b>{value}</b></label> }
function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><b>{value}</b></div> }
function Bar({ label, value }: { label: string; value: number }) { return <div className="bar"><span>{label}</span><i><b style={{ width: `${value * 100}%` }} /></i><strong>{(value * 100).toFixed(1)}%</strong></div> }

function parseCsv(text: string): Row[] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false
  for (let i = 0; i < text.length; i++) { const ch = text[i], next = text[i + 1]; if (ch === '"') { if (q && next === '"') { cell += '"'; i++ } else q = !q } else if (ch === ',' && !q) { row.push(cell); cell = '' } else if ((ch === '\n' || ch === '\r') && !q) { if (ch === '\r' && next === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' } else cell += ch }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [head, ...body] = rows.filter((r) => r.some(Boolean)); return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] || ''])))
}
function n(v: unknown): number | null { const x = Number(String(v ?? '').replaceAll(',', '').trim()); return Number.isFinite(x) ? x : null }
function height(v: string): number | null { if (!v) return null; if (v.includes('-')) { const [f, i] = v.split('-').map(Number); return f * 12 + i } return n(v) }
function norm(p: string): string { const x = p.toUpperCase(); if (['OT', 'T', 'LT', 'RT'].includes(x)) return 'OT'; if (['G', 'OG', 'C', 'OL', 'IOL'].includes(x)) return 'IOL'; if (['DE', 'OLB', 'EDGE'].includes(x)) return 'EDGE'; if (['DT', 'NT', 'DL', 'IDL'].includes(x)) return 'IDL'; if (['FS', 'SS', 'DB', 'S'].includes(x)) return 'S'; return positions.includes(x) ? x : 'S' }
function buildHistory(combine: Row[], draft: Row[]): Historical[] {
  const byPfr = new Map(draft.map((r) => [r.pfr_player_id, r])); const byNameYear = new Map(draft.map((r) => [`${r.season}-${clean(r.pfr_player_name)}`, r]))
  return combine.map((r, i) => { const year = n(r.draft_year) || n(r.season) || 0; const d = byPfr.get(r.pfr_id) || byNameYear.get(`${year}-${clean(r.player_name)}`); const av = n(d?.w_av) || n(d?.car_av) || 0; const games = n(d?.games) || 0; const starts = n(d?.seasons_started) || 0; const proBowls = n(d?.probowls) || 0; const allPros = n(d?.allpro) || 0; return { id: `${year}-${r.player_name}-${i}`, name: r.player_name || d?.pfr_player_name || 'Unknown', school: r.school || d?.college || '', year, pos: norm(r.pos || d?.position || ''), pick: n(r.draft_ovr) || n(d?.pick) || 260, age: n(d?.age), height: height(r.ht), weight: n(r.wt), forty: n(r.forty), vertical: n(r.vertical), broad: n(r.broad_jump), cone: n(r.cone), shuttle: n(r.shuttle), games, av, starts, proBowls, allPros, category: category(av, games, starts, proBowls, allPros) } }).filter((p) => p.year >= 2000 && p.year <= 2021 && p.av >= 0 && p.pick < 260)
}
function clean(s = '') { return s.toLowerCase().replace(/[^a-z0-9]/g, '') }
function category(av: number, games: number, starts: number, pb: number, ap: number): Category { if (ap || pb >= 2 || av >= 70) return 'Star'; if (pb || (starts >= 5 && av >= 45)) return 'High-end starter'; if (starts >= 3 || (games >= 48 && av >= 20)) return 'Starter'; if (games >= 32 || av >= 8) return 'Role'; if (games >= 12 || av >= 3) return 'Reserve'; return 'Bust' }
function project(input: Prospect, history: Historical[]) {
  const pool = history.filter((p) => p.pos === input.pos || group[p.pos] === group[input.pos])
  const stats = (k: keyof Historical) => pool.map((p) => p[k]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const pct = (value: number, values: number[], low = false) => values.length ? values.filter((v) => low ? v >= value : v <= value).length / values.length * 100 : 50
  const draft = 100 * Math.pow(1 - (input.pick - 1) / 259, .58)
  const athletic = avg([pct(input.forty, stats('forty'), true), pct(input.vertical, stats('vertical')), pct(input.broad, stats('broad')), pct(input.cone, stats('cone'), true), pct(input.shuttle, stats('shuttle'), true)])
  const size = avg([pct(input.height, stats('height')), pct(input.weight, stats('weight'))])
  const scout = input.film * .35 + input.production * .24 + input.fit * .18 + input.health * .13 + input.processing * .1
  const age = input.age <= 20.8 ? 92 : input.age <= 21.6 ? 82 : input.age <= 22.5 ? 68 : input.age <= 23.5 ? 52 : 36
  const score = draft * .34 + athletic * .18 + size * .1 + scout * .32 + age * .06
  const comps = pool.map((p) => ({ player: p, sim: sim(input, p) })).sort((a, b) => b.sim - a.sim).slice(0, 80)
  const w = comps.reduce((s, c) => s + c.sim, 0) || 1
  const expectedAv = comps.reduce((s, c) => s + c.player.av * c.sim, 0) / w * (0.92 + (score - 60) / 260)
  const games = comps.reduce((s, c) => s + c.player.games * c.sim, 0) / w
  const starts = comps.reduce((s, c) => s + c.player.starts * c.sim, 0) / w
  const sorted = comps.map((c) => c.player.av).sort((a, b) => a - b)
  const floor = q(sorted, .1), median = q(sorted, .5), ceiling = q(sorted, .9), max = Math.max(90, ceiling * 1.1)
  const odds = Object.fromEntries(outcomeOrder.map((cat) => [cat, comps.filter((c) => c.player.category === cat).reduce((s, c) => s + c.sim, 0) / w])) as Record<Category, number>
  return { score, grade: score > 84 ? 'Blue-chip starter profile' : score > 72 ? 'Strong starter profile' : score > 60 ? 'Developmental starter profile' : 'Role or long-shot profile', expectedAv, games, starts, floor, median, ceiling, floorPct: floor / max * 100, midPct: median / max * 100, ceilPct: ceiling / max * 100, odds, comps: comps.slice(0, 12), signals: { draft, athletic, size, scout, age } }
}
function sim(i: Prospect, p: Historical) { const d = Math.abs(Math.log(i.pick + 1) - Math.log(p.pick + 1)) * .45 + z(i.height, p.height, 3) * .08 + z(i.weight, p.weight, 18) * .08 + z(i.forty, p.forty, .16) * .16 + z(i.vertical, p.vertical, 5) * .07 + z(i.broad, p.broad, 9) * .07 + z(i.cone, p.cone, .28) * .05 + z(i.shuttle, p.shuttle, .2) * .05 + (i.pos === p.pos ? 0 : .12); return Math.exp(-d) }
function z(a: number, b: number | null, sd: number) { return b == null ? .4 : Math.min(2, Math.abs(a - b) / sd) }
function avg(v: number[]) { return v.reduce((s, x) => s + x, 0) / v.length }
function q(v: number[], p: number) { return v[Math.min(v.length - 1, Math.max(0, Math.floor(v.length * p)))] || 0 }
function round(pick: number) { return pick <= 32 ? '1' : pick <= 64 ? '2' : pick <= 100 ? '3' : pick <= 140 ? '4' : pick <= 180 ? '5' : pick <= 220 ? '6' : '7/UDFA' }
