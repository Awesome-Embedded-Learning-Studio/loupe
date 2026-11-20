import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'
import { libInjectCss } from 'vite-plugin-lib-inject-css'

// Component library build. vue and @aels/wasm-runtime-host stay external
// (peer and dependency); preserveModules keeps one chunk per module so
// consumers can tree-shake per component, and lib-inject-css wires each
// chunk's styles so no separate style.css import is needed.
export default defineConfig({
  plugins: [vue(), dts({ include: ['src'], entryRoot: 'src' }), libInjectCss()],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
    },
    outDir: 'dist',
    sourcemap: true,
    minify: false,
    rollupOptions: {
      external: ['vue', '@aels/wasm-runtime-host'],
      output: {
        // preserveModules keeps one chunk per module so consumers can
        // tree-shake per component. plugin-vue's internal script modules
        // collide with the SFC facade names and get a "2" suffix — those
        // files are internal only (consumer bundlers inline them), so the
        // suffix is harmless.
        preserveModules: true,
        entryFileNames: '[name].js',
      },
    },
  },
})
