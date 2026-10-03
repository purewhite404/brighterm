import agentsDoc from '@sdk/AGENTS.md?raw'
import hostApiTypes from '@sdk/host-api.d.ts?raw'

/**
 * Builds the messages the user pastes into a web chat (ChatGPT, etc.) in
 * "Web bridge" AI Builder mode. Pure string assembly — no network, no IPC —
 * so it's trivially unit-testable and safe to call on every keystroke.
 */

/**
 * A code fence longer than any backtick run inside `text`: AGENTS.md has ```js examples
 * of its own, and with a ``` fence around it the first of them would end the spec.
 */
export function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  return '`'.repeat(Math.max(3, longest + 1))
}

/** The spec plus the exact Host API types — without them the AI guesses call signatures. */
function specBlocks(): string[] {
  const specFence = fenceFor(agentsDoc)
  const typesFence = fenceFor(hostApiTypes)
  return [
    `${specFence}markdown`,
    agentsDoc.trim(),
    specFence,
    '',
    'Host API（window.brighterm）の型定義 host-api.d.ts。関数はここにあるものだけが使えます:',
    '',
    `${typesFence}ts`,
    hostApiTypes.trim(),
    typesFence
  ]
}

export function buildAddTilePrompt(userRequest: string): string {
  return [
    '以下は Brighterm というアプリに新しいタイル（プラグイン）を追加するための仕様書です。',
    'この仕様に厳密に従い、指定された "btbundle" 形式で1つのコードブロックとして回答してください。',
    '',
    ...specBlocks(),
    '',
    '---',
    '',
    `作ってほしいもの: ${userRequest.trim()}`
  ].join('\n')
}

/** A follow-up for the same chat thread: the pasted code didn't pass the check before installing. */
export function buildFixPrompt(errors: string[], warnings: string[] = []): string {
  const lines = [
    '先ほどのプラグインを Brighterm でチェックしたところ、次の問題が見つかりました。',
    '該当箇所を修正し、manifest.json を含む全ファイルを、同じ "btbundle" 形式で',
    '（`=== file: ... ===` 区切り、1つのコードブロック）もう一度すべて出力してください。',
    '差分ではなく全文でお願いします。',
    '',
    ...errors.map((e) => `- ${e}`)
  ]
  if (warnings.length > 0) lines.push('', '注意点（こちらも直してください）:', ...warnings.map((w) => `- ${w}`))
  return lines.join('\n')
}

/** A follow-up for when an installed plugin fails while running (errors caught in its tile). */
export function buildRuntimeFixPrompt(plugin: { id: string; name: string }, errors: string[]): string {
  return [
    `Brighterm のプラグイン「${plugin.name}」（id: ${plugin.id}）を実行したところ、次のエラーが出ました。`,
    '',
    ...errors.map((e) => `- ${e}`),
    '',
    '原因を直した全ファイルを、manifest.json も含めて同じ "btbundle" 形式（`=== file: ... ===` 区切り、',
    `1つのコードブロック）で、差分ではなく全文で出力してください。id は "${plugin.id}" のままにしてください`,
    '（同じ id なら上書きでインストールされます）。window.brighterm の関数は、次の型定義のとおりに呼んでください:',
    '',
    '```ts',
    hostApiTypes.trim(),
    '```'
  ].join('\n')
}
