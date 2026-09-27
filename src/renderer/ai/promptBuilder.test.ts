import { describe, expect, it } from 'vitest'
import { buildAddTilePrompt, buildFixPrompt } from './promptBuilder'

describe('buildAddTilePrompt', () => {
  it('embeds the user request', () => {
    const prompt = buildAddTilePrompt('写真フォルダを見るビューア')
    expect(prompt).toContain('作ってほしいもの: 写真フォルダを見るビューア')
  })

  it('embeds the AGENTS.md content wrapped in a markdown code fence', () => {
    const prompt = buildAddTilePrompt('x')
    expect(prompt).toContain('```markdown')
    expect(prompt).toContain('btbundle')
  })

  it('trims surrounding whitespace from the user request', () => {
    const prompt = buildAddTilePrompt('  note app  ')
    expect(prompt).toContain('作ってほしいもの: note app')
  })
})

describe('buildFixPrompt', () => {
  it('lists every error as a bullet point', () => {
    const prompt = buildFixPrompt(['manifest.json is invalid', 'eval() is not allowed'])
    expect(prompt).toContain('- manifest.json is invalid')
    expect(prompt).toContain('- eval() is not allowed')
  })

  it('asks for the full bundle again, not a diff', () => {
    const prompt = buildFixPrompt(['x'])
    expect(prompt).toMatch(/全文/)
  })

  it('includes an optional note when provided', () => {
    const prompt = buildFixPrompt(['x'], '追加の注意事項です')
    expect(prompt).toContain('追加の注意事項です')
  })
})
