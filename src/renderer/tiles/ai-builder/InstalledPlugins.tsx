import { useState } from 'react'
import type { PluginListItem } from '@shared/apiTypes'
import { useAppStore } from '../../store/appStore'
import { Icon } from '../../ui/Icon'
import { pluginTileIds } from '../catalog'

/** Every installed plugin, with disable / enable and delete (bundled ones come back at startup, so no delete). */
export function InstalledPlugins({ plugins }: { plugins: PluginListItem[] }): React.JSX.Element {
  const closeTiles = useAppStore((s) => s.closeTiles)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const closeOpenTiles = (pluginId: string): void =>
    closeTiles(pluginTileIds(useAppStore.getState().config?.workspaces ?? [], pluginId))

  const toggle = async (item: PluginListItem): Promise<void> => {
    if (item.enabled) closeOpenTiles(item.manifest.id)
    await window.api.plugins.setEnabled(item.manifest.id, !item.enabled)
  }

  const remove = async (pluginId: string): Promise<void> => {
    closeOpenTiles(pluginId)
    await window.api.plugins.uninstall(pluginId)
    setConfirmingId(null)
  }

  const sorted = [...plugins].sort((a, b) => Number(a.bundled ?? false) - Number(b.bundled ?? false) || b.installedAt - a.installedAt)

  return (
    <section className="bt-ai-builder__step" aria-label="インストール済みのプラグイン">
      <div className="bt-ai-builder__step-title">インストール済みのプラグイン</div>
      <div className="bt-ai-builder__hint">
        無効にするとドックから消えます（あとで有効に戻せます）。削除するとプラグインのファイルも消えます。どちらも、開いているそのタイルは閉じます。
      </div>
      {sorted.length === 0 && <div className="bt-ai-builder__hint">まだありません。</div>}
      {sorted.map((item) => {
        const { id, name, version, icon, description } = item.manifest
        return (
          <div key={id} className={`bt-ai-builder__plugin-row${item.enabled ? '' : ' bt-ai-builder__plugin-row--disabled'}`}>
            <Icon name={icon} size={16} />
            <div className="bt-ai-builder__plugin-info">
              <div className="bt-ai-builder__plugin-name">
                {name}{' '}
                <span className="bt-text-muted">
                  v{version}
                  {item.bundled ? '・同梱' : ''}
                  {item.enabled ? '' : '・無効'}
                </span>
              </div>
              {description && <div className="bt-ai-builder__hint">{description}</div>}
            </div>
            <div className="bt-ai-builder__plugin-actions">
              {confirmingId === id ? (
                <>
                  <span className="bt-ai-builder__hint">削除しますか？</span>
                  <button className="bt-ai-builder__danger" onClick={() => void remove(id)}>
                    削除する
                  </button>
                  <button onClick={() => setConfirmingId(null)}>やめる</button>
                </>
              ) : (
                <>
                  <button onClick={() => void toggle(item)}>{item.enabled ? '無効にする' : '有効にする'}</button>
                  {item.bundled ? null : (
                    <button onClick={() => setConfirmingId(id)} aria-label={`「${name}」を削除`}>
                      <Icon name="trash" size={13} /> 削除
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )
      })}
    </section>
  )
}
