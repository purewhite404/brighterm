import { describe, expect, it } from 'vitest'
import { buildAddTilePrompt, buildFixPrompt, buildRuntimeFixPrompt } from './promptBuilder'

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

  it('includes the exact Host API types, so the AI doesn’t guess how to call fs.*', () => {
    const prompt = buildAddTilePrompt('x')
    expect(prompt).toContain('export interface BrightermFs')
    expect(prompt).toContain('fileUrl(handle: BrightermFolderHandle, relativePath: string): Promise<string>')
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

  it('lists warnings separately when there are any', () => {
    expect(buildFixPrompt(['x'], ['通信先が未宣言'])).toContain('- 通信先が未宣言')
    expect(buildFixPrompt(['x'])).not.toContain('注意点')
  })
})

describe('buildRuntimeFixPrompt', () => {
  it('names the plugin, lists the errors, keeps the id and carries the Host API types', () => {
    const prompt = buildRuntimeFixPrompt({ id: 'photo-viewer', name: 'Photo Viewer' }, ['fs.readFile: フォルダの指定が正しくありません'])
    expect(prompt).toContain('「Photo Viewer」（id: photo-viewer）')
    expect(prompt).toContain('- fs.readFile: フォルダの指定が正しくありません')
    expect(prompt).toContain('id は "photo-viewer" のまま')
    expect(prompt).toContain('export interface BrightermFs')
  })
})
