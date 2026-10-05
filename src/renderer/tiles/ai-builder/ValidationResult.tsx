import type { PluginInstallIssue, PluginInstallResult, PluginListItem } from '@shared/apiTypes'
import { CopyButton } from '../../ui/CopyButton'
import { Icon } from '../../ui/Icon'
import { describePermission } from '@shared/permissionWords'
import { buildFixPrompt } from './promptBuilder'

const issueText = (issue: PluginInstallIssue): string => (issue.file ? `${issue.file}: ${issue.message}` : issue.message)

/**
 * Step 3's result. Either what has to be fixed (with a fix request for the
 * chat), or what the plugin will be allowed to do — for the user to approve
 * by installing it.
 */
export function ValidationResult({
  result,
  installed
}: {
  result: PluginInstallResult
  /** The installed plugin with the same id, which installing replaces. */
  installed: PluginListItem | null
}): React.JSX.Element {
  const errors = result.errors.map(issueText)
  const warnings = result.warnings.map(issueText)

  if (!result.ok || !result.manifest) {
    return (
      <div className="bt-ai-builder__result bt-ai-builder__result--error" aria-label="チェック結果">
        <div className="bt-ai-builder__result-title">
          <Icon name="alert" size={14} /> このままではインストールできません（問題 {errors.length} 件）
        </div>
        <ul className="bt-ai-builder__list">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
        <div className="bt-ai-builder__hint">
          「修正依頼をコピー」を押して左のチャットに貼り付け、送信してください。返ってきたコードで 2
          の欄を貼り替えると、もう一度チェックします。
        </div>
        <div>
          <CopyButton getText={() => buildFixPrompt(errors, warnings)} label="修正依頼をコピー" />
        </div>
      </div>
    )
  }

  const { manifest } = result
  return (
    <div className="bt-ai-builder__result" aria-label="チェック結果">
      <div className="bt-ai-builder__result-title bt-ai-builder__result-title--ok">
        <Icon name="check" size={14} /> 問題は見つかりませんでした。インストールできます。
      </div>
      <div className="bt-ai-builder__plugin-name">
        {manifest.name} <span className="bt-text-muted">v{manifest.version}</span>
      </div>
      {manifest.description && <div className="bt-ai-builder__hint">{manifest.description}</div>}
      {installed && (
        <div className="bt-ai-builder__hint">
          インストール済みの「{installed.manifest.name}」（v{installed.manifest.version}）を、このコードで置き換えます。開いているタイルも読み込み直します。
        </div>
      )}

      <div className="bt-ai-builder__subtitle">このプラグインが使う機能</div>
      {manifest.permissions.length === 0 ? (
        <div className="bt-ai-builder__hint">特別な機能は使いません。</div>
      ) : (
        <ul className="bt-ai-builder__list">
          {manifest.permissions.map((p, i) => (
            <li key={i}>{describePermission(p)}</li>
          ))}
        </ul>
      )}

      {warnings.length > 0 && (
        <>
          <div className="bt-ai-builder__subtitle bt-ai-builder__subtitle--warning">念のため確認してください</div>
          <ul className="bt-ai-builder__list">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          <div className="bt-ai-builder__hint">
            インストールはできますが、このままでは一部が動かないかもしれません。直すときは「修正依頼をコピー」をチャットに送ってください。
          </div>
          <div>
            <CopyButton getText={() => buildFixPrompt(warnings)} label="修正依頼をコピー" />
          </div>
        </>
      )}
    </div>
  )
}
