import { describe, expect, it } from 'vitest'
import { generateBridgeScript, injectIntoHtml, HOST_API_SCRIPT_PATH, TOKENS_CSS_PATH } from './bridgeScript'

describe('generateBridgeScript', () => {
  it('embeds the plugin id as a JSON string literal', () => {
    const script = generateBridgeScript('photo-viewer')
    expect(script).toContain('const PLUGIN_ID = "photo-viewer";')
  })

  it('escapes a plugin id containing special characters safely', () => {
    const script = generateBridgeScript('weird"id')
    expect(script).toContain(JSON.stringify('weird"id'))
  })

  it('defines every documented window.brighterm namespace', () => {
    const script = generateBridgeScript('x')
    for (const ns of ['storage', 'fs', 'net', 'hq', 'theme', 'notify', 'openTile']) {
      expect(script).toContain(ns)
    }
  })
})

describe('injectIntoHtml', () => {
  it('injects right after an existing <head> tag', () => {
    const html = '<html><head><title>t</title></head><body></body></html>'
    const result = injectIntoHtml(html)
    expect(result.indexOf('<head>')).toBeLessThan(result.indexOf(HOST_API_SCRIPT_PATH))
    expect(result).toContain(TOKENS_CSS_PATH)
    // original content must survive untouched
    expect(result).toContain('<title>t</title>')
  })

  it('creates a <head> when the document only has <html>', () => {
    const html = '<html><body>hi</body></html>'
    const result = injectIntoHtml(html)
    expect(result).toContain('<head>')
    expect(result).toContain(HOST_API_SCRIPT_PATH)
  })

  it('prepends the injection when there is no <html> tag at all', () => {
    const html = '<div>fragment</div>'
    const result = injectIntoHtml(html)
    expect(result.startsWith('<link')).toBe(true)
    expect(result).toContain('<div>fragment</div>')
  })

  it('is case-insensitive about the head tag', () => {
    const html = '<HTML><HEAD></HEAD><body></body></HTML>'
    const result = injectIntoHtml(html)
    expect(result).toContain(HOST_API_SCRIPT_PATH)
  })
})
