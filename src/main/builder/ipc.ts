import { dialog, ipcMain } from 'electron'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import hostApiTypes from '@sdk/host-api.d.ts?raw'
import { IPC } from '@shared/ipc'
import type { ConfigStore } from '../configStore'
import type { PluginHost } from '../plugins/pluginHost'
import type { SecretStore } from '../secretStore'
import type { Send } from '../window'
import { AgentToolRunner, AGENT_TOOL_DEFS, type ConfirmInstall } from './agentTools'
import { describePermission } from '@shared/permissionWords'
import { getMainWindow } from '../window'
import { OpenAiAgentProvider } from './providers/openai'
import { buildAgentSystemPrompt } from './systemPrompt'

/** The AI Builder: its API-mode agent (with the provider's key) and "AI キットを書き出す". */
export function registerBuilderIpc(deps: {
  configStore: ConfigStore
  secretStore: SecretStore
  pluginHost: PluginHost
  send: Send
}): void {
  const { secretStore } = deps
  ipcMain.handle(IPC.builderHasApiKey, (_event, provider: string) => secretStore.has(provider))
  ipcMain.handle(IPC.builderSetApiKey, (_event, provider: string, apiKey: string) => secretStore.set(provider, apiKey))
  ipcMain.handle(IPC.builderAgentRun, async (_event, request: string) => runAgent(deps, request))
  ipcMain.handle(IPC.builderExportKit, async () => exportAiKit())
}

/**
 * "AI キットを書き出す": copies the SDK docs/types/templates into a folder, for
 * building plugins with an AI tool that works on files (Claude Code, Cursor…).
 */
async function exportAiKit(): Promise<{ ok: boolean; path?: string; error?: string }> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return { ok: false }

  const destDir = join(result.filePaths[0], 'brighterm-plugin-kit')
  try {
    // __dirname is out/main (main is bundled into one file), in dev and in app.asar alike.
    copyDir(join(__dirname, '../../packages/sdk'), destDir)
    // electron-builder leaves *.d.ts files out of the package, so write the Host API types from the bundle.
    writeFileSync(join(destDir, 'host-api.d.ts'), hostApiTypes)
    return { ok: true, path: destDir }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** fs.cpSync can't read a folder inside app.asar (ENOENT); readdir/stat/readFile can. */
function copyDir(from: string, to: string): void {
  mkdirSync(to, { recursive: true })
  for (const name of readdirSync(from)) {
    const source = join(from, name)
    if (statSync(source).isDirectory()) copyDir(source, join(to, name))
    else writeFileSync(join(to, name), readFileSync(source))
  }
}

/** The agent's install waits for the user: what it is and what it may do. */
const confirmAgentInstall: ConfirmInstall = async (manifest) => {
  const permissions = manifest.permissions.length
    ? manifest.permissions.map((p) => `・${describePermission(p)}`).join('\n')
    : '・特別な権限は使いません'
  const options = {
    type: 'question' as const,
    buttons: ['インストールする', 'やめる'],
    defaultId: 1,
    cancelId: 1,
    title: 'AI Builder',
    message: `AI が作ったプラグイン「${manifest.name}」（${manifest.id} ${manifest.version}）をインストールしますか？`,
    detail: `このプラグインができること:\n${permissions}`
  }
  const win = getMainWindow()
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
  return response === 0
}

async function runAgent(
  { configStore, secretStore, pluginHost, send }: Parameters<typeof registerBuilderIpc>[0],
  request: string
): Promise<{ ok: boolean; error?: string }> {
  const config = configStore.get()
  const { apiProvider, apiModel, apiBaseUrl } = config.aiBuilder

  if (apiProvider !== 'openai' && apiProvider !== 'openai-compatible') {
    const message = `${apiProvider} プロバイダはまだ実装されていません（OpenAI / OpenAI 互換のみ対応）。`
    send(IPC.builderAgentEvent, { type: 'error', message })
    return { ok: false, error: message }
  }

  const apiKey = secretStore.get(apiProvider) ?? (apiProvider === 'openai-compatible' ? 'not-needed' : '')
  if (!apiKey) {
    const message = 'API キーが設定されていません。設定から入力してください。'
    send(IPC.builderAgentEvent, { type: 'error', message })
    return { ok: false, error: message }
  }

  const stagingDir = mkdtempSync(join(tmpdir(), 'brighterm-agent-'))
  const toolRunner = new AgentToolRunner(pluginHost, stagingDir, confirmAgentInstall)
  const provider = new OpenAiAgentProvider()

  try {
    await provider.run({
      systemPrompt: buildAgentSystemPrompt(),
      userMessage: request,
      tools: AGENT_TOOL_DEFS,
      callTool: (name, args) => toolRunner.call(name, args),
      onEvent: (event) => {
        send(IPC.builderAgentEvent, event)
        if (event.type === 'tool-result' && event.name === 'install_staged_bundle') {
          const result = event.result as { ok?: boolean } | undefined
          if (result?.ok) send(IPC.pluginsChanged)
        }
      },
      apiKey,
      model: apiModel,
      baseUrl: apiProvider === 'openai-compatible' ? apiBaseUrl : undefined
    })
    return { ok: true }
  } finally {
    toolRunner.dispose()
  }
}
