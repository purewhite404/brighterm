import { create } from 'zustand'
import type { AppConfig, Card, SystemMemorySnapshot, TileInstance, Workspace } from '@shared/types'
import { autoGrid, listTileIds, moveTile, resizeAt, type DropZone, type NodePath } from '../tiling/layout'

export interface TileRuntimeState {
  titleOverride?: string
  snapshot: string | null
  suspended: boolean
  memoryBytes: number
}

interface AppState {
  loaded: boolean
  config: AppConfig | null
  /** Ephemeral, non-persisted per-tile state (snapshot, live title, memory). */
  runtime: Record<string, TileRuntimeState>
  paletteOpen: boolean
  memorySnapshot: SystemMemorySnapshot | null
  hqCards: Card[]
  /** Width / height of the tiling area, kept current by TilingView; drives the auto grid. */
  viewportAspect: number

  load: () => Promise<void>
  switchWorkspace: (workspaceId: string) => void
  createWorkspace: (name: string, icon: string) => string
  deleteWorkspace: (workspaceId: string) => void

  /** Add a tile and re-flow the workspace into a grid of roughly 16:9 cells. */
  addTile: (tile: Omit<TileInstance, 'id'>) => string
  closeTile: (tileId: string) => void
  /** Close tiles in any workspace (each affected workspace re-flows into a grid). */
  closeTiles: (tileIds: string[]) => void
  /** Shallow-merge into a tile's persisted config (whichever workspace it's in), e.g. a Browser's current URL. */
  updateTileConfig: (tileId: string, patch: Record<string, unknown>) => void
  resizeSplitAt: (path: NodePath, ratio: number) => void
  moveTileTo: (tileId: string, targetTileId: string, zone: DropZone) => void
  setViewportAspect: (aspect: number) => void
  /** Shallow-merge into the app config, in memory and on disk. */
  updateConfig: (patch: Partial<AppConfig>) => void

  setTileRuntime: (tileId: string, patch: Partial<TileRuntimeState>) => void
  setPaletteOpen: (open: boolean) => void
  setMemorySnapshot: (snapshot: SystemMemorySnapshot) => void
  setHqCards: (cards: Card[]) => void
  publishHqCard: (card: Card) => void
  removeHqCard: (cardId: string) => void
}

function activeWorkspace(state: AppState): Workspace | null {
  if (!state.config) return null
  return state.config.workspaces.find((w) => w.id === state.config!.activeWorkspaceId) ?? null
}

function persist(config: AppConfig): void {
  void window.api.config.set({ workspaces: config.workspaces, activeWorkspaceId: config.activeWorkspaceId })
}

function updateWorkspace(config: AppConfig, workspaceId: string, updater: (w: Workspace) => Workspace): AppConfig {
  return {
    ...config,
    workspaces: config.workspaces.map((w) => (w.id === workspaceId ? updater(w) : w))
  }
}

let idCounter = 0
function genId(prefix: string): string {
  idCounter += 1
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`
  return `${prefix}-${random}-${idCounter}`
}

export const useAppStore = create<AppState>((set, get) => ({
  loaded: false,
  config: null,
  runtime: {},
  paletteOpen: false,
  memorySnapshot: null,
  hqCards: [],
  viewportAspect: 16 / 9,

  load: async () => {
    const config = await window.api.config.get()
    performance.mark('shell:config-loaded')
    set({ config, loaded: true })
  },

  switchWorkspace: (workspaceId) => {
    const { config } = get()
    if (!config) return
    const next = { ...config, activeWorkspaceId: workspaceId }
    set({ config: next })
    persist(next)
  },

  createWorkspace: (name, icon) => {
    const { config } = get()
    if (!config) return ''
    const id = genId('ws')
    const workspace: Workspace = { id, name, icon, layout: null, tiles: {} }
    const next: AppConfig = {
      ...config,
      workspaces: [...config.workspaces, workspace],
      activeWorkspaceId: id
    }
    set({ config: next })
    persist(next)
    return id
  },

  deleteWorkspace: (workspaceId) => {
    const { config } = get()
    if (!config || config.workspaces.length <= 1) return
    const workspaces = config.workspaces.filter((w) => w.id !== workspaceId)
    const activeWorkspaceId =
      config.activeWorkspaceId === workspaceId ? workspaces[0]?.id ?? null : config.activeWorkspaceId
    const next: AppConfig = { ...config, workspaces, activeWorkspaceId }
    set({ config: next })
    persist(next)
  },

  addTile: (tile) => {
    const { config, viewportAspect } = get()
    if (!config) return ''
    const ws = activeWorkspace(get())
    if (!ws) return ''

    const id = genId('tile')
    const instance: TileInstance = { ...tile, id }
    const layout = autoGrid([...listTileIds(ws.layout), id], viewportAspect)

    const next = updateWorkspace(config, ws.id, (w) => ({
      ...w,
      layout,
      tiles: { ...w.tiles, [id]: instance }
    }))
    set({ config: next })
    persist(next)
    return id
  },

  closeTile: (tileId) => get().closeTiles([tileId]),

  closeTiles: (tileIds) => {
    const { config, viewportAspect } = get()
    if (!config || tileIds.length === 0) return
    const closing = new Set(tileIds)
    const next: AppConfig = {
      ...config,
      workspaces: config.workspaces.map((w) => {
        if (!Object.keys(w.tiles).some((id) => closing.has(id))) return w
        const tiles = { ...w.tiles }
        for (const id of closing) delete tiles[id]
        const layout = autoGrid(
          listTileIds(w.layout).filter((id) => !closing.has(id)),
          viewportAspect
        )
        return { ...w, layout, tiles }
      })
    }
    set({ config: next })
    persist(next)

    for (const tileId of tileIds) void window.api.tile.close(tileId)
    set((state) => {
      const runtime = { ...state.runtime }
      for (const tileId of tileIds) delete runtime[tileId]
      return { runtime }
    })
  },

  updateTileConfig: (tileId, patch) => {
    const { config } = get()
    if (!config) return
    const ws = config.workspaces.find((w) => w.tiles[tileId])
    if (!ws) return
    const tile = ws.tiles[tileId]
    if (Object.entries(patch).every(([key, value]) => tile.config?.[key] === value)) return
    const next = updateWorkspace(config, ws.id, (w) => ({
      ...w,
      tiles: { ...w.tiles, [tileId]: { ...tile, config: { ...tile.config, ...patch } } }
    }))
    set({ config: next })
    persist(next)
  },

  resizeSplitAt: (path, ratio) => {
    const { config } = get()
    if (!config) return
    const ws = activeWorkspace(get())
    if (!ws) return
    const layout = resizeAt(ws.layout, path, ratio)
    const next = updateWorkspace(config, ws.id, (w) => ({ ...w, layout }))
    set({ config: next })
    persist(next)
  },

  moveTileTo: (tileId, targetTileId, zone) => {
    const { config } = get()
    if (!config) return
    const ws = activeWorkspace(get())
    if (!ws) return
    const layout = moveTile(ws.layout, tileId, targetTileId, zone)
    if (layout === ws.layout) return
    const next = updateWorkspace(config, ws.id, (w) => ({ ...w, layout }))
    set({ config: next })
    persist(next)
  },

  setViewportAspect: (aspect) => {
    if (Number.isFinite(aspect) && aspect > 0) set({ viewportAspect: aspect })
  },

  updateConfig: (patch) => {
    const { config } = get()
    if (!config) return
    set({ config: { ...config, ...patch } })
    void window.api.config.set(patch)
  },

  setTileRuntime: (tileId, patch) => {
    set((state) => {
      const defaults: TileRuntimeState = { snapshot: null, suspended: false, memoryBytes: 0 }
      const existing: TileRuntimeState = state.runtime[tileId] ?? defaults
      return { runtime: { ...state.runtime, [tileId]: { ...existing, ...patch } } }
    })
  },

  setPaletteOpen: (open) => set({ paletteOpen: open }),

  setMemorySnapshot: (snapshot) => set({ memorySnapshot: snapshot }),

  setHqCards: (cards) => set({ hqCards: cards }),

  publishHqCard: (card) => {
    set((state) => {
      const existingIndex = state.hqCards.findIndex((c) => c.id === card.id)
      const hqCards = [...state.hqCards]
      if (existingIndex >= 0) hqCards[existingIndex] = card
      else hqCards.push(card)
      hqCards.sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority))
      return { hqCards }
    })
  },

  removeHqCard: (cardId) => {
    set((state) => ({ hqCards: state.hqCards.filter((c) => c.id !== cardId) }))
  }
}))

function priorityRank(p: Card['priority']): number {
  return { urgent: 3, high: 2, normal: 1, low: 0 }[p]
}

export function selectActiveWorkspace(state: AppState): Workspace | null {
  return activeWorkspace(state)
}
