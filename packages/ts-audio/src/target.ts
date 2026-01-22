/**
 * Target abstractions for audio output
 */

import type { Target, BufferTarget, FileTarget, StreamTarget } from './types'

/**
 * Create a target from various output types
 */
export function createTarget(output: string | Target): Target {
  if (typeof output === 'string') {
    return { type: 'file', path: output }
  }
  return output
}

/**
 * Create a buffer target
 */
export function bufferTarget(): BufferTarget {
  return { type: 'buffer' }
}

/**
 * Create a file target
 */
export function fileTarget(path: string): FileTarget {
  return { type: 'file', path }
}

/**
 * Create a stream target
 */
export function streamTarget(stream: WritableStream<Uint8Array>): StreamTarget {
  return { type: 'stream', stream }
}

/**
 * Write data to a target
 */
export async function writeToTarget(target: Target, data: Uint8Array): Promise<void> {
  if (target.type === 'buffer') {
    // Buffer target just stores in memory, return the data
    return
  }

  if (target.type === 'file') {
    const Bun = globalThis.Bun
    if (Bun) {
      await Bun.write(target.path, data)
    } else {
      const fs = await import('node:fs/promises')
      await fs.writeFile(target.path, data)
    }
    return
  }

  if (target.type === 'stream') {
    const writer = target.stream.getWriter()
    await writer.write(data)
    await writer.close()
    return
  }

  throw new Error('Unknown target type')
}

/**
 * Create a writable stream from a target
 */
export function createWriteStream(target: Target): WritableStream<Uint8Array> {
  if (target.type === 'stream') {
    return target.stream
  }

  const chunks: Uint8Array[] = []

  return new WritableStream({
    write(chunk) {
      chunks.push(chunk)
    },
    async close() {
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const data = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        data.set(chunk, offset)
        offset += chunk.length
      }

      if (target.type === 'file') {
        await writeToTarget(target, data)
      }
    },
  })
}

/**
 * BufferTarget constant for convenience
 */
export const BufferTarget: BufferTarget = { type: 'buffer' }
