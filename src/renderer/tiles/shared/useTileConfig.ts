import { useCallback } from 'react'
import { useAppStore, selectActiveWorkspace } from '../../store/appStore'

/**
 * A tile's persisted config (survives remounts and restarts — e.g. a Browser's
 * URL, the Files tree's expanded folders) and a setter that shallow-merges into it.
 */
export function useTileConfig<T extends object>(tileId: string): [Partial<T>, (patch: Partial<T>) => void] {
  const config = useAppStore((s) => selectActiveWorkspace(s)?.tiles[tileId]?.config) as Partial<T> | undefined
  const updateTileConfig = useAppStore((s) => s.updateTileConfig)
  const update = useCallback(
    (patch: Partial<T>) => updateTileConfig(tileId, patch as Record<string, unknown>),
    [tileId, updateTileConfig]
  )
  return [config ?? {}, update]
}
