/**
 * Source abstractions for audio input
 */

import type { Source, BufferSource, FileSource, UrlSource, StreamSource } from './types'

/**
 * Create a source from various input types
 */
export function createSource(input: string | Uint8Array | ArrayBuffer | Source): Source {
  if (typeof input === 'string') {
    if (input.startsWith('http://') || input.startsWith('https://')) {
      return { type: 'url', url: input }
    }
    return { type: 'file', path: input }
  }

  if (input instanceof Uint8Array) {
    return { type: 'buffer', data: input }
  }

  if (input instanceof ArrayBuffer) {
    return { type: 'buffer', data: input }
  }

  return input
}

/**
 * Create a buffer source
 */
export function bufferSource(data: Uint8Array | ArrayBuffer): BufferSource {
  return { type: 'buffer', data }
}

/**
 * Create a file source
 */
export function fileSource(path: string): FileSource {
  return { type: 'file', path }
}

/**
 * Create a URL source
 */
export function urlSource(url: string, headers?: Record<string, string>): UrlSource {
  return { type: 'url', url, headers }
}

/**
 * Create a stream source
 */
export function streamSource(stream: ReadableStream<Uint8Array>): StreamSource {
  return { type: 'stream', stream }
}

/**
 * Check if a source supports random access (seeking)
 */
export function supportsSeek(source: Source): boolean {
  return source.type !== 'stream'
}

/**
 * Get the size of a source if available
 */
export async function getSourceSize(source: Source): Promise<number | null> {
  if (source.type === 'buffer') {
    const data = source.data
    return data instanceof ArrayBuffer ? data.byteLength : data.length
  }

  if (source.type === 'file') {
    const Bun = globalThis.Bun
    if (Bun) {
      const file = Bun.file(source.path)
      return file.size
    } else {
      const fs = await import('node:fs/promises')
      const stat = await fs.stat(source.path)
      return stat.size
    }
  }

  if (source.type === 'url') {
    try {
      const response = await fetch(source.url, {
        method: 'HEAD',
        headers: source.headers,
      })
      const contentLength = response.headers.get('content-length')
      return contentLength ? Number.parseInt(contentLength, 10) : null
    } catch {
      return null
    }
  }

  return null
}

/**
 * Read entire source into a buffer
 */
export async function readSourceBuffer(source: Source): Promise<Uint8Array> {
  if (source.type === 'buffer') {
    const data = source.data
    return data instanceof ArrayBuffer ? new Uint8Array(data) : data
  }

  if (source.type === 'file') {
    const Bun = globalThis.Bun
    if (Bun) {
      const file = Bun.file(source.path)
      const buffer = await file.arrayBuffer()
      return new Uint8Array(buffer)
    } else {
      const fs = await import('node:fs/promises')
      const buffer = await fs.readFile(source.path)
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    }
  }

  if (source.type === 'url') {
    const response = await fetch(source.url, { headers: source.headers })
    const buffer = await response.arrayBuffer()
    return new Uint8Array(buffer)
  }

  if (source.type === 'stream') {
    const chunks: Uint8Array[] = []
    const reader = source.stream.getReader()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    return result
  }

  throw new Error('Unknown source type')
}

/**
 * Create a readable stream from a source
 */
export function createReadStream(source: Source): ReadableStream<Uint8Array> {
  if (source.type === 'stream') {
    return source.stream
  }

  return new ReadableStream({
    async start(controller) {
      try {
        const data = await readSourceBuffer(source)
        controller.enqueue(data)
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}
