/**
 * Audio conversion API
 */

import type { ConversionOptions, ConversionProgress, AudioTrack, EncodedPacket } from './types'
import type { OutputFormat } from './muxer'
import { decodeAudio } from './audio-decode'
import { encodeWav, mixChannels, resampleAudio } from './audio-samples'
import { defaultOutputFormats, optionalPackage } from './default-formats'
import { assertPacketCopyConversion } from './delivery'
import { Input } from './input'
import { assertCodecSupported } from './muxer'
import { Output } from './output'
import { applyGain, fadeIn, fadeOut } from './utils'

/**
 * What a conversion does: copy the packets, when nothing about the audio has
 * to change, or decode and encode again, when something does and the target
 * is one ts-audio can write.
 */
type ConversionMode = 'copy' | 'transcode'

/** The codecs a conversion can encode into, and how deep. */
interface TranscodePlan {
  codec: 'pcm' | 'flac'
  bitDepth: number
}

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
export type ProgressCallback = (_progress: ConversionProgress) => void

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
  private mode: ConversionMode = 'copy'
  private plan: TranscodePlan | null = null

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

    // Copying is lossless and fast, and keeps the source's own bitstream, so
    // it is preferred whenever it gives the same result. Only when the audio
    // has to change -- a codec, a rate, a level -- or the container cannot
    // carry the source's codec, is it decoded and encoded again.
    if (!this.canCopy(track)) {
      this.mode = 'transcode'
      this.plan = this.planTranscode(track)
      return
    }

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

  /** Whether the packets can go across as they are. */
  private canCopy(track: AudioTrack): boolean {
    try {
      assertPacketCopyConversion(track, this.options)
      assertCodecSupported(this.output.getFormat(), track.codec)
      return true
    }
    catch {
      return false
    }
  }

  /**
   * What to encode into, or a refusal saying why it cannot be done. Thrown
   * here, before anything is decoded, rather than partway through.
   */
  private planTranscode(track: AudioTrack): TranscodePlan {
    const format = this.output.getFormat()
    const target = this.options.audioCodec ?? naturalCodec(format)
    if (!target)
      throw new Error(`The ${format.name} container does not say what it carries, so there is nothing to encode into`)
    assertCodecSupported(format, target)

    const codec = target.startsWith('pcm') ? 'pcm' : target === 'flac' ? 'flac' : null
    if (!codec) {
      throw new Error(`ts-audio has no ${target} encoder, so it cannot convert ${track.codec} to ${target}. `
        + `It can decode ${track.codec} and write WAV or FLAC, or copy the ${track.codec} packets into a container that carries them.`)
    }
    if (codec === 'flac' && format.name !== 'flac')
      throw new Error(`FLAC is written into a .flac file; writing it into ${format.name} is not supported`)

    // Options a decode and encode cannot honour, refused by name.
    if (this.options.audioBitrate !== undefined)
      throw new Error(`A bitrate does not apply to ${codec === 'flac' ? 'FLAC' : 'WAV'}, which is lossless`)
    if (this.options.trimSilence)
      throw new Error('Trimming silence is not supported')
    if (this.options.sampleFormat !== undefined)
      throw new Error('Choosing a sample format is not supported; choose a bit depth')
    if (this.options.channelLayout !== undefined)
      throw new Error('Choosing a channel layout is not supported; choose a channel count')
    const channels = this.options.channels
    if (channels !== undefined && channels !== track.channels && channels !== 1 && channels !== 2)
      throw new Error(`Mixing to ${channels} channels is not supported; to mono or stereo is`)

    if (codec === 'pcm') {
      const depth = this.options.bitDepth ?? (WAV_DEPTHS.includes(track.bitDepth ?? 0) ? track.bitDepth! : 16)
      if (!WAV_DEPTHS.includes(depth))
        throw new Error(`WAV is written at 8, 16, 24 or 32 bits, not ${depth}`)
      return { codec, bitDepth: depth }
    }
    // FLAC holds up to 24 bits; a deeper source is reduced to that.
    const depth = this.options.bitDepth ?? Math.min(24, Math.max(4, track.bitDepth ?? 16))
    if (depth < 4 || depth > 24)
      throw new Error(`FLAC is written at 4 to 24 bits, not ${depth}`)
    return { codec, bitDepth: depth }
  }

  /**
   * Decodes the whole input, changes what was asked for, and encodes it again.
   * Decoding goes through decodeAudio, so the samples are exactly the ones it
   * would give: gapless MP3 and Opus pre-skip trimmed, every WAV layout read.
   */
  private async transcode(): Promise<Uint8Array> {
    const plan = this.plan!
    const source = this.input.getSource()
    if (source.type === 'stream')
      throw new Error('Converting a stream decodes it a second time, which a stream cannot be read for; read it into a buffer first')

    const decoded = await decodeAudio(source)
    let sampleRate = decoded.sampleRate
    let channels = decoded.channels

    // Time range, to the sample -- finer than copying, which can only cut
    // between packets.
    const { startTime, endTime } = this.options
    if (startTime !== undefined || endTime !== undefined) {
      const length = channels[0]?.length ?? 0
      const from = Math.max(0, Math.min(length, Math.round((startTime ?? 0) * sampleRate)))
      const to = Math.max(from, Math.min(length, endTime !== undefined ? Math.round(endTime * sampleRate) : length))
      channels = channels.map(channel => channel.subarray(from, to))
    }
    if (this.options.channels !== undefined && this.options.channels !== channels.length)
      channels = mixChannels(channels, this.options.channels)
    if (this.options.sampleRate !== undefined && this.options.sampleRate !== sampleRate) {
      channels = resampleAudio(channels, sampleRate, this.options.sampleRate)
      sampleRate = this.options.sampleRate
    }
    if (this.options.volume !== undefined && this.options.volume !== 1) {
      const gain = this.options.volume
      channels = channels.map(channel => applyGain(channel, gain))
    }
    if (this.options.normalize) {
      // One gain for every channel, from the loudest, so stereo keeps its balance.
      let peak = 0
      for (const channel of channels) {
        for (const sample of channel) peak = Math.max(peak, Math.abs(sample))
      }
      if (peak > 0)
        channels = channels.map(channel => applyGain(channel, 1 / peak))
    }
    if (this.options.fadeIn !== undefined && this.options.fadeIn > 0) {
      const frames = Math.round(this.options.fadeIn * sampleRate)
      channels = channels.map(channel => fadeIn(channel, frames))
    }
    if (this.options.fadeOut !== undefined && this.options.fadeOut > 0) {
      const frames = Math.round(this.options.fadeOut * sampleRate)
      channels = channels.map(channel => fadeOut(channel, frames))
    }

    let bytes: Uint8Array
    if (plan.codec === 'pcm') {
      bytes = encodeWav(channels, sampleRate, { bitDepth: plan.bitDepth as 8 | 16 | 24 | 32 })
    }
    else {
      const flac = await optionalPackage(() => import('@ts-audio/flac'))
      if (!flac)
        throw new Error('Writing FLAC needs @ts-audio/flac, which is not installed')
      bytes = flac.encodeFlac(channels, { sampleRate, bitsPerSample: plan.bitDepth })
    }
    return this.output.writeFile(bytes)
  }

  /** Which conversion this is, once initialised. */
  get conversionMode(): ConversionMode {
    return this.mode
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
    if (!this.inputTrack || (this.mode === 'copy' && this.outputTrackId === null)) {
      throw new Error('Conversion not initialized')
    }

    this.startTimestamp = Date.now()

    if (this.mode === 'transcode') {
      const result = await this.transcode()
      this.outputBytes = result.byteLength
      this.processedTime = this.totalDuration
      this.reportProgress()
      return result
    }

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

  const ext = (outputPath.split('.').pop() ?? '').toLowerCase()
  // A registered format first, then the ones that ship with ts-audio. Looking
  // only at the registry, which nothing fills, made this fail for every file.
  const format = getOutputFormatByExtension(ext)
    ?? (await defaultOutputFormats()).find(candidate => candidate.extension === ext)
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

/** The integer depths WAV is written at. */
const WAV_DEPTHS: readonly number[] = [8, 16, 24, 32]

/** The codec a container is first meant for: what to encode into when none is named. */
function naturalCodec(format: OutputFormat): string | null {
  return format.supportedCodecs[0] ?? null
}
