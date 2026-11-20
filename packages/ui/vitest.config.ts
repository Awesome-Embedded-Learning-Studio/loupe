import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// Tests run against workspace sources, not the built dist.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@aels/wasm-runtime-host/worker': fileURLToPath(
        new URL('../wasm-runtime-host/src/worker/engine-worker.ts', import.meta.url),
      ),
      '@aels/wasm-runtime-host': fileURLToPath(
        new URL('../wasm-runtime-host/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'happy-dom',
  },
})
