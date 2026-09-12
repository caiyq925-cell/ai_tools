import { defineConfig } from 'vite'

// Tauri 需要固定端口，且不能清屏，否则 Rust 侧日志会丢失
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
    watch: {
      // src-tauri 由 cargo 自己监听，避免 vite 重复触发
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    target: 'chrome110',
    minify: 'esbuild',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
})
