// 文件：electron.vite.config.ts
// 层：构建配置
// 作用：声明桌面、预加载与界面的构建入口。
// 说明：不承载业务逻辑，不改变用户数据位置。
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
