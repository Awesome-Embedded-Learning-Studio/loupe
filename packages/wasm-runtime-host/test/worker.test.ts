import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { EngineClient, type EngineClientHandlers } from '../src/worker/client'
import { EngineWorkerLogic } from '../src/worker/engine-worker'
import type { EngineEvent, EngineRequest } from '../src/worker/protocol'
import { SNAPSHOT_ENGINE_NAME } from '../src/snapshot'
import { DISK_PATH, ENGINE_PATH, KERNEL_PATH } from './assets'



const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

/** Poll until the condition holds; throws with the evidence on timeout. */
async function until(
  condition: () => boolean,
  timeoutMs: number,
  evidence: () => string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs} ms. Evidence: ${evidence()}`)
    }
    await sleep(25)
  }
}

/** A client wired straight to worker logic in this thread; no real worker. */
function makeClient(
  options: ConstructorParameters<typeof EngineWorkerLogic>[1],
  handlers: EngineClientHandlers,
) {
  let deliver: ((event: EngineEvent) => void) | null = null
  const logic = new EngineWorkerLogic(event => {
    deliver?.(event)
  }, options)
  const port = {
    postMessage: (data: unknown) => {
      void logic.handle(data as EngineRequest)
    },
    addEventListener: (_type: 'message', listener: (event: MessageEvent) => void) => {
      deliver = event => listener(new MessageEvent('message', { data: event }))
    },
  }
  return { client: new EngineClient(port, handlers) }
}

describe('engine worker protocol (skipped without a local engine.wasm)', () => {
  it.skipIf(!ENGINE_PATH)(
    'loads, boots by bytes, streams feeds, and answers an injection',
    async () => {
      const engineBytes = await readFile(ENGINE_PATH!)
      let text = ''
      let stopped: string | null = null
      let paused = false
      const { client } = makeClient(
        {
          fetchImpl: (async () =>
            new Response(engineBytes.buffer.slice(0) as ArrayBuffer)) as unknown as typeof fetch,
          schedule: fn => queueMicrotask(fn),
        },
        {
          onFeed: feed => {
            text += feed.text
            if (feed.stopped !== null) stopped = feed.stopped.kind
          },
          onPaused: () => {
            paused = true
          },
        },
      )

      const loaded = await client.load('https://example/engine.wasm')
      expect(loaded.abiVersion).toBe(1)
      expect(loaded.ramSize).toBeGreaterThan(0)

      if (!existsSync(KERNEL_PATH) || !existsSync(DISK_PATH)) {
        // Boot coverage needs the host images; the protocol path above
        // already ran against the real engine.
        client.terminate()
        return
      }
      const kernel = new Uint8Array(await readFile(KERNEL_PATH))
      const disk = new Uint8Array(await readFile(DISK_PATH))
      const booted = await client.bootBytes(kernel, disk)
      expect(booted.type).toBe('booted')
      expect(booted.fromCache).toEqual({ kernel: false, disk: false })

      await client.run(2_000_000, 400)
      await until(
        () => text.includes('Cinux up') || stopped !== null,
        180_000,
        () => `stopped=${stopped} text tail=${text.slice(-120)}`,
      )
      expect(stopped).toBeNull()
      expect(text).toContain('Cinux up')

      await client.pause()
      await until(() => paused, 5_000, () => 'no paused notification')

      paused = false
      await client.inject('echo loupe-worker-ok', true)
      await client.run(2_000_000, 200)
      await until(
        () => text.includes('loupe-worker-ok') || paused,
        60_000,
        () => text.slice(-120),
      )
      expect(text).toContain('loupe-worker-ok')
      client.terminate()
    },
    300_000,
  )

  it.skipIf(!ENGINE_PATH)('rejects requests made before load', async () => {
    const { client } = makeClient({}, {})
    await expect(client.icount()).rejects.toThrow('not loaded')
    client.terminate()
  })

  it.skipIf(!ENGINE_PATH)('saves and restores over the worker protocol', async () => {
    const engineBytes = await readFile(ENGINE_PATH!)
    const { client } = makeClient(
      {
        fetchImpl: (async () =>
          new Response(engineBytes.buffer.slice(0) as ArrayBuffer)) as unknown as typeof fetch,
        schedule: fn => queueMicrotask(fn),
      },
      {},
    )
    await client.load('https://example/engine.wasm')
    // An unbooted machine still has full state to save (RAM + CPU defaults).
    const saved = await client.save()
    expect(saved.header.engine).toBe(SNAPSHOT_ENGINE_NAME)
    expect(saved.bytes.length).toBeGreaterThan(0)
    await client.restore(saved.bytes)
    client.terminate()
  }, 120_000)
})
