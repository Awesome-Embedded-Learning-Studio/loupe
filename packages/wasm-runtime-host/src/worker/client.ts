/**
 * Page-side client for the engine worker.
 *
 * Pairs request ids with replies and surfaces id-less notifications
 * (`feed`, `progress`, `paused`) through callbacks. The port is any
 * postMessage-compatible object, so tests can connect the client straight
 * to `EngineWorkerLogic` without a real worker.
 */
import type {
  EngineEvent,
  EngineRequest,
  RepliedRequest,
  RequestKind,
  StopReport,
} from './protocol'
import type { JudgeStep } from '../judge'

export interface EngineClientPort {
  postMessage(data: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  terminate?(): void
}

export interface EngineClientHandlers {
  /** Streamed console text and progress while a run is active. */
  onFeed?: (feed: { text: string; icount: number; retired: number; stopped: StopReport }) => void
  onProgress?: (progress: {
    which: 'engine' | 'kernel' | 'disk'
    loaded: number
    total: number
  }) => void
  onPaused?: (icount: number) => void
}

export class EngineClient {
  private nextId = 1
  private readonly pending = new Map<
    number,
    { resolve: (event: EngineEvent) => void; reject: (error: Error) => void }
  >()
  private readonly port: EngineClientPort

  constructor(
    port: EngineClientPort,
    private readonly handlers: EngineClientHandlers = {},
  ) {
    this.port = port
    port.addEventListener('message', (event) => {
      this.receive(event.data as EngineEvent)
    })
  }

  /**
   * Open a module worker from a URL. Bundlers only transform the
   * `new Worker(new URL(...))` pattern when it sits inline at the call
   * site — under Vite, build the worker there and pass it to the
   * constructor instead.
   */
  static open(workerUrl: string | URL, handlers: EngineClientHandlers = {}): EngineClient {
    return new EngineClient(new Worker(workerUrl, { type: 'module' }), handlers)
  }

  /** Load and validate the engine artifact inside the worker. */
  load(engineUrl: string): Promise<RepliedRequest['load']> {
    return this.request('load', { engineUrl })
  }

  /** Boot from image bytes uploaded to the worker. */
  bootBytes(kernel: Uint8Array, disk: Uint8Array): Promise<RepliedRequest['boot']> {
    return this.request('boot', { kernel, disk })
  }

  /** Boot from URLs, fetched and cached inside the worker. */
  bootUrls(kernelUrl: string, diskUrl: string): Promise<RepliedRequest['boot']> {
    return this.request('boot', { kernelUrl, diskUrl })
  }

  /** Start a continuous run; feeds stream through `onFeed` until paused or stopped. */
  run(budget?: number, maxSteps?: number): Promise<RepliedRequest['run']> {
    return this.request('run', { budget, maxSteps })
  }

  /** Request a pause; completion arrives through `onPaused`. */
  pause(): Promise<RepliedRequest['pause']> {
    return this.request('pause', {})
  }

  inject(text: string, lineEnd?: boolean): Promise<RepliedRequest['inject']> {
    return this.request('inject', { text, lineEnd })
  }

  icount(): Promise<RepliedRequest['icount']> {
    return this.request('icount', {})
  }

  reset(entry: number, stackTop: number): Promise<RepliedRequest['reset']> {
    return this.request('reset', { entry, stackTop })
  }

  /** Save a snapshot container; requires a paused machine. */
  save(): Promise<RepliedRequest['save']> {
    return this.request('save', {})
  }

  /** Restore a snapshot container; requires a paused machine. */
  restore(bytes: Uint8Array): Promise<RepliedRequest['restore']> {
    return this.request('restore', { bytes })
  }

  /** Run a serial-judging case to completion; console streams through `onFeed`. */
  judge(steps: JudgeStep[]): Promise<RepliedRequest['judge']> {
    return this.request('judge', { steps })
  }

  /** Drop the worker; outstanding requests reject. */
  terminate(): void {
    for (const entry of this.pending.values()) {
      entry.reject(new Error('The engine worker was terminated.'))
    }
    this.pending.clear()
    this.port.terminate?.()
  }

  private request<K extends RequestKind>(
    kind: K,
    fields: Omit<Extract<EngineRequest, { type: K }>, 'id' | 'type'>,
  ): Promise<RepliedRequest[K]> {
    const id = this.nextId
    this.nextId += 1
    const request = { id, type: kind, ...fields } as EngineRequest
    const promise = new Promise<RepliedRequest[K]>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (event) => resolve(event as RepliedRequest[K]),
        reject,
      })
    })
    this.port.postMessage(request)
    return promise
  }

  private receive(event: EngineEvent): void {
    if (event.type === 'feed') {
      this.handlers.onFeed?.({
        text: event.text,
        icount: event.icount,
        retired: event.retired,
        stopped: event.stopped,
      })
      return
    }
    if (event.type === 'progress') {
      this.handlers.onProgress?.({ which: event.which, loaded: event.loaded, total: event.total })
      return
    }
    if (event.type === 'paused') {
      this.handlers.onPaused?.(event.icount)
      return
    }
    const pending = this.pending.get(event.id)
    if (pending === undefined) return
    this.pending.delete(event.id)
    if (event.type === 'error') {
      pending.reject(new Error(event.message))
    } else {
      pending.resolve(event)
    }
  }
}
