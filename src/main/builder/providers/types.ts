/**
 * Provider-agnostic shape for the AI Builder's "API agent" mode (mode 2).
 * Only an OpenAI (and OpenAI-compatible / local LLM) implementation exists
 * today — see providers/openai.ts — but every provider plugs in through
 * this same interface, so adding Anthropic/Gemini later doesn't touch the
 * tool-calling loop or the IPC wiring in main/index.ts.
 */

export interface AgentToolDef {
  name: string
  description: string
  /** JSON Schema for the tool's arguments object. */
  parameters: Record<string, unknown>
}

export type AgentEvent =
  | { type: 'assistant-text'; text: string }
  | { type: 'tool-call'; name: string; arguments: unknown }
  | { type: 'tool-result'; name: string; result: unknown }
  | { type: 'error'; message: string }
  | { type: 'done' }

export interface AgentRunOptions {
  systemPrompt: string
  userMessage: string
  tools: AgentToolDef[]
  /** Executes one tool call and returns its JSON-serializable result. Throws to signal a tool error. */
  callTool: (name: string, args: unknown) => Promise<unknown>
  onEvent: (event: AgentEvent) => void
  apiKey: string
  model: string
  baseUrl?: string
  /** Safety valve against a runaway loop; each round is one model call + its tool calls. */
  maxRounds?: number
}

export interface AgentProvider {
  run(options: AgentRunOptions): Promise<void>
}
