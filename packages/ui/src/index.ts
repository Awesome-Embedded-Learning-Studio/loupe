/**
 * @aels/loupe-ui
 *
 * Vue components for loupe pages: the terminal console and machine
 * controls. Components receive a machine handle from @aels/wasm-runtime-host
 * and never touch the wasm ABI themselves.
 */
export { default as TermConsole } from './TermConsole.vue'
export { default as LabShell } from './LabShell.vue'
export type { LabAsset, LabEngineClient, LabManifest, LabPreset } from './LabShell.vue'
export { keyToBytes } from './keys'
