<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef } from 'vue'
import { EngineClient, type EngineClientHandlers } from '@aels/wasm-runtime-host'
import { TermConsole } from '@aels/loupe-ui'

// The engine runs inside a dedicated worker; this page only renders.
// Asset URLs go through the worker's OPFS cache; files load from disk.
const ENGINE_URL = './engine.wasm'
const KERNEL_URL = './kernel.bin'
const DISK_URL = './ext2.img'

const status = ref('选择镜像或填好 URL 后引导(demo/public 下放资产)')
const busy = ref(false)
const running = ref(false)
const source = ref<'files' | 'url'>('files')
const kernelFile = ref<File | null>(null)
const diskFile = ref<File | null>(null)
const kernelUrl = ref(KERNEL_URL)
const diskUrl = ref(DISK_URL)
const judgeVerdict = ref('')

const client = shallowRef<EngineClient | null>(null)
const term = shallowRef<InstanceType<typeof TermConsole> | null>(null)
let icount = 0
let paused = false

const handlers: EngineClientHandlers = {
  onFeed: (feed) => {
    icount = feed.icount
    term.value?.push(feed.text)
    if (feed.stopped !== null) {
      running.value = false
      status.value = `guest 停止:${feed.stopped.kind},code=0x${feed.stopped.code.toString(16)},rip=0x${feed.stopped.rip.toString(16)}`
    } else if (!busy.value) {
      status.value = `运行中 · ${(feed.icount / 1e6).toFixed(1)}M 条指令`
    }
  },
  onProgress: (progress) => {
    const percent =
      progress.total > 0
        ? `${Math.floor((progress.loaded / progress.total) * 100)}%`
        : `${(progress.loaded / 1048576).toFixed(1)} MiB`
    status.value = `下载 ${labelOf(progress.which)}… ${percent}`
  },
  onPaused: () => {
    paused = true
    running.value = false
    status.value = `已暂停 · ${(icount / 1e6).toFixed(1)}M 条指令`
  },
}

function labelOf(which: 'engine' | 'kernel' | 'disk'): string {
  if (which === 'engine') return '引擎'
  if (which === 'kernel') return '内核'
  return '磁盘'
}

const engineReady = () => source.value === 'url' || Boolean(kernelFile.value && diskFile.value)

const readFileBytes = (file: File): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsArrayBuffer(file)
  })

const ensureClient = (): EngineClient => {
  if (client.value === null) {
    // Inline construction so Vite bundles the worker entry.
    client.value = new EngineClient(
      new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
      handlers,
    )
  }
  return client.value
}

const boot = async (): Promise<void> => {
  if (!engineReady() || busy.value) return
  busy.value = true
  judgeVerdict.value = ''
  try {
    const active = ensureClient()
    status.value = '加载引擎…'
    const loaded = await active.load(ENGINE_URL)
    const { major, minor, patch } = loaded.engine
    if (source.value === 'url') {
      status.value = '下载镜像(URL 走 OPFS 缓存)…'
      await active.bootUrls(kernelUrl.value, diskUrl.value)
    } else {
      status.value = '读取镜像…'
      const kernel = await readFileBytes(kernelFile.value!)
      status.value = `读取磁盘映像(${(diskFile.value!.size / 1048576).toFixed(0)} MiB)…`
      const disk = await readFileBytes(diskFile.value!)
      await active.bootBytes(kernel, disk)
    }
    running.value = true
    paused = false
    status.value = `引导中 · 引擎 ${major}.${minor}.${patch}`
    term.value?.focus()
    await active.run()
  } catch (error) {
    status.value = `失败:${error instanceof Error ? error.message : String(error)}`
    running.value = false
  } finally {
    busy.value = false
  }
}

const pause = async (): Promise<void> => {
  await client.value?.pause()
}

/** Demo of the judging API: pause, run an echo assertion, show the verdict. */
const runJudgeDemo = async (): Promise<void> => {
  const active = client.value
  if (active === null || busy.value || running.value) return
  busy.value = true
  judgeVerdict.value = '判题中…'
  try {
    const verdict = await active.judge([
      { input: 'echo loupe-judge-demo', lineEnd: true, expect: 'loupe-judge-demo' },
    ])
    const step = verdict.steps[0]
    judgeVerdict.value = verdict.ok
      ? '判题通过 · 匹配成功'
      : `判题失败 · ${step?.outcome ?? 'unknown'}(用时 ${step?.elapsedMs ?? 0} ms)`
  } catch (error) {
    judgeVerdict.value = `判题出错:${error instanceof Error ? error.message : String(error)}`
  } finally {
    busy.value = false
  }
}

const resume = async (): Promise<void> => {
  if (client.value === null || running.value) return
  running.value = true
  paused = false
  await client.value.run()
}

/** Guest tty bytes from the terminal component (printables, ANSI, ^C). */
const onBytes = (bytes: number[]): void => {
  if (running.value) void client.value?.inject(String.fromCharCode(...bytes))
}

/** Pasted text goes through as-is. */
const onText = (text: string): void => {
  if (running.value) void client.value?.inject(text)
}

const pickKernel = (event: Event): void => {
  kernelFile.value = (event.target as HTMLInputElement).files?.[0] ?? null
}

const pickDisk = (event: Event): void => {
  diskFile.value = (event.target as HTMLInputElement).files?.[0] ?? null
}

onBeforeUnmount(() => {
  client.value?.terminate()
})
</script>

<template>
  <header>
    <h1>loupe · demo</h1>
    <label class="mode"><input v-model="source" type="radio" value="files" /> 本地文件</label>
    <label class="mode"><input v-model="source" type="radio" value="url" /> URL(缓存)</label>
    <template v-if="source === 'files'">
      <label class="file">kernel.bin<input type="file" @change="pickKernel" /></label>
      <label class="file">ext2.img<input type="file" @change="pickDisk" /></label>
    </template>
    <template v-else>
      <label class="url">kernel<input v-model="kernelUrl" type="text" spellcheck="false" /></label>
      <label class="url">disk<input v-model="diskUrl" type="text" spellcheck="false" /></label>
    </template>
    <button :disabled="!engineReady() || running || busy" @click="boot">引导</button>
    <button :disabled="!running" @click="pause">暂停</button>
    <button :disabled="running || busy || paused" @click="resume">继续</button>
    <button :disabled="running || busy || !paused" @click="runJudgeDemo">判题演示</button>
    <span id="status">{{ status }}</span>
    <span v-if="judgeVerdict !== ''" id="verdict">{{ judgeVerdict }}</span>
  </header>
  <TermConsole ref="term" :on-bytes="onBytes" :on-text="onText" />
</template>

<style scoped>
header {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  padding: 12px 18px;
  font-family: system-ui, sans-serif;
}

h1 {
  font-size: 18px;
  margin: 0;
}

.mode {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  font-size: 13px;
}

.file,
.url {
  display: inline-flex;
  flex-direction: column;
  font-size: 12px;
  color: #888;
}

.url input {
  width: 180px;
  padding: 3px 6px;
  font-size: 12px;
  font-family: monospace;
}

#status {
  font-size: 13px;
  color: #666;
}

#verdict {
  font-size: 13px;
  color: #2c7;
}
</style>
