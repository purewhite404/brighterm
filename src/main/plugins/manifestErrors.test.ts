import { describe, expect, it } from 'vitest'
import { parseManifest } from '@sdk/manifest.schema'

describe('manifest errors', () => {
  it('say in Japanese which field is wrong and how', () => {
    const result = parseManifest({ id: 'Photo Viewer', kind: 'desktop', permissions: [{ type: 'camera' }] })
    expect(result.ok).toBe(false)
    const errors = result.ok ? [] : result.errors
    expect(errors).toContain('「id」: 英小文字・数字・ハイフンだけにしてください（例: "photo-viewer"）')
    expect(errors).toContain('「name」がありません')
    expect(errors).toContain('「kind」は "web" か "app" にしてください')
    expect(errors.some((e) => e.startsWith('「permissions.0.type」は "network" / "storage"'))).toBe(true)
  })

  it('require the entry of an app plugin', () => {
    const result = parseManifest({ id: 'x-app', name: 'X', version: '1.0.0', icon: 'note', kind: 'app' })
    expect(result.ok ? [] : result.errors).toEqual(['「entry」: kind が "app" のときは必須です（通常 "index.html"）'])
  })
})
