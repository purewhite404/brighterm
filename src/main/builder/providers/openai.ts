import type OpenAI from 'openai'
import type { AgentProvider, AgentRunOptions } from './types'

/**
 * Drives the tool-calling loop against OpenAI's Chat Completions API. Also
 * serves OpenAI-*compatible* endpoints (Ollama, LM Studio, etc.) by passing
 * a custom `baseUrl` — same request/response shape, so no separate code path
 * is needed.
 *
 * NOTE: written and reviewed against the OpenAI Node SDK's documented tool
 * calling shape, but not exercised against a live API key in this
 * environment (no key was available to verify against).
 */
export class OpenAiAgentProvider implements AgentProvider {
  async run(options: AgentRunOptions): Promise<void> {
    const { systemPrompt, userMessage, tools, callTool, onEvent, apiKey, model, baseUrl, maxRounds = 8 } = options
    // Loaded on first use (~12 MB in the main process); only the API-mode agent needs it.
    const { default: OpenAIClient } = await import('openai')
    const client = new OpenAIClient({ apiKey, baseURL: baseUrl })

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ]

    const toolDefs: OpenAI.Chat.ChatCompletionTool[] = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters }
    }))

    for (let round = 0; round < maxRounds; round++) {
      let response: OpenAI.Chat.ChatCompletion
      try {
        response = await client.chat.completions.create({
          model,
          messages,
          tools: toolDefs,
          tool_choice: 'auto'
        })
      } catch (err) {
        onEvent({ type: 'error', message: err instanceof Error ? err.message : String(err) })
        return
      }

      const choice = response.choices[0]
      const message = choice?.message
      if (!message) {
        onEvent({ type: 'error', message: 'モデルから応答がありませんでした。' })
        return
      }

      if (message.content) {
        onEvent({ type: 'assistant-text', text: message.content })
      }

      const toolCalls = message.tool_calls ?? []
      if (toolCalls.length === 0) {
        onEvent({ type: 'done' })
        return
      }

      messages.push({ role: 'assistant', content: message.content, tool_calls: toolCalls })

      for (const call of toolCalls) {
        let args: unknown
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {}
        } catch {
          args = {}
        }
        onEvent({ type: 'tool-call', name: call.function.name, arguments: args })

        let resultText: string
        try {
          const result = await callTool(call.function.name, args)
          onEvent({ type: 'tool-result', name: call.function.name, result })
          resultText = JSON.stringify(result)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          onEvent({ type: 'tool-result', name: call.function.name, result: { error: message } })
          resultText = JSON.stringify({ error: message })
        }

        messages.push({ role: 'tool', tool_call_id: call.id, content: resultText })
      }
    }

    onEvent({ type: 'error', message: `やり取りの上限（${maxRounds}往復）に達しました。依頼を分割してもう一度お試しください。` })
  }
}
