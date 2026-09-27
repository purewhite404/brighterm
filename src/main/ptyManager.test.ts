import { describe, expect, it } from 'vitest'
import { shellEnv } from './ptyManager'

const powershell = { id: 'powershell', label: 'Windows PowerShell', path: 'powershell.exe', args: [] }
const bash = { id: 'bash', label: 'bash', path: '/bin/bash', args: [] }

describe('shellEnv', () => {
  it('drops an inherited PSModulePath (any casing) for Windows PowerShell 5.1', () => {
    const env = shellEnv(powershell, { PSModulePath: 'C:\pwsh7\Modules', Path: 'C:\bin' })
    expect(env.PSModulePath).toBeUndefined()
    expect(env.Path).toBe('C:\bin')
    expect(shellEnv(powershell, { PSMODULEPATH: 'x' }).PSMODULEPATH).toBeUndefined()
  })

  it('leaves other shells environment alone apart from TERM', () => {
    const env = shellEnv(bash, { PSModulePath: 'kept', HOME: '/home/me' })
    expect(env.PSModulePath).toBe('kept')
    expect(env.HOME).toBe('/home/me')
    expect(env.TERM).toBe('xterm-256color')
  })
})
