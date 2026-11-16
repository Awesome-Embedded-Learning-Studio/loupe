/**
 * Export surface of the micro-forge wasm engine (src/wasm/exports.cpp).
 *
 * Every export is declared here exactly as the engine defines it; the
 * wrapper layer picks the calls it needs, the rest stay typed for later
 * surfaces (snapshots, judging, video).
 */

/** ABI version this package is written against; the engine bumps it on breaking changes. */
export const EXPECTED_ABI_VERSION = 1

/** Unpacked `mf_engine_version`: major<<16 | minor<<8 | patch. */
export interface EngineVersion {
  major: number
  minor: number
  patch: number
}

/** Unpack the raw `mf_engine_version` return value. */
export function decodeEngineVersion(packed: number): EngineVersion {
  return {
    major: packed >>> 16,
    minor: (packed >>> 8) & 0xff,
    patch: packed & 0xff,
  }
}

/** Cpu exit kinds (src/arch/x86_64/cpu.hpp); the low byte of a packed exit. */
export enum ExitKind {
  Running = 0,
  Exit = 2,
  DebugExit = 3,
  DecodeError = 4,
  Unsupported = 5,
  Fault = 6,
}

/**
 * All engine exports. Numbers follow the wasm boundary: i32/u32 as `number`,
 * u64 as `bigint`.
 */
export interface EngineExports {
  memory: WebAssembly.Memory
  /** Reactor contract: call once after instantiation to run static constructors. */
  _initialize: () => void
  malloc: (size: number) => number
  free: (ptr: number) => void

  /** ABI version; bumps on breaking changes. */
  mf_abi_version: () => number
  /** Engine version; packing see `decodeEngineVersion`. */
  mf_engine_version: () => number
  /** Snapshot format version, for both writing and reading. */
  mf_snapshot_format_version: () => number
  /** Guest RAM size in bytes; the layout belongs to the artifact, not to an instance. */
  mf_guest_ram_size: () => number
  /** Linear framebuffer: guest-physical base and length. */
  mf_lfb_base: () => number
  mf_lfb_size: () => number

  mf_reset: (entry: number, stackTop: number) => void
  /** Run at most `maxInstructions`; returns a packed exit (kind in the low byte). */
  mf_run: (maxInstructions: bigint) => bigint
  /** Boot Cinux from wasm-heap pointers; returns 1 accepted, 0 refused. */
  mf_boot_cinux: (
    kernelPtr: number,
    kernelLen: number,
    diskPtr: number,
    diskLen: number,
  ) => number
  mf_write_guest: (paddr: number, src: number, len: number) => number
  mf_peek32: (paddr: number) => number

  mf_inject_serial: (byte: number) => void
  mf_serial_tx: () => bigint
  /** Copy the whole serial console to `dst` (wasm pointer); returns the total length. */
  mf_read_console: (dst: number, cap: number) => bigint

  mf_icount: () => bigint
  mf_rip_low: () => number
  mf_rip_high: () => number
  mf_set_rip: (rip: bigint) => void

  /** Write a snapshot blob to `dst` (wasm pointer). Returns bytes written, or the needed length when `cap` is too small (nothing is written then). */
  mf_snapshot: (dst: number, cap: number) => bigint
  /** Restore from `src` (wasm pointer). Returns 0 on success, else the SnapshotError ordinal + 1. */
  mf_restore: (src: number, len: number) => number

  mf_instance_create: (ramSize: number, window: number) => number
  mf_instance_use: (handle: number) => number
  /** Destroy an instance; the default instance is ignored. */
  mf_instance_destroy: (handle: number) => void
}

/** Imports a reactor artifact needs (wasi stubs + emscripten growth notice). */
export const REACTOR_IMPORTS: WebAssembly.Imports = {
  env: { emscripten_notify_memory_growth: () => {} },
  wasi_snapshot_preview1: {
    fd_close: () => 0,
    fd_write: () => 0,
    fd_seek: () => 0,
    environ_sizes_get: () => 0,
    environ_get: () => 0,
  },
}

/** Unpacked result of `mf_run`. */
export interface RunStatus {
  kind: ExitKind
  code: number
}

/** Unpack a packed exit value. */
export function unpackExit(packed: bigint): RunStatus {
  return {
    kind: Number(packed & 0xffn) as ExitKind,
    code: Number(packed >> 8n),
  }
}
