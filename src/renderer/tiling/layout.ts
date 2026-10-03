import type { LayoutLeaf, LayoutNode, LayoutSplit, Rect, SplitDirection } from '@shared/types'

export type { Rect }

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

/** A side of a tile or of the whole tiling area. */
export type Edge = 'left' | 'right' | 'top' | 'bottom'

/** Where a dragged tile was dropped relative to the target tile. */
export type DropZone = Edge | 'center'

/** Where a dragged tile can be dropped: on a tile, on an edge of the whole area, or on an empty area. */
export type Drop =
  | { kind: 'tile'; targetTileId: string; zone: DropZone }
  | { kind: 'edge'; edge: Edge }
  | { kind: 'area' }

/** What is being dragged: a tile already in the layout, or a new one (from the Dock). */
export type DragSource = { kind: 'tile'; tileId: string } | { kind: 'new' }

/** Stands in for a tile that doesn't exist yet when previewing where a new one would go. */
const NEW_TILE_PREVIEW_ID = '\u0000new-tile'

function normalAspect(containerAspect: number): number {
  return Number.isFinite(containerAspect) && containerAspect > 0 ? containerAspect : TARGET_CELL_ASPECT
}

/**
 * Put `tileId` (not in `root`) where `drop` says. On a tile's side: that tile is
 * halved and the new one goes on that side; on its centre: halved along its
 * longer side, the new one after it; on an edge of the area: along the whole
 * edge, one band thick. Nothing else changes. Returns `root` itself when the
 * drop can't be done (missing target, area drop on a non-empty layout).
 */
function placeTile(root: LayoutNode | null, tileId: string, drop: Drop, containerAspect: number): LayoutNode | null {
  if (root === null) return drop.kind === 'area' ? leaf(tileId) : null
  if (drop.kind === 'area') return root
  if (drop.kind === 'edge') {
    const direction: SplitDirection = drop.edge === 'left' || drop.edge === 'right' ? 'row' : 'column'
    const share = 1 / (maxBands(root, direction) + 1)
    return drop.edge === 'left' || drop.edge === 'top'
      ? split(direction, leaf(tileId), root, share)
      : split(direction, root, leaf(tileId), 1 - share)
  }
  const { targetTileId, zone } = drop
  if (!containsTile(root, targetTileId)) return root
  if (zone === 'center') {
    const target = computeRects(root, { x: 0, y: 0, width: normalAspect(containerAspect), height: 1 }).find(
      (r) => r.tileId === targetTileId
    )!.rect
    return splitLeaf(root, targetTileId, tileId, target.width >= target.height ? 'row' : 'column', 'after')
  }
  const direction: SplitDirection = zone === 'left' || zone === 'right' ? 'row' : 'column'
  const position: SplitPosition = zone === 'left' || zone === 'top' ? 'before' : 'after'
  return splitLeaf(root, targetTileId, tileId, direction, position)
}

/**
 * Move `tileId` next to `targetTileId`. 'center' swaps the two tiles; an
 * edge zone removes the tile from where it was and splits the target on
 * that side.
 */
export function moveTile(
  root: LayoutNode | null,
  tileId: string,
  targetTileId: string,
  zone: DropZone
): LayoutNode | null {
  if (root === null || tileId === targetTileId) return root
  if (!containsTile(root, tileId) || !containsTile(root, targetTileId)) return root
  if (zone === 'center') return swapTiles(root, tileId, targetTileId)
  return placeTile(removeTile(root, tileId), tileId, { kind: 'tile', targetTileId, zone }, 1)
}

/**
 * Visual position order: `a` comes first if it starts higher, or at the same
 * height further left. (`listTileIds` is tree order, which for nested splits
 * isn't what the user reads: in `row(col(A, C), B)` it's A, C, B.)
 */
function compareRects(a: Rect, b: Rect): number {
  if (Math.abs(a.y - b.y) > 1e-6) return a.y - b.y
  return a.x - b.x
}

/** Tile ids in reading order of where they sit on screen (top row first, then left to right). */
export function visualOrder(root: LayoutNode | null): string[] {
  return computeRects(root, { x: 0, y: 0, width: 1, height: 1 })
    .sort((a, b) => compareRects(a.rect, b.rect))
    .map((r) => r.tileId)
}

/**
 * Add a tile without touching the rest of the layout (bspwm's "largest" +
 * "longest side" insertion): the biggest tile — the first one in reading order
 * on a tie — is split in half along its longer side and the new tile goes after
 * it. Every other split keeps its ratio, so the user's resizes and moves stay.
 * `containerAspect` (width / height) decides which side is longer.
 */
export function insertTile(root: LayoutNode | null, newTileId: string, containerAspect: number): LayoutNode {
  if (root === null) return leaf(newTileId)
  const rects = computeRects(root, { x: 0, y: 0, width: normalAspect(containerAspect), height: 1 }).sort((a, b) => compareRects(a.rect, b.rect))
  let best = rects[0]
  for (const candidate of rects) {
    if (candidate.rect.width * candidate.rect.height > best.rect.width * best.rect.height + 1e-9) best = candidate
  }
  const direction: SplitDirection = best.rect.width >= best.rect.height ? 'row' : 'column'
  return splitLeaf(root, best.tileId, newTileId, direction, 'after')
}

/**
 * How many tiles are lined up across the given axis at most — for 'column',
 * the most tiles any vertical line crosses (rows), for 'row' the most any
 * horizontal line crosses (columns).
 */
function maxBands(root: LayoutNode, direction: SplitDirection): number {
  const rects = computeRects(root, { x: 0, y: 0, width: 1, height: 1 }).map((r) => r.rect)
  let most = 1
  for (const r of rects) {
    const crossed =
      direction === 'column'
        ? rects.filter((o) => o.x < r.x + r.width / 2 && r.x + r.width / 2 < o.x + o.width).length
        : rects.filter((o) => o.y < r.y + r.height / 2 && r.y + r.height / 2 < o.y + o.height).length
    most = Math.max(most, crossed)
  }
  return most
}

/**
 * Move `tileId` to one side of the whole tiling area, spanning its full width
 * (top/bottom) or height (left/right). It gets the size of one more band:
 * dropped under a layout two rows tall, it takes a third of the height.
 */
export function moveTileToEdge(root: LayoutNode | null, tileId: string, edge: Edge): LayoutNode | null {
  if (root === null || !containsTile(root, tileId)) return root
  const rest = removeTile(root, tileId)
  if (rest === null) return root
  return placeTile(rest, tileId, { kind: 'edge', edge }, 1)
}

/** Move a tile already in the layout to where it was dropped. */
export function applyDrop(root: LayoutNode | null, tileId: string, drop: Drop): LayoutNode | null {
  if (drop.kind === 'tile') return moveTile(root, tileId, drop.targetTileId, drop.zone)
  if (drop.kind === 'edge') return moveTileToEdge(root, tileId, drop.edge)
  return root
}

/**
 * Add a new tile where it was dropped (dragged from the Dock). Unlike a move,
 * a drop on a tile's centre doesn't swap: that tile is halved along its longer
 * side. If the drop can't be done (its target is gone), the tile is added the
 * usual way, so it is never lost.
 */
export function insertTileAt(root: LayoutNode | null, newTileId: string, drop: Drop, containerAspect: number): LayoutNode {
  const placed = placeTile(root, newTileId, drop, containerAspect)
  return placed !== null && placed !== root ? placed : insertTile(root, newTileId, containerAspect)
}

/**
 * Where the tiles a drop moves or adds will end up, in `area` coordinates — the
 * dragged tile first, then (for a swap) the target. Empty when the drop changes
 * nothing. This is the drag hint, computed from the real result so it can't
 * disagree with it.
 */
export function dropPreview(root: LayoutNode | null, area: Rect, source: DragSource, drop: Drop): Rect[] {
  let after: LayoutNode | null
  let ids: string[]
  if (source.kind === 'new') {
    after = placeTile(root, NEW_TILE_PREVIEW_ID, drop, area.width / area.height)
    ids = [NEW_TILE_PREVIEW_ID]
  } else {
    after = applyDrop(root, source.tileId, drop)
    ids = drop.kind === 'tile' && drop.zone === 'center' ? [source.tileId, drop.targetTileId] : [source.tileId]
  }
  if (after === root || after === null) return []
  const rects = computeRects(after, area)
  return ids.flatMap((id) => rects.filter((r) => r.tileId === id).map((r) => r.rect))
}

/** Cell aspect ratio the auto layout aims for. */
export const TARGET_CELL_ASPECT = 16 / 9

/** Equal-sized chain: n nodes along one axis, each getting 1/n of the space. */
function equalChain(nodes: LayoutNode[], direction: SplitDirection): LayoutNode {
  if (nodes.length === 1) return nodes[0]
  const [first, ...rest] = nodes
  return split(direction, first, equalChain(rest, direction), 1 / nodes.length)
}

/**
 * Choose a column count so each cell is as close to 16:9 as possible for a
 * container of the given aspect ratio (width / height).
 */
export function chooseGridColumns(count: number, containerAspect: number): number {
  let best = 1
  let bestScore = Infinity
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols)
    const cellAspect = (containerAspect * rows) / cols
    const emptyCells = rows * cols - count
    const score = Math.abs(Math.log(cellAspect / TARGET_CELL_ASPECT)) + 0.1 * emptyCells
    if (score < bestScore - 1e-9) {
      best = cols
      bestScore = score
    }
  }
  return best
}

/**
 * Lay the tiles out as a grid whose cells are close to 16:9. Rows differ in
 * length by at most one tile; tiles in a shorter row are simply wider.
 */
export function autoGrid(tileIds: string[], containerAspect: number): LayoutNode | null {
  const count = tileIds.length
  if (count === 0) return null
  const cols = chooseGridColumns(count, containerAspect)
  const rowCount = Math.ceil(count / cols)

  const rows: LayoutNode[] = []
  let index = 0
  for (let r = 0; r < rowCount; r++) {
    // Spread the remainder over the first rows so row lengths differ by at most one.
    const remainingRows = rowCount - r
    const inThisRow = Math.ceil((count - index) / remainingRows)
    const ids = tileIds.slice(index, index + inThisRow)
    index += inThisRow
    rows.push(equalChain(ids.map(leaf), 'row'))
  }
  return equalChain(rows, 'column')
}

export interface SplitterRect {
  path: NodePath
  direction: SplitDirection
  /** Where the draggable handle sits. */
  rect: Rect
  /** The split's full area, used to turn a pointer position into a ratio. */
  parent: Rect
}

/** Every split's handle position, for rendering resize handles over a flat tile layer. */
export function computeSplitters(node: LayoutNode | null, rect: Rect, thickness: number, path: NodePath = []): SplitterRect[] {
  if (node === null || node.type === 'leaf') return []
  const result: SplitterRect[] = []
  if (node.direction === 'row') {
    const aWidth = rect.width * node.ratio
    result.push({
      path,
      direction: 'row',
      parent: rect,
      rect: { x: rect.x + aWidth - thickness / 2, y: rect.y, width: thickness, height: rect.height }
    })
    result.push(...computeSplitters(node.a, { ...rect, width: aWidth }, thickness, [...path, 'a']))
    result.push(
      ...computeSplitters(node.b, { ...rect, x: rect.x + aWidth, width: rect.width - aWidth }, thickness, [...path, 'b'])
    )
  } else {
    const aHeight = rect.height * node.ratio
    result.push({
      path,
      direction: 'column',
      parent: rect,
      rect: { x: rect.x, y: rect.y + aHeight - thickness / 2, width: rect.width, height: thickness }
    })
    result.push(...computeSplitters(node.a, { ...rect, height: aHeight }, thickness, [...path, 'a']))
    result.push(
      ...computeSplitters(node.b, { ...rect, y: rect.y + aHeight, height: rect.height - aHeight }, thickness, [...path, 'b'])
    )
  }
  return result
}

/**
 * The ratio a splitter drag ends at for a pointer at (x, y) in tiling-area
 * coordinates — clamped exactly like resizeAt, so the guide line stops where the
 * split will.
 */
export function splitterRatioAt(splitter: SplitterRect, x: number, y: number): number {
  const { parent, direction } = splitter
  return clampRatio(direction === 'row' ? (x - parent.x) / parent.width : (y - parent.y) / parent.height)
}

/** How far (px, along the split's axis) the handle moves when the split's ratio becomes `ratio`. */
export function splitterOffset(splitter: SplitterRect, ratio: number): number {
  const { parent, direction, rect } = splitter
  return direction === 'row'
    ? parent.x + parent.width * ratio - (rect.x + rect.width / 2)
    : parent.y + parent.height * ratio - (rect.y + rect.height / 2)
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
