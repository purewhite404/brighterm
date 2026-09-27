import { createContext } from 'react'
import type { Rect } from '@shared/types'

export const TILE_DRAG_MIME = 'application/x-brighterm-tile'

/** The tile's rect within the tiling area; web tiles re-report their on-screen bounds whenever it changes. */
export const TileRectContext = createContext<Rect | null>(null)

/** Lets TileChrome start/end a drag without prop-drilling through the tile tree. */
export const TileDragContext = createContext<{
  draggingTileId: string | null
  startDrag: (tileId: string) => void
  endDrag: () => void
}>({ draggingTileId: null, startDrag: () => {}, endDrag: () => {} })
