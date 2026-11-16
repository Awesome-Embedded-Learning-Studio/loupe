/**
 * @aels/wasm-runtime-host
 *
 * TypeScript wrapper for the micro-forge wasm engine. No framework and no
 * DOM: engine loading with ABI checks, machine lifetime, run-loop
 * stepping, the serial console stream, asset caching, and a worker
 * protocol for running the engine off the UI thread.
 */
export {
  EXPECTED_ABI_VERSION,
  REACTOR_IMPORTS,
  ExitKind,
  decodeEngineVersion,
  unpackExit,
  type EngineExports,
  type EngineVersion,
  type RunStatus,
} from './abi'
export { loadEngine, type EngineLoadOptions } from './loader'
export { LoupeMachine, type CinuxImages, type RunOutcome } from './machine'
export { stepFeed, runUntil, type FeedStep, type FeedOptions } from './feed'
export {
  LoupeError,
  AbiMismatchError,
  BootRefusedError,
  GuestStoppedError,
  SnapshotFormatError,
  SnapshotMismatchError,
} from './errors'
export {
  SNAPSHOT_ENGINE_NAME,
  encodeSnapshot,
  parseSnapshot,
  snapshotMismatch,
  type SnapshotHeader,
  type ParsedSnapshot,
} from './snapshot'
export { fetchWithProgress, type FetchedBytes } from './http'
export {
  loadAsset,
  cacheKey,
  MemoryCacheBackend,
  OpfsCacheBackend,
  type AssetMeta,
  type CacheBackend,
  type LoadAssetOptions,
} from './assets'
export type { EngineRequest, EngineEvent, RepliedRequest, StopReport } from './worker/protocol'
export {
  judgeSerial,
  matchesExpectation,
  type JudgeStep,
  type JudgeMachine,
  type JudgeOptions,
  type StepResult,
  type CaseResult,
} from './judge'
export { EngineClient, type EngineClientHandlers, type EngineClientPort } from './worker/client'
export {
  EngineWorkerLogic,
  bindEngineWorker,
  type EngineWorkerOptions,
  type TurnScheduler,
} from './worker/engine-worker'
