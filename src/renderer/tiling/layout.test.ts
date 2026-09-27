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
  swapTiles
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
