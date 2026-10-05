import { describe, expect, it } from 'vitest'
import { pluginCsp, withCsp } from './pluginCsp'

const directive = (csp: string, name: string): string =>
  csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `)) ?? ''

describe('pluginCsp', () => {
  it('without network permission: only the plugin itself, no internet at all', () => {
    const csp = pluginCsp({ permissions: [{ type: 'storage' }] })
    expect(directive(csp, 'default-src')).toBe("default-src 'self'")
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self'")
    expect(directive(csp, 'img-src')).toBe("img-src 'self' data: blob:")
    expect(directive(csp, 'script-src')).toBe("script-src 'self' 'unsafe-inline'")
    expect(csp).not.toContain('unsafe-eval')
    expect(directive(csp, 'form-action')).toBe("form-action 'none'")
    expect(directive(csp, 'object-src')).toBe("object-src 'none'")
    expect(csp).not.toMatch(/https?:\/\/\*|\s\*(\s|;|$)/)
  })

  it('declared domains may be fetched and shown over https (a weather / translation plugin)', () => {
    const csp = pluginCsp({ permissions: [{ type: 'network', domains: ['api.open-meteo.com', 'API.Example.com'] }] })
    expect(directive(csp, 'connect-src')).toBe(
      "connect-src 'self' https://api.open-meteo.com https://api.example.com wss://api.open-meteo.com wss://api.example.com"
    )
    expect(directive(csp, 'img-src')).toContain('https://api.open-meteo.com')
    // Still no scripts from there.
    expect(directive(csp, 'script-src')).toBe("script-src 'self' 'unsafe-inline'")
  })

  it('never lets a malformed domain break out of the header', () => {
    const csp = pluginCsp({ permissions: [{ type: 'network', domains: ["x.com; script-src *", 'ok.com'] }] })
    expect(csp).not.toContain('script-src *')
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self' https://ok.com wss://ok.com")
  })
})

describe('withCsp', () => {
  it('adds the header and keeps status, type and body', async () => {
    const original = new Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } })
    const res = withCsp(original, "default-src 'self'")
    expect(res.headers.get('content-security-policy')).toBe("default-src 'self'")
    expect(res.headers.get('content-type')).toBe('text/plain')
    expect(await res.text()).toBe('hello')
  })
})
