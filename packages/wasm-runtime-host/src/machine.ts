/**
 * LoupeMachine: one managed machine.
 *
 * The engine's exports act on the "current" instance, so every operation
 * here selects its own instance first; machines can coexist without
 * stepping on each other's cpu state. The default instance (handle 0) is
 * lazily created and never destroyed; every other handle owns a full
 * machine and must be destroyed by its caller.
 */
import {
  decodeEngineVersion,
  unpackExit,
  ExitKind,
  type EngineExports,
  type EngineVersion,
  type RunStatus,
} from './abi'
import { BootRefusedError, SnapshotMismatchError } from './errors'
import {
  SNAPSHOT_ENGINE_NAME,
  encodeSnapshot,
  parseSnapshot,
  snapshotMismatch,
} from './snapshot'

/** The Cinux image pair: kernel binary and ext2 root volume. */
export interface CinuxImages {
  kernel: Uint8Array
  disk: Uint8Array
}

/** One `run` outcome: exit status plus instructions retired in this call. */
export interface RunOutcome extends RunStatus {
  retired: number
}

export class LoupeMachine {
  private readonly handle: number
  private destroyed = false

  private constructor(
    private readonly engine: EngineExports,
    handle: number,
  ) {
    this.handle = handle
  }

  /** The default instance (lazy, never destroyed); single-machine pages use this. */
  static default(engine: EngineExports): LoupeMachine {
    return new LoupeMachine(engine, 0)
  }

  /** A standalone instance; must be destroyed. Zero `ramSize`/`window` select the artifact defaults. */
  static create(engine: EngineExports, ramSize = 0, window = 0): LoupeMachine {
    const handle = engine.mf_instance_create(ramSize, window)
    return new LoupeMachine(engine, handle)
  }

  /** Artifact-level info (shared by all instances). */
  get engineVersion(): EngineVersion {
    return decodeEngineVersion(this.engine.mf_engine_version())
  }

  get snapshotFormatVersion(): number {
    return this.engine.mf_snapshot_format_version()
  }

  get guestRamSize(): number {
    return this.engine.mf_guest_ram_size()
  }

  /** Linear framebuffer placement in guest-physical memory. */
  get lfb(): { base: number; size: number } {
    return { base: this.engine.mf_lfb_base(), size: this.engine.mf_lfb_size() }
  }

  /** Retired instruction count (exact below 2^53). */
  get icount(): number {
    this.use()
    return Number(this.engine.mf_icount())
  }

  /** Current RIP, read as two halves. */
  get rip(): number {
    this.use()
    return (this.engine.mf_rip_low() >>> 0) + this.engine.mf_rip_high() * 0x1_0000_0000
  }

  private use(): void {
    this.assertAlive()
    if (this.engine.mf_instance_use(this.handle) !== 1) {
      throw new Error(`Instance ${this.handle} does not exist (destroyed?).`)
    }
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error('This machine was destroyed and can no longer be used.')
    }
  }

  /** Copy an image into the engine heap; the caller keeps the pointer. */
  upload(bytes: Uint8Array): number {
    this.assertAlive()
    const ptr = this.engine.malloc(bytes.length)
    if (ptr === 0) {
      throw new Error(`malloc(${bytes.length}) failed: engine heap exhausted.`)
    }
    new Uint8Array(this.engine.memory.buffer, ptr, bytes.length).set(bytes)
    return ptr
  }

  /** Free a pointer obtained from `upload`. */
  release(ptr: number): void {
    this.engine.free(ptr)
  }

  /**
   * Boot from images already uploaded to the engine heap. Split from
   * `upload` because a single multi-hundred-MiB copy freezes the tab;
   * pages yield to the main thread between uploads.
   */
  bootUploaded(
    kernelPtr: number,
    kernelLen: number,
    diskPtr: number,
    diskLen: number,
  ): void {
    this.use()
    const ok = this.engine.mf_boot_cinux(kernelPtr, kernelLen, diskPtr, diskLen)
    // Once accepted, the heap copies are dead weight.
    this.engine.free(kernelPtr)
    this.engine.free(diskPtr)
    if (ok !== 1) {
      throw new BootRefusedError()
    }
  }

  /** Current identity triple; snapshots pin the same values. */
  private versionTriple(): { engine: string; engineVersion: string; snapshotFormat: number } {
    const { major, minor, patch } = this.engineVersion
    return {
      engine: SNAPSHOT_ENGINE_NAME,
      engineVersion: `${major}.${minor}.${patch}`,
      snapshotFormat: this.snapshotFormatVersion,
    }
  }

  /**
   * Save the full machine state as a portable snapshot container.
   * Throws SnapshotUnsupportedError on engine builds whose snapshot
   * export cannot leave the guest RAM (see that error).
   */
  snapshot(): Uint8Array {
    this.use()
    const need = Number(this.engine.mf_snapshot(0, 0))
    const ptr = this.engine.malloc(need)
    try {
      const written = Number(this.engine.mf_snapshot(ptr, need))
      if (written === 0) {
        throw new Error('The engine failed to write the snapshot.')
      }
      const blob = new Uint8Array(this.engine.memory.buffer, ptr, written).slice()
      const triple = this.versionTriple()
      return encodeSnapshot(
        {
          engine: triple.engine,
          engineVersion: triple.engineVersion,
          snapshotFormat: triple.snapshotFormat,
          ramSize: this.guestRamSize,
          savedAt: new Date().toISOString(),
        },
        blob,
      )
    } finally {
      this.engine.free(ptr)
    }
  }

  /**
   * Restore a container produced by `snapshot`. Refuses snapshots whose
   * version triple does not match this engine; the machine is untouched
   * when the header or the engine rejects the blob.
   */
  restore(bytes: Uint8Array): void {
    this.use()
    const { header, blob } = parseSnapshot(bytes)
    const mismatch = snapshotMismatch(header, this.versionTriple())
    if (mismatch !== null) {
      throw new SnapshotMismatchError(mismatch)
    }
    const ptr = this.upload(blob)
    try {
      const rc = this.engine.mf_restore(ptr, blob.length)
      if (rc !== 0) {
        throw new Error(`Engine refused to restore the snapshot (reason ${rc - 1}).`)
      }
    } finally {
      this.engine.free(ptr)
    }
  }

  /** One-shot boot (small images and tests; large images go through upload + bootUploaded). */
  boot(images: CinuxImages): void {
    const kernelPtr = this.upload(images.kernel)
    const diskPtr = this.upload(images.disk)
    this.bootUploaded(kernelPtr, images.kernel.length, diskPtr, images.disk.length)
  }

  /** Reset the cpu (entry, stack top); guest RAM contents stay as they are. */
  reset(entry: number, stackTop: number): void {
    this.use()
    this.engine.mf_reset(entry, stackTop)
  }

  /** Run up to `budget` instructions. */
  run(budget: number | bigint): RunOutcome {
    this.use()
    const before = this.engine.mf_icount()
    const packed = this.engine.mf_run(BigInt(budget))
    return {
      ...unpackExit(packed),
      retired: Number(this.engine.mf_icount() - before),
    }
  }

  /**
   * Read the new part of the serial console. `printed` is the watermark
   * from the previous call; the engine copies the whole console each
   * time, so everything above the watermark is new.
   */
  readConsole(printed: number): { text: string; printed: number } {
    this.use()
    const cap = 1 << 16
    const dst = this.engine.malloc(cap)
    if (dst === 0) {
      throw new Error(`readConsole: malloc(${cap}) failed.`)
    }
    try {
      const n = Number(this.engine.mf_read_console(dst, cap))
      if (n <= printed) {
        return { text: '', printed }
      }
      const view = new Uint8Array(this.engine.memory.buffer, dst, n).subarray(printed)
      return {
        text: new TextDecoder('utf-8', { fatal: false }).decode(view),
        printed: n,
      }
    } finally {
      this.engine.free(dst)
    }
  }

  /** Queue bytes on the COM1 receive side; the serial line ends lines with CR. */
  injectSerial(text: string, lineEnd = false): void {
    this.use()
    for (const char of text) {
      this.engine.mf_inject_serial(char.codePointAt(0) ?? 0)
    }
    if (lineEnd) {
      this.engine.mf_inject_serial(0x0d)
    }
  }

  /**
   * Guest-physical memory access (expectation checks in judging).
   * Instances created with `window = 0` share the artifact's default
   * guest window: memory is visible across them by design, and only cpu
   * state is per-instance. Distinct windows need distinct `window` bases.
   */
  writeGuest(paddr: number, bytes: Uint8Array): boolean {
    this.use()
    const src = this.engine.malloc(bytes.length)
    try {
      new Uint8Array(this.engine.memory.buffer, src, bytes.length).set(bytes)
      return this.engine.mf_write_guest(paddr, src, bytes.length) === 1
    } finally {
      this.engine.free(src)
    }
  }

  peek32(paddr: number): number {
    this.use()
    return this.engine.mf_peek32(paddr) >>> 0
  }

  /** Destroy the instance. The default instance is ignored; the machine is unusable after this. */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.engine.mf_instance_destroy(this.handle)
  }

  /** Exit kind name for status lines and logs. */
  static exitName(kind: ExitKind): string {
    return ExitKind[kind] ?? `kind=${kind}`
  }
}
