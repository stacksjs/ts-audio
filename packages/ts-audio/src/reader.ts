/**
 * Binary reader utilities for audio file parsing
 */

import type { Source } from './types'

/**
 * FileSlice represents a cached portion of a file for efficient reading
 */
export class FileSlice {
  constructor(
    public readonly bytes: Uint8Array,
    public readonly offset: number,
  ) {}

  contains(pos: number, length: number): boolean {
    return pos >= this.offset && pos + length <= this.offset + this.bytes.length
  }

  get(pos: number, length: number): Uint8Array {
    const start = pos - this.offset
    return this.bytes.subarray(start, start + length)
  }
}

/**
 * Reader provides binary reading utilities with caching and seeking
 */
export class Reader {
  private _position = 0
  private slice: FileSlice | null = null
  private source: Source
  private sourceData: Uint8Array | null = null
  private fileHandle: unknown = null
  private fileSize: number | null = null

  static readonly DEFAULT_SLICE_SIZE = 64 * 1024 // 64KB

  constructor(source: Source) {
    this.source = source
  }

  static fromSource(source: Source): Reader {
    return new Reader(source)
  }

  static fromBuffer(data: Uint8Array | ArrayBuffer): Reader {
    return new Reader({ type: 'buffer', data })
  }

  static fromFile(path: string): Reader {
    return new Reader({ type: 'file', path })
  }

  static fromUrl(url: string, headers?: Record<string, string>): Reader {
    return new Reader({ type: 'url', url, headers })
  }

  get position(): number {
    return this._position
  }

  set position(value: number) {
    this._position = value
  }

  async init(): Promise<void> {
    if (this.source.type === 'buffer') {
      const data = this.source.data
      this.sourceData = data instanceof ArrayBuffer ? new Uint8Array(data) : data
      this.fileSize = this.sourceData.length
    } else if (this.source.type === 'file') {
      const Bun = globalThis.Bun
      if (Bun) {
        const file = Bun.file(this.source.path)
        this.fileHandle = file
        this.fileSize = file.size
      } else {
        const fs = await import('node:fs/promises')
        const stat = await fs.stat(this.source.path)
        this.fileSize = stat.size
      }
    } else if (this.source.type === 'url') {
      const response = await fetch(this.source.url, {
        method: 'HEAD',
        headers: this.source.headers,
      })
      const contentLength = response.headers.get('content-length')
      this.fileSize = contentLength ? Number.parseInt(contentLength, 10) : null
    }
  }

  async getSize(): Promise<number | null> {
    if (this.fileSize === null) {
      await this.init()
    }
    return this.fileSize
  }

  async readBytes(length: number): Promise<Uint8Array | null> {
    if (this.slice?.contains(this._position, length)) {
      const result = this.slice.get(this._position, length)
      this._position += length
      return result
    }

    await this.loadSlice(this._position, Math.max(length, Reader.DEFAULT_SLICE_SIZE))

    if (!this.slice?.contains(this._position, length)) {
      return null
    }

    const result = this.slice.get(this._position, length)
    this._position += length
    return result
  }

  async peek(length: number): Promise<Uint8Array | null> {
    const pos = this._position
    const result = await this.readBytes(length)
    this._position = pos
    return result
  }

  private async loadSlice(offset: number, length: number): Promise<void> {
    let bytes: Uint8Array

    if (this.source.type === 'buffer') {
      if (!this.sourceData) await this.init()
      const end = Math.min(offset + length, this.sourceData!.length)
      bytes = this.sourceData!.subarray(offset, end)
    } else if (this.source.type === 'file') {
      const Bun = globalThis.Bun
      if (Bun && this.fileHandle) {
        const file = this.fileHandle as { slice: (start: number, end: number) => { arrayBuffer: () => Promise<ArrayBuffer> } }
        const slice = file.slice(offset, offset + length)
        const buffer = await slice.arrayBuffer()
        bytes = new Uint8Array(buffer)
      } else {
        const fs = await import('node:fs/promises')
        const handle = await fs.open(this.source.path, 'r')
        const buffer = Buffer.alloc(length)
        const { bytesRead } = await handle.read(buffer, 0, length, offset)
        await handle.close()
        bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead)
      }
    } else if (this.source.type === 'url') {
      const response = await fetch(this.source.url, {
        headers: {
          ...this.source.headers,
          Range: `bytes=${offset}-${offset + length - 1}`,
        },
      })
      const buffer = await response.arrayBuffer()
      bytes = new Uint8Array(buffer)
    } else if (this.source.type === 'stream') {
      throw new Error('Stream source does not support random access')
    } else {
      throw new Error('Unknown source type')
    }

    this.slice = new FileSlice(bytes, offset)
  }

  async readU8(): Promise<number | null> {
    const bytes = await this.readBytes(1)
    return bytes ? bytes[0] : null
  }

  async readU16BE(): Promise<number | null> {
    const bytes = await this.readBytes(2)
    if (!bytes) return null
    return (bytes[0] << 8) | bytes[1]
  }

  async readU16LE(): Promise<number | null> {
    const bytes = await this.readBytes(2)
    if (!bytes) return null
    return bytes[0] | (bytes[1] << 8)
  }

  async readU24BE(): Promise<number | null> {
    const bytes = await this.readBytes(3)
    if (!bytes) return null
    return (bytes[0] << 16) | (bytes[1] << 8) | bytes[2]
  }

  async readU24LE(): Promise<number | null> {
    const bytes = await this.readBytes(3)
    if (!bytes) return null
    return bytes[0] | (bytes[1] << 8) | (bytes[2] << 16)
  }

  async readU32BE(): Promise<number | null> {
    const bytes = await this.readBytes(4)
    if (!bytes) return null
    return ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
  }

  async readU32LE(): Promise<number | null> {
    const bytes = await this.readBytes(4)
    if (!bytes) return null
    return (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0
  }

  async readU64BE(): Promise<bigint | null> {
    const bytes = await this.readBytes(8)
    if (!bytes) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, 8)
    return view.getBigUint64(0, false)
  }

  async readU64LE(): Promise<bigint | null> {
    const bytes = await this.readBytes(8)
    if (!bytes) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, 8)
    return view.getBigUint64(0, true)
  }

  async readI16BE(): Promise<number | null> {
    const bytes = await this.readBytes(2)
    if (!bytes) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, 2)
    return view.getInt16(0, false)
  }

  async readI16LE(): Promise<number | null> {
    const bytes = await this.readBytes(2)
    if (!bytes) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, 2)
    return view.getInt16(0, true)
  }

  async readI32BE(): Promise<number | null> {
    const bytes = await this.readBytes(4)
    if (!bytes) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, 4)
    return view.getInt32(0, false)
  }

  async readI32LE(): Promise<number | null> {
    const bytes = await this.readBytes(4)
    if (!bytes) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, 4)
    return view.getInt32(0, true)
  }

  async readI64BE(): Promise<bigint | null> {
    const bytes = await this.readBytes(8)
    if (!bytes) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, 8)
    return view.getBigInt64(0, false)
  }

  async readI64LE(): Promise<bigint | null> {
    const bytes = await this.readBytes(8)
    if (!bytes) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, 8)
    return view.getBigInt64(0, true)
  }

  async readF32BE(): Promise<number | null> {
    const bytes = await this.readBytes(4)
    if (!bytes) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, 4)
    return view.getFloat32(0, false)
  }

  async readF32LE(): Promise<number | null> {
    const bytes = await this.readBytes(4)
    if (!bytes) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, 4)
    return view.getFloat32(0, true)
  }

  async readF64BE(): Promise<number | null> {
    const bytes = await this.readBytes(8)
    if (!bytes) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, 8)
    return view.getFloat64(0, false)
  }

  async readF64LE(): Promise<number | null> {
    const bytes = await this.readBytes(8)
    if (!bytes) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, 8)
    return view.getFloat64(0, true)
  }

  async readString(length: number, encoding: 'utf-8' | 'ascii' | 'latin1' = 'utf-8'): Promise<string | null> {
    const bytes = await this.readBytes(length)
    if (!bytes) return null
    const decoder = new TextDecoder(encoding)
    return decoder.decode(bytes)
  }

  async readCString(maxLength = 256): Promise<string | null> {
    const bytes: number[] = []
    for (let i = 0; i < maxLength; i++) {
      const byte = await this.readU8()
      if (byte === null) return null
      if (byte === 0) break
      bytes.push(byte)
    }
    return new TextDecoder().decode(new Uint8Array(bytes))
  }

  async readFourCC(): Promise<string | null> {
    const bytes = await this.readBytes(4)
    if (!bytes) return null
    return String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  }

  async readSyncsafeInt(): Promise<number | null> {
    const bytes = await this.readBytes(4)
    if (!bytes) return null
    return ((bytes[0] & 0x7F) << 21) |
           ((bytes[1] & 0x7F) << 14) |
           ((bytes[2] & 0x7F) << 7) |
           (bytes[3] & 0x7F)
  }

  async skip(length: number): Promise<void> {
    this._position += length
  }

  async seek(position: number): Promise<void> {
    this._position = position
  }

  async isEOF(): Promise<boolean> {
    const size = await this.getSize()
    return size !== null && this._position >= size
  }

  async remaining(): Promise<number | null> {
    const size = await this.getSize()
    return size !== null ? size - this._position : null
  }

  async close(): Promise<void> {
    this.slice = null
    this.sourceData = null
    this.fileHandle = null
  }
}

/**
 * Create a reader from a source
 */
export function createReader(source: Source | string | Uint8Array | ArrayBuffer): Reader {
  if (typeof source === 'string') {
    if (source.startsWith('http://') || source.startsWith('https://')) {
      return Reader.fromUrl(source)
    }
    return Reader.fromFile(source)
  }

  if (source instanceof Uint8Array || source instanceof ArrayBuffer) {
    return Reader.fromBuffer(source)
  }

  return Reader.fromSource(source)
}
