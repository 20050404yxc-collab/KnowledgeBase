import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react-swc'
import { resolve } from 'node:path'

export default defineConfig({
  main: { build: { rollupOptions: { input: resolve('apps/desktop/main/index.ts') } } },
  preload: { build: { rollupOptions: { input: resolve('apps/desktop/preload/index.ts') } } },
  renderer: {
    root: resolve('apps/desktop/renderer'),
    plugins: [react()],
    build: { rollupOptions: { input: resolve('apps/desktop/renderer/index.html') } }
  }
})
