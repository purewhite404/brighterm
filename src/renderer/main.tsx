import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../packages/sdk/ui/tokens.css'
import './styles/app.css'
import { App } from './App'

const container = document.getElementById('root')
if (!container) throw new Error('#root not found')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
