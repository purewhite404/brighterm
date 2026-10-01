import { useEffect, useRef, useState } from 'react'
import { useAppStore, selectActiveWorkspace } from '../../store/appStore'
import { CopyButton } from '../../ui/CopyButton'
import { Icon } from '../../ui/Icon'
import { buildRuntimeFixPrompt } from '../ai-builder/promptBuilder'
import { usePluginList } from '../shared/usePluginList'
import { useTileConfig } from '../shared/useTileConfig'
import { FolderBar } from './FolderBar'
import './plugin.css'

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

/** The newest errors are kept; older ones only count. */
const MAX_ERRORS = 5

/** "Error invoking remote method 'plugins:host-call': Error: <what we threw>" → what we threw. */
function hostErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/**
 * Renders a kind:"app" plugin inside a sandboxed iframe served from the
 * `plugin-app://` protocol (see src/main/plugins/protocol.ts), and answers
 * its `window.brighterm` postMessage RPC by forwarding each call to the main
 * process (which enforces the plugin's declared permissions).
 *
 * Failed calls and errors the plugin doesn't handle show up in a bar above
 * it, with a fix request to paste into the AI Builder's chat. Installing the
 * plugin again (same id) reloads the frame with the new code.
 *
 * A plugin that calls `fs.showFolderBar` gets a folder address bar on top
 * (FolderBar): the path is shown and typed here, in the shell, and the plugin
 * only ever receives the granted handle ("folderBarChange" event).
 */
export function PluginFrame({ tileId }: { tileId: string }): React.JSX.Element {
  const title = useAppStore((s) => selectActiveWorkspace(s)?.tiles[tileId]?.title)
  const [config, updateConfig] = useTileConfig<{ pluginId: string; openRequest: OpenFileRequest | null }>(tileId)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [errorCount, setErrorCount] = useState(0)
  const errorsRef = useRef<string[]>([])
  /** The folder bar's path ('' = shown, no folder yet); null until the plugin asks for the bar. */
  const [folderBarPath, setFolderBarPath] = useState<string | null>(null)

  const pluginId = config.pluginId
  const openRequest = config.openRequest
  const plugin = usePluginList().find((p) => p.manifest.id === pluginId)

  // A reinstall (even of the same version) gets a new installedAt: reload the frame with the new code.
  const installedAt = plugin?.installedAt ?? 0
  const seenInstalledAt = useRef(0)
  const [reloads, setReloads] = useState(0)
  useEffect(() => {
    if (!installedAt) return
    if (seenInstalledAt.current && installedAt !== seenInstalledAt.current) setReloads((n) => n + 1)
    seenInstalledAt.current = installedAt
  }, [installedAt])

  /** Lists an error once; the same failure again only counts (e.g. every photo of a folder). */
  const addError = (message: string): void => {
    const listed = errorsRef.current
    // An uncaught failed call is reported again by the plugin's page — it's listed already.
    if (listed.some((e) => e.endsWith(`: ${message}`))) return
    setErrorCount((n) => n + 1)
    if (listed.includes(message)) return
    errorsRef.current = [...listed, message].slice(-MAX_ERRORS)
    setErrors(errorsRef.current)
  }

  const clearErrors = (): void => {
    errorsRef.current = []
    setErrors([])
    setErrorCount(0)
  }

  useEffect(() => {
    if (!pluginId) return
    let cancelled = false
    void window.api.plugins.getAppUrl(pluginId).then((url) => {
      if (cancelled) return
      setSrc(reloads ? `${url}?v=${reloads}` : url)
      setLoaded(false)
      setFolderBarPath(null)
      clearErrors()
    })
    return () => {
      cancelled = true
    }
  }, [pluginId, reloads])

  useEffect(() => {
    if (!pluginId) return

    const onMessage = async (event: MessageEvent): Promise<void> => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data as Partial<BridgeMessage> & { report?: string; message?: string }
      if (!data || data.__brighterm !== true) return
      if (data.report === 'error') {
        addError(String(data.message))
        return
      }
      if (typeof data.id !== 'number' || !data.method) return

      try {
        let result: unknown
        if (data.method === 'fs.showFolderBar') {
          // Answered here: main resolves the path for the bar; the plugin just gets undefined back.
          const path = await window.api.plugins.folderBarPath(pluginId, data.args?.[0] ?? null)
          setFolderBarPath(path ?? '')
        } else {
          result = await window.api.plugins.hostCall(pluginId, data.method, data.args ?? [])
        }
        iframeRef.current?.contentWindow?.postMessage({ __brighterm: true, id: data.id, result }, '*')
      } catch (err) {
        const message = hostErrorMessage(err)
        addError(`window.brighterm.${data.method}: ${message}`)
        iframeRef.current?.contentWindow?.postMessage({ __brighterm: true, id: data.id, error: message }, '*')
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

  /** The user picked another folder in the bar: tell the plugin (the handle is granted already). */
  const switchFolder = async (folder: { id: string; label: string }): Promise<void> => {
    if (!pluginId) return
    setFolderBarPath((await window.api.plugins.folderBarPath(pluginId, folder)) ?? '')
    iframeRef.current?.contentWindow?.postMessage({ __brighterm: true, event: 'folderBarChange', payload: folder }, '*')
  }

  const submitFolder = async (input: string): Promise<void> => {
    if (!pluginId) return
    let folder: { id: string; label: string }
    try {
      folder = await window.api.plugins.grantFolder(pluginId, input)
    } catch (err) {
      throw new Error(hostErrorMessage(err))
    }
    await switchFolder(folder)
  }

  const browseFolder = async (): Promise<void> => {
    if (!pluginId) return
    let folder: { id: string; label: string } | null
    try {
      folder = (await window.api.plugins.hostCall(pluginId, 'fs.pickFolder', [])) as { id: string; label: string } | null
    } catch (err) {
      throw new Error(hostErrorMessage(err))
    }
    if (folder) await switchFolder(folder)
  }

  if (!pluginId) {
    return <div className="bt-tile-body bt-tile-body--centered bt-text-muted">プラグインが指定されていません</div>
  }
  if (!src) {
    return <div className="bt-tile-body bt-tile-body--centered bt-text-muted">読み込み中…</div>
  }

  const name = plugin?.manifest.name ?? title ?? pluginId
  return (
    <div className="bt-plugin-tile">
      {/* On top, like an address bar: an error bar appearing below doesn't move it. */}
      {folderBarPath !== null && <FolderBar path={folderBarPath} onSubmit={submitFolder} onBrowse={browseFolder} />}
      {errors.length > 0 && (
        <div className="bt-plugin-tile__errors" role="alert" aria-label="プラグインのエラー">
          <div className="bt-plugin-tile__errors-head">
            <Icon name="alert" size={14} />
            <span className="bt-plugin-tile__errors-title">
              このプラグインでエラーが起きました{errorCount > errors.length ? `（${errorCount} 回）` : ''}
            </span>
            <CopyButton getText={() => buildRuntimeFixPrompt({ id: pluginId, name }, errors)} label="修正依頼をコピー" />
            <button
              className="bt-plugin-tile__errors-close"
              title="閉じる"
              aria-label="エラー表示を閉じる"
              onClick={clearErrors}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
          <ul className="bt-plugin-tile__errors-list">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          <div className="bt-plugin-tile__errors-hint">
            AI Builder のチャットに「修正依頼をコピー」を貼り付けて送信し、返ってきたコードを AI Builder の 2
            に貼り付けてインストールし直すと直せます。
          </div>
        </div>
      )}
      <iframe
        key={src}
        ref={iframeRef}
        src={src}
        title={title ?? pluginId}
        className="bt-plugin-frame"
        onLoad={() => setLoaded(true)}
        sandbox="allow-scripts allow-forms allow-modals allow-popups"
      />
    </div>
  )
}
