// Notes — a small, dependency-free markdown notebook.
// Deliberately has no build step and no external libraries: it's meant to
// double as a worked example of a kind:"app" plugin (see AGENTS.md).

const pickerScreen = document.getElementById('picker-screen')
const notesScreen = document.getElementById('notes-screen')
const pickFolderBtn = document.getElementById('pick-folder')
const newNoteBtn = document.getElementById('new-note')
const searchInput = document.getElementById('search')
const fileListEl = document.getElementById('file-list')
const titleInput = document.getElementById('title')
const contentArea = document.getElementById('content')

let folderHandle = null
let files = [] // { name, isDirectory }
let currentFile = null // file name of the currently open note
let saveTimer = null

async function init() {
  folderHandle = await window.brighterm.storage.get('folderHandle')
  if (folderHandle) {
    try {
      await refreshFileList()
      showScreen('notes')
      return
    } catch {
      // The saved handle is stale (folder moved/deleted) — fall back to the picker.
      folderHandle = null
    }
  }
  showScreen('picker')
}

function showScreen(which) {
  pickerScreen.hidden = which !== 'picker'
  notesScreen.hidden = which !== 'notes'
}

pickFolderBtn.addEventListener('click', async () => {
  const handle = await window.brighterm.fs.pickFolder()
  if (!handle) return
  folderHandle = handle
  await window.brighterm.storage.set('folderHandle', handle)
  await refreshFileList()
  showScreen('notes')
})

async function refreshFileList() {
  const all = await window.brighterm.fs.listFiles(folderHandle)
  files = all.filter((f) => !f.isDirectory && f.name.toLowerCase().endsWith('.md')).sort((a, b) => a.name.localeCompare(b.name))
  renderFileList()
}

function renderFileList() {
  const query = searchInput.value.trim().toLowerCase()
  const visible = query ? files.filter((f) => f.name.toLowerCase().includes(query)) : files

  fileListEl.innerHTML = ''
  for (const file of visible) {
    const row = document.createElement('button')
    row.className = 'file-row' + (file.name === currentFile ? ' file-row--active' : '')
    row.textContent = file.name.replace(/\.md$/i, '')
    row.addEventListener('click', () => openFile(file.name))
    fileListEl.appendChild(row)
  }
}

async function openFile(name) {
  currentFile = name
  const content = await window.brighterm.fs.readFile(folderHandle, name)
  titleInput.value = name.replace(/\.md$/i, '')
  contentArea.value = content
  renderFileList()
}

newNoteBtn.addEventListener('click', async () => {
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

async function saveCurrent() {
  if (!currentFile) return
  await window.brighterm.fs.writeFile(folderHandle, currentFile, contentArea.value)
}

async function renameCurrent() {
  if (!currentFile) return
  const newName = `${titleInput.value.trim() || 'Untitled'}.md`
  if (newName === currentFile) return
  const oldName = currentFile
  const content = contentArea.value
  await window.brighterm.fs.writeFile(folderHandle, newName, content)
  await window.brighterm.fs.deleteFile(folderHandle, oldName)
  currentFile = newName
  await refreshFileList()
}

contentArea.addEventListener('input', scheduleSave)
titleInput.addEventListener('change', renameCurrent)

init()
