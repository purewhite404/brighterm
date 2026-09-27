const valueEl = document.getElementById('value')
const incButton = document.getElementById('inc')

async function load() {
  const saved = await window.brighterm.storage.get('count')
  valueEl.textContent = String(saved ?? 0)
}

incButton.addEventListener('click', async () => {
  const current = Number(valueEl.textContent)
  const next = current + 1
  valueEl.textContent = String(next)
  await window.brighterm.storage.set('count', next)
})

load()
