import { describe, expect, it } from 'vitest'
import { findValidator, runValidator } from './validators'

describe('findValidator', () => {
  it('matches sudoers and its drop-in directory', () => {
    expect(findValidator('/etc/sudoers')?.label).toBe('visudo -c')
    expect(findValidator('/etc/sudoers.d/custom')?.label).toBe('visudo -c')
  })

  it('matches sshd_config', () => {
    expect(findValidator('/etc/ssh/sshd_config')?.label).toBe('sshd -t')
  })

  it('matches files under /etc/nginx/', () => {
    expect(findValidator('/etc/nginx/nginx.conf')?.label).toBe('nginx -t')
    expect(findValidator('/etc/nginx/sites-available/default')?.label).toBe('nginx -t')
  })

  it('matches fstab', () => {
    expect(findValidator('/etc/fstab')?.label).toBe('findmnt --verify')
  })

  it('matches systemd unit files', () => {
    expect(findValidator('/etc/systemd/system/myapp.service')?.label).toBe('systemd-analyze verify')
  })

  it('returns null for a file with no known validator', () => {
    expect(findValidator('/etc/hosts')).toBeNull()
    expect(findValidator('/etc/resolv.conf')).toBeNull()
  })
})

describe('runValidator', () => {
  it('runs the matched validator command against the candidate path', () => {
    let receivedCmd = ''
    let receivedArgs: string[] = []
    const result = runValidator('/etc/sudoers', '/tmp/candidate', (cmd, args) => {
      receivedCmd = cmd
      receivedArgs = args
      return { ok: true, output: 'parsed OK' }
    })
    expect(receivedCmd).toBe('visudo')
    expect(receivedArgs).toEqual(['-c', '-f', '/tmp/candidate'])
    expect(result).toEqual({ ok: true, output: 'parsed OK' })
  })

  it('returns null when there is no validator for the file', () => {
    const result = runValidator('/etc/hosts', '/tmp/candidate', () => ({ ok: true, output: '' }))
    expect(result).toBeNull()
  })
})
