/**
 * Snapshot container: a self-describing wrapper around the engine's
 * snapshot blob.
 *
 * Layout: 4-byte magic `LPSN`, u32 little-endian header length, a JSON
 * header, then the raw engine blob. The header pins the version triple
 * (engine name, engine version, snapshot format), so a restore can
 * refuse snapshots this engine cannot replay instead of corrupting guest
 * state.
 */
import { SnapshotFormatError } from './errors'

/** Leading magic of every loupe snapshot container. */
const MAGIC = [0x4c, 0x50, 0x53, 0x4e] // "LPSN"

/** Version of the container layout itself (not the engine snapshot format). */
const CONTAINER_VERSION = 1

/** Engine artifact name snapshots are pinned to. */
export const SNAPSHOT_ENGINE_NAME = 'micro-forge'

/** Identity triple a restore checks against the running engine. */
export interface SnapshotHeader {
  engine: string
  engineVersion: string
  snapshotFormat: number
  /** Guest RAM bytes at save time. */
  ramSize: number
  savedAt: string
}

/** A parsed container; `blob` is a view into `bytes`, not a copy. */
export interface ParsedSnapshot {
  header: SnapshotHeader
  blob: Uint8Array
}

/** Serialize a header and blob into a container. */
export function encodeSnapshot(header: SnapshotHeader, blob: Uint8Array): Uint8Array {
  const headerJson = new TextEncoder().encode(
    JSON.stringify({ ...header, containerVersion: CONTAINER_VERSION }),
  )
  const total = MAGIC.length + 4 + headerJson.length + blob.length
  const out = new Uint8Array(total)
  out.set(MAGIC, 0)
  new DataView(out.buffer).setUint32(4, headerJson.length, true)
  out.set(headerJson, 8)
  out.set(blob, 8 + headerJson.length)
  return out
}

/** Parse a container; throws SnapshotFormatError on anything malformed. */
export function parseSnapshot(bytes: Uint8Array): ParsedSnapshot {
  if (bytes.length < 8 || !MAGIC.every((b, i) => bytes[i] === b)) {
    throw new SnapshotFormatError('bad magic')
  }
  const headerLen = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .getUint32(4, true)
  const bodyStart = 8 + headerLen
  if (headerLen === 0 || bodyStart > bytes.length) {
    throw new SnapshotFormatError('header length out of range')
  }
  let header: SnapshotHeader
  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(bytes.subarray(8, bodyStart)),
    ) as SnapshotHeader & { containerVersion?: number }
    if (parsed.containerVersion !== CONTAINER_VERSION) {
      throw new SnapshotFormatError(
        `container version ${String(parsed.containerVersion)} vs ${CONTAINER_VERSION}`,
      )
    }
    const { containerVersion: _ignored, ...rest } = parsed
    header = rest
  } catch (error) {
    if (error instanceof SnapshotFormatError) throw error
    throw new SnapshotFormatError('header is not valid JSON')
  }
  if (
    typeof header.engine !== 'string' ||
    typeof header.engineVersion !== 'string' ||
    typeof header.snapshotFormat !== 'number' ||
    typeof header.ramSize !== 'number'
  ) {
    throw new SnapshotFormatError('header fields missing')
  }
  return { header, blob: bytes.subarray(bodyStart) }
}

/**
 * Compare a parsed header with the running engine's triple; null when
 * compatible, otherwise the first failing field.
 */
export function snapshotMismatch(
  header: SnapshotHeader,
  current: { engine: string; engineVersion: string; snapshotFormat: number },
): string | null {
  if (header.engine !== current.engine) {
    return `engine ${header.engine} vs ${current.engine}`
  }
  if (header.engineVersion !== current.engineVersion) {
    return `engineVersion ${header.engineVersion} vs ${current.engineVersion}`
  }
  if (header.snapshotFormat !== current.snapshotFormat) {
    return `snapshotFormat ${header.snapshotFormat} vs ${current.snapshotFormat}`
  }
  return null
}
