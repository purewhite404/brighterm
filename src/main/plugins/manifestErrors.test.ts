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

  it('only accept a web page as the url of a web plugin', () => {
    const web = (url: string) => parseManifest({ id: 'x-web', name: 'X', version: '0.1.0', icon: 'globe', kind: 'web', url })
    expect(web('https://app.slack.com/client').ok).toBe(true)
    expect(web('http://localhost:3000/').ok).toBe(true)
    for (const url of ['file:///C:/Users/me/secret.html', 'javascript:alert(1)', 'chrome://settings', 'data:text/html,hi']) {
      const result = web(url)
      expect(result.ok ? [] : result.errors, url).toContain('「url」: http:// か https:// で始まる URL にしてください')
    }
  })
})
