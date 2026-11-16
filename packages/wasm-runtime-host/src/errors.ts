/**
 * Error family for loupe. Callers branch on `instanceof`; every message
 * carries the values needed to locate the failure.
 */

export class LoupeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/** The engine ABI version does not match what this package was written against. */
export class AbiMismatchError extends LoupeError {
  constructor(
    readonly got: number,
    readonly expected: number,
    readonly url?: string,
  ) {
    super(
      `Engine ABI mismatch: engine reports ${got}, this package expects ${expected}` +
        (url !== undefined ? ` (${url})` : '') +
        '. Use the matching engine.wasm, or upgrade @aels/wasm-runtime-host.',
    )
  }
}

/** The engine refused to boot the given image pair. */
export class BootRefusedError extends LoupeError {
  constructor() {
    super('The engine refused this image pair: kernel.bin header invalid or oversized.')
  }
}

/** The guest stopped while running (DecodeError/Unsupported/Fault, or a stalled boot). */
export class GuestStoppedError extends LoupeError {
  constructor(
    readonly kind: string,
    readonly code: number,
    readonly rip: number,
  ) {
    super(`Guest stopped: ${kind}, code=0x${code.toString(16)}, rip=0x${rip.toString(16)}.`)
  }
}

/** The bytes are not a loupe snapshot container (bad magic or truncated). */
export class SnapshotFormatError extends LoupeError {
  constructor(detail: string) {
    super(`Not a loupe snapshot: ${detail}.`)
  }
}

/** The snapshot was taken by a different engine or snapshot format. */
export class SnapshotMismatchError extends LoupeError {
  /** First mismatching field of (engine, engineVersion, snapshotFormat). */
  constructor(readonly reason: string) {
    super(`Snapshot does not match this engine: ${reason}.`)
  }
}
