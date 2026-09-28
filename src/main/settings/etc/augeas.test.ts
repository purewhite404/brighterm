import { describe, expect, it } from 'vitest'
import { isAugeasAvailable, parsePrintOutput, readTree, setValueAndSave, removeNodeAndSave } from './augeas'

describe('parsePrintOutput', () => {
  it('parses quoted values scoped to the requested root', () => {
    const output = [
      '/files/etc/hosts/1/ipaddr = "127.0.0.1"',
      '/files/etc/hosts/1/canonical = "localhost"',
      '/files/etc/hosts/2/ipaddr = "::1"',
      '' // trailing blank line from augtool's own output
    ].join('\n')

    const nodes = parsePrintOutput(output, '/files/etc/hosts')
    expect(nodes).toEqual([
      { path: '/files/etc/hosts/1/ipaddr', value: '127.0.0.1' },
      { path: '/files/etc/hosts/1/canonical', value: 'localhost' },
      { path: '/files/etc/hosts/2/ipaddr', value: '::1' }
    ])
  })

  it('ignores lines outside the requested scope', () => {
    const output = '/files/etc/fstab/1/spec = "/dev/sda1"\n/files/etc/hosts/1/ipaddr = "127.0.0.1"'
    const nodes = parsePrintOutput(output, '/files/etc/hosts')
    expect(nodes).toEqual([{ path: '/files/etc/hosts/1/ipaddr', value: '127.0.0.1' }])
  })

  it('handles a node path with no value (a container node)', () => {
    const output = '/files/etc/hosts/1\n/files/etc/hosts/1/ipaddr = "127.0.0.1"'
    const nodes = parsePrintOutput(output, '/files/etc/hosts')
    expect(nodes[0]).toEqual({ path: '/files/etc/hosts/1', value: null })
  })

  it('returns an empty array for empty output', () => {
    expect(parsePrintOutput('', '/files/etc/hosts')).toEqual([])
  })
})

describe('isAugeasAvailable', () => {
  it('is true when the exec function reports success', () => {
    expect(isAugeasAvailable(() => ({ ok: true, stdout: '', stderr: '' }))).toBe(true)
  })

  it('is false when augtool is missing or errors', () => {
    expect(isAugeasAvailable(() => ({ ok: false, stdout: '', stderr: 'command not found' }))).toBe(false)
  })
})

describe('readTree', () => {
  it('sends a print command scoped to /files<path> and parses the result', () => {
    let sentCommand = ''
    const nodes = readTree('/etc/hosts', (stdin) => {
      sentCommand = stdin
      return { ok: true, stdout: '/files/etc/hosts/1/ipaddr = "127.0.0.1"\n', stderr: '' }
    })
    expect(sentCommand).toBe('print /files/etc/hosts\n')
    expect(nodes).toEqual([{ path: '/files/etc/hosts/1/ipaddr', value: '127.0.0.1' }])
  })

  it('returns an empty array when the command fails', () => {
    const nodes = readTree('/etc/hosts', () => ({ ok: false, stdout: '', stderr: 'denied' }))
    expect(nodes).toEqual([])
  })
})

describe('setValueAndSave', () => {
  it('sends a set followed by a save, escaping embedded quotes', () => {
    let sentCommand = ''
    const result = setValueAndSave('/files/etc/hosts/1/ipaddr', 'weird "quoted" value', (stdin) => {
      sentCommand = stdin
      return { ok: true, stdout: 'Saved', stderr: '' }
    })
    expect(sentCommand).toBe('set /files/etc/hosts/1/ipaddr "weird \\"quoted\\" value"\nsave\n')
    expect(result.ok).toBe(true)
  })
})

describe('removeNodeAndSave', () => {
  it('sends an rm followed by a save', () => {
    let sentCommand = ''
    removeNodeAndSave('/files/etc/hosts/2', (stdin) => {
      sentCommand = stdin
      return { ok: true, stdout: '', stderr: '' }
    })
    expect(sentCommand).toBe('rm /files/etc/hosts/2\nsave\n')
  })
})
