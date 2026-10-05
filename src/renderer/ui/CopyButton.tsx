import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

/** A button that copies text and briefly confirms it ("コピーしました"). */
export function CopyButton({
  getText,
  label = 'コピー',
  disabled,
  style
}: {
  getText: () => string
  label?: string
  disabled?: boolean
  style?: React.CSSProperties
}): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const copy = async (): Promise<void> => {
    try {
      await window.api.clipboard.writeText(getText())
      setState('copied')
    } catch {
      setState('failed')
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 2000)
  }

  return (
    <button
      onClick={copy}
      disabled={disabled}
      style={style}
      className={state === 'copied' ? 'bt-copy-button bt-copy-button--copied' : 'bt-copy-button'}
      aria-live="polite"
    >
      <Icon name={state === 'copied' ? 'check' : 'copy'} size={14} />{' '}
      {state === 'copied' ? 'コピーしました' : state === 'failed' ? 'コピーできませんでした' : label}
    </button>
  )
}
