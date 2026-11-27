/**
 * High-level audio input API
 */

import type { Source, AudioTrack, EncodedPacket, AudioMetadata } from './types'
import { createSource } from './source'
import { defaultInputFormats } from './default-formats'
import { Demuxer, InputFormat } from './demuxer'

/**
 * Registered input formats
 */
const inputFormats: InputFormat[] = []

/**
 * Register an input format
 */
export function registerInputFormat(format: InputFormat): void {
  inputFormats.push(format)
}

/**
 * Get all registered input formats
 */
export function getInputFormats(): InputFormat[] {
  return [...inputFormats]
}

/**
 * Detect the format of a source
 */
export async function detectFormat(source: Source): Promise<InputFormat | null> {
  for (const format of inputFormats) {
    if (await format.canRead(source)) {
      return format
    }
  }
  // Nothing registered recognises it, so try the readers that ship with
  // ts-audio. Without this an `Input` given no format could only ever read
  // what the caller had registered by hand, which is why the CLI could not
  // open a file at all.
  for (const format of await defaultInputFormats()) {
    if (await format.canRead(source)) {
      return format
    }
  }
  return null
}

/**
 * Input options
 */
export interface InputOptions {
  source: Source | string | Uint8Array | ArrayBuffer
  format?: InputFormat
}

/**
 * High-level audio input class
 */
export class Input {
  private source: Source
  private demuxer: Demuxer | null = null
  private format: InputFormat | null = null
  private initialized = false
  private initPromise: Promise<void> | null = null

  constructor(options: InputOptions) {
    this.source = typeof options.source === 'string' ||
                  options.source instanceof Uint8Array ||
                  options.source instanceof ArrayBuffer
      ? createSource(options.source)
      : options.source
    this.format = options.format ?? null
  }

  /**
   * Initialize the input and detect format
   */
  private async ensureInit(): Promise<void> {
    // Memoised rather than guarded by a flag. Every accessor below awaits
    // this, so a caller doing `Promise.all([getTracks(), getDuration(), ...])`
    // starts several at once; a flag only set at the end let all of them past,
    // each building its own demuxer over the same source and racing to assign
    // it. That read as a file with no tracks and no duration.
    this.initPromise ??= this.initialize()
    return this.initPromise
  }

  private async initialize(): Promise<void> {
    if (!this.format) {
      this.format = await detectFormat(this.source)
      if (!this.format) {
        throw new Error('Could not detect audio format')
      }
    }

    const demuxer = this.format.createDemuxer(this.source)
    await demuxer.init()
    this.demuxer = demuxer
    this.initialized = true
  }

  /**
   * Get the format name
   */
  async getFormatName(): Promise<string> {
    await this.ensureInit()
    return this.demuxer!.formatName
  }

  /**
   * Get the MIME type
   */
  async getMimeType(): Promise<string> {
    await this.ensureInit()
    return this.demuxer!.mimeType
  }

  /**
   * Get all tracks
   */
  async getTracks(): Promise<AudioTrack[]> {
    await this.ensureInit()
    return this.demuxer!.tracks
  }

  /**
   * Get a specific track by ID
   */
  async getTrack(trackId: number): Promise<AudioTrack | undefined> {
    await this.ensureInit()
    return this.demuxer!.getTrack(trackId)
  }

  /**
   * Get the primary audio track
   */
  async getPrimaryTrack(): Promise<AudioTrack | undefined> {
    await this.ensureInit()
    return this.demuxer!.getPrimaryTrack()
  }

  /**
   * Get total duration in seconds
   */
  async getDuration(): Promise<number> {
    await this.ensureInit()
    return this.demuxer!.duration
  }

  /**
   * Get file metadata
   */
  async getMetadata(): Promise<AudioMetadata> {
    await this.ensureInit()
    return this.demuxer!.metadata
  }

  /**
   * Seek to a position in seconds
   */
  async seek(timeInSeconds: number): Promise<void> {
    await this.ensureInit()
    await this.demuxer!.seek(timeInSeconds)
  }

  /**
   * Read the next packet for a track
   */
  async readPacket(trackId: number): Promise<EncodedPacket | null> {
    await this.ensureInit()
    return this.demuxer!.readPacket(trackId)
  }

  /**
   * Iterate over all packets for a track
   */
  async *packets(trackId: number): AsyncGenerator<EncodedPacket> {
    await this.ensureInit()
    yield* this.demuxer!.packets(trackId)
  }

  /**
   * Read all packets into an array
   */
  async readAllPackets(trackId: number): Promise<EncodedPacket[]> {
    await this.ensureInit()
    return this.demuxer!.readAllPackets(trackId)
  }

  /**
   * Close the input and release resources
   */
  async close(): Promise<void> {
    if (this.demuxer) {
      await this.demuxer.close()
    }
  }
}

/**
 * Create an input from a source
 */
export function createInput(source: Source | string | Uint8Array | ArrayBuffer): Input {
  return new Input({ source })
}
