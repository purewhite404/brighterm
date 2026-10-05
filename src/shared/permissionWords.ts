import type { PluginPermission } from './types'

/** What a plugin permission lets it do, in words the user can approve or not. */
export function describePermission(permission: PluginPermission): string {
  switch (permission.type) {
    case 'folders':
      return 'あなたが選んだフォルダの中のファイルを読み書きします（選んだフォルダ以外には触れません）'
    case 'storage':
      return '設定やデータを、このプラグイン専用の保存場所に保存します'
    case 'network':
      return `次のサイトと通信します: ${permission.domains.join(', ')}`
    case 'notifications':
      return 'デスクトップ通知を出します'
    case 'hqCards':
      return '司令部（HQ）タイルにカードを表示します'
  }
}
