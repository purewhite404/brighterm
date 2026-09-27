import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { PluginHost } from '../plugins/pluginHost'
import { readDirAsBundleFiles } from '../plugins/dirBundle'
import type { AgentToolDef } from './providers/types'

/**
 * The tool surface the API-agent mode (mode 2) gets. Every write lands in a
 * per-run staging directory — never directly in a plugin's installed
 * directory — so a half-finished or buggy generation can't corrupt an
 * existing plugin. `install_staged_bundle` is the one tool that actually
 * calls PluginHost.install(); everything up to it is inspectable and
 * reversible.
 */

function isSafeRelativePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.startsWith('\\') || /^[a-zA-Z]:/.test(path)) return false
  return !path.split(/[/\\]/).some((s) => s === '..' || s.trim() === '')
}

export const AGENT_TOOL_DEFS: AgentToolDef[] = [
  {
    name: 'list_plugins',
    description: '現在インストールされているプラグインの一覧（id・名前・バージョン・有効/無効）を返す。',
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'read_plugin',
    description: '既存プラグインの全ファイルを読む（既存プラグインを更新するときに使う）。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'プラグインの id' } },
      required: ['id'],
      additionalProperties: false
    }
  },
  {
    name: 'write_staging_file',
    description: '作業領域に1ファイルを書き込む（manifest.json を含む全ファイルをここに書く）。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相対パス。例: "manifest.json", "index.html"' },
        content: { type: 'string', description: 'ファイルの中身（全文）' }
      },
      required: ['path', 'content'],
      additionalProperties: false
    }
  },
  {
    name: 'validate_staged_bundle',
    description: '作業領域に今あるファイル一式を検証する。エラーがあれば具体的なメッセージが返るので、該当ファイルを書き直すこと。',
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'install_staged_bundle',
    description:
      '検証に問題がなければ、作業領域のファイル一式を実際にインストールする。これがユーザーへの最終的な提供物になる。',
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  }
]

export class AgentToolRunner {
  constructor(
    private readonly pluginHost: PluginHost,
    private readonly stagingDir: string
  ) {
    mkdirSync(stagingDir, { recursive: true })
  }

  async call(name: string, args: unknown): Promise<unknown> {
    const a = (args ?? {}) as Record<string, unknown>
    switch (name) {
      case 'list_plugins':
        return this.pluginHost.list().map((p) => ({
          id: p.manifest.id,
          name: p.manifest.name,
          version: p.manifest.version,
          enabled: p.enabled
        }))

      case 'read_plugin': {
        const id = String(a.id ?? '')
        const item = this.pluginHost.getListItem(id)
        if (!item) throw new Error(`plugin "${id}" is not installed`)
        return readDirAsBundleFiles(item.dir)
      }

      case 'write_staging_file': {
        const path = String(a.path ?? '')
        const content = String(a.content ?? '')
        if (!isSafeRelativePath(path)) throw new Error(`不正なパスです: "${path}"`)
        const target = resolve(this.stagingDir, path)
        if (relative(this.stagingDir, target).startsWith('..')) throw new Error(`不正なパスです: "${path}"`)
        mkdirSync(join(target, '..'), { recursive: true })
        writeFileSync(target, content, 'utf-8')
        return { ok: true }
      }

      case 'validate_staged_bundle': {
        const files = readDirAsBundleFiles(this.stagingDir)
        return this.pluginHost.validate(files)
      }

      case 'install_staged_bundle': {
        const files = readDirAsBundleFiles(this.stagingDir)
        return this.pluginHost.install(files)
      }

      default:
        throw new Error(`unknown tool: ${name}`)
    }
  }

  dispose(): void {
    rmSync(this.stagingDir, { recursive: true, force: true })
  }
}
