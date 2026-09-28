/**
 * Web views a tile owns besides its own are "<tileId>::<name>"; the main
 * process closes them along with the tile.
 */
export function subViewId(tileId: string, name: string): string {
  return `${tileId}::${name}`
}

const SIDE_PANE = 'pane-'

/**
 * A side pane next to the tile's own content (the AI Builder chat, the Files
 * preview). Unlike other sub-views (Mail's per-provider views), its page title
 * doesn't become the tile's title.
 */
export function sidePaneId(tileId: string, name: string): string {
  return subViewId(tileId, SIDE_PANE + name)
}

export function baseTileId(viewId: string): string {
  return viewId.split('::')[0]
}

/** The tile whose title a view's page title becomes, or null for a side pane. */
export function titledTileId(viewId: string): string | null {
  const [tileId, name] = viewId.split('::')
  return name?.startsWith(SIDE_PANE) ? null : tileId
}
