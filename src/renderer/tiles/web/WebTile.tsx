import { EmbeddedWebView } from '../shared/EmbeddedWebView'
import { useTileConfig } from '../shared/useTileConfig'

/** A "web" tile, or a kind:"web" plugin: one page in its own session partition. */
export function WebTile({ tileId }: { tileId: string }): React.JSX.Element {
  const [config] = useTileConfig<{ url: string; partitionId: string; compactCss: string }>(tileId)
  return (
    <EmbeddedWebView
      viewId={tileId}
      source={
        config.url && config.partitionId
          ? { url: config.url, partitionId: config.partitionId, compactCss: config.compactCss }
          : null
      }
    />
  )
}
