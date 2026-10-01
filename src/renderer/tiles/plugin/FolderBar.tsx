import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from '../../ui/Icon'
import { folderName, stillMatching, tabCompletion } from './folderBarText'

const SUGGEST_DELAY_MS = 120
const IS_WINDOWS = navigator.userAgent.includes('Windows')
/** Windows and macOS paths ignore case. */
const CASE_INSENSITIVE = IS_WINDOWS || navigator.userAgent.includes('Mac OS')
const PLACEHOLDER = IS_WINDOWS
  ? 'フォルダのパスを入力（例: C:\\Users\\名前\\Documents、~ はホーム）'
  : 'フォルダのパスを入力（例: ~/Documents）'

/**
 * The address bar a plugin tile shows above the plugin when it calls
 * `fs.showFolderBar` (Notes: where the notes are). The user types or pastes a
 * folder path — with completion of subfolders — instead of going through a
 * picker window. Drawn by the shell, so the plugin never sees the path.
 */
export function FolderBar({
  path,
  onSubmit,
  onBrowse
}: {
  /** The plugin's current folder ('' = none yet). */
  path: string
  /** Switch to what was typed; rejects with the message to show. */
  onSubmit: (input: string) => Promise<void>
  /** The native picker, for those who'd rather click. */
  onBrowse: () => Promise<void>
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [value, setValue] = useState(path)
  const [focused, setFocused] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [highlight, setHighlight] = useState(-1)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const suggestRequest = useRef(0)
  const listId = useId()

  // Show the end of a long path (the folder's own name) while not editing.
  const showEnd = (): void => {
    const input = inputRef.current
    if (input) input.scrollLeft = input.scrollWidth
  }

  useEffect(() => {
    if (focused) return
    setValue(path)
    requestAnimationFrame(showEnd)
    // ...and again whenever the tile is resized (the layout changed).
    const input = inputRef.current
    if (!input) return
    const observer = new ResizeObserver(showEnd)
    observer.observe(input)
    return () => observer.disconnect()
  }, [path, focused])

  // Completions for what's typed so far (debounced; late answers to old input are dropped).
  useEffect(() => {
    if (!focused) return
    const request = ++suggestRequest.current
    const timer = setTimeout(() => {
      void window.api.plugins.suggestFolders(value).then((found) => {
        if (request !== suggestRequest.current) return
        setSuggestions(found.filter((s) => s !== value))
        setHighlight(-1)
      })
    }, SUGGEST_DELAY_MS)
    return () => clearTimeout(timer)
  }, [value, focused])

  const listOpen = focused && suggestions.length > 0

  const submit = async (input: string): Promise<void> => {
    setBusy(true)
    try {
      await onSubmit(input)
      setError(null)
      setSuggestions([])
      inputRef.current?.blur()
    } catch (err) {
      setValue(input)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Tab: complete what's typed and keep typing (its subfolders come next).
   * Asks main for the completions of the input as it is right now — the list
   * on screen may still be the one for the previous keystroke, or not there yet.
   */
  const complete = async (): Promise<void> => {
    const typed = inputRef.current?.value ?? value
    const found = (await window.api.plugins.suggestFolders(typed)).filter((s) => s !== typed)
    if (inputRef.current?.value !== typed) return // typed on meanwhile
    const completion = tabCompletion(typed, found, CASE_INSENSITIVE)
    if (completion) fill(completion)
  }

  const fill = (suggestion: string): void => {
    setValue(suggestion)
    setHighlight(-1)
    setError(null)
    inputRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown' && listOpen) {
      e.preventDefault()
      setHighlight((h) => (h + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp' && listOpen) {
      e.preventDefault()
      setHighlight((h) => (h <= 0 ? suggestions.length - 1 : h - 1))
    } else if (e.key === 'Tab' && !e.shiftKey) {
      // Always kept in the bar: leaving it (the browser's Tab) would throw away what was typed. Shift+Tab / Esc leave.
      e.preventDefault()
      if (busy) return
      if (listOpen && highlight >= 0) fill(suggestions[highlight])
      else void complete()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void submit(highlight >= 0 && listOpen ? suggestions[highlight] : value)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (listOpen) {
        setSuggestions([])
      } else {
        setValue(path)
        setError(null)
        inputRef.current?.blur()
      }
    }
  }

  return (
    <div className="bt-plugin-tile__folderbar">
      <div className="bt-plugin-tile__folderbar-row">
        <Icon name="folder" size={14} />
        <input
          ref={inputRef}
          className="bt-plugin-tile__folderbar-input"
          value={value}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          // Not `disabled`: that would blur it, and a failed switch must leave the focus (and the message) here.
          readOnly={busy}
          role="combobox"
          aria-label="フォルダのパス"
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={error ? true : undefined}
          title={path || undefined}
          onChange={(e) => {
            setValue(e.target.value)
            // Until the new completions arrive, keep only those that still fit.
            setSuggestions((list) => stillMatching(list, e.target.value, CASE_INSENSITIVE))
            setError(null)
            // The old completions are stale now: Enter must take what's typed, not one of them.
            setHighlight(-1)
          }}
          onFocus={(e) => {
            setFocused(true)
            e.target.select()
          }}
          onBlur={() => {
            // Like Explorer's address bar: leaving it without Enter keeps the current folder.
            setFocused(false)
            setSuggestions([])
            setError(null)
          }}
          onKeyDown={onKeyDown}
        />
        <button
          className="bt-plugin-tile__folderbar-browse"
          title="フォルダを選ぶウィンドウを開く"
          aria-label="フォルダを選ぶウィンドウを開く"
          onClick={() => void onBrowse().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))}
        >
          <Icon name="folder-open" size={14} />
        </button>
      </div>
      {error && (
        <div className="bt-plugin-tile__folderbar-error" role="alert">
          {error}
        </div>
      )}
      {listOpen && (
        <ul id={listId} className="bt-plugin-tile__folderbar-list" role="listbox" aria-label="フォルダの候補">
          {suggestions.map((s, i) => (
            <li
              key={s}
              role="option"
              aria-selected={i === highlight}
              className={i === highlight ? 'bt-plugin-tile__folderbar-option--active' : undefined}
              title={s}
              // Keep the focus in the input (a click would blur it and close the list first).
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => void submit(s)}
            >
              <span className="bt-plugin-tile__folderbar-option-name">{folderName(s)}</span>
              <span className="bt-plugin-tile__folderbar-option-path">{s}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
