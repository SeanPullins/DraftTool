// Minimal ridge-regression solver (standardize -> normal equations -> Gauss-Jordan
// inverse). Hand-rolled because there's no numeric library in package.json and the
// fitted result has to ship as plain coefficients that model.ts can evaluate with a
// dot product at runtime — no server, no numeric runtime, just the static bundle.
//
// Fits: y = intercept + sum(coef_i * (x_i - mean_i) / sd_i)
// which is exactly the CalibrationModel shape already used by src/model.ts's
// calibratedExpectedAvFromModel.

export type FittedRidge = {
  intercept: number
  coefs: number[]   // one per column of X, in input order
  means: number[]
  sds: number[]
}

function mean(v: number[]): number {
  return v.reduce((s, x) => s + x, 0) / v.length
}

function stddev(v: number[], m: number): number {
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length)
}

function transpose(A: number[][]): number[][] {
  const rows = A.length, cols = A[0].length
  const T: number[][] = Array.from({ length: cols }, () => new Array(rows).fill(0))
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) T[j][i] = A[i][j]
  return T
}

function matMul(A: number[][], B: number[][]): number[][] {
  const n = A.length, k = A[0].length, m = B[0].length
  const out: number[][] = Array.from({ length: n }, () => new Array(m).fill(0))
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < k; t++) {
      const a = A[i][t]
      if (a === 0) continue
      for (let j = 0; j < m; j++) out[i][j] += a * B[t][j]
    }
  }
  return out
}

function matVec(A: number[][], v: number[]): number[] {
  return A.map((row) => row.reduce((s, a, j) => s + a * v[j], 0))
}

// Gauss-Jordan matrix inverse. Throws on a (numerically) singular matrix —
// callers should keep alpha large enough that A = Z^T Z + alpha*I stays
// well-conditioned (ridge regularization exists precisely to guarantee this).
function invert(A: number[][]): number[][] {
  const n = A.length
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
  for (let col = 0; col < n; col++) {
    let pivotRow = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r
    if (Math.abs(M[pivotRow][col]) < 1e-12) throw new Error(`Matrix is singular at column ${col} — increase ridge alpha or drop a collinear feature`)
    ;[M[col], M[pivotRow]] = [M[pivotRow], M[col]]
    const pivot = M[col][col]
    for (let j = 0; j < 2 * n; j++) M[col][j] /= pivot
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = M[r][col]
      if (factor === 0) continue
      for (let j = 0; j < 2 * n; j++) M[r][j] -= factor * M[col][j]
    }
  }
  return M.map((row) => row.slice(n))
}

// X: n rows x p columns (raw, unstandardized features). y: n actuals.
export function ridgeFit(X: number[][], y: number[], alpha: number): FittedRidge {
  const n = X.length
  const p = X[0].length
  const means = new Array(p).fill(0)
  const sds = new Array(p).fill(1)
  for (let j = 0; j < p; j++) {
    const col = X.map((row) => row[j])
    const m = mean(col)
    const sd = stddev(col, m)
    means[j] = m
    sds[j] = sd > 1e-9 ? sd : 1
  }
  const Z = X.map((row) => row.map((x, j) => (x - means[j]) / sds[j]))
  const yMean = mean(y)
  const yc = y.map((v) => v - yMean)

  const Zt = transpose(Z)
  const ZtZ = matMul(Zt, Z)
  for (let i = 0; i < p; i++) ZtZ[i][i] += alpha
  const Zty = matVec(Zt, yc)
  const inv = invert(ZtZ)
  const coefs = matVec(inv, Zty)

  return { intercept: yMean, coefs, means, sds }
}

export function predictRidge(fit: FittedRidge, x: number[]): number {
  return fit.intercept + x.reduce((s, xi, j) => s + fit.coefs[j] * ((xi - fit.means[j]) / fit.sds[j]), 0)
}

// Self-check: y = 2x exactly (no noise), alpha≈0 should recover the standardized
// slope exactly (dy/dz = dy/dx * sd_x). Run at import time so a broken solver
// fails loudly before it's ever used to fit real coefficients.
function selfCheck() {
  const X = [[1], [2], [3], [4], [5]]
  const y = [2, 4, 6, 8, 10]
  const fit = ridgeFit(X, y, 1e-8)
  const expectedSlope = 2 * Math.sqrt(2) // dy/dx=2, sd_x=sqrt(2)
  if (Math.abs(fit.coefs[0] - expectedSlope) > 1e-4) {
    throw new Error(`ridge self-check failed: expected coef≈${expectedSlope.toFixed(4)}, got ${fit.coefs[0].toFixed(4)}`)
  }
  const pred = predictRidge(fit, [3])
  if (Math.abs(pred - 6) > 1e-4) {
    throw new Error(`ridge self-check failed: predict(3) expected 6, got ${pred.toFixed(4)}`)
  }
}
selfCheck()
