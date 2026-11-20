import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// engine.wasm lives in public/ and is fetched by URL at runtime; it never
// goes through the bundler. Two pages: the engine playground and the
// Issue-board demo.
export default defineConfig({
  plugins: [vue()],
  base: './',
  server: {
    port: 8090,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        issues: fileURLToPath(new URL('./issues.html', import.meta.url)),
      },
    },
  },
})
