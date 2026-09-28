import { useEffect, useRef, useState } from 'react'
import { useAppStore, selectActiveWorkspace } from '../../store/appStore'
import { useTileConfig } from '../shared/useTileConfig'

/** Set in a plugin tile's config (see FileExplorerTile) to open a file in it. */
export interface OpenFileRequest {
  folderPath: string
  name: string
  /** Makes each request distinct, so opening the same file twice still triggers. */
  nonce: number
}

interface BridgeMessage {
  __brighterm: true
  id: number
  pluginId: string
  method: string
  args: unknown[]
}

/**
 * Renders a kind:"app" plugin inside a sandboxed iframe served from the
 * `plugin-app://` protocol (see src/main/plugins/protocol.ts), and answers
 * its `window.brighterm` postMessage RPC by forwarding each call to the main
 * process (which enforces the plugin's declared permissions).
 */
export function PluginFrame({ tileId }: { tileId: string }): React.JSX.Element {
  const title = useAppStore((s) => selectActiveWorkspace(s)?.tiles[tileId]?.title)
  const [config, updateConfig] = useTileConfig<{ pluginId: string; openRequest: OpenFileRequest | null }>(tileId)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const pluginId = config.pluginId
  const openRequest = config.openRequest

  useEffect(() => {
    if (!pluginId) return
    let cancelled = false
    void window.api.plugins.getAppUrl(pluginId).then((url) => {
      if (!cancelled) setSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [pluginId])

  useEffect(() => {
    if (!pluginId) return

    const onMessage = async (event: MessageEvent): Promise<void> => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data as Partial<BridgeMessage>
      if (!data || data.__brighterm !== true || typeof data.id !== 'number' || !data.method) return

      try {
        const result = await window.api.plugins.hostCall(pluginId, data.method, data.args ?? [])
        iframeRef.current?.contentWindow?.postMessage({ __brighterm: true, id: data.id, result }, '*')
      } catch (err) {
        iframeRef.current?.contentWindow?.postMessage(
          { __brighterm: true, id: data.id, error: err instanceof Error ? err.message : String(err) },
          '*'
        )
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [pluginId])

  // "Open in <plugin>" from the Files tile: grant the file's folder, then hand the plugin the file.
  useEffect(() => {
    if (!pluginId || !loaded || !openRequest) return
    let cancelled = false
    void window.api.plugins.grantFolder(pluginId, openRequest.folderPath).then((folder) => {
      if (cancelled) return
      iframeRef.current?.contentWindow?.postMessage(
        { __brighterm: true, event: 'openFile', payload: { folder, name: openRequest.name } },
        '*'
      )
      updateConfig({ openRequest: null })
    })
    return () => {
      cancelled = true
    }
  }, [pluginId, loaded, openRequest, updateConfig])

  if (!pluginId) {
    return <div className="bt-tile-body bt-tile-body--centered bt-text-muted">プラグインが指定されていません</div>
  }
  if (!src) {
    return <div className="bt-tile-body bt-tile-body--centered bt-text-muted">読み込み中…</div>
  }

  return (
    <iframe
      ref={iframeRef}
      src={src}
      title={title ?? pluginId}
      className="bt-plugin-frame"
      onLoad={() => setLoaded(true)}
      sandbox="allow-scripts allow-forms allow-modals allow-popups"
    />
  )
}
