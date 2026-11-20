/**
 * Engine side of the worker protocol.
 *
 * Owns the machine and the run loop: the page never touches the wasm
 * instance directly. A run steps its budget per turn, emits a `feed`
 * notification after each turn, and yields to the worker's message loop
 * between turns so `pause`/`inject` arrive while the guest runs. The
 * logic is a plain class bound to a port at the bottom of this file, so
 * tests can drive it without a real worker.
 */
import type { EngineExports } from '../abi'
import { stepFeed } from '../feed'
import { loadEngine } from '../loader'
import { LoupeMachine } from '../machine'
import { loadAsset, type CacheBackend } from '../assets'
import { judgeSerial } from '../judge'
import { parseSnapshot } from '../snapshot'
import type { EngineEvent, EngineRequest, RepliedRequest, RequestKind } from './protocol'

/** Scheduler for the gaps between run turns; injectable for tests. */
export type TurnScheduler = (run: () => void) => void

export interface EngineWorkerOptions {
  /** Cache backend for URL-loaded images and the engine itself. */
  backend?: CacheBackend
  /** Fetch implementation for tests. */
  fetchImpl?: typeof fetch
  /** Scheduler between run turns; default `setTimeout(0)`. */
  schedule?: TurnScheduler
}

const DEFAULT_BUDGET = 500_000

export class EngineWorkerLogic {
  private machine: LoupeMachine | null = null
  private engine: EngineExports | null = null
  private printed = 0
  private stall = 0
  private running = false
  private judging = false
  private pauseRequested = false
  private turnsLeft = 0
  private budget = DEFAULT_BUDGET

  constructor(
    private readonly emit: (event: EngineEvent) => void,
    private readonly options: EngineWorkerOptions = {},
  ) {}

  /** Handle one request; failures surface as an `error` reply with the same id. */
  async handle(request: EngineRequest): Promise<void> {
    try {
      await this.dispatch(request)
    } catch (error) {
      this.emit({
        id: request.id,
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async dispatch(request: EngineRequest): Promise<void> {
    switch (request.type) {
      case 'load':
        await this.load(request.id, request.engineUrl)
        break
      case 'boot':
        await this.boot(request)
        break
      case 'run':
        this.startRun(request.id, request.budget, request.maxSteps)
        break
      case 'pause':
        this.pauseRequested = true
        this.reply(request.id, 'pause')
        break
      case 'inject':
        this.requireMachine().injectSerial(request.text, request.lineEnd === true)
        this.reply(request.id, 'inject')
        break
      case 'icount':
        this.emit({ id: request.id, type: 'icount', icount: this.requireMachine().icount })
        break
      case 'reset':
        this.requireMachine().reset(request.entry, request.stackTop)
        this.reply(request.id, 'reset')
        break
      case 'save': {
        if (this.running) {
          throw new Error('Pause the machine before saving a snapshot.')
        }
        const bytes = this.requireMachine().snapshot()
        this.emit({ id: request.id, type: 'saved', bytes, header: parseSnapshot(bytes).header })
        break
      }
      case 'restore': {
        if (this.running) {
          throw new Error('Pause the machine before restoring a snapshot.')
        }
        this.requireMachine().restore(request.bytes)
        this.printed = 0
        this.stall = 0
        this.reply(request.id, 'restore')
        break
      }
      case 'judge': {
        if (this.running || this.judging) {
          throw new Error('Stop the current run or judging first.')
        }
        this.judging = true
        const machine = this.requireMachine()
        try {
          const result = await judgeSerial(machine, request.steps, {
            onText: (text) =>
              this.emit({ type: 'feed', text, icount: machine.icount, retired: 0, stopped: null }),
          })
          // Judging consumed the console with its own watermark; push this
          // loop's watermark to the newest so a resumed run does not replay.
          this.printed = machine.readConsole(this.printed).printed
          this.emit({
            id: request.id,
            type: 'judged',
            ok: result.ok,
            steps: result.steps,
            icount: result.icount,
          })
        } finally {
          this.judging = false
        }
        break
      }
    }
  }

  private async load(id: number, engineUrl: string): Promise<void> {
    const progress = (loaded: number, total: number): void => {
      this.emit({ type: 'progress', which: 'engine', loaded, total })
    }
    const backend = this.options.backend
    if (backend === undefined) {
      this.engine = await loadEngine({
        url: engineUrl,
        fetchImpl: this.options.fetchImpl,
        onProgress: progress,
      })
    } else {
      const hit = await loadAsset(engineUrl, {
        backend,
        fetchImpl: this.options.fetchImpl,
        onProgress: progress,
      })
      const buffer = hit.bytes.buffer.slice(
        hit.bytes.byteOffset,
        hit.bytes.byteOffset + hit.bytes.byteLength,
      ) as ArrayBuffer
      if (hit.fromCache) progress(1, 1)
      this.engine = await loadEngine({ bytes: buffer })
    }
    this.machine = LoupeMachine.default(this.engine)
    this.printed = 0
    this.stall = 0
    const reply: RepliedRequest['load'] = {
      id,
      type: 'loaded',
      abiVersion: this.engine.mf_abi_version(),
      engine: this.machine.engineVersion,
      ramSize: this.machine.guestRamSize,
    }
    this.emit(reply)
  }

  private async boot(request: Extract<EngineRequest, { type: 'boot' }>): Promise<void> {
    const machine = this.requireMachine()
    const kernel = await this.pickImage('kernel', request.kernelUrl, request.kernel)
    const disk = await this.pickImage('disk', request.diskUrl, request.disk)
    machine.boot({ kernel: kernel.bytes, disk: disk.bytes })
    this.printed = 0
    this.stall = 0
    this.emit({
      id: request.id,
      type: 'booted',
      fromCache: { kernel: kernel.fromCache, disk: disk.fromCache },
    })
  }

  private async pickImage(
    which: 'kernel' | 'disk',
    url: string | undefined,
    bytes: Uint8Array | undefined,
  ): Promise<{ bytes: Uint8Array; fromCache: boolean }> {
    if (bytes !== undefined) return { bytes, fromCache: false }
    if (url === undefined) {
      throw new Error(`boot needs ${which} bytes or a ${which}Url.`)
    }
    const hit = await loadAsset(url, {
      backend: this.options.backend,
      fetchImpl: this.options.fetchImpl,
      onProgress: (loaded, total) => this.emit({ type: 'progress', which, loaded, total }),
    })
    return { bytes: hit.bytes, fromCache: hit.fromCache }
  }

  private startRun(id: number, budget: number | undefined, maxSteps: number | undefined): void {
    const machine = this.requireMachine()
    if (this.running) {
      throw new Error('A run is already active; pause it first.')
    }
    this.running = true
    this.pauseRequested = false
    this.budget = budget ?? DEFAULT_BUDGET
    this.turnsLeft = maxSteps ?? Number.POSITIVE_INFINITY
    this.reply(id, 'run')
    this.turn(machine)
  }

  private turn(machine: LoupeMachine): void {
    if (!this.running) return
    if (this.pauseRequested) {
      this.finish(machine)
      return
    }
    const r = stepFeed(machine, this.printed, this.stall, {
      budget: this.budget,
      throwOnError: false,
    })
    this.printed = r.printed
    this.stall = r.stall
    this.emit({
      type: 'feed',
      text: r.feed.text,
      icount: r.feed.icount,
      retired: r.feed.retired,
      stopped: r.feed.stopped,
    })
    if (r.feed.stopped !== null) {
      this.running = false
      return
    }
    this.turnsLeft -= 1
    if (this.turnsLeft <= 0) {
      this.finish(machine)
      return
    }
    this.schedule(() => this.turn(machine))
  }

  private finish(machine: LoupeMachine): void {
    this.running = false
    this.pauseRequested = false
    this.emit({ type: 'paused', icount: machine.icount })
  }

  private schedule(run: () => void): void {
    const scheduler = this.options.schedule ?? ((fn) => setTimeout(fn, 0))
    scheduler(run)
  }

  private reply<K extends RequestKind>(id: number, kind: K): void {
    this.emit({ id, type: kind } as RepliedRequest[K])
  }

  private requireMachine(): LoupeMachine {
    if (this.machine === null) {
      throw new Error('The engine is not loaded yet.')
    }
    return this.machine
  }
}

interface WorkerPort {
  postMessage(data: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}

/**
 * Wire worker logic to a dedicated-worker port. Imported for its side
 * effect by the worker entry module; tests import the class directly
 * instead.
 */
export function bindEngineWorker(logic: EngineWorkerLogic, port: WorkerPort): void {
  port.addEventListener('message', (event) => {
    void logic.handle(event.data as EngineRequest)
  })
}
