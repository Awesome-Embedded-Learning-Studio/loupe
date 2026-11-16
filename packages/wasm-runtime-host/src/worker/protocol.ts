/**
 * Message protocol between the page and the engine worker.
 *
 * Every request carries a numeric id and the worker answers with an event
 * carrying the same id; events without an id (`feed`, `progress`,
 * `paused`) are notifications streamed while a run is active.
 */
import type { EngineVersion } from '../abi'
import type { SnapshotHeader } from '../snapshot'
import type { JudgeStep, StepResult } from '../judge'

/** A run that has stopped; `null` while the guest is still running. */
export type StopReport = { kind: string; code: number; rip: number } | null

export type EngineRequest =
  | { id: number; type: 'load'; engineUrl: string }
  | {
      id: number
      type: 'boot'
      /** Image URLs; fetched (and cached) inside the worker. */
      kernelUrl?: string
      diskUrl?: string
      /** Image bytes as an alternative to URLs. */
      kernel?: Uint8Array
      disk?: Uint8Array
    }
  | { id: number; type: 'run'; budget?: number; maxSteps?: number }
  | { id: number; type: 'pause' }
  | { id: number; type: 'inject'; text: string; lineEnd?: boolean }
  | { id: number; type: 'icount' }
  | { id: number; type: 'reset'; entry: number; stackTop: number }
  | { id: number; type: 'save' }
  | { id: number; type: 'restore'; bytes: Uint8Array }
  | { id: number; type: 'judge'; steps: JudgeStep[] }

export type EngineEvent =
  | {
      id: number
      type: 'loaded'
      abiVersion: number
      engine: EngineVersion
      ramSize: number
    }
  | { id: number; type: 'booted'; fromCache: { kernel: boolean; disk: boolean } }
  | { id: number; type: 'started' }
  | { id: number; type: 'pausing' }
  | { id: number; type: 'injected' }
  | { id: number; type: 'icount'; icount: number }
  | { id: number; type: 'reset' }
  | { id: number; type: 'saved'; bytes: Uint8Array; header: SnapshotHeader }
  | { id: number; type: 'restored' }
  | { id: number; type: 'judged'; ok: boolean; steps: StepResult[]; icount: number }
  | { id: number; type: 'error'; message: string }
  | { type: 'feed'; text: string; icount: number; retired: number; stopped: StopReport }
  | { type: 'progress'; which: 'engine' | 'kernel' | 'disk'; loaded: number; total: number }
  | { type: 'paused'; icount: number }

/** Requests whose reply resolves (or rejects on `error`). */
export type RepliedRequest = {
  load: Extract<EngineEvent, { type: 'loaded' }>
  boot: Extract<EngineEvent, { type: 'booted' }>
  run: Extract<EngineEvent, { type: 'started' }>
  pause: Extract<EngineEvent, { type: 'pausing' }>
  inject: Extract<EngineEvent, { type: 'injected' }>
  icount: Extract<EngineEvent, { type: 'icount' }>
  reset: Extract<EngineEvent, { type: 'reset' }>
  save: Extract<EngineEvent, { type: 'saved' }>
  restore: Extract<EngineEvent, { type: 'restored' }>
  judge: Extract<EngineEvent, { type: 'judged' }>
}

/** Request type names that carry a reply. */
export type RequestKind = keyof RepliedRequest
