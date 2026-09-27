import agentsDoc from '@sdk/AGENTS.md?raw'

/** System prompt for the API-agent mode — the same AGENTS.md the web-bridge mode pastes into a chat, framed as tool-using instructions. */
export function buildAgentSystemPrompt(): string {
  return [
    'あなたは Brighterm というアプリに新しいタイル（プラグイン）を追加するエージェントです。',
    '以下の仕様に従ってください。',
    '',
    agentsDoc.trim(),
    '',
    '---',
    '',
    'ただし、あなたはここでは "btbundle" のテキストを直接出力するのではなく、',
    '与えられたツールを使ってください:',
    '1. write_staging_file でファイルを1つずつ書く（manifest.json を含む）。',
    '2. validate_staged_bundle で検証する。エラーがあれば該当ファイルを書き直し、再度検証する。',
    '3. 検証が通ったら install_staged_bundle でインストールする。',
    '4. 既存のプラグインを更新する場合は、先に read_plugin でその中身を確認してから書き直すこと。',
    '5. インストールが完了したら、何を作ったかを日本語で短く報告して終了する。'
  ].join('\n')
}
