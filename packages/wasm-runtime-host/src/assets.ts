/**
 * Asset loading with a cache backend.
 *
 * Images ship by URL and never enter the repo; the disk image is large, so
 * repeat loads come from a local cache (OPFS in the browser) instead of
 * the network. The backend is injectable: OPFS for pages, an in-memory
 * map for tests. Cache writes are best effort — a failed write degrades
 * to network-only, never to a failed load.
 */
import { fetchWithProgress } from './http'

/** Stored alongside the bytes; the URL check turns hash collisions into misses. */
export interface AssetMeta {
  url: string
  byteLength: number
  contentType: string
  storedAt: number
}

/** Keyed byte store; implementations must treat reads and writes atomically per key. */
export interface CacheBackend {
  read(key: string): Promise<{ bytes: Uint8Array; meta: AssetMeta } | null>
  write(key: string, bytes: Uint8Array, meta: AssetMeta): Promise<void>
  remove(key: string): Promise<void>
}

/** In-memory backend; one map per instance, used by tests and cache-less hosts. */
export class MemoryCacheBackend implements CacheBackend {
  private readonly entries = new Map<string, { bytes: Uint8Array; meta: AssetMeta }>()

  async read(key: string) {
    return this.entries.get(key) ?? null
  }

  async write(key: string, bytes: Uint8Array, meta: AssetMeta): Promise<void> {
    this.entries.set(key, { bytes, meta })
  }

  async remove(key: string): Promise<void> {
    this.entries.delete(key)
  }
}

/** FNV-1a over the URL; collision risk is handled by the meta URL check. */
export function cacheKey(url: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < url.length; i += 1) {
    hash ^= url.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `asset-${(hash >>> 0).toString(16)}`
}

interface NavigatorStorage {
  getDirectory(): Promise<FileSystemDirectoryHandle>
}

/**
 * OPFS backend. Each asset is one binary file plus a JSON sidecar with the
 * meta; a missing or unreadable sidecar counts as a miss.
 */
export class OpfsCacheBackend implements CacheBackend {
  private root: Promise<FileSystemDirectoryHandle> | null = null

  constructor(private readonly storage?: NavigatorStorage) {}

  private directory(): Promise<FileSystemDirectoryHandle> {
    this.root ??= new Promise((resolve, reject) => {
      const source = this.storage
        ?? (navigator as unknown as { storage?: NavigatorStorage }).storage
      if (source === undefined) {
        reject(new Error('OPFS is unavailable in this environment.'))
        return
      }
      resolve(source.getDirectory())
    })
    return this.root
  }

  async read(key: string) {
    try {
      const dir = await this.directory()
      const metaFile = await dir.getFileHandle(`${key}.meta`)
      const dataFile = await dir.getFileHandle(key)
      const meta = JSON.parse(
        new TextDecoder().decode(await (await metaFile.getFile()).arrayBuffer()),
      ) as AssetMeta
      const bytes = new Uint8Array(await (await dataFile.getFile()).arrayBuffer())
      return { bytes, meta }
    } catch {
      return null
    }
  }

  async write(key: string, bytes: Uint8Array, meta: AssetMeta): Promise<void> {
    const dir = await this.directory()
    const metaWritable = await dir.getFileHandle(`${key}.meta`, { create: true })
      .then(handle => handle.createWritable())
    await metaWritable.write(new TextEncoder().encode(JSON.stringify(meta)))
    await metaWritable.close()
    const dataWritable = await dir.getFileHandle(key, { create: true })
      .then(handle => handle.createWritable())
    await dataWritable.write(bytes as unknown as FileSystemWriteChunkType)
    await dataWritable.close()
  }

  async remove(key: string): Promise<void> {
    const dir = await this.directory()
    await dir.removeEntry(`${key}.meta`).catch(() => undefined)
    await dir.removeEntry(key).catch(() => undefined)
  }
}

export interface LoadAssetOptions {
  /** Cache backend; a read/write failure degrades to network-only. */
  backend?: CacheBackend
  /** Fetch implementation for tests. */
  fetchImpl?: typeof fetch
  /** Download progress callback (network path only). */
  onProgress?: (loaded: number, total: number) => void
}

/** Load an asset by URL, serving repeat loads from the cache when it matches. */
export async function loadAsset(
  url: string,
  options: LoadAssetOptions = {},
): Promise<{ bytes: Uint8Array; fromCache: boolean; contentType: string }> {
  const key = cacheKey(url)
  const backend = options.backend
  if (backend !== undefined) {
    const hit = await backend.read(key).catch(() => null)
    if (hit !== null && hit.meta.url === url && hit.meta.byteLength === hit.bytes.byteLength) {
      return { bytes: hit.bytes, fromCache: true, contentType: hit.meta.contentType }
    }
  }
  const response = options.fetchImpl ?? fetch
  const { buffer, contentType } = await fetchWithProgress(url, {
    onProgress: options.onProgress,
    fetchImpl: response,
  })
  const bytes = new Uint8Array(buffer)
  if (backend !== undefined) {
    const meta: AssetMeta = {
      url,
      byteLength: bytes.byteLength,
      contentType,
      storedAt: Date.now(),
    }
    await backend.write(key, bytes, meta).catch(() => undefined)
  }
  return { bytes, fromCache: false, contentType }
}
