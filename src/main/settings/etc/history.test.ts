import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EtcHistory, sanitizeForDirName } from './history'

describe('sanitizeForDirName', () => {
  it('replaces path separators and colons', () => {
    expect(sanitizeForDirName('/etc/hosts')).toBe('etc_hosts')
    expect(sanitizeForDirName('C:\\Windows\\System32')).toBe('C__Windows_System32')
  })
})

describe('EtcHistory', () => {
  let dir: string
  let history: EtcHistory

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brighterm-etc-history-test-'))
    history = new EtcHistory(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns an empty list for a file with no history yet', () => {
    expect(history.list('/etc/hosts')).toEqual([])
  })

  it('backs up content and lists it newest-first', async () => {
    history.backup('/etc/hosts', 'version 1')
    await new Promise((r) => setTimeout(r, 2))
    history.backup('/etc/hosts', 'version 2')

    const entries = history.list('/etc/hosts')
    expect(entries).toHaveLength(2)
    expect(entries[0].timestamp).toBeGreaterThanOrEqual(entries[1].timestamp)
  })

  it('round-trips backup content through read()', () => {
    const fileName = history.backup('/etc/fstab', 'the original content')
    const entries = history.list('/etc/fstab')
    expect(entries[0].fileName).toBe(fileName)
    expect(history.read('/etc/fstab', fileName)).toBe('the original content')
  })

  it('keeps histories for different target files separate', () => {
    history.backup('/etc/hosts', 'hosts content')
    history.backup('/etc/fstab', 'fstab content')
    expect(history.list('/etc/hosts')).toHaveLength(1)
    expect(history.list('/etc/fstab')).toHaveLength(1)
  })
})
