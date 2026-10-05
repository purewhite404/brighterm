import { describe, expect, it } from 'vitest'
import { describePermission } from './permissionWords'

describe('describePermission', () => {
  it('explains each permission in plain words', () => {
    expect(describePermission({ type: 'folders' })).toContain('あなたが選んだフォルダ')
    expect(describePermission({ type: 'network', domains: ['api.example.com', 'b.example.com'] })).toBe(
      '次のサイトと通信します: api.example.com, b.example.com'
    )
    for (const type of ['storage', 'notifications', 'hqCards'] as const) {
      expect(describePermission({ type })).not.toBe('')
    }
  })
})
