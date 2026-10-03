import { describe, expect, it } from 'vitest'
import type { LayoutNode } from '@shared/types'
import {
  computeRects,
  containsTile,
  countTiles,
  findPath,
  getAt,
  leaf,
  listTileIds,
  removeTile,
  resizeAt,
  split,
  splitLeaf,
  swapTiles,
  moveTile,
  autoGrid,
  chooseGridColumns,
  computeSplitters,
  splitterOffset,
  splitterRatioAt,
  insertTile,
  moveTileToEdge,
  applyDrop,
  dropPreview,
  visualOrder,
  insertTileAt
} from './layout'

describe('leaf / split constructors', () => {
  it('creates a leaf node', () => {
    expect(leaf('t1')).toEqual({ type: 'leaf', tileId: 't1' })
  })

  it('clamps ratio into [0.05, 0.95]', () => {
    expect(split('row', leaf('a'), leaf('b'), 0).ratio).toBe(0.05)
    expect(split('row', leaf('a'), leaf('b'), 1).ratio).toBe(0.95)
    expect(split('row', leaf('a'), leaf('b'), 0.5).ratio).toBe(0.5)
    expect(split('row', leaf('a'), leaf('b'), NaN).ratio).toBe(0.5)
  })
})

describe('listTileIds / containsTile / countTiles', () => {
  it('handles null root', () => {
    expect(listTileIds(null)).toEqual([])
    expect(containsTile(null, 'a')).toBe(false)
    expect(countTiles(null)).toBe(0)
  })

  it('handles a single leaf', () => {
    const root = leaf('a')
    expect(listTileIds(root)).toEqual(['a'])
    expect(containsTile(root, 'a')).toBe(true)
    expect(containsTile(root, 'b')).toBe(false)
    expect(countTiles(root)).toBe(1)
  })

  it('lists tiles in left-to-right / top-to-bottom order for nested splits', () => {
    const root = split('row', split('column', leaf('a'), leaf('b')), leaf('c'))
    expect(listTileIds(root)).toEqual(['a', 'b', 'c'])
    expect(countTiles(root)).toBe(3)
  })
})

describe('findPath / getAt', () => {
  const root = split('row', split('column', leaf('a'), leaf('b')), leaf('c'))

  it('finds paths to nested leaves', () => {
    expect(findPath(root, 'a')).toEqual(['a', 'a'])
    expect(findPath(root, 'b')).toEqual(['a', 'b'])
    expect(findPath(root, 'c')).toEqual(['b'])
  })

  it('returns null for a tile not present', () => {
    expect(findPath(root, 'z')).toBeNull()
    expect(findPath(null, 'z')).toBeNull()
  })

  it('returns empty path for the root when it is itself the target leaf', () => {
    expect(findPath(leaf('x'), 'x')).toEqual([])
  })

  it('getAt retrieves the node at a path', () => {
    expect(getAt(root, [])).toBe(root)
    expect(getAt(root, ['a'])).toEqual(split('column', leaf('a'), leaf('b')))
    expect(getAt(root, ['a', 'a'])).toEqual(leaf('a'))
    expect(getAt(root, ['a', 'a', 'a'])).toBeNull() // path continues past a leaf
  })
})

describe('splitLeaf', () => {
  it('creates a root leaf when starting from null', () => {
    expect(splitLeaf(null, 'ignored', 'new', 'row')).toEqual(leaf('new'))
  })

  it('splits an existing leaf, placing the new tile after by default', () => {
    const root = leaf('a')
    const result = splitLeaf(root, 'a', 'b', 'row')
    expect(result).toEqual(split('row', leaf('a'), leaf('b'), 0.5))
  })

  it('places the new tile before when requested', () => {
    const root = leaf('a')
    const result = splitLeaf(root, 'a', 'b', 'column', 'before')
    expect(result).toEqual(split('column', leaf('b'), leaf('a'), 0.5))
  })

  it('splits a deeply nested leaf without disturbing siblings', () => {
    const root = split('row', split('column', leaf('a'), leaf('b')), leaf('c'))
    const result = splitLeaf(root, 'b', 'd', 'row', 'after', 0.3)
    expect(listTileIds(result)).toEqual(['a', 'b', 'd', 'c'])
    // sibling 'a' and 'c' subtrees must be structurally untouched
    expect(findPath(result, 'a')).toEqual(['a', 'a'])
    expect(findPath(result, 'c')).toEqual(['b'])
    expect(findPath(result, 'd')).toEqual(['a', 'b', 'b'])
  })

  it('returns the tree unchanged if target tile does not exist', () => {
    const root = leaf('a')
    expect(splitLeaf(root, 'missing', 'b', 'row')).toBe(root)
  })

  it('honors a custom ratio on the new split', () => {
    const result = splitLeaf(leaf('a'), 'a', 'b', 'row', 'after', 0.25)
    expect(result).toEqual(split('row', leaf('a'), leaf('b'), 0.25))
  })
})

describe('removeTile', () => {
  it('returns null when removing the only tile', () => {
    expect(removeTile(leaf('a'), 'a')).toBeNull()
  })

  it('returns null for a null root', () => {
    expect(removeTile(null, 'a')).toBeNull()
  })

  it('collapses a simple split to the sibling', () => {
    const root = split('row', leaf('a'), leaf('b'))
    expect(removeTile(root, 'a')).toEqual(leaf('b'))
    expect(removeTile(root, 'b')).toEqual(leaf('a'))
  })

  it('collapses correctly from a deeply nested tree, preserving the rest of the tree', () => {
    const root = split('row', split('column', leaf('a'), leaf('b')), leaf('c'))
    const result = removeTile(root, 'a')
    expect(listTileIds(result)).toEqual(['b', 'c'])
    expect(result).toEqual(split('row', leaf('b'), leaf('c')))
  })

  it('is a no-op when the tile is not present', () => {
    const root = split('row', leaf('a'), leaf('b'))
    expect(removeTile(root, 'z')).toBe(root)
  })

  it('removing every tile one at a time empties the tree', () => {
    let root: LayoutNode | null = split('row', split('column', leaf('a'), leaf('b')), leaf('c'))
    root = removeTile(root, 'a')
    root = removeTile(root, 'b')
    root = removeTile(root, 'c')
    expect(root).toBeNull()
  })
})

describe('resizeAt', () => {
  it('updates the ratio of the split at a path', () => {
    const root = split('row', leaf('a'), leaf('b'), 0.5)
    const result = resizeAt(root, [], 0.7) as any
    expect(result.ratio).toBe(0.7)
  })

  it('clamps out-of-range ratios', () => {
    const root = split('row', leaf('a'), leaf('b'))
    const result = resizeAt(root, [], 5) as any
    expect(result.ratio).toBe(0.95)
  })

  it('leaves the tree unchanged if the path does not point at a split', () => {
    const root = split('row', leaf('a'), leaf('b'))
    expect(resizeAt(root, ['a'], 0.9)).toBe(root)
  })

  it('resizes a nested split without affecting others', () => {
    const root = split('row', split('column', leaf('a'), leaf('b'), 0.4), leaf('c'), 0.6)
    const result = resizeAt(root, ['a'], 0.9) as any
    expect(result.ratio).toBe(0.6) // outer unchanged
    expect(result.a.ratio).toBe(0.9) // inner updated
  })

  it('returns null for a null root', () => {
    expect(resizeAt(null, [], 0.5)).toBeNull()
  })
})

describe('swapTiles', () => {
  it('swaps two leaves across different branches', () => {
    const root = split('row', split('column', leaf('a'), leaf('b')), leaf('c'))
    const result = swapTiles(root, 'a', 'c')
    expect(listTileIds(result)).toEqual(['c', 'b', 'a'])
  })

  it('is a no-op if either tile is missing', () => {
    const root = split('row', leaf('a'), leaf('b'))
    expect(swapTiles(root, 'a', 'z')).toBe(root)
  })

  it('is a no-op when swapping a tile with itself', () => {
    const root = split('row', leaf('a'), leaf('b'))
    expect(swapTiles(root, 'a', 'a')).toBe(root)
  })

  it('returns null for a null root', () => {
    expect(swapTiles(null, 'a', 'b')).toBeNull()
  })
})

describe('computeRects', () => {
  it('gives the whole rect to a single leaf', () => {
    const rect = { x: 0, y: 0, width: 100, height: 100 }
    expect(computeRects(leaf('a'), rect)).toEqual([{ tileId: 'a', rect }])
  })

  it('splits a row proportionally by ratio', () => {
    const root = split('row', leaf('a'), leaf('b'), 0.3)
    const rects = computeRects(root, { x: 0, y: 0, width: 100, height: 50 })
    expect(rects).toEqual([
      { tileId: 'a', rect: { x: 0, y: 0, width: 30, height: 50 } },
      { tileId: 'b', rect: { x: 30, y: 0, width: 70, height: 50 } }
    ])
  })

  it('splits a column proportionally by ratio', () => {
    const root = split('column', leaf('a'), leaf('b'), 0.25)
    const rects = computeRects(root, { x: 0, y: 0, width: 40, height: 100 })
    expect(rects).toEqual([
      { tileId: 'a', rect: { x: 0, y: 0, width: 40, height: 25 } },
      { tileId: 'b', rect: { x: 0, y: 25, width: 40, height: 75 } }
    ])
  })

  it('handles nested splits and covers the full area with no gaps or overlaps', () => {
    const root = split('row', split('column', leaf('a'), leaf('b'), 0.5), leaf('c'), 0.5)
    const rects = computeRects(root, { x: 0, y: 0, width: 200, height: 200 })
    const byId = Object.fromEntries(rects.map((r) => [r.tileId, r.rect]))
    expect(byId.a).toEqual({ x: 0, y: 0, width: 100, height: 100 })
    expect(byId.b).toEqual({ x: 0, y: 100, width: 100, height: 100 })
    expect(byId.c).toEqual({ x: 100, y: 0, width: 100, height: 200 })
  })

  it('returns an empty array for a null tree', () => {
    expect(computeRects(null, { x: 0, y: 0, width: 10, height: 10 })).toEqual([])
  })
})

describe('moveTile', () => {
  const root = split('row', leaf('a'), split('column', leaf('b'), leaf('c')))

  it('swaps on center drop', () => {
    expect(listTileIds(moveTile(root, 'a', 'c', 'center'))).toEqual(['c', 'b', 'a'])
  })

  it('moves a tile to the left of the target', () => {
    const result = moveTile(root, 'c', 'a', 'left')
    expect(result).toEqual(split('row', split('row', leaf('c'), leaf('a')), leaf('b')))
  })

  it('moves a tile below the target', () => {
    const result = moveTile(root, 'a', 'b', 'bottom')
    expect(result).toEqual(split('column', split('column', leaf('b'), leaf('a')), leaf('c')))
  })

  it('is a no-op when dropping on itself or on a missing tile', () => {
    expect(moveTile(root, 'a', 'a', 'left')).toBe(root)
    expect(moveTile(root, 'a', 'zzz', 'left')).toBe(root)
  })
})

describe('chooseGridColumns / autoGrid', () => {
  // Typical content area: 1400x900 window minus the dock and status bar.
  const aspect = (1400 - 64) / (900 - 28)

  it('returns null for no tiles', () => {
    expect(autoGrid([], aspect)).toBeNull()
  })

  it('uses a single leaf for one tile', () => {
    expect(autoGrid(['a'], aspect)).toEqual(leaf('a'))
  })

  it('picks cells close to 16:9: four tiles become 2x2', () => {
    expect(chooseGridColumns(4, aspect)).toBe(2)
    const rects = computeRects(autoGrid(['a', 'b', 'c', 'd'], aspect), { x: 0, y: 0, width: 1600, height: 900 })
    for (const r of rects) {
      expect(r.rect.width).toBeCloseTo(800)
      expect(r.rect.height).toBeCloseTo(450)
    }
  })

  it('never produces the old "keep halving the last tile" layout for many tiles', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const rects = computeRects(autoGrid(ids, 16 / 9), { x: 0, y: 0, width: 1600, height: 900 })
    const widths = rects.map((r) => r.rect.width)
    // All cells equal-ish: the smallest is at least half the largest.
    expect(Math.min(...widths) / Math.max(...widths)).toBeGreaterThanOrEqual(0.5)
  })

  it('keeps row lengths within one tile of each other', () => {
    const tree = autoGrid(['a', 'b', 'c', 'd', 'e'], 16 / 9)
    const rects = computeRects(tree, { x: 0, y: 0, width: 1600, height: 900 })
    const rowsByY = new Map<number, number>()
    for (const r of rects) rowsByY.set(Math.round(r.rect.y), (rowsByY.get(Math.round(r.rect.y)) ?? 0) + 1)
    const lengths = [...rowsByY.values()]
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(1)
  })

  it('tiles cover the whole area with no gaps', () => {
    const rects = computeRects(autoGrid(['a', 'b', 'c'], aspect), { x: 0, y: 0, width: 1000, height: 600 })
    const area = rects.reduce((sum, r) => sum + r.rect.width * r.rect.height, 0)
    expect(area).toBeCloseTo(600000)
  })
})

describe('computeSplitters', () => {
  it('returns one handle per split, positioned at the ratio boundary', () => {
    const tree = split('row', leaf('a'), split('column', leaf('b'), leaf('c'), 0.25), 0.4)
    const handles = computeSplitters(tree, { x: 0, y: 0, width: 1000, height: 800 }, 6)
    expect(handles).toHaveLength(2)
    expect(handles[0]).toMatchObject({ path: [], direction: 'row', rect: { x: 397, width: 6, height: 800 } })
    expect(handles[1]).toMatchObject({ path: ['b'], direction: 'column', rect: { x: 400, y: 197, width: 600 } })
  })

  it('returns nothing for a single leaf', () => {
    expect(computeSplitters(leaf('a'), { x: 0, y: 0, width: 10, height: 10 }, 4)).toEqual([])
  })
})

describe('splitterRatioAt / splitterOffset (the guide line while dragging)', () => {
  const tree = split('row', leaf('a'), split('column', leaf('b'), leaf('c'), 0.25), 0.4)
  const [rowHandle, columnHandle] = computeSplitters(tree, { x: 0, y: 0, width: 1000, height: 800 }, 6)

  it('turns the pointer into a ratio of the split it belongs to', () => {
    expect(splitterRatioAt(rowHandle, 600, 123)).toBe(0.6)
    // The nested column split spans x 400..1000, y 0..800.
    expect(splitterRatioAt(columnHandle, 999, 400)).toBe(0.5)
  })

  it('stops at the same limits as resizeAt', () => {
    expect(splitterRatioAt(rowHandle, -50, 0)).toBe(0.05)
    expect(splitterRatioAt(rowHandle, 5000, 0)).toBe(0.95)
    expect(resizeAt(tree, [], splitterRatioAt(rowHandle, 5000, 0))).toMatchObject({ ratio: 0.95 })
  })

  it('moves the handle to where the split will be after release', () => {
    expect(splitterOffset(rowHandle, 0.4)).toBe(0)
    expect(splitterOffset(rowHandle, 0.6)).toBe(200)
    expect(splitterOffset(columnHandle, 0.5)).toBe(200)
    const after = computeSplitters(resizeAt(tree, [], 0.6), { x: 0, y: 0, width: 1000, height: 800 }, 6)[0]
    expect(after.rect.x).toBe(rowHandle.rect.x + splitterOffset(rowHandle, 0.6))
  })

  it('copes with a zero-sized split (no NaN)', () => {
    const [handle] = computeSplitters(tree, { x: 0, y: 0, width: 0, height: 0 }, 6)
    const ratio = splitterRatioAt(handle, 10, 10)
    expect(ratio).toBeGreaterThanOrEqual(0.05)
    expect(ratio).toBeLessThanOrEqual(0.95)
  })
})

describe('visualOrder', () => {
  it('reads tiles top row first, then left to right — not in tree order', () => {
    const root = split('row', split('column', leaf('a'), leaf('c')), leaf('b'))
    expect(listTileIds(root)).toEqual(['a', 'c', 'b'])
    expect(visualOrder(root)).toEqual(['a', 'b', 'c'])
  })

  it('is empty for an empty tree', () => {
    expect(visualOrder(null)).toEqual([])
  })
})

describe('insertTile (split the largest tile along its longer side)', () => {
  const wide = 16 / 9

  it('starts a tree from nothing', () => {
    expect(insertTile(null, 'a', wide)).toEqual(leaf('a'))
  })

  it('splits side by side in a wide area, stacked in a tall one', () => {
    expect(insertTile(leaf('a'), 'b', wide)).toEqual(split('row', leaf('a'), leaf('b')))
    expect(insertTile(leaf('a'), 'b', 0.5)).toEqual(split('column', leaf('a'), leaf('b')))
  })

  it('fills a wide area into a 2x2 grid in reading order', () => {
    let root: LayoutNode | null = null
    for (const id of ['a', 'b', 'c', 'd']) root = insertTile(root, id, wide)
    expect(visualOrder(root)).toEqual(['a', 'b', 'c', 'd'])
    const rects = computeRects(root, { x: 0, y: 0, width: 160, height: 90 })
    for (const { rect } of rects) {
      expect(rect.width).toBeCloseTo(80)
      expect(rect.height).toBeCloseTo(45)
    }
  })

  it('splits the largest tile, leaving every other split as the user left it', () => {
    const root = split('row', leaf('a'), split('column', leaf('b'), leaf('c'), 0.3), 0.7)
    const result = insertTile(root, 'n', wide)
    expect(result).toEqual(split('row', split('row', leaf('a'), leaf('n')), split('column', leaf('b'), leaf('c'), 0.3), 0.7))
  })

  it('never changes anything else: removing the new tile gives back the same tree', () => {
    const trees: LayoutNode[] = [
      leaf('a'),
      split('row', leaf('a'), leaf('b'), 0.2),
      split('column', split('row', leaf('a'), leaf('b'), 0.7), split('row', leaf('c'), leaf('d'), 0.3), 0.6),
      split('row', split('column', leaf('a'), split('row', leaf('b'), leaf('c'), 0.8), 0.35), leaf('d'), 0.55)
    ]
    for (const tree of trees) {
      expect(removeTile(insertTile(tree, 'n', wide), 'n')).toEqual(tree)
    }
  })
})

describe('closing a tile keeps the user\'s layout (regression: closing used to re-grid everything)', () => {
  it('only the sibling takes the space; other ratios stay', () => {
    const root = split('column', split('row', leaf('a'), leaf('b'), 0.7), split('row', leaf('c'), leaf('d'), 0.3), 0.6)
    expect(removeTile(root, 'b')).toEqual(split('column', leaf('a'), split('row', leaf('c'), leaf('d'), 0.3), 0.6))
  })

  it('a move followed by add and close keeps where the moved tile went', () => {
    let root: LayoutNode | null = autoGrid(['a', 'b', 'c', 'd'], 16 / 9)
    root = moveTile(root, 'd', 'a', 'left') // d now left of a, top row
    expect(visualOrder(root).slice(0, 2)).toEqual(['d', 'a'])
    root = insertTile(root, 'e', 16 / 9)
    root = removeTile(root, 'e')
    root = removeTile(root, 'c')
    expect(visualOrder(root)).toEqual(['d', 'a', 'b'])
  })
})

describe('moveTileToEdge', () => {
  const area = { x: 0, y: 0, width: 160, height: 90 }

  it('puts the tile along the whole bottom, one band tall', () => {
    const grid = autoGrid(['a', 'b', 'c', 'd'], 16 / 9)
    const result = moveTileToEdge(grid, 'd', 'bottom')!
    expect(result.type).toBe('split')
    const d = computeRects(result, area).find((r) => r.tileId === 'd')!.rect
    // Two rows remain (a b / c), so d takes a third of the height.
    expect(d.x).toBe(0)
    expect(d.width).toBe(160)
    expect(d.height).toBeCloseTo(30)
    expect(removeTile(result, 'd')).toEqual(removeTile(grid, 'd'))
  })

  it('puts the tile along the whole left side', () => {
    const root = split('column', leaf('a'), leaf('b'))
    const result = moveTileToEdge(root, 'b', 'left')
    expect(result).toEqual(split('row', leaf('b'), leaf('a'), 0.5))
  })

  it('counts columns for a side drop', () => {
    const root = split('row', leaf('a'), split('row', leaf('b'), leaf('c')), 1 / 3)
    const result = moveTileToEdge(split('column', root, leaf('d')), 'd', 'right')
    const d = computeRects(result, area).find((r) => r.tileId === 'd')!.rect
    expect(d.width).toBeCloseTo(40) // three columns remain: d is the fourth
    expect(d.height).toBe(90)
  })

  it('does nothing for the only tile or a missing one', () => {
    expect(moveTileToEdge(leaf('a'), 'a', 'top')).toEqual(leaf('a'))
    const root = split('row', leaf('a'), leaf('b'))
    expect(moveTileToEdge(root, 'x', 'top')).toBe(root)
    expect(moveTileToEdge(null, 'a', 'top')).toBeNull()
  })
})

describe('applyDrop / dropPreview', () => {
  const root = split('row', leaf('a'), split('column', leaf('b'), leaf('c')))
  const area = { x: 0, y: 0, width: 100, height: 100 }

  it('dispatches tile and edge drops', () => {
    expect(applyDrop(root, 'a', { kind: 'tile', targetTileId: 'c', zone: 'center' })).toEqual(swapTiles(root, 'a', 'c'))
    expect(applyDrop(root, 'a', { kind: 'edge', edge: 'top' })).toEqual(moveTileToEdge(root, 'a', 'top'))
  })

  it('shows where the tile really lands, after its old place has closed up', () => {
    // b leaves the right column, so c grows to the full height before being split:
    // b lands on the right quarter at full height, not on a corner of where c was.
    expect(dropPreview(root, area, { kind: 'tile', tileId: 'b' }, { kind: 'tile', targetTileId: 'c', zone: 'right' })).toEqual([
      { x: 75, y: 0, width: 25, height: 100 }
    ])
  })

  it('shows both tiles of a swap', () => {
    expect(dropPreview(root, area, { kind: 'tile', tileId: 'a' }, { kind: 'tile', targetTileId: 'c', zone: 'center' })).toEqual([
      { x: 50, y: 50, width: 50, height: 50 },
      { x: 0, y: 0, width: 50, height: 100 }
    ])
  })

  it('shows nothing for a drop that changes nothing', () => {
    expect(dropPreview(root, area, { kind: 'tile', tileId: 'a' }, { kind: 'tile', targetTileId: 'a', zone: 'left' })).toEqual([])
    expect(dropPreview(leaf('a'), area, { kind: 'tile', tileId: 'a' }, { kind: 'edge', edge: 'left' })).toEqual([])
  })
})

describe('insertTileAt (a new tile dragged from the Dock)', () => {
  const root = split('row', leaf('a'), split('column', leaf('b'), leaf('c'), 0.3), 0.7)
  const area = { x: 0, y: 0, width: 160, height: 90 }

  it('on a tile\'s side: that tile is halved, nothing else changes', () => {
    expect(insertTileAt(root, 'n', { kind: 'tile', targetTileId: 'c', zone: 'left' }, 16 / 9)).toEqual(
      split('row', leaf('a'), split('column', leaf('b'), split('row', leaf('n'), leaf('c')), 0.3), 0.7)
    )
  })

  it('on a tile\'s centre: halved along its longer side (no swap)', () => {
    // a is 112 x 90 (wide) -> side by side; b is 48 x 27 (wide) -> side by side.
    expect(insertTileAt(root, 'n', { kind: 'tile', targetTileId: 'a', zone: 'center' }, 16 / 9)).toEqual(
      split('row', split('row', leaf('a'), leaf('n')), split('column', leaf('b'), leaf('c'), 0.3), 0.7)
    )
    // In a tall area, c (0.3 x 1.4 of 1 x 2) is tall -> stacked.
    expect(insertTileAt(root, 'n', { kind: 'tile', targetTileId: 'c', zone: 'center' }, 0.5)).toEqual(
      split('row', leaf('a'), split('column', leaf('b'), split('column', leaf('c'), leaf('n')), 0.3), 0.7)
    )
  })

  it('on an edge of the area: along the whole edge, one band thick, the rest untouched', () => {
    const result = insertTileAt(root, 'n', { kind: 'edge', edge: 'top' }, 16 / 9)
    expect(result).toEqual(split('column', leaf('n'), root, 1 / 3))
  })

  it('into an empty workspace: the whole area', () => {
    expect(insertTileAt(null, 'n', { kind: 'area' }, 16 / 9)).toEqual(leaf('n'))
  })

  it('a drop that can\'t be done still adds the tile (the usual way)', () => {
    expect(insertTileAt(root, 'n', { kind: 'tile', targetTileId: 'gone', zone: 'left' }, 16 / 9)).toEqual(
      insertTile(root, 'n', 16 / 9)
    )
    expect(insertTileAt(root, 'n', { kind: 'area' }, 16 / 9)).toEqual(insertTile(root, 'n', 16 / 9))
  })

  it('the preview is where the new tile really lands', () => {
    const drops = [
      { kind: 'tile', targetTileId: 'c', zone: 'bottom' },
      { kind: 'tile', targetTileId: 'a', zone: 'center' },
      { kind: 'edge', edge: 'right' }
    ] as const
    for (const drop of drops) {
      const placed = computeRects(insertTileAt(root, 'n', drop, area.width / area.height), area).find((r) => r.tileId === 'n')!
      expect(dropPreview(root, area, { kind: 'new' }, drop)).toEqual([placed.rect])
    }
    expect(dropPreview(null, area, { kind: 'new' }, { kind: 'area' })).toEqual([area])
  })

  it('a move onto a centre still swaps; a move can\'t use the empty-area drop', () => {
    expect(applyDrop(root, 'a', { kind: 'tile', targetTileId: 'b', zone: 'center' })).toEqual(swapTiles(root, 'a', 'b'))
    expect(applyDrop(root, 'a', { kind: 'area' })).toBe(root)
  })
})
