/**
 * Binary writer utilities for audio file creation
 */

import type { Target } from './types'

/**
 * Writer provides binary writing utilities with buffering
 */
export class Writer {
  private buffers: Uint8Array[] = []
  private target: Target
  private _position = 0
  private fileHandle: unknown = null
  private streamWriter: WritableStreamDefaultWriter<Uint8Array> | null = null

  constructor(target: Target) {
    this.target = target
  }

  static fromTarget(target: Target): Writer {
    return new Writer(target)
  }

  static toBuffer(): Writer {
    return new Writer({ type: 'buffer' })
  }

  static toFile(path: string): Writer {
    return new Writer({ type: 'file', path })
  }

  static toStream(stream: WritableStream<Uint8Array>): Writer {
    return new Writer({ type: 'stream', stream })
  }

  get position(): number {
    return this._position
  }

  async init(): Promise<void> {
    if (this.target.type === 'file') {
      const Bun = globalThis.Bun
      if (Bun) {
        // Will write all at once on close
      } else {
        const fs = await import('node:fs/promises')
        this.fileHandle = await fs.open(this.target.path, 'w')
      }
    } else if (this.target.type === 'stream') {
      this.streamWriter = this.target.stream.getWriter()
    }
  }

  async writeBytes(data: Uint8Array): Promise<void> {
    if (this.target.type === 'stream' && this.streamWriter) {
      await this.streamWriter.write(data)
    } else {
      this.buffers.push(data.slice())
    }
    this._position += data.length
  }

  async writeU8(value: number): Promise<void> {
    await this.writeBytes(new Uint8Array([value & 0xFF]))
  }

  async writeU16BE(value: number): Promise<void> {
    await this.writeBytes(new Uint8Array([
      (value >> 8) & 0xFF,
      value & 0xFF,
    ]))
  }

  async writeU16LE(value: number): Promise<void> {
    await this.writeBytes(new Uint8Array([
      value & 0xFF,
      (value >> 8) & 0xFF,
    ]))
  }

  async writeU24BE(value: number): Promise<void> {
    await this.writeBytes(new Uint8Array([
      (value >> 16) & 0xFF,
      (value >> 8) & 0xFF,
      value & 0xFF,
    ]))
  }

  async writeU24LE(value: number): Promise<void> {
    await this.writeBytes(new Uint8Array([
      value & 0xFF,
      (value >> 8) & 0xFF,
      (value >> 16) & 0xFF,
    ]))
  }

  async writeU32BE(value: number): Promise<void> {
    const bytes = new Uint8Array(4)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, value, false)
    await this.writeBytes(bytes)
  }

  async writeU32LE(value: number): Promise<void> {
    const bytes = new Uint8Array(4)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, value, true)
    await this.writeBytes(bytes)
  }

  async writeU64BE(value: bigint): Promise<void> {
    const bytes = new Uint8Array(8)
    const view = new DataView(bytes.buffer)
    view.setBigUint64(0, value, false)
    await this.writeBytes(bytes)
  }

  async writeU64LE(value: bigint): Promise<void> {
    const bytes = new Uint8Array(8)
    const view = new DataView(bytes.buffer)
    view.setBigUint64(0, value, true)
    await this.writeBytes(bytes)
  }

  async writeI16BE(value: number): Promise<void> {
    const bytes = new Uint8Array(2)
    const view = new DataView(bytes.buffer)
    view.setInt16(0, value, false)
    await this.writeBytes(bytes)
  }

  async writeI16LE(value: number): Promise<void> {
    const bytes = new Uint8Array(2)
    const view = new DataView(bytes.buffer)
    view.setInt16(0, value, true)
    await this.writeBytes(bytes)
  }

  async writeI32BE(value: number): Promise<void> {
    const bytes = new Uint8Array(4)
    const view = new DataView(bytes.buffer)
    view.setInt32(0, value, false)
    await this.writeBytes(bytes)
  }

  async writeI32LE(value: number): Promise<void> {
    const bytes = new Uint8Array(4)
    const view = new DataView(bytes.buffer)
    view.setInt32(0, value, true)
    await this.writeBytes(bytes)
  }

  async writeI64BE(value: bigint): Promise<void> {
    const bytes = new Uint8Array(8)
    const view = new DataView(bytes.buffer)
    view.setBigInt64(0, value, false)
    await this.writeBytes(bytes)
  }

  async writeI64LE(value: bigint): Promise<void> {
    const bytes = new Uint8Array(8)
    const view = new DataView(bytes.buffer)
    view.setBigInt64(0, value, true)
    await this.writeBytes(bytes)
  }

  async writeF32BE(value: number): Promise<void> {
    const bytes = new Uint8Array(4)
    const view = new DataView(bytes.buffer)
    view.setFloat32(0, value, false)
    await this.writeBytes(bytes)
  }

  async writeF32LE(value: number): Promise<void> {
    const bytes = new Uint8Array(4)
    const view = new DataView(bytes.buffer)
    view.setFloat32(0, value, true)
    await this.writeBytes(bytes)
  }

  async writeF64BE(value: number): Promise<void> {
    const bytes = new Uint8Array(8)
    const view = new DataView(bytes.buffer)
    view.setFloat64(0, value, false)
    await this.writeBytes(bytes)
  }

  async writeF64LE(value: number): Promise<void> {
    const bytes = new Uint8Array(8)
    const view = new DataView(bytes.buffer)
    view.setFloat64(0, value, true)
    await this.writeBytes(bytes)
  }

  async writeString(value: string, encoding: 'utf-8' | 'ascii' | 'latin1' = 'utf-8'): Promise<void> {
    const encoder = new TextEncoder()
    const bytes = encoder.encode(value)
    await this.writeBytes(bytes)
  }

  async writeCString(value: string): Promise<void> {
    await this.writeString(value)
    await this.writeU8(0)
  }

  async writeFourCC(value: string): Promise<void> {
    const bytes = new Uint8Array(4)
    for (let i = 0; i < 4; i++) {
      bytes[i] = i < value.length ? value.charCodeAt(i) : 0x20
    }
    await this.writeBytes(bytes)
  }

  async writeSyncsafeInt(value: number): Promise<void> {
    await this.writeBytes(new Uint8Array([
      (value >> 21) & 0x7F,
      (value >> 14) & 0x7F,
      (value >> 7) & 0x7F,
      value & 0x7F,
    ]))
  }

  async writePadding(length: number, value = 0): Promise<void> {
    const bytes = new Uint8Array(length)
    bytes.fill(value)
    await this.writeBytes(bytes)
  }

  async getBuffer(): Promise<Uint8Array> {
    const totalLength = this.buffers.reduce((sum, buf) => sum + buf.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const buf of this.buffers) {
      result.set(buf, offset)
      offset += buf.length
    }
    return result
  }

  async close(): Promise<Uint8Array> {
    if (this.target.type === 'file') {
      const data = await this.getBuffer()
      const Bun = globalThis.Bun
      if (Bun) {
        await Bun.write(this.target.path, data)
      } else if (this.fileHandle) {
        const handle = this.fileHandle as { write: (data: Uint8Array) => Promise<unknown>, close: () => Promise<void> }
        await handle.write(data)
        await handle.close()
      }
      return data
    } else if (this.target.type === 'stream' && this.streamWriter) {
      await this.streamWriter.close()
      return new Uint8Array(0)
    }

    return this.getBuffer()
  }
}

/**
 * Create a writer from a target
 */
export function createWriter(target: Target | string): Writer {
  if (typeof target === 'string') {
    return Writer.toFile(target)
  }
  return Writer.fromTarget(target)
}

/**
 * BufferTarget for in-memory output
 */
export const BufferTarget: Target = { type: 'buffer' }
