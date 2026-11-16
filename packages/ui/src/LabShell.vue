<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { EngineClient, type EngineClientHandlers } from '@aels/wasm-runtime-host'
import TermConsole from './TermConsole.vue'

/**
 * Generic lab shell for doc sites: fetches a build-time asset manifest,
 * offers named kernel/disk presets, and drives an engine worker through
 * boot / pause / resume with a serial terminal attached. Sites stay thin:
 * they provide the manifest URL and a worker factory (the worker script
 * must resolve inside the site's own build context), everything else —
 * base-aware URL resolution, preset switching, machine lifetime — lives
 * here.
 */

/** One published lab file as described by the manifest. */
export interface LabAsset {
  url: string
  bytes: number
  md5: string
}

/** One boot combination as published by the manifest. */
export interface LabPreset {
  id: string
  label: string
  note?: string
  kernel: LabAsset
  disk: LabAsset
}

/** Asset manifest generated at build time and served as a static file. */
export interface LabManifest {
  engine: LabAsset
  presets: LabPreset[]
}

/** The client surface LabShell drives; overridable for tests. */
export interface LabEngineClient {
  load: (url: string) => Promise<{ engine: { major: number; minor: number; patch: number } }>
  bootUrls: (kernelUrl: string, diskUrl: string) => Promise<unknown>
  inject: (text: string) => Promise<unknown>
  pause: () => Promise<unknown>
  run: () => Promise<unknown>
  terminate: () => void
}

const props = withDefaults(
  defineProps<{
    /** Manifest URL relative to the site base. */
    manifest: string
    /** Creates the engine worker inside the site's build context. */
    createWorker: () => Worker
    /** Initial preset id; falls back to the first manifest entry. */
    preset?: string
    /** Terminal height in pixels. */
    height?: number
    /** Client factory; tests inject a fake here. */
    createClient?: (worker: Worker, handlers: EngineClientHandlers) => LabEngineClient
  }>(),
  { preset: '', height: 420, createClient: undefined },
)

const status = ref('就绪。选择一套镜像,点「启动」下载并引导(首次较慢)。')
const phase = ref<'idle' | 'loading' | 'booting' | 'running' | 'paused'>('idle')
const presets = ref<LabPreset[]>([])
const selectedId = ref('')
const engineUrl = shallowRef('')

const selected = computed<LabPreset | null>(
  () => presets.value.find(entry => entry.id === selectedId.value) ?? null,
)

const client = shallowRef<LabEngineClient | null>(null)
const term = shallowRef<InstanceType<typeof TermConsole> | null>(null)
let icount = 0

/**
 * Resolves a manifest-relative path against the site base. Page-relative
 * resolution breaks on nested pages (they hit the SPA fallback instead of
 * the asset), so the base prefix from the bundler is the stable anchor.
 */
const absolute = (src: string): string =>
  new URL(`${import.meta.env.BASE_URL}${src}`, window.location.origin).href

const handlers: EngineClientHandlers = {
  onFeed: feed => {
    icount = feed.icount
    term.value?.push(feed.text)
    if (feed.stopped !== null) {
      phase.value = 'paused'
      status.value = `guest 停止:${feed.stopped.kind},code=0x${feed.stopped.code.toString(16)},rip=0x${feed.stopped.rip.toString(16)}`
    } else if (phase.value === 'booting') {
      status.value = `引导中 · ${(feed.icount / 1e6).toFixed(1)}M 条指令`
    }
  },
  onProgress: progress => {
    const which = progress.which === 'engine' ? '引擎' : progress.which === 'kernel' ? '内核' : '磁盘'
    const percent = progress.total > 0
      ? `${Math.floor((progress.loaded / progress.total) * 100)}%`
      : `${(progress.loaded / 1048576).toFixed(1)} MiB`
    status.value = `下载${which}… ${percent}`
  },
  onPaused: () => {
    phase.value = 'paused'
    status.value = `已暂停 · ${(icount / 1e6).toFixed(1)}M 条指令`
  },
}

onMounted(async () => {
  try {
    const url = absolute(props.manifest)
    const manifest: LabManifest = await (await fetch(url)).json()
    engineUrl.value = manifest.engine.url
    presets.value = manifest.presets
    selectedId.value =
      manifest.presets.find(entry => entry.id === props.preset)?.id
      ?? manifest.presets[0]?.id
      ?? ''
    if (manifest.presets.length === 0) status.value = '清单里没有可用的镜像组合。'
  } catch (error) {
    status.value = `镜像清单加载失败:${error instanceof Error ? error.message : String(error)}`
  }
})

const boot = async (): Promise<void> => {
  if (selected.value === null) return
  if (phase.value === 'loading' || phase.value === 'booting') return
  const preset = selected.value
  phase.value = 'loading'
  status.value = '准备中…'
  try {
    // A preset switch needs a fresh machine: drop any previous worker.
    client.value?.terminate()
    const next = props.createClient?.(props.createWorker(), handlers)
      ?? new EngineClient(props.createWorker(), handlers)
    client.value = next
    const loaded = await next.load(absolute(engineUrl.value))
    await next.bootUrls(absolute(preset.kernel.url), absolute(preset.disk.url))
    phase.value = 'running'
    status.value = `运行中 · 引擎 ${loaded.engine.major}.${loaded.engine.minor}.${loaded.engine.patch}`
    term.value?.focus()
    await next.run()
  } catch (error) {
    phase.value = 'idle'
    status.value = `失败:${error instanceof Error ? error.message : String(error)}`
  }
}

const pause = async (): Promise<void> => {
  await client.value?.pause()
}

const resume = async (): Promise<void> => {
  if (phase.value !== 'paused' || client.value === null) return
  phase.value = 'running'
  await client.value.run()
}

/** Switching presets while running restarts the guest with the new pair. */
const onPresetChange = (): void => {
  if (phase.value === 'running' || phase.value === 'paused') void boot()
}

const onBytes = (bytes: number[]): void => {
  if (phase.value === 'running') void client.value?.inject(String.fromCharCode(...bytes))
}

const onText = (text: string): void => {
  if (phase.value === 'running') void client.value?.inject(text)
}

onBeforeUnmount(() => {
  client.value?.terminate()
  client.value = null
})

defineExpose({ boot, phase, presets, selectedId, status })
</script>

<template>
  <div class="lab-shell" :style="{ '--lab-term-height': `${height}px` }">
    <div class="bar">
      <select v-model="selectedId" :disabled="phase === 'loading' || phase === 'booting'" @change="onPresetChange">
        <option v-for="entry in presets" :key="entry.id" :value="entry.id">
          {{ entry.label }}{{ entry.note ? ` · ${entry.note}` : '' }}
        </option>
      </select>
      <button
        class="primary"
        :disabled="phase === 'loading' || phase === 'booting' || phase === 'running' || selected === null"
        @click="boot"
      >
        启动
      </button>
      <button :disabled="phase !== 'running'" @click="pause">暂停</button>
      <button :disabled="phase !== 'paused'" @click="resume">继续</button>
      <span class="status">{{ status }}</span>
    </div>
    <TermConsole ref="term" :on-bytes="onBytes" :on-text="onText" />
  </div>
</template>

<style scoped>
.lab-shell {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 16px 0;
}

.bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

select {
  padding: 4px 8px;
  font-size: 13px;
  border: 1px solid var(--vp-c-border, var(--loupe-line, #ccc));
  border-radius: 6px;
  background: var(--vp-c-bg, var(--loupe-panel, #fff));
  color: var(--vp-c-text-1, inherit);
  cursor: pointer;
}

button {
  padding: 4px 12px;
  font-size: 13px;
  border: 1px solid var(--vp-c-border, var(--loupe-line, #ccc));
  border-radius: 6px;
  background: var(--vp-c-bg, var(--loupe-panel, #fff));
  color: var(--vp-c-text-1, inherit);
  cursor: pointer;
}

button.primary {
  color: var(--vp-button-brand-text, #fff);
  background: var(--vp-button-brand-bg, #2f6f8f);
  border-color: var(--vp-button-brand-border, #2f6f8f);
}

button:disabled,
select:disabled {
  opacity: 0.5;
  cursor: default;
}

.status {
  font-size: 12px;
  color: var(--vp-c-text-2, var(--loupe-dim, #888));
}

.lab-shell :deep(.term-wrap) {
  height: var(--lab-term-height, 420px);
  margin: 0;
}
</style>
