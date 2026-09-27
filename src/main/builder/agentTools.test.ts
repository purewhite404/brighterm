import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginHost } from '../plugins/pluginHost'
import { AgentToolRunner } from './agentTools'

describe('AgentToolRunner', () => {
  let pluginsDir: string
  let stagingDir: string
  let pluginHost: PluginHost
  let runner: AgentToolRunner

  beforeEach(() => {
    pluginsDir = mkdtempSync(join(tmpdir(), 'brighterm-agent-plugins-'))
    stagingDir = join(mkdtempSync(join(tmpdir(), 'brighterm-agent-staging-')), 'run')
    pluginHost = new PluginHost(pluginsDir)
    runner = new AgentToolRunner(pluginHost, stagingDir)
  })

  afterEach(() => {
    rmSync(pluginsDir, { recursive: true, force: true })
    runner.dispose()
  })

  it('creates the staging directory up front', () => {
    expect(existsSync(stagingDir)).toBe(true)
  })

  it('list_plugins returns an empty array when nothing is installed', async () => {
    expect(await runner.call('list_plugins', {})).toEqual([])
  })

  it('write_staging_file writes into the staging directory, including nested paths', async () => {
    await runner.call('write_staging_file', { path: 'manifest.json', content: '{}' })
    await runner.call('write_staging_file', { path: 'sub/dir/file.js', content: 'x' })
    expect(readFileSync(join(stagingDir, 'manifest.json'), 'utf-8')).toBe('{}')
    expect(readFileSync(join(stagingDir, 'sub/dir/file.js'), 'utf-8')).toBe('x')
  })

  it('write_staging_file rejects a path that escapes the staging directory', async () => {
    await expect(runner.call('write_staging_file', { path: '../../evil.js', content: 'x' })).rejects.toThrow(
      /不正なパス/
    )
  })

  it('write_staging_file rejects an absolute path', async () => {
    await expect(runner.call('write_staging_file', { path: '/etc/passwd', content: 'x' })).rejects.toThrow(
      /不正なパス/
    )
  })

  it('validate_staged_bundle reports errors for an incomplete bundle', async () => {
    await runner.call('write_staging_file', { path: 'manifest.json', content: '{"id":"bad id"}' })
    const result = (await runner.call('validate_staged_bundle', {})) as { ok: boolean }
    expect(result.ok).toBe(false)
  })

  it('validate_staged_bundle passes for a well-formed bundle', async () => {
    await runner.call('write_staging_file', {
      path: 'manifest.json',
      content: JSON.stringify({
        id: 'my-plugin',
        name: 'My Plugin',
        version: '1.0.0',
        icon: 'note',
        kind: 'web',
        url: 'https://example.com',
        permissions: []
      })
    })
    const result = (await runner.call('validate_staged_bundle', {})) as { ok: boolean }
    expect(result.ok).toBe(true)
  })

  it('install_staged_bundle actually installs the plugin via PluginHost', async () => {
    await runner.call('write_staging_file', {
      path: 'manifest.json',
      content: JSON.stringify({
        id: 'my-plugin',
        name: 'My Plugin',
        version: '1.0.0',
        icon: 'note',
        kind: 'web',
        url: 'https://example.com',
        permissions: []
      })
    })
    const result = (await runner.call('install_staged_bundle', {})) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(pluginHost.list().map((p) => p.manifest.id)).toEqual(['my-plugin'])
  })

  it('read_plugin returns the installed plugin files for an existing plugin', async () => {
    pluginHost.install([
      {
        path: 'manifest.json',
        content: JSON.stringify({
          id: 'existing',
          name: 'Existing',
          version: '1.0.0',
          icon: 'note',
          kind: 'web',
          url: 'https://example.com',
          permissions: []
        })
      }
    ])
    const files = (await runner.call('read_plugin', { id: 'existing' })) as Array<{ path: string }>
    expect(files.map((f) => f.path)).toEqual(['manifest.json'])
  })

  it('read_plugin throws for a plugin that is not installed', async () => {
    await expect(runner.call('read_plugin', { id: 'nope' })).rejects.toThrow(/not installed/)
  })

  it('throws for an unknown tool name', async () => {
    await expect(runner.call('not_a_real_tool', {})).rejects.toThrow(/unknown tool/)
  })

  it('dispose() removes the staging directory', () => {
    runner.dispose()
    expect(existsSync(stagingDir)).toBe(false)
  })
})
