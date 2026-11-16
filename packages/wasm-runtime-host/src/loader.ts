/**
 * Engine loader: turns an engine.wasm URL (or pre-fetched bytes) into a
 * validated `EngineExports`.
 *
 * Organising URLs per engine version is the caller's job; this module only
 * requires one of `url`/`bytes` and reports download progress. The ABI
 * version is checked right after the reactor constructors run.
 */
import { REACTOR_IMPORTS, EXPECTED_ABI_VERSION, type EngineExports } from './abi'
import { fetchWithProgress } from './http'
import { AbiMismatchError } from './errors'

export interface EngineLoadOptions {
  /** URL of the engine artifact. Required unless `bytes` is given. */
  url?: string
  /** Pre-fetched module bytes; node tests use this to bypass fetch. */
  bytes?: ArrayBuffer
  /** Download progress callback (fetch path only). */
  onProgress?: (loaded: number, total: number) => void
  /** Override the expected ABI version (default `EXPECTED_ABI_VERSION`). */
  expectedAbiVersion?: number
  /** Fetch implementation for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
}

/** Load the engine artifact, run the reactor constructors, and check the ABI version. */
export async function loadEngine(options: EngineLoadOptions = {}): Promise<EngineExports> {
  let buffer: ArrayBuffer
  let url: string | undefined
  if (options.bytes !== undefined) {
    buffer = options.bytes
  } else {
    if (options.url === undefined) {
      throw new Error('loadEngine needs either url or bytes.')
    }
    url = options.url
    const fetched = await fetchWithProgress(url, {
      onProgress: options.onProgress,
      fetchImpl: options.fetchImpl,
    })
    buffer = fetched.buffer
  }
  const { instance } = await WebAssembly.instantiate(buffer, REACTOR_IMPORTS)
  const exports = instance.exports as unknown as EngineExports
  // Reactor contract: the static constructors (Machine singleton) run here.
  exports._initialize()
  const expected = options.expectedAbiVersion ?? EXPECTED_ABI_VERSION
  const got = exports.mf_abi_version()
  if (got !== expected) {
    throw new AbiMismatchError(got, expected, url)
  }
  return exports
}
