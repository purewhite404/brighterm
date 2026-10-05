import path from 'node:path'

type PathModule = Pick<typeof path, 'relative' | 'isAbsolute'>

/**
 * True when `target` is `root` itself or somewhere below it (both already absolute and
 * resolved). Checking only for a leading ".." isn't enough on Windows: `path.relative`
 * returns the target's *absolute* path when it is on another drive (`D:\…`), a UNC share
 * (`\\server\share\…`, which also leaks the user's NTLM hash) or a device path.
 * `pathModule` is only for tests (path.win32 / path.posix).
 */
export function isInside(root: string, target: string, pathModule: PathModule = path): boolean {
  const rel = pathModule.relative(root, target)
  if (rel === '') return true
  if (pathModule.isAbsolute(rel)) return false
  return !rel.split(/[\\/]/).includes('..')
}
