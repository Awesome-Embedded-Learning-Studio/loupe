/**
 * Fetch with progress reporting.
 *
 * Streams the body when the server advertises a content length, reporting
 * bytes as they arrive; falls back to a single arrayBuffer read otherwise.
 * The fetch implementation is injectable for tests.
 */

export interface FetchWithProgressOptions {
  /** Progress callback (streamed path only). */
  onProgress?: (loaded: number, total: number) => void
  /** Fetch implementation; defaults to the global fetch. */
  fetchImpl?: typeof fetch
}

/** Fetched bytes plus the response content type ('' when absent). */
export interface FetchedBytes {
  buffer: ArrayBuffer
  contentType: string
}

/** Fetch `url` and report download progress when the length is known. */
export async function fetchWithProgress(
  url: string,
  options: FetchWithProgressOptions = {},
): Promise<FetchedBytes> {
  const doFetch = options.fetchImpl ?? fetch
  const response = await doFetch(url)
  if (!response.ok) {
    throw new Error(`fetch ${url}: HTTP ${response.status}.`)
  }
  const contentType = response.headers.get('content-type') ?? ''
  const total = Number(response.headers.get('content-length') ?? '0')
  if (options.onProgress === undefined || response.body === null || total <= 0) {
    return { buffer: await response.arrayBuffer(), contentType }
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    options.onProgress(loaded, total)
  }
  const merged = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { buffer: merged.buffer, contentType }
}
