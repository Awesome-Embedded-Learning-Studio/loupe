import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// engine.wasm lives in public/ and is fetched by URL at runtime; it never
// goes through the bundler. Two pages: the engine playground and the
// Issue-board demo. Dev serves workspace sources for HMR; builds resolve
// the packages' published entries (dist), which is also the smoke check
// that the built form actually works.
export default defineConfig(({ command }) => ({
  plugins: [vue()],
  base: './',
  resolve:
    command === 'serve'
      ? {
          alias: {
            '@aels/wasm-runtime-host/worker': fileURLToPath(
              new URL('../packages/wasm-runtime-host/src/worker/engine-worker.ts', import.meta.url),
            ),
            '@aels/wasm-runtime-host': fileURLToPath(
              new URL('../packages/wasm-runtime-host/src/index.ts', import.meta.url),
            ),
            '@aels/loupe-ui': fileURLToPath(
              new URL('../packages/ui/src/index.ts', import.meta.url),
            ),
          },
        }
      : undefined,
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
}))
