/**
 * Audio conversion API
 */

import type { ConversionOptions, ConversionProgress, AudioTrack, EncodedPacket } from './types'
import { Input } from './input'
import { Output } from './output'

/**
 * Conversion init options
 */
export interface ConversionInitOptions {
  input: Input
  output: Output
  options?: ConversionOptions
}

/**
 * Progress callback type
 */
export type ProgressCallback = (progress: ConversionProgress) => void

/**
 * Audio conversion class
 */
export class Conversion {
  private input: Input
  private output: Output
  private options: ConversionOptions
  private progressCallbacks: ProgressCallback[] = []
  private inputTrack: AudioTrack | null = null
  private outputTrackId: number | null = null
  private totalDuration = 0
  private processedTime = 0
  private inputBytes = 0
  private outputBytes = 0
  private startTimestamp = 0

  private constructor(input: Input, output: Output, options: ConversionOptions = {}) {
    this.input = input
    this.output = output
    this.options = options
  }

  /**
   * Create and initialize a conversion
   */
  static async init(opts: ConversionInitOptions): Promise<Conversion> {
    const conversion = new Conversion(opts.input, opts.output, opts.options)
    await conversion.initialize()
    return conversion
  }

  /**
   * Initialize the conversion
   */
  private async initialize(): Promise<void> {
    const track = await this.input.getPrimaryTrack()
    if (!track) {
      throw new Error('No audio track found in input')
    }

    this.inputTrack = track
    this.totalDuration = await this.input.getDuration()

    // Apply time range options
    if (this.options.startTime !== undefined) {
      await this.input.seek(this.options.startTime)
    }

    if (this.options.endTime !== undefined) {
      this.totalDuration = Math.min(this.totalDuration, this.options.endTime)
    }

    if (this.options.startTime !== undefined) {
      this.totalDuration -= this.options.startTime
    }

    // Create output track
    const outputTrack = this.output.addAudioTrack({
      codec: this.options.audioCodec ?? track.codec,
      sampleRate: this.options.sampleRate ?? track.sampleRate,
      channels: this.options.channels ?? track.channels,
      channelLayout: this.options.channelLayout ?? track.channelLayout,
      bitDepth: this.options.bitDepth ?? track.bitDepth,
      bitrate: this.options.audioBitrate ?? track.bitrate,
      codecDescription: track.codecDescription,
    })

    this.outputTrackId = outputTrack.id

    // Copy metadata
    const metadata = await this.input.getMetadata()
    this.output.setMetadata(metadata)
  }

  /**
   * Register a progress callback
   */
  onProgress(callback: ProgressCallback): void {
    this.progressCallbacks.push(callback)
  }

  /**
   * Report progress to all callbacks
   */
  private reportProgress(): void {
    const progress: ConversionProgress = {
      percentage: this.totalDuration > 0 ? (this.processedTime / this.totalDuration) * 100 : 0,
      currentTime: this.processedTime,
      totalTime: this.totalDuration,
      inputBytes: this.inputBytes,
      outputBytes: this.outputBytes,
      speed: this.startTimestamp > 0
        ? this.processedTime / ((Date.now() - this.startTimestamp) / 1000)
        : undefined,
    }

    for (const callback of this.progressCallbacks) {
      callback(progress)
    }
  }

  /**
   * Process a single packet
   */
  private async processPacket(packet: EncodedPacket): Promise<boolean> {
    // Check time range
    if (this.options.endTime !== undefined && packet.timestamp > this.options.endTime) {
      return false
    }

    if (this.options.startTime !== undefined && packet.timestamp < this.options.startTime) {
      return true // Skip but continue
    }

    // Write to output
    await this.output.writePacket(this.outputTrackId!, packet)

    // Update progress
    this.inputBytes += packet.data.length
    this.processedTime = packet.timestamp
    if (this.options.startTime !== undefined) {
      this.processedTime -= this.options.startTime
    }

    this.reportProgress()

    return true
  }

  /**
   * Execute the conversion
   */
  async execute(): Promise<Uint8Array> {
    if (!this.inputTrack || this.outputTrackId === null) {
      throw new Error('Conversion not initialized')
    }

    this.startTimestamp = Date.now()

    // Process all packets
    for await (const packet of this.input.packets(this.inputTrack.id)) {
      const shouldContinue = await this.processPacket(packet)
      if (!shouldContinue) break
    }

    // Finalize output
    const result = await this.output.finalize()
    this.outputBytes = result.byteLength

    // Final progress report
    this.processedTime = this.totalDuration
    this.reportProgress()

    return result
  }

  /**
   * Close resources
   */
  async close(): Promise<void> {
    await this.input.close()
  }
}

/**
 * Convert audio with simple interface
 */
export async function convert(
  inputPath: string,
  outputPath: string,
  options?: ConversionOptions,
  onProgress?: ProgressCallback,
): Promise<void> {
  // Dynamic import to avoid circular dependencies
  const { createInput } = await import('./input')
  const { getOutputFormatByExtension } = await import('./output')
  const { Output } = await import('./output')

  const input = createInput(inputPath)

  const ext = outputPath.split('.').pop() ?? ''
  const format = getOutputFormatByExtension(ext)
  if (!format) {
    throw new Error(`Unknown output format: ${ext}`)
  }

  const output = new Output({ format, target: { type: 'file', path: outputPath } })

  const conversion = await Conversion.init({ input, output, options })

  if (onProgress) {
    conversion.onProgress(onProgress)
  }

  await conversion.execute()
  await conversion.close()
}
