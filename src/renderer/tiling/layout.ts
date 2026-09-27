import type { LayoutLeaf, LayoutNode, LayoutSplit, SplitDirection } from '@shared/types'

/**
 * Pure functions over the tiling layout tree. No React, no IPC — this file is
 * unit-tested in isolation (see layout.test.ts) because a bug here corrupts a
 * user's whole workspace.
 *
 * A LayoutNode is either:
 *   { type: 'leaf', tileId }
 *   { type: 'split', direction, ratio, a, b }
 *
 * A "path" is the sequence of 'a' | 'b' choices from the root down to some
 * node. It's how callers address a specific split (e.g. to resize it) without
 * needing object identity.
 */

export type PathStep = 'a' | 'b'
export type NodePath = PathStep[]

const MIN_RATIO = 0.05
const MAX_RATIO = 0.95

export function leaf(tileId: string): LayoutLeaf {
  return { type: 'leaf', tileId }
}

export function split(
  direction: SplitDirection,
  a: LayoutNode,
  b: LayoutNode,
  ratio = 0.5
): LayoutSplit {
  return { type: 'split', direction, ratio: clampRatio(ratio), a, b }
}

function clampRatio(ratio: number): number {
  if (Number.isNaN(ratio)) return 0.5
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio))
}

/** All tile ids present anywhere in the tree, in left-to-right / top-to-bottom order. */
export function listTileIds(node: LayoutNode | null): string[] {
  if (node === null) return []
  if (node.type === 'leaf') return [node.tileId]
  return [...listTileIds(node.a), ...listTileIds(node.b)]
}

export function containsTile(node: LayoutNode | null, tileId: string): boolean {
  if (node === null) return false
  if (node.type === 'leaf') return node.tileId === tileId
  return containsTile(node.a, tileId) || containsTile(node.b, tileId)
}

/** Path to the leaf holding `tileId`, or null if not found. */
export function findPath(node: LayoutNode | null, tileId: string): NodePath | null {
  if (node === null) return null
  if (node.type === 'leaf') return node.tileId === tileId ? [] : null
  const inA = findPath(node.a, tileId)
  if (inA !== null) return ['a', ...inA]
  const inB = findPath(node.b, tileId)
  if (inB !== null) return ['b', ...inB]
  return null
}

/** Get the node at `path`, or null if the path doesn't exist in this tree. */
export function getAt(node: LayoutNode | null, path: NodePath): LayoutNode | null {
  let current = node
  for (const step of path) {
    if (current === null || current.type === 'leaf') return null
    current = step === 'a' ? current.a : current.b
  }
  return current
}

/** Replace the node at `path` with `replacement`. Returns a new tree (structural sharing). */
function replaceAt(node: LayoutNode, path: NodePath, replacement: LayoutNode | null): LayoutNode | null {
  if (path.length === 0) return replacement
  if (node.type === 'leaf') {
    throw new Error('replaceAt: path continues past a leaf')
  }
  const [step, ...rest] = path
  if (step === 'a') {
    const newA = replaceAt(node.a, rest, replacement)
    if (newA === null) {
      // Collapsing: this split disappears, replaced by its remaining sibling.
      return node.b
    }
    return { ...node, a: newA }
  } else {
    const newB = replaceAt(node.b, rest, replacement)
    if (newB === null) {
      return node.a
    }
    return { ...node, b: newB }
  }
}

export type SplitPosition = 'before' | 'after'

/**
 * Split the leaf holding `targetTileId` into a new split node containing the
 * original leaf and a new leaf for `newTileId`.
 *
 * `position: 'after'` puts the new tile as `b` (right/bottom);
 * `position: 'before'` puts it as `a` (left/top).
 *
 * Returns the new tree, or the original tree unchanged if targetTileId isn't found.
 */
export function splitLeaf(
  root: LayoutNode | null,
  targetTileId: string,
  newTileId: string,
  direction: SplitDirection,
  position: SplitPosition = 'after',
  ratio = 0.5
): LayoutNode {
  if (root === null) {
    return leaf(newTileId)
  }
  const path = findPath(root, targetTileId)
  if (path === null) return root

  const existing = leaf(targetTileId)
  const added = leaf(newTileId)
  const newSplit =
    position === 'after' ? split(direction, existing, added, ratio) : split(direction, added, existing, ratio)

  const result = replaceAt(root, path, newSplit)
  // replaceAt only returns null when collapsing a removal, which can't happen here.
  return result as LayoutNode
}

/**
 * Remove the leaf holding `tileId`. The sibling takes the place of the parent
 * split. Returns the new tree, or null if the tree becomes empty.
 */
export function removeTile(root: LayoutNode | null, tileId: string): LayoutNode | null {
  if (root === null) return null
  const path = findPath(root, tileId)
  if (path === null) return root
  if (path.length === 0) {
    // Removing the only tile in the tree.
    return null
  }
  return replaceAt(root, path, null)
}

/** Set the ratio of the split at `path`. No-op if there's no split there. */
export function resizeAt(root: LayoutNode | null, path: NodePath, ratio: number): LayoutNode | null {
  if (root === null) return null
  const node = getAt(root, path)
  if (node === null || node.type !== 'split') return root
  const updated: LayoutSplit = { ...node, ratio: clampRatio(ratio) }
  return replaceAt(root, path, updated) ?? null
}

/** Swap the positions of two tiles (both must exist in the tree). */
export function swapTiles(root: LayoutNode | null, tileIdA: string, tileIdB: string): LayoutNode | null {
  if (root === null) return null
  if (tileIdA === tileIdB) return root

  function walk(node: LayoutNode): LayoutNode {
    if (node.type === 'leaf') {
      if (node.tileId === tileIdA) return leaf(tileIdB)
      if (node.tileId === tileIdB) return leaf(tileIdA)
      return node
    }
    return { ...node, a: walk(node.a), b: walk(node.b) }
  }

  const pathA = findPath(root, tileIdA)
  const pathB = findPath(root, tileIdB)
  if (pathA === null || pathB === null) return root
  return walk(root)
}

/** Count how many leaves are in the tree. */
export function countTiles(node: LayoutNode | null): number {
  if (node === null) return 0
  if (node.type === 'leaf') return 1
  return countTiles(node.a) + countTiles(node.b)
}

/**
 * Compute pixel/percentage rectangles for every leaf, given a root rectangle.
 * Used by the renderer to size the placeholder divs that WebContentsView tracks.
 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface TileRect {
  tileId: string
  rect: Rect
}

export function computeRects(node: LayoutNode | null, rect: Rect): TileRect[] {
  if (node === null) return []
  if (node.type === 'leaf') {
    return [{ tileId: node.tileId, rect }]
  }
  if (node.direction === 'row') {
    const aWidth = rect.width * node.ratio
    const rectA: Rect = { ...rect, width: aWidth }
    const rectB: Rect = { ...rect, x: rect.x + aWidth, width: rect.width - aWidth }
    return [...computeRects(node.a, rectA), ...computeRects(node.b, rectB)]
  } else {
    const aHeight = rect.height * node.ratio
    const rectA: Rect = { ...rect, height: aHeight }
    const rectB: Rect = { ...rect, y: rect.y + aHeight, height: rect.height - aHeight }
    return [...computeRects(node.a, rectA), ...computeRects(node.b, rectB)]
  }
}
