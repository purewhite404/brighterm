import { useEffect, useState } from 'react'
import type { DirEntry } from '../../main/fsService'
import { useAppStore, selectActiveWorkspace } from '../store/appStore'
import { Icon } from '../ui/Icon'

interface TreeNodeProps {
  entry: DirEntry
  depth: number
  onOpenTerminalHere: (path: string) => void
}

function TreeNode({ entry, depth, onOpenTerminalHere }: TreeNodeProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<DirEntry[] | null>(null)
  const [loading, setLoading] = useState(false)

  const toggle = async (): Promise<void> => {
    if (!entry.isDirectory) {
      await window.api.shells.openPath(entry.path)
      return
    }
    if (!expanded && children === null) {
      setLoading(true)
      try {
        const list = await window.api.fs.listDir(entry.path)
        setChildren(list)
      } catch {
        setChildren([])
      } finally {
        setLoading(false)
      }
    }
    setExpanded((e) => !e)
  }

  return (
    <div>
      <div
        className="bt-file-row"
        style={{ paddingLeft: depth * 14 + 8 }}
        onClick={toggle}
        onContextMenu={(e) => {
          e.preventDefault()
          if (entry.isDirectory) onOpenTerminalHere(entry.path)
        }}
        title={entry.isDirectory ? 'Click to expand · right-click to open in Terminal' : entry.path}
      >
        <Icon
          name={entry.isDirectory ? (expanded ? 'folder-open' : 'folder') : 'file'}
          size={14}
        />
        <span className="bt-file-row__name">{entry.name}</span>
        {loading && <span className="bt-file-row__loading">…</span>}
      </div>
      {expanded && children?.map((child) => (
        <TreeNode key={child.path} entry={child} depth={depth + 1} onOpenTerminalHere={onOpenTerminalHere} />
      ))}
    </div>
  )
}

export function FileExplorerTile({ tileId }: { tileId: string }): React.JSX.Element {
  const tile = useAppStore((s) => selectActiveWorkspace(s)?.tiles[tileId])
  const addTile = useAppStore((s) => s.addTile)
  const [root, setRoot] = useState<DirEntry | null>(null)

  useEffect(() => {
    let cancelled = false
    async function init(): Promise<void> {
      const config = (tile?.config ?? {}) as { rootPath?: string }
      const rootPath = config.rootPath ?? (await window.api.fs.homeDir())
      if (cancelled) return
      setRoot({ name: rootPath, path: rootPath, isDirectory: true, sizeBytes: 0, modifiedAt: 0 })
    }
    void init()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openTerminalHere = (path: string): void => {
    addTile(
      { kind: 'builtin', typeId: 'terminal', title: 'Terminal', icon: 'terminal', config: { cwd: path } },
      { splitTargetTileId: tileId, direction: 'row' }
    )
  }

  if (!root) return <div className="bt-tile-body bt-tile-body--centered">読み込み中…</div>

  return (
    <div className="bt-tile-body bt-file-explorer">
      <TreeNode entry={root} depth={0} onOpenTerminalHere={openTerminalHere} />
    </div>
  )
}
