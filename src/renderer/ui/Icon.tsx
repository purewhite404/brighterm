/**
 * A tiny, dependency-free icon set. Every icon is a stroke-based SVG using
 * `currentColor`, so it always matches the surrounding text color and the
 * active theme — no icon font, no per-icon color to keep in sync.
 */

const PATHS: Record<string, string> = {
  terminal: 'M4 5h16v14H4z M7 9l3 3-3 3 M12 15h5',
  browser: 'M4 5h16v14H4z M4 9h16 M8 5v0',
  mail: 'M4 6h16v12H4z M4 6l8 7 8-7',
  calendar: 'M4 5h16v15H4z M4 10h16 M8 3v4 M16 3v4',
  folder: 'M4 6h6l2 2h8v11H4z',
  'folder-open': 'M4 6h6l2 2h8l-2 9H6L4 6z',
  file: 'M6 3h8l4 4v14H6z M14 3v4h4',
  activity: 'M3 12h4l2 7 4-14 2 7h6',
  sparkles: 'M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z M19 15l0.8 2.2L22 18l-2.2 0.8L19 21l-0.8-2.2L16 18l2.2-0.8z',
  settings:
    'M12 8a4 4 0 100 8 4 4 0 000-8z M19 12a7 7 0 00-.14-1.4l2-1.55-2-3.46-2.36.95a7 7 0 00-2.42-1.4L13.7 3h-3.4l-.38 2.14a7 7 0 00-2.42 1.4l-2.36-.95-2 3.46 2 1.55A7 7 0 004 12c0 .48.05.94.14 1.4l-2 1.55 2 3.46 2.36-.95c.7.6 1.53 1.08 2.42 1.4L10.3 21h3.4l.38-2.14a7 7 0 002.42-1.4l2.36.95 2-3.46-2-1.55c.09-.46.14-.92.14-1.4z',
  command: 'M8 3a3 3 0 100 6 3 3 0 000-6z M8 15a3 3 0 100 6 3 3 0 000-6z M15 3a3 3 0 100 6 3 3 0 000-6z M15 15a3 3 0 100 6 3 3 0 000-6z M11 6h2 M11 18h2 M6 11v2 M18 11v2',
  home: 'M4 11l8-7 8 7v9H4z M9 20v-6h6v6',
  close: 'M5 5l14 14 M19 5L5 19',
  plus: 'M12 5v14 M5 12h14',
  refresh: 'M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3 M18 4v4h-4 M6 20v-4h4',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  send: 'M4 11l16-7-6 16-3-7-7-2z',
  copy: 'M9 9h10v10H9z M5 5h10v4H9v6H5z',
  check: 'M5 13l4 4 10-10',
  alert: 'M12 3l9 16H3z M12 10v4 M12 17v0',
  trash: 'M5 7h14 M9 7V5h6v2 M7 7l1 13h8l1-13',
  power: 'M12 3v8 M6.5 6.5a7 7 0 1011 0',
  slack: 'M9 3a2 2 0 100 4h2V5a2 2 0 00-2-2z M15 21a2 2 0 100-4h-2v2a2 2 0 002 2z M5 9a2 2 0 100 4v-2a2 2 0 00-2-2z M19 15a2 2 0 100-4v2a2 2 0 002 2z',
  note: 'M6 3h9l3 3v15H6z M15 3v4h4 M9 12h6 M9 16h6'
}

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.6,
  className
}: {
  name: string
  size?: number
  strokeWidth?: number
  className?: string
}): React.JSX.Element {
  const d = PATHS[name] ?? PATHS.file
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}
