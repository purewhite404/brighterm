import { dialog, ipcMain } from 'electron'
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import type { ConfigStore } from '../configStore'
import type { PluginHost } from '../plugins/pluginHost'
import type { SecretStore } from '../secretStore'
import type { Send } from '../window'
import { AgentToolRunner, AGENT_TOOL_DEFS } from './agentTools'
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

/** "AI キットを書き出す": copies the SDK docs/types/templates to a folder the user can hand to any chat AI. */
async function exportAiKit(): Promise<{ ok: boolean; path?: string }> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return { ok: false }

  const destDir = join(result.filePaths[0], 'brighterm-plugin-kit')
  // __dirname is out/main (main is bundled into one file), in dev and in app.asar alike.
  const sdkDir = join(__dirname, '../../packages/sdk')
  cpSync(sdkDir, destDir, { recursive: true })
  return { ok: true, path: destDir }
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
  const toolRunner = new AgentToolRunner(pluginHost, stagingDir)
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
