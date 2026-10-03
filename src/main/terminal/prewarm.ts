import type { AppConfig } from '@shared/types'

export interface PrewarmTerminal {
  tileId: string
  shellId?: string
  cwd?: string
}

/**
 * The Terminal tiles the window will show first: those in the active workspace
 * (other workspaces' tiles only mount when switched to).
 */
export function terminalsToPrewarm(config: AppConfig): PrewarmTerminal[] {
  const workspace = config.workspaces.find((w) => w.id === config.activeWorkspaceId)
  if (!workspace) return []
  return Object.values(workspace.tiles)
    .filter((tile) => tile.kind === 'builtin' && tile.typeId === 'terminal')
    .map((tile) => {
      const config = (tile.config ?? {}) as { shellId?: unknown; cwd?: unknown }
      return {
        tileId: tile.id,
        shellId: typeof config.shellId === 'string' ? config.shellId : undefined,
        cwd: typeof config.cwd === 'string' ? config.cwd : undefined
      }
    })
}
