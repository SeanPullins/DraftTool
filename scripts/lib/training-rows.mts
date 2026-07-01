// Shared walk-forward training-row builder for the calibration-model fitting scripts
// (scripts/fit-calibration-model.mts, scripts/fit-gbm-model.mts). Pulled out so both
// fit on byte-identical feature vectors from byte-identical rows -- if this were
// reimplemented per-script, a fair ridge-vs-GBM comparison would be impossible to trust.

import { clean, project, buildCalibrationFeatureValues, group, calibratedAvModel } from '../../src/model.ts'
import type { ModelSignal } from '../../src/model.ts'
import { toProspect, getRas, KNOWN_POSITIONS, type EvalData } from './eval-data.mts'

// Position dummies only make sense in a global (cross-position) model; a per-group
// model trains on a single group so they'd just be constant columns.
export const GROUP_FEATURES: ModelSignal[] = ['draftScore', 'logPick', 'pffComp', 'pffGrade', 'pffProd', 'pffEff', 'pffClean', 'hasPff', 'ageScore', 'athletic', 'size', 'strength']
export const GLOBAL_FEATURES: ModelSignal[] = [...GROUP_FEATURES, 'isQB', 'isSkill', 'isOL', 'isFront', 'isDB']

export const GROUPS = ['QB', 'SKILL', 'OL', 'FRONT', 'DB'] as const
export type Grp = typeof GROUPS[number]

export type TrainingRow = {
  year: number
  grp: Grp
  pick: number
  av: number
  currentModelScore: number   // full production pipeline score, OLD pre-refit calibratedAvModel pinned (fair baseline)
  features: Record<ModelSignal, number>
}

export function buildTrainingRows(data: EvalData, yearMin = 2000, yearMax = 2020, onProgress?: (done: number, total: number) => void): TrainingRow[] {
  const { pool, pffProfiles, pffByKey, rasLookup, qbPffSeasons, y1NflStats } = data
  const evalSet = pool.filter((p) => p.year >= yearMin && p.year <= yearMax && p.pick < 260 && KNOWN_POSITIONS.has(p.pos))

  const rows: TrainingRow[] = []
  let done = 0
  for (const player of evalSet) {
    const pff      = pffByKey.get(`${clean(player.name)}|${player.year}`)
    const rasRec   = getRas(player.name, player.year, player.pos, rasLookup)
    const prospect = toProspect(player, qbPffSeasons, pff, rasRec)
    // Walk-forward: this player's features only ever see strictly-earlier draft years,
    // exactly like scripts/evaluate-model.mts --walk-forward and exactly like a real
    // "score a new prospect today" call would only ever see the past.
    const wfPool        = pool.filter((p) => p.year < player.year)
    const wfPffProfiles = pffProfiles.filter((p) => p.draftSeason < player.year)
    const proj = project(prospect, wfPool, wfPffProfiles, player.id, undefined, undefined, undefined, prospect.qbTrajectory?.gradeDelta ?? null, true, undefined, y1NflStats, null)
    const features = buildCalibrationFeatureValues(prospect, proj.signals)
    // Pin the ORIGINAL single hand-fit global model for the "current production" baseline
    // comparison -- project()'s own default now points at whatever this fitting pipeline
    // last produced, so without pinning, re-running a fitting script after wiring its
    // output in would compare the new fit against itself instead of the pre-refit baseline.
    const oldProj = project(prospect, wfPool, wfPffProfiles, player.id, undefined, undefined, undefined, prospect.qbTrajectory?.gradeDelta ?? null, true, undefined, y1NflStats, { global: calibratedAvModel })
    rows.push({ year: player.year, grp: (group[player.pos] ?? 'SKILL') as Grp, pick: player.pick, av: player.av, currentModelScore: oldProj.score, features })
    done++
    if (onProgress && done % 1000 === 0) onProgress(done, evalSet.length)
  }
  if (onProgress) onProgress(done, evalSet.length)
  return rows
}
