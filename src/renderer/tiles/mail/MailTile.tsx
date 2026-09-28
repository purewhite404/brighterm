import { resolveMail } from '@shared/types'
import { useAppStore } from '../../store/appStore'
import { EmbeddedWebView } from '../shared/EmbeddedWebView'
import { subViewId } from '../shared/subViews'

/**
 * Web mail, for whichever provider is chosen in Settings (Gmail, Outlook,
 * Yahoo!, iCloud, Proton, or a custom URL). Each provider gets its own
 * sub-view ("<tileId>::<provider>"), so switching providers doesn't lose the
 * other one's login, and closing the tile destroys them all.
 */
export function MailTile({ tileId }: { tileId: string }): React.JSX.Element {
  const mail = useAppStore((s) => s.config?.mail) ?? { provider: 'gmail' }
  const target = resolveMail(mail)
  return (
    <EmbeddedWebView
      viewId={subViewId(tileId, mail.provider)}
      source={{ url: target.url, partitionId: target.partitionId }}
    />
  )
}
