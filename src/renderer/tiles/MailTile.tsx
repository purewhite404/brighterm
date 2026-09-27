import { resolveMail } from '@shared/types'
import { useAppStore } from '../store/appStore'
import { useEmbeddedWebView } from './useEmbeddedWebView'

/**
 * Web mail, for whichever provider is chosen in Settings (Gmail, Outlook,
 * Yahoo!, iCloud, Proton, or a custom URL). Each provider gets its own
 * sub-view ("<tileId>::<provider>"), so switching providers doesn't lose the
 * other one's login, and closing the tile destroys them all.
 */
export function MailTile({ tileId }: { tileId: string }): React.JSX.Element {
  const mail = useAppStore((s) => s.config?.mail) ?? { provider: 'gmail' }
  const snapshot = useAppStore((s) => s.runtime[`${tileId}::${mail.provider}`]?.snapshot)
  const target = resolveMail(mail)
  const ref = useEmbeddedWebView(`${tileId}::${mail.provider}`, { url: target.url, partitionId: target.partitionId })

  return (
    <div ref={ref} className="bt-web-tile">
      {snapshot && <img src={snapshot} alt="" className="bt-web-tile__snapshot" draggable={false} />}
    </div>
  )
}
