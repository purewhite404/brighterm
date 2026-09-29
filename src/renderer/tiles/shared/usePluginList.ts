import { useEffect, useState } from 'react'
import type { PluginListItem } from '@shared/apiTypes'

/** The installed plugins, kept current (main sends "plugins changed" after every install / enable / delete). */
export function usePluginList(): PluginListItem[] {
  const [plugins, setPlugins] = useState<PluginListItem[]>([])
  useEffect(() => {
    let active = true
    const refresh = (): void =>
      void window.api.plugins.list().then((list) => {
        if (active) setPlugins(list)
      })
    refresh()
    const unsubscribe = window.api.plugins.onChanged(refresh)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  return plugins
}
