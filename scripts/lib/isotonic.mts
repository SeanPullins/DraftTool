// Isotonic regression (Pool Adjacent Violators Algorithm) for the pick -> outcome market
// baseline. Replaces the old parametric power-law formula (100*(1-(pick-1)/259)^0.58) with
// a nonparametric fit that can capture round-boundary cliffs, compensatory-pick effects,
// etc. without assuming a fixed curve shape. Ships as a small list of (x, value) knots with
// linear interpolation between them -- cheap to evaluate client-side, no server needed.

export type IsotonicFit = { xs: number[]; values: number[] } // sorted ascending by x, monotonic per `direction` at fit time

// Core PAVA: fits a non-decreasing step function to (xs, ys) with weights. xs must be sorted
// ascending and unique (callers aggregate duplicate x's into a weighted mean first).
function poolAdjacentViolators(xs: number[], ys: number[], weights: number[]): IsotonicFit {
  const n = xs.length
  const blockSumW: number[] = []
  const blockSumWY: number[] = []
  const blockXs: number[][] = []

  for (let i = 0; i < n; i++) {
    blockSumW.push(weights[i])
    blockSumWY.push(weights[i] * ys[i])
    blockXs.push([xs[i]])

    // Merge backward while the new block's mean would violate monotonicity with its
    // predecessor -- this is the "pool adjacent violators" step.
    while (blockSumW.length >= 2) {
      const m = blockSumW.length
      const meanLast = blockSumWY[m - 1] / blockSumW[m - 1]
      const meanPrev = blockSumWY[m - 2] / blockSumW[m - 2]
      if (meanPrev <= meanLast) break
      blockSumW[m - 2] += blockSumW[m - 1]
      blockSumWY[m - 2] += blockSumWY[m - 1]
      blockXs[m - 2] = blockXs[m - 2].concat(blockXs[m - 1])
      blockSumW.pop(); blockSumWY.pop(); blockXs.pop()
    }
  }

  const fittedXs: number[] = []
  const fittedValues: number[] = []
  for (let b = 0; b < blockSumW.length; b++) {
    const mean = blockSumWY[b] / blockSumW[b]
    for (const x of blockXs[b]) { fittedXs.push(x); fittedValues.push(mean) }
  }
  return { xs: fittedXs, values: fittedValues }
}

// Groups duplicate x's (many players share the same draft pick number across different
// years) into a weighted mean before fitting, per the standard PAVA formulation.
export function fitIsotonic(pointsX: number[], pointsY: number[], direction: 'increasing' | 'decreasing' = 'decreasing'): IsotonicFit {
  const groups = new Map<number, { sumY: number; n: number }>()
  for (let i = 0; i < pointsX.length; i++) {
    const x = pointsX[i]
    const g = groups.get(x) ?? { sumY: 0, n: 0 }
    g.sumY += pointsY[i]
    g.n += 1
    groups.set(x, g)
  }
  const uniqueX = [...groups.keys()].sort((a, b) => a - b)
  const ys = uniqueX.map((x) => groups.get(x)!.sumY / groups.get(x)!.n)
  const weights = uniqueX.map((x) => groups.get(x)!.n)

  const ysForFit = direction === 'decreasing' ? ys.map((y) => -y) : ys
  const fit = poolAdjacentViolators(uniqueX, ysForFit, weights)
  const values = direction === 'decreasing' ? fit.values.map((v) => -v) : fit.values
  return { xs: fit.xs, values }
}

// Linear interpolation between knots; flat extrapolation past the observed range (same
// convention as sklearn's IsotonicRegression with out_of_bounds='clip').
export function predictIsotonic(fit: IsotonicFit, x: number): number {
  const { xs, values } = fit
  if (x <= xs[0]) return values[0]
  if (x >= xs[xs.length - 1]) return values[values.length - 1]
  for (let i = 0; i < xs.length - 1; i++) {
    if (x >= xs[i] && x <= xs[i + 1]) {
      if (xs[i + 1] === xs[i]) return values[i]
      const t = (x - xs[i]) / (xs[i + 1] - xs[i])
      return values[i] + t * (values[i + 1] - values[i])
    }
  }
  return values[values.length - 1]
}

// Self-checks, run at import time so a broken fit fails loudly before it's ever used.
function selfCheck() {
  // Decreasing fit: y has a violation (12 > 8 breaks the expected decreasing trend at x=2).
  // PAVA should pool x=[1,2] together (mean of 10,12=11) since 12 isn't allowed to exceed 10
  // in a decreasing fit... actually the violation is that y[1]=12 > y[0]=10, so pooling
  // x=0,1 gives mean 11, and the result must be monotonic non-increasing.
  const x = [1, 2, 3, 4, 5]
  const y = [10, 12, 8, 6, 7]
  const fit = fitIsotonic(x, y, 'decreasing')
  for (let i = 1; i < fit.values.length; i++) {
    if (fit.values[i] > fit.values[i - 1] + 1e-9) {
      throw new Error(`isotonic self-check failed: not monotonic decreasing at index ${i}: ${JSON.stringify(fit)}`)
    }
  }
  // Weighted mean should be preserved overall (PAVA is a projection, total sum invariant
  // isn't exact under weighting in general, but with unit weights per input point here,
  // total sum of fitted values across underlying points must equal total sum of y).
  const totalY = y.reduce((s, v) => s + v, 0)
  const totalFit = x.reduce((s, xi) => s + predictIsotonic(fit, xi), 0)
  if (Math.abs(totalY - totalFit) > 1e-6) {
    throw new Error(`isotonic self-check failed: sum mismatch (y=${totalY}, fit=${totalFit})`)
  }
  // Already-monotonic input should be returned unchanged.
  const cleanX = [1, 2, 3, 4]
  const cleanY = [40, 30, 20, 10]
  const cleanFit = fitIsotonic(cleanX, cleanY, 'decreasing')
  for (let i = 0; i < cleanX.length; i++) {
    if (Math.abs(predictIsotonic(cleanFit, cleanX[i]) - cleanY[i]) > 1e-9) {
      throw new Error(`isotonic self-check failed: already-monotonic input was altered`)
    }
  }
}
selfCheck()
