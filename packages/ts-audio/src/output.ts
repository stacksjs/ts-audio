/**
 * High-level audio output API
 */

import type { Target, AudioTrackConfig, OutputAudioTrack, EncodedPacket, AudioMetadata } from './types'
import { Muxer, OutputFormat } from './muxer'

/**
 * Registered output formats
 */
const outputFormats: OutputFormat[] = []

/**
 * Register an output format
 */
export function registerOutputFormat(format: OutputFormat): void {
  outputFormats.push(format)
}

/**
 * Get all registered output formats
 */
export function getOutputFormats(): OutputFormat[] {
  return [...outputFormats]
}

/**
 * Get output format by name
 */
export function getOutputFormat(name: string): OutputFormat | null {
  return outputFormats.find(f => f.name === name || f.extension === name) ?? null
}

/**
 * Get output format by extension
 */
export function getOutputFormatByExtension(ext: string): OutputFormat | null {
  const normalizedExt = ext.toLowerCase().replace(/^\./, '')
  return outputFormats.find(f => f.extension === normalizedExt) ?? null
}

/**
 * Output options
 */
export interface OutputOptions {
  format: OutputFormat
  target?: Target
}

/**
 * High-level audio output class
 */
export class Output {
  private muxer: Muxer
  private format: OutputFormat

  constructor(options: OutputOptions) {
    this.format = options.format
    const target = options.target ?? { type: 'buffer' }
    this.muxer = this.format.createMuxer(target)
  }

  /**
   * Get the format name
   */
  getFormatName(): string {
    return this.format.name
  }

  /**
   * Get the MIME type
   */
  getMimeType(): string {
    return this.format.mimeType
  }

  /**
   * Get the file extension
   */
  getExtension(): string {
    return this.format.extension
  }

  /**
   * Add an audio track
   */
  addAudioTrack(config: AudioTrackConfig): OutputAudioTrack {
    return this.muxer.addAudioTrack(config)
  }

  /**
   * Set metadata
   */
  setMetadata(metadata: AudioMetadata): void {
    this.muxer.setMetadata(metadata)
  }

  /**
   * Write a packet
   */
  async writePacket(trackId: number, packet: EncodedPacket): Promise<void> {
    await this.muxer.writePacket(trackId, packet)
  }

  /**
   * Finalize the output and get the buffer
   */
  async finalize(): Promise<Uint8Array> {
    return this.muxer.finalize()
  }

  /**
   * Get current output size
   */
  get size(): number {
    return this.muxer.size
  }
}

/**
 * Create an output for a format
 */
export function createOutput(format: OutputFormat | string, target?: Target): Output {
  const resolvedFormat = typeof format === 'string' ? getOutputFormat(format) : format
  if (!resolvedFormat) {
    throw new Error(`Unknown output format: ${format}`)
  }
  return new Output({ format: resolvedFormat, target })
}
