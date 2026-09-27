import { create } from 'zustand'
import type {
  AppConfig,
  Card,
  LayoutNode,
  SplitDirection,
  SystemMemorySnapshot,
  TileInstance,
  Workspace
} from '@shared/types'
import { removeTile, resizeAt, splitLeaf, type NodePath, type SplitPosition } from '../tiling/layout'

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

  load: () => Promise<void>
  switchWorkspace: (workspaceId: string) => void
  createWorkspace: (name: string, icon: string) => string
  deleteWorkspace: (workspaceId: string) => void

  addTile: (
    tile: Omit<TileInstance, 'id'>,
    opts?: { splitTargetTileId?: string; direction?: SplitDirection; position?: SplitPosition; ratio?: number }
  ) => string
  closeTile: (tileId: string) => void
  resizeSplitAt: (path: NodePath, ratio: number) => void

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

  load: async () => {
    const config = await window.api.config.get()
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

  addTile: (tile, opts = {}) => {
    const { config } = get()
    if (!config) return ''
    const ws = activeWorkspace(get())
    if (!ws) return ''

    const id = genId('tile')
    const instance: TileInstance = { ...tile, id }

    let layout: LayoutNode
    if (ws.layout === null) {
      layout = { type: 'leaf', tileId: id }
    } else {
      const targetId = opts.splitTargetTileId ?? lastLeafId(ws.layout)
      layout = splitLeaf(ws.layout, targetId, id, opts.direction ?? 'row', opts.position ?? 'after', opts.ratio ?? 0.5)
    }

    const next = updateWorkspace(config, ws.id, (w) => ({
      ...w,
      layout,
      tiles: { ...w.tiles, [id]: instance }
    }))
    set({ config: next })
    persist(next)
    return id
  },

  closeTile: (tileId) => {
    const { config } = get()
    if (!config) return
    const ws = activeWorkspace(get())
    if (!ws) return

    const layout = removeTile(ws.layout, tileId)
    const tiles = { ...ws.tiles }
    delete tiles[tileId]
    const next = updateWorkspace(config, ws.id, (w) => ({ ...w, layout, tiles }))
    set({ config: next })
    persist(next)

    void window.api.tile.close(tileId)
    set((state) => {
      const runtime = { ...state.runtime }
      delete runtime[tileId]
      return { runtime }
    })
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

function lastLeafId(node: LayoutNode): string {
  if (node.type === 'leaf') return node.tileId
  return lastLeafId(node.b)
}
