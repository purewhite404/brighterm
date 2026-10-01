// Notes — a small, dependency-free markdown notebook.
// Deliberately has no build step and no external libraries: it's meant to
// double as a worked example of a kind:"app" plugin (see AGENTS.md).

// The notes folder is chosen in the folder bar Brighterm draws above this page
// (fs.showFolderBar / fs.onFolderBarChange) — no picker window needed.

const pickerScreen = document.getElementById('picker-screen')
const notesScreen = document.getElementById('notes-screen')
const newNoteBtn = document.getElementById('new-note')
const searchInput = document.getElementById('search')
const fileListEl = document.getElementById('file-list')
const titleInput = document.getElementById('title')
const contentArea = document.getElementById('content')
const sortSelect = document.getElementById('sort')
const toggleSidebarBtn = document.getElementById('toggle-sidebar')
const sidebarBackdrop = document.getElementById('sidebar-backdrop')

// ---- File list pane: always shown on a roomy tile (unless collapsed by hand);
// on a small tile it's folded away and opens over the editor on demand.
const NARROW = window.matchMedia('(max-width: 559px)')
let sidebarCollapsed = false // wide tiles: user folded it away
let sidebarOpen = false // narrow tiles: temporarily shown over the editor

function applySidebar() {
  const narrow = NARROW.matches
  notesScreen.classList.toggle('narrow', narrow)
  notesScreen.classList.toggle('sidebar-hidden', narrow ? !sidebarOpen : sidebarCollapsed)
  notesScreen.classList.toggle('sidebar-overlay', narrow && sidebarOpen)
  toggleSidebarBtn.setAttribute('aria-expanded', String(narrow ? sidebarOpen : !sidebarCollapsed))
}

toggleSidebarBtn.addEventListener('click', () => {
  if (NARROW.matches) sidebarOpen = !sidebarOpen
  else sidebarCollapsed = !sidebarCollapsed
  applySidebar()
})
sidebarBackdrop.addEventListener('click', () => {
  sidebarOpen = false
  applySidebar()
})
NARROW.addEventListener('change', () => {
  sidebarOpen = false
  applySidebar()
})
applySidebar()

/** After picking a note on a small tile, get the list out of the way. */
function closeOverlaySidebar() {
  if (!sidebarOpen) return
  sidebarOpen = false
  applySidebar()
}

let folderHandle = null
let files = [] // { name, isDirectory, modifiedAt }, in the chosen order
// How the list is ordered: "name-asc" | "name-desc" | "date-desc" | "date-asc" (remembered in storage).
const SORT_ORDERS = ['name-asc', 'name-desc', 'date-desc', 'date-asc']
let sortOrder = 'name-asc'
let currentFile = null // file name of the currently open note
let saveTimer = null
// A non-.md file opened from the Files tile (a .txt, .log, config file...); listed alongside the notes.
let extraFile = null

const isMarkdown = (name) => name.toLowerCase().endsWith('.md')
/** Notes show without ".md"; other files keep their full name so the extension stays visible. */
const displayName = (name) => (isMarkdown(name) ? name.replace(/\.md$/i, '') : name)

async function init() {
  const savedOrder = await window.brighterm.storage.get('sortOrder')
  if (SORT_ORDERS.includes(savedOrder)) sortOrder = savedOrder
  sortSelect.value = sortOrder
  folderHandle = await window.brighterm.storage.get('folderHandle')
  if (folderHandle) {
    try {
      await refreshFileList()
      await window.brighterm.fs.showFolderBar(folderHandle)
      showScreen('notes')
      return
    } catch {
      // The saved handle is stale (folder moved/deleted) — ask for a folder again.
      folderHandle = null
    }
  }
  await window.brighterm.fs.showFolderBar(null)
  showScreen('picker')
}

function showScreen(which) {
  pickerScreen.hidden = which !== 'picker'
  notesScreen.hidden = which !== 'notes'
}

/** Saves what's being typed right now, before the note or the folder changes under it. */
async function flushSave() {
  if (!saveTimer) return
  clearTimeout(saveTimer)
  saveTimer = null
  await saveCurrent()
}

/** Makes `handle` the notes folder (remembered for next time) and lists it. */
async function useFolder(handle) {
  await flushSave()
  folderHandle = handle
  currentFile = null
  titleInput.value = ''
  contentArea.value = ''
  await window.brighterm.storage.set('folderHandle', handle)
  await refreshFileList()
  await window.brighterm.fs.showFolderBar(handle)
  showScreen('notes')
}

// Another folder typed into the folder bar: open its first note, or leave the editor ready — typing creates one.
window.brighterm.fs.onFolderBarChange(async (handle) => {
  await ready
  extraFile = null
  await useFolder(handle)
  if (files.length > 0) await openFile(files[0].name)
  contentArea.focus()
})

async function refreshFileList() {
  const all = await window.brighterm.fs.listFiles(folderHandle)
  files = all.filter((f) => !f.isDirectory && (isMarkdown(f.name) || f.name === extraFile))
  sortFiles()
  renderFileList()
}

/** By the name as shown ("note 2" before "note 10", case ignored), or by when it was last changed. */
const byName = (a, b) => displayName(a.name).localeCompare(displayName(b.name), 'ja', { numeric: true, sensitivity: 'base' })

function sortFiles() {
  const [key, direction] = sortOrder.split('-')
  const sign = direction === 'asc' ? 1 : -1
  files.sort((a, b) => {
    if (key === 'date') return sign * ((a.modifiedAt || 0) - (b.modifiedAt || 0)) || byName(a, b)
    return sign * byName(a, b)
  })
}

sortSelect.addEventListener('change', async () => {
  sortOrder = SORT_ORDERS.includes(sortSelect.value) ? sortSelect.value : 'name-asc'
  sortFiles()
  renderFileList()
  await window.brighterm.storage.set('sortOrder', sortOrder)
})

/** A note was just saved: by date, it moves to where it belongs now (without listing the folder again). */
function touched(name) {
  const file = files.find((f) => f.name === name)
  if (!file) return
  file.modifiedAt = Date.now()
  if (!sortOrder.startsWith('date')) return
  sortFiles()
  renderFileList()
}

function renderFileList() {
  const query = searchInput.value.trim().toLowerCase()
  const visible = query ? files.filter((f) => f.name.toLowerCase().includes(query)) : files

  fileListEl.innerHTML = ''
  for (const file of visible) {
    const row = document.createElement('button')
    row.className = 'file-row' + (file.name === currentFile ? ' file-row--active' : '')
    row.textContent = displayName(file.name)
    row.addEventListener('click', () => {
      closeOverlaySidebar()
      openFile(file.name)
    })
    fileListEl.appendChild(row)
  }
}

async function openFile(name) {
  currentFile = name
  const content = await window.brighterm.fs.readFile(folderHandle, name)
  titleInput.value = displayName(name)
  contentArea.value = content
  renderFileList()
}

newNoteBtn.addEventListener('click', async () => {
  closeOverlaySidebar()
  const name = `Untitled-${Date.now()}.md`
  await window.brighterm.fs.writeFile(folderHandle, name, '')
  await refreshFileList()
  await openFile(name)
  titleInput.focus()
})

searchInput.addEventListener('input', renderFileList)

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveCurrent, 400)
}

/** A file name for a new note, from the title if one was typed. */
function newFileName() {
  const base = titleInput.value.trim().replace(/[\\/:*?"<>|]/g, '_') || `メモ-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`
  let name = `${base}.md`
  let n = 2
  while (files.some((f) => f.name === name)) name = `${base} (${n++}).md`
  return name
}

async function saveCurrent() {
  if (!folderHandle) return
  if (!currentFile) {
    // Typing with no note open (e.g. a brand-new, empty folder) starts a new note.
    if (!contentArea.value && !titleInput.value.trim()) return
    currentFile = newFileName()
    titleInput.value = currentFile.replace(/\.md$/i, '')
    await window.brighterm.fs.writeFile(folderHandle, currentFile, contentArea.value)
    await refreshFileList()
    return
  }
  await window.brighterm.fs.writeFile(folderHandle, currentFile, contentArea.value)
  touched(currentFile)
}

async function renameCurrent() {
  if (!currentFile) {
    await saveCurrent()
    return
  }
  const title = titleInput.value.trim()
  const newName = isMarkdown(currentFile) ? `${title || 'Untitled'}.md` : title || currentFile
  if (newName === currentFile) return
  const oldName = currentFile
  const content = contentArea.value
  await window.brighterm.fs.writeFile(folderHandle, newName, content)
  await window.brighterm.fs.deleteFile(folderHandle, oldName)
  currentFile = newName
  if (extraFile === oldName) extraFile = newName
  await refreshFileList()
}

contentArea.addEventListener('input', scheduleSave)
titleInput.addEventListener('change', renameCurrent)

const ready = init()

// "Open in Notes" from the Files tile: switch to that file's folder and open it.
window.brighterm.onOpenFile(async ({ folder, name }) => {
  await ready
  extraFile = isMarkdown(name) ? null : name
  await useFolder(folder)
  await openFile(name)
  contentArea.focus()
})
