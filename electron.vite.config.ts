import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@sdk': resolve('packages/sdk')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@sdk': resolve('packages/sdk')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts')
        },
        // Force CJS *and* a .cjs extension: the root package.json has
        // "type": "module", so a plain .js file here would be loaded as ESM
        // by Node's require() — which is how Electron's preload loader
        // actually loads it — and crash with ERR_REQUIRE_ESM.
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared'),
        '@sdk': resolve('packages/sdk')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html')
        }
      }
    },
    plugins: [react()]
  }
})
