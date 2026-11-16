import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// engine.wasm lives in public/ and is fetched by URL at runtime; it never
// goes through the bundler.
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
  },
})
