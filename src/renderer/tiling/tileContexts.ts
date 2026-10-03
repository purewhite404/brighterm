import { createContext } from 'react'
import type { Rect } from '@shared/types'

/** dataTransfer type of a tile dragged by its header (data: the tile id). */
export const TILE_DRAG_MIME = 'application/x-brighterm-tile'
/** dataTransfer type of a new tile dragged from the Dock (what to add is in the store's `tileDrag`). */
export const NEW_TILE_DRAG_MIME = 'application/x-brighterm-new-tile'

/** The tile's rect within the tiling area; web tiles re-report their on-screen bounds whenever it changes. */
export const TileRectContext = createContext<Rect | null>(null)
