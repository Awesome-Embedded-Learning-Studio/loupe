import { describe, expect, it } from 'vitest'
import {
  cacheKey,
  loadAsset,
  MemoryCacheBackend,
  type AssetMeta,
} from '../src/assets'
import { fetchWithProgress } from '../src/http'

function streamResponse(chunks: number[], length: string): Response {
  const encoder = new TextEncoder()
  const queue = chunks.map(n => encoder.encode(String(n)))
  let done = false
  const body = {
    getReader: () => ({
      read: async () => {
        if (queue.length > 0) return { done: false, value: queue.shift() }
        if (!done) {
          done = true
          return { done: true, value: undefined }
        }
        return { done: true, value: undefined }
      },
    }),
  }
  return {
    ok: true,
    body,
    headers: { get: (name: string) => (name === 'content-length' ? length : null) },
  } as unknown as Response
}

describe('fetchWithProgress', () => {
  it('streams chunks and reports progress', async () => {
    const seen: Array<[number, number]> = []
    const fetched = await fetchWithProgress('https://example/big', {
      fetchImpl: (async () => streamResponse([1, 2, 3, 4], '4')) as unknown as typeof fetch,
      onProgress: (loaded, total) => seen.push([loaded, total]),
    })
    expect(new TextDecoder().decode(fetched.buffer)).toBe('1234')
    expect(seen).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]])
  })

  it('rejects on a non-2xx status', async () => {
    const response = { ok: false, status: 404, headers: { get: () => null } } as unknown as Response
    await expect(
      fetchWithProgress('https://example/missing', {
        fetchImpl: (async () => response) as unknown as typeof fetch,
      }),
    ).rejects.toThrow('HTTP 404')
  })
})

describe('loadAsset with a cache backend', () => {
  const payload = new Uint8Array([9, 8, 7, 6])

  function countingFetch(counter: { calls: number }): typeof fetch {
    return (async () => {
      counter.calls += 1
      return new Response(payload.slice().buffer, {
        headers: { 'content-type': 'application/octet-stream' },
      })
    }) as unknown as typeof fetch
  }

  it('downloads once and serves the second load from the cache', async () => {
    const backend = new MemoryCacheBackend()
    const counter = { calls: 0 }
    const fetchImpl = countingFetch(counter)
    const first = await loadAsset('https://example/disk.img', { backend, fetchImpl })
    expect(first.fromCache).toBe(false)
    expect([...first.bytes]).toEqual([9, 8, 7, 6])
    const second = await loadAsset('https://example/disk.img', { backend, fetchImpl })
    expect(second.fromCache).toBe(true)
    expect([...second.bytes]).toEqual([9, 8, 7, 6])
    expect(counter.calls).toBe(1)
  })

  it('treats a corrupted cache entry as a miss and re-downloads', async () => {
    const backend = new MemoryCacheBackend()
    const counter = { calls: 0 }
    const fetchImpl = countingFetch(counter)
    await loadAsset('https://example/disk.img', { backend, fetchImpl })
    const key = cacheKey('https://example/disk.img')
    const stale = await backend.read(key)
    const broken: AssetMeta = { ...stale!.meta, byteLength: stale!.meta.byteLength + 1 }
    await backend.write(key, stale!.bytes, broken)
    const again = await loadAsset('https://example/disk.img', { backend, fetchImpl })
    expect(again.fromCache).toBe(false)
    expect(counter.calls).toBe(2)
  })

  it('re-downloads after the entry is removed', async () => {
    const backend = new MemoryCacheBackend()
    const counter = { calls: 0 }
    const fetchImpl = countingFetch(counter)
    await loadAsset('https://example/kernel.bin', { backend, fetchImpl })
    await backend.remove(cacheKey('https://example/kernel.bin'))
    const again = await loadAsset('https://example/kernel.bin', { backend, fetchImpl })
    expect(again.fromCache).toBe(false)
    expect(counter.calls).toBe(2)
  })
})
