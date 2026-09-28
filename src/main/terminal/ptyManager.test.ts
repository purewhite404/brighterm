import { describe, expect, it } from 'vitest'
import { findPwsh7, shellEnv } from './ptyManager'

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

describe('findPwsh7', () => {
  const env = {
    ProgramFiles: 'C:\\Program Files',
    Path: 'C:\\Windows\\System32;C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps',
    LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local'
  }

  it('prefers the MSI install in Program Files', () => {
    const found = findPwsh7(env, (p) => p.endsWith('pwsh.exe'))
    expect(found).toBe('C:\\Program Files\\PowerShell\\7\\pwsh.exe')
  })

  it('finds the Store / winget alias on PATH when there is no MSI install', () => {
    const alias = 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe'
    expect(findPwsh7(env, (p) => p === alias)).toBe(alias)
    expect(findPwsh7({ ...env, Path: '' }, (p) => p === alias)).toBe(alias)
  })

  it('returns null when PowerShell 7 is not installed', () => {
    expect(findPwsh7(env, () => false)).toBeNull()
  })
})
