/**
 * `window.brighterm.fs.*` takes a whole `BrightermFolderHandle` object
 * ({id, label} — see packages/sdk/host-api.d.ts), not a bare id, so plugin
 * code can hold onto and display `handle.label`. The IPC dispatcher unwraps
 * it here before passing an id through to PluginHostApiBridge, which only
 * cares about the id.
 */
export function handleId(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg && typeof arg === 'object' && 'id' in arg) return String((arg as { id: unknown }).id)
  throw new Error('invalid folder handle')
}
