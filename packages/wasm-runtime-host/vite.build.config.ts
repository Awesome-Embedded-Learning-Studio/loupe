import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

// Library build, separate from vitest (which uses its own defaults): two
// entries — the root API and the engine worker entry. ESM only, no deps to
// externalize (the package has none), sourcemaps on.
export default defineConfig({
  plugins: [dts({ include: ['src'] })],
  build: {
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        worker: fileURLToPath(new URL('./src/worker/engine-worker.ts', import.meta.url)),
      },
      formats: ['es'],
    },
    outDir: 'dist',
    sourcemap: true,
    minify: false,
  },
})
