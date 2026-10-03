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
    row.dataset.name = file.name
    row.addEventListener('click', () => {
      closeOverlaySidebar()
      openFile(file.name)
    })
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      showMenu(e.clientX, e.clientY, file)
    })
    fileListEl.appendChild(row)
  }
}

// ---- Right-click menu on the file list: copy / cut / paste / copy path / rename / delete.
// The folder is remembered too: a note copied here can be pasted after switching folders.
let fileClipboard = null // { handle, name, cut }
let menuEl = null

function closeMenu() {
  if (menuEl) menuEl.remove()
  menuEl = null
}
document.addEventListener('click', closeMenu)
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu())
window.addEventListener('blur', closeMenu)
fileListEl.addEventListener('scroll', closeMenu)
fileListEl.addEventListener('contextmenu', (e) => {
  if (e.target === fileListEl && fileClipboard) {
    e.preventDefault()
    showMenu(e.clientX, e.clientY, null)
  }
})

function showMenu(x, y, file) {
  closeMenu()
  const items = []
  if (file) {
    items.push(['コピー', () => (fileClipboard = { handle: folderHandle, name: file.name, cut: false })])
    items.push(['切り取り', () => (fileClipboard = { handle: folderHandle, name: file.name, cut: true })])
  }
  if (fileClipboard) items.push(['貼り付け', pasteFile])
  if (file) {
    items.push(['パスのコピー', () => window.brighterm.fs.copyPath(folderHandle, file.name)])
    items.push(['名前の変更', () => renameFile(file)])
    items.push(['削除', () => deleteNote(file)])
  }
  menuEl = document.createElement('div')
  menuEl.className = 'ctx-menu'
  for (const [label, action] of items) {
    const b = document.createElement('button')
    b.textContent = label
    b.addEventListener('click', async (e) => {
      e.stopPropagation()
      closeMenu()
      try {
        await action()
      } catch (err) {
        alert(String(err && err.message ? err.message : err))
      }
    })
    menuEl.appendChild(b)
  }
  document.body.appendChild(menuEl)
  menuEl.style.left = Math.max(0, Math.min(x, window.innerWidth - menuEl.offsetWidth - 4)) + 'px'
  menuEl.style.top = Math.max(0, Math.min(y, window.innerHeight - menuEl.offsetHeight - 4)) + 'px'
}

/**
 * Is `name` taken in this folder (by a file other than `except`)? Case is ignored:
 * on Windows "Note.md" and "note.md" are the same file, so writing one overwrites the other.
 */
function nameTaken(name, except = null) {
  const lower = name.toLowerCase()
  return files.some((f) => f.name !== except && f.name.toLowerCase() === lower)
}

/** "a.md" → "a (2).md" … the first name not taken yet. */
function freeName(name) {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let n = 2
  let candidate = name
  while (nameTaken(candidate)) candidate = `${base} (${n++})${ext}`
  return candidate
}

/**
 * Renames a file in this folder (the Host API has no rename: write the new one, delete the old).
 * A change of case only goes through a temporary name — written straight away, "Note.md"
 * would *be* "note.md" on Windows, and deleting the old name would delete the note.
 */
async function moveFile(from, to, content) {
  const fs = window.brighterm.fs
  if (from.toLowerCase() === to.toLowerCase()) {
    const temp = `${to}.renaming-${Date.now()}`
    await fs.writeFile(folderHandle, temp, content)
    await fs.deleteFile(folderHandle, from)
    await fs.writeFile(folderHandle, to, content)
    await fs.deleteFile(folderHandle, temp)
    return
  }
  await fs.writeFile(folderHandle, to, content)
  await fs.deleteFile(folderHandle, from)
}

async function pasteFile() {
  if (!fileClipboard) return
  const { handle, name, cut } = fileClipboard
  await flushSave()
  const sameFolder = handle.id === folderHandle.id
  if (cut && sameFolder) return // cut then paste into the same folder: nothing moves
  // Read from the folder it was copied in — the current one may have another file of that name.
  const content = await window.brighterm.fs.readFile(handle, name)
  const newName = freeName(name)
  await window.brighterm.fs.writeFile(folderHandle, newName, content)
  if (cut) {
    await window.brighterm.fs.deleteFile(handle, name)
    fileClipboard = null
  }
  await refreshFileList()
}

/** Rename in place: the row turns into a text box (Enter = apply, Esc = cancel). */
function askName(file) {
  return new Promise((resolve) => {
    const row = [...fileListEl.children].find((el) => el.dataset.name === file.name)
    if (!row) return resolve(null)
    const box = document.createElement('input')
    box.className = 'file-rename'
    box.value = displayName(file.name)
    row.replaceWith(box)
    box.focus()
    box.select()
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      resolve(value)
    }
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(box.value)
      if (e.key === 'Escape') finish(null)
    })
    box.addEventListener('blur', () => finish(null))
  })
}

async function renameFile(file) {
  const input = await askName(file)
  renderFileList() // the text box goes back to being a row, whatever happens next
  if (input === null) return
  const title = input.trim().replace(/[\\/:*?"<>|]/g, '_')
  if (!title) return
  const newName = isMarkdown(file.name) ? `${title}.md` : title
  if (newName === file.name) return
  if (nameTaken(newName, file.name)) throw new Error(`同じ名前のファイルがあります: ${newName}`)
  await flushSave()
  const content = await window.brighterm.fs.readFile(folderHandle, file.name)
  await moveFile(file.name, newName, content)
  if (currentFile === file.name) {
    currentFile = newName
    titleInput.value = displayName(newName)
  }
  if (extraFile === file.name) extraFile = newName
  if (fileClipboard && fileClipboard.name === file.name) fileClipboard.name = newName
  await refreshFileList()
}

async function deleteNote(file) {
  if (!confirm(`「${displayName(file.name)}」を削除しますか？`)) return
  if (currentFile === file.name) {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    currentFile = null
    titleInput.value = ''
    contentArea.value = ''
  }
  await window.brighterm.fs.deleteFile(folderHandle, file.name)
  if (extraFile === file.name) extraFile = null
  if (fileClipboard && fileClipboard.name === file.name) fileClipboard = null
  await refreshFileList()
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
  while (nameTaken(name)) name = `${base} (${n++}).md`
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
  if (nameTaken(newName, oldName)) {
    titleInput.value = displayName(oldName)
    alert(`同じ名前のファイルがあります: ${newName}`)
    return
  }
  const content = contentArea.value
  await moveFile(oldName, newName, content)
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
