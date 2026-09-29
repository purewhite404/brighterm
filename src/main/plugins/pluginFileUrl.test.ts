import { describe, expect, it } from 'vitest'
import { buildPluginFileUrl, parsePluginFilePath } from './pluginFileUrl'

describe('plugin file URLs', () => {
  it('round-trip a file in a granted folder, including subfolders and non-ASCII names', () => {
    const url = buildPluginFileUrl('photo-viewer', 'folder-1', '2024 旅行\\富士山 #1.jpg')
    expect(url).toMatch(/^plugin-app:\/\/photo-viewer\/__brighterm_file__\/folder-1\//)
    expect(parsePluginFilePath(new URL(url).pathname)).toEqual({ handleId: 'folder-1', relativePath: '2024 旅行/富士山 #1.jpg' })
  })

  it('ignore the plugin’s own files', () => {
    expect(parsePluginFilePath('/index.html')).toBeNull()
    expect(parsePluginFilePath('/__brighterm_file__/folder-1')).toBeNull()
  })

  it('reject malformed escapes instead of throwing', () => {
    expect(parsePluginFilePath('/__brighterm_file__/folder-1/%E0%A4%A')).toBeNull()
  })
})
