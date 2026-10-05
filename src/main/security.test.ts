import { describe, expect, it } from 'vitest'
import { permissionLabel, permissionPolicy, pluginFrameMayNavigate, shellMayNavigate, shellSessionRequestAllowed } from './security'

describe('shellMayNavigate', () => {
  const shell = 'file:///C:/app/out/renderer/index.html'
  it('allows only the same page (reload, hash change)', () => {
    expect(shellMayNavigate(shell, shell)).toBe(true)
    expect(shellMayNavigate(shell, `${shell}#x`)).toBe(true)
    expect(shellMayNavigate('http://localhost:5173/', 'http://localhost:5173/')).toBe(true)
  })
  it('never shows a dropped file or a link', () => {
    expect(shellMayNavigate(shell, 'file:///C:/Users/me/Downloads/evil.html')).toBe(false)
    expect(shellMayNavigate(shell, 'https://example.com/')).toBe(false)
    expect(shellMayNavigate('http://localhost:5173/', 'http://localhost:5174/')).toBe(false)
    expect(shellMayNavigate(shell, 'javascript:alert(1)')).toBe(false)
    expect(shellMayNavigate(shell, 'not a url')).toBe(false)
  })
})

describe('pluginFrameMayNavigate', () => {
  it('lets a new plugin frame load its plugin, then keeps it on that plugin', () => {
    expect(pluginFrameMayNavigate('about:blank', 'plugin-app://notes/')).toBe(true)
    expect(pluginFrameMayNavigate('', 'plugin-app://notes/index.html')).toBe(true)
    expect(pluginFrameMayNavigate('plugin-app://notes/', 'plugin-app://notes/other.html')).toBe(true)
    expect(pluginFrameMayNavigate('plugin-app://notes/', 'plugin-app://photo-viewer/')).toBe(false)
  })
  it('lets frames a plugin makes itself and the PDF viewer load', () => {
    expect(pluginFrameMayNavigate('plugin-app://notes/', 'about:blank')).toBe(true)
    expect(pluginFrameMayNavigate('plugin-app://notes/', 'about:srcdoc')).toBe(true)
    expect(pluginFrameMayNavigate('plugin-app://notes/', 'blob:null/1234')).toBe(true)
    expect(pluginFrameMayNavigate('plugin-app://notes/', 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html')).toBe(true)
  })
  it('never lets a plugin turn into a web site or a local file', () => {
    expect(pluginFrameMayNavigate('plugin-app://notes/', 'https://example.com/')).toBe(false)
    expect(pluginFrameMayNavigate('about:blank', 'https://example.com/')).toBe(false)
    expect(pluginFrameMayNavigate('plugin-app://notes/', 'file:///C:/Windows/win.ini')).toBe(false)
    expect(pluginFrameMayNavigate('plugin-app://notes/', 'data:text/html,hi')).toBe(false)
    expect(pluginFrameMayNavigate('plugin-app://notes/', 'chrome-extension://otherextension/')).toBe(false)
  })
})

describe('shellSessionRequestAllowed', () => {
  it('lets the shell and plugins load resources, but no frame may load a web or file page', () => {
    expect(shellSessionRequestAllowed('image')).toBe(true)
    expect(shellSessionRequestAllowed('xhr')).toBe(true)
    expect(shellSessionRequestAllowed('mainFrame')).toBe(true) // the shell itself (dev server); will-frame-navigate guards it
    expect(shellSessionRequestAllowed('subFrame')).toBe(false)
  })
})

describe('permissionPolicy', () => {
  it('gives the shell and plugin frames only the harmless permissions', () => {
    expect(permissionPolicy('clipboard-sanitized-write', { fromWebView: false })).toBe('allow')
    expect(permissionPolicy('fullscreen', { fromWebView: false })).toBe('allow')
    for (const p of ['media', 'notifications', 'geolocation', 'openExternal', 'clipboard-read', 'hid', 'usb']) {
      expect(permissionPolicy(p, { fromWebView: false }), p).toBe('deny')
    }
  })
  it('asks before a web page gets camera, microphone, location or notifications', () => {
    for (const p of ['media', 'notifications', 'geolocation', 'clipboard-read', 'display-capture']) {
      expect(permissionPolicy(p, { fromWebView: true }), p).toBe('ask')
    }
  })
  it('denies the rest to web pages, and external apps unless it is a mail link', () => {
    for (const p of ['hid', 'usb', 'serial', 'midiSysex', 'fileSystem', 'unknown', 'local-network-access']) {
      expect(permissionPolicy(p, { fromWebView: true }), p).toBe('deny')
    }
    expect(permissionPolicy('openExternal', { fromWebView: true, externalURL: 'mailto:a@b.c' })).toBe('ask')
    expect(permissionPolicy('openExternal', { fromWebView: true, externalURL: 'ms-msdt:/id x' })).toBe('deny')
    expect(permissionPolicy('openExternal', { fromWebView: true })).toBe('deny')
  })
  it('names what is asked for in Japanese', () => {
    expect(permissionLabel('media', ['audio'])).toBe('マイク')
    expect(permissionLabel('media', ['video', 'audio'])).toBe('カメラとマイク')
    expect(permissionLabel('notifications')).toBe('通知の表示')
  })
})
