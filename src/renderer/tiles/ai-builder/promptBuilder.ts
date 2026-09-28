import agentsDoc from '@sdk/AGENTS.md?raw'

/**
 * Builds the message the user pastes/inserts into a web chat (ChatGPT, etc.)
 * in "Web bridge" AI Builder mode. Pure string assembly — no network, no
 * IPC — so it's trivially unit-testable and safe to call on every keystroke
 * if the UI wants a live preview.
 */
export function buildAddTilePrompt(userRequest: string): string {
  return [
    '以下は Brighterm というアプリに新しいタイル（プラグイン）を追加するための仕様書です。',
    'この仕様に厳密に従い、指定された "btbundle" 形式で1つのコードブロックとして回答してください。',
    '',
    '```markdown',
    agentsDoc.trim(),
    '```',
    '',
    '---',
    '',
    `作ってほしいもの: ${userRequest.trim()}`
  ].join('\n')
}

/** Builds a follow-up "please fix these errors" prompt for the same chat thread. */
export function buildFixPrompt(errors: string[], previousBundleNote?: string): string {
  const lines = [
    '先ほどのプラグインを検証したところ、次のエラーが見つかりました。',
    '該当箇所を修正し、manifest.json を含む全ファイルを、同じ "btbundle" 形式で',
    '（`=== file: ... ===` 区切り、1つのコードブロック）もう一度すべて出力してください。',
    '差分ではなく全文でお願いします。',
    '',
    ...errors.map((e) => `- ${e}`)
  ]
  if (previousBundleNote) lines.push('', previousBundleNote)
  return lines.join('\n')
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text)
}
