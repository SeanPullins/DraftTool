// Minimal gradient-boosted regression trees (GBM), hand-rolled for the same reason as
// scripts/lib/ridge.mts: no ML library in package.json, and the fitted result has to
// ship as a plain JSON tree structure that src/model.ts can walk at runtime with a
// simple comparison-based evaluator -- no server, no ML runtime.
//
// Standard stochastic gradient boosting (Friedman): each tree fits the current
// residual, row/feature subsampling regularizes against the small per-group training
// sets here (QB is ~260 rows), and predictions accumulate with a learning-rate shrink.

export type TreeNode =
  | { leaf: true; value: number }
  | { leaf: false; featureIndex: number; threshold: number; left: TreeNode; right: TreeNode }

export type GbmModel = {
  initialValue: number
  learningRate: number
  trees: TreeNode[]
}

export type GbmParams = {
  numTrees: number
  maxDepth: number
  learningRate: number
  minLeafSize: number
  rowSubsample: number     // fraction of rows sampled per tree, (0, 1]
  colSubsample: number     // fraction of features sampled per tree, (0, 1]
}

function mean(values: number[], idx: number[]): number {
  let s = 0
  for (const i of idx) s += values[i]
  return s / idx.length
}

// Build one CART regression tree minimizing SSE, restricted to row indices `idx` and
// candidate feature indices `featureIdx` (the latter re-sampled fresh at every node,
// matching how random-forest-style column subsampling is usually implemented).
function buildTree(X: number[][], residual: number[], idx: number[], allFeatures: number[], depth: number, params: GbmParams): TreeNode {
  const nodeMean = mean(residual, idx)
  if (depth >= params.maxDepth || idx.length < params.minLeafSize * 2) {
    return { leaf: true, value: nodeMean }
  }

  const featureIdx = sampleFeatures(allFeatures, params.colSubsample)
  let best: { featureIndex: number; threshold: number; gain: number; leftIdx: number[]; rightIdx: number[] } | null = null

  const parentSSE = idx.reduce((s, i) => s + (residual[i] - nodeMean) ** 2, 0)

  for (const f of featureIdx) {
    const sorted = [...idx].sort((a, b) => X[a][f] - X[b][f])
    const n = sorted.length
    let sumLeft = 0, sumSqLeft = 0
    const totalSum = sorted.reduce((s, i) => s + residual[i], 0)
    const totalSumSq = sorted.reduce((s, i) => s + residual[i] ** 2, 0)
    for (let k = 0; k < n - 1; k++) {
      const i = sorted[k]
      sumLeft += residual[i]
      sumSqLeft += residual[i] ** 2
      const leftN = k + 1
      const rightN = n - leftN
      if (leftN < params.minLeafSize || rightN < params.minLeafSize) continue
      // Skip non-boundary splits (identical feature value on both sides of the cut).
      if (X[sorted[k]][f] === X[sorted[k + 1]][f]) continue
      const sumRight = totalSum - sumLeft
      const sumSqRight = totalSumSq - sumSqLeft
      const sseLeft  = sumSqLeft  - (sumLeft ** 2) / leftN
      const sseRight = sumSqRight - (sumRight ** 2) / rightN
      const gain = parentSSE - (sseLeft + sseRight)
      if (!best || gain > best.gain) {
        const threshold = (X[sorted[k]][f] + X[sorted[k + 1]][f]) / 2
        best = { featureIndex: f, threshold, gain, leftIdx: sorted.slice(0, leftN), rightIdx: sorted.slice(leftN) }
      }
    }
  }

  if (!best || best.gain <= 1e-9) return { leaf: true, value: nodeMean }

  return {
    leaf: false,
    featureIndex: best.featureIndex,
    threshold: best.threshold,
    left: buildTree(X, residual, best.leftIdx, allFeatures, depth + 1, params),
    right: buildTree(X, residual, best.rightIdx, allFeatures, depth + 1, params),
  }
}

function sampleFeatures(all: number[], fraction: number): number[] {
  if (fraction >= 1) return all
  const k = Math.max(1, Math.round(all.length * fraction))
  const shuffled = [...all].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, k)
}

function sampleRows(n: number, fraction: number): number[] {
  if (fraction >= 1) return Array.from({ length: n }, (_, i) => i)
  const k = Math.max(2, Math.round(n * fraction))
  const shuffled = Array.from({ length: n }, (_, i) => i).sort(() => Math.random() - 0.5)
  return shuffled.slice(0, k)
}

export function predictTree(node: TreeNode, x: number[]): number {
  let n = node
  while (!n.leaf) n = x[n.featureIndex] <= n.threshold ? n.left : n.right
  return n.value
}

export function predictGbm(model: GbmModel, x: number[]): number {
  return model.initialValue + model.learningRate * model.trees.reduce((s, t) => s + predictTree(t, x), 0)
}

// onTreeAdded, if given, fires after each tree with the ensemble-so-far -- lets a
// caller record CV metrics at every tree count from a single fit (boosting is additive,
// so this is equivalent to, but far cheaper than, refitting separately per numTrees
// candidate when tuning that hyperparameter).
export function fitGbm(X: number[][], y: number[], params: GbmParams, onTreeAdded?: (treeIndex: number, modelSoFar: GbmModel) => void): GbmModel {
  const n = X.length
  const allFeatures = Array.from({ length: X[0].length }, (_, i) => i)
  const initialValue = y.reduce((s, v) => s + v, 0) / n
  const residual = y.map((v) => v - initialValue)
  const trees: TreeNode[] = []

  for (let t = 0; t < params.numTrees; t++) {
    const rowIdx = sampleRows(n, params.rowSubsample)
    const tree = buildTree(X, residual, rowIdx, allFeatures, 0, params)
    // Update residuals for ALL rows (not just the sampled ones) so the next tree sees
    // the true current error everywhere, per standard stochastic gradient boosting.
    for (let i = 0; i < n; i++) residual[i] -= params.learningRate * predictTree(tree, X[i])
    trees.push(tree)
    // Snapshot the array -- `trees` keeps growing after this callback fires, so a live
    // reference would silently include trees added on later iterations too.
    if (onTreeAdded) onTreeAdded(t, { initialValue, learningRate: params.learningRate, trees: [...trees] })
  }

  return { initialValue, learningRate: params.learningRate, trees }
}

// Self-check: y has a pure interaction/step structure ((x1>5)+(x2>5)*2) that no linear
// model could fit but a tree ensemble should recover almost exactly. Runs at import
// time so a broken tree-builder fails loudly before it's ever used on real data.
function selfCheck() {
  const X: number[][] = []
  const y: number[] = []
  for (let i = 0; i < 400; i++) {
    const x1 = Math.random() * 10
    const x2 = Math.random() * 10
    X.push([x1, x2])
    y.push((x1 > 5 ? 10 : 0) + (x2 > 5 ? 5 : 0))
  }
  const model = fitGbm(X, y, { numTrees: 40, maxDepth: 3, learningRate: 0.3, minLeafSize: 5, rowSubsample: 0.8, colSubsample: 1 })
  const cases: Array<[number[], number]> = [[[1, 1], 0], [[9, 1], 10], [[1, 9], 5], [[9, 9], 15]]
  for (const [x, expected] of cases) {
    const pred = predictGbm(model, x)
    if (Math.abs(pred - expected) > 1.5) {
      throw new Error(`gbm self-check failed: predict(${x}) expected≈${expected}, got ${pred.toFixed(2)}`)
    }
  }
}
selfCheck()
