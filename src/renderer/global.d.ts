import type { BrightermApi } from '../preload/index'

declare global {
  interface Window {
    api: BrightermApi
  }
}

export {}
