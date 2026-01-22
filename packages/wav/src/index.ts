/**
 * WAV codec package for ts-audio
 * Implements RIFF/WAVE format demuxing/muxing
 */

import type { Source, Target, AudioTrack, EncodedPacket, AudioMetadata, SampleFormat } from 'ts-audio'
import { InputFormat, OutputFormat, Demuxer, Muxer, Reader } from 'ts-audio'

// RIFF chunk IDs
const RIFF_MAGIC = 0x52494646 // "RIFF"
const WAVE_MAGIC = 0x57415645 // "WAVE"
const FMT_MAGIC = 0x666D7420  // "fmt "
const DATA_MAGIC = 0x64617461 // "data"
const LIST_MAGIC = 0x4C495354 // "LIST"
const INFO_MAGIC = 0x494E464F // "INFO"

// WAV format codes
const WAVE_FORMAT_PCM = 0x0001
const WAVE_FORMAT_IEEE_FLOAT = 0x0003
const WAVE_FORMAT_ALAW = 0x0006
const WAVE_FORMAT_MULAW = 0x0007
const WAVE_FORMAT_EXTENSIBLE = 0xFFFE

// INFO chunk tags
const INFO_TAGS: Record<string, keyof AudioMetadata> = {
  'INAM': 'title',
  'IART': 'artist',
  'IPRD': 'album',
  'ICMT': 'comment',
  'ICOP': 'copyright',
  'ICRD': 'date',
  'IGNR': 'genre',
  'ITRK': 'trackNumber',
  'ISFT': 'encoder',
}

interface WavFormat {
  formatCode: number
  channels: number
  sampleRate: number
  byteRate: number
  blockAlign: number
  bitsPerSample: number
  validBitsPerSample?: number
  channelMask?: number
  subFormat?: Uint8Array
}

interface RiffChunk {
  id: number
  size: number
  offset: number
}

function formatCodeToCodec(code: number): string {
  switch (code) {
    case WAVE_FORMAT_PCM: return 'pcm'
    case WAVE_FORMAT_IEEE_FLOAT: return 'pcm'
    case WAVE_FORMAT_ALAW: return 'alaw'
    case WAVE_FORMAT_MULAW: return 'ulaw'
    default: return 'pcm'
  }
}

function formatToSampleFormat(format: WavFormat): SampleFormat {
  if (format.formatCode === WAVE_FORMAT_IEEE_FLOAT) {
    return format.bitsPerSample === 64 ? 'f64' : 'f32'
  }

  switch (format.bitsPerSample) {
    case 8: return 'u8'
    case 16: return 's16'
    case 24: return 's24'
    case 32: return 's32'
    default: return 's16'
  }
}

export class WavDemuxer extends Demuxer {
  private format: WavFormat | null = null
  private dataChunk: RiffChunk | null = null
  private currentPosition = 0
  private bytesPerSample = 0
  private samplesRead = 0
  private totalSamples = 0
  private _initialized = false

  get formatName(): string {
    return 'wav'
  }

  get mimeType(): string {
    return 'audio/wav'
  }

  async init(): Promise<void> {
    if (this._initialized) return
    this._initialized = true

    this.reader.position = 0

    // Read RIFF header
    const riffMagic = await this.reader.readU32BE()
    if (riffMagic !== RIFF_MAGIC) {
      throw new Error('Invalid WAV file: missing RIFF header')
    }

    const fileSize = await this.reader.readU32LE()
    const waveMagic = await this.reader.readU32BE()

    if (waveMagic !== WAVE_MAGIC) {
      throw new Error('Invalid WAV file: missing WAVE identifier')
    }

    // Parse chunks
    const metadata: AudioMetadata = {}
    let infoChunk: { [key: string]: string } = {}

    while (this.reader.position < 8 + fileSize!) {
      const chunkId = await this.reader.readU32BE()
      const chunkSize = await this.reader.readU32LE()

      if (chunkId === null || chunkSize === null) break

      const chunkOffset = this.reader.position

      if (chunkId === FMT_MAGIC) {
        await this.parseFmtChunk(chunkSize)
      } else if (chunkId === DATA_MAGIC) {
        this.dataChunk = { id: chunkId, size: chunkSize, offset: chunkOffset }
      } else if (chunkId === LIST_MAGIC) {
        const listType = await this.reader.readU32BE()
        if (listType === INFO_MAGIC) {
          infoChunk = await this.parseInfoChunk(chunkSize - 4)
        }
      }

      // Move to next chunk (align to 16-bit boundary)
      this.reader.position = chunkOffset + chunkSize + (chunkSize % 2)
    }

    // Convert INFO chunk to metadata
    for (const [tag, key] of Object.entries(INFO_TAGS)) {
      if (infoChunk[tag]) {
        if (key === 'trackNumber') {
          metadata.trackNumber = Number.parseInt(infoChunk[tag], 10)
        } else {
          (metadata as Record<string, unknown>)[key] = infoChunk[tag]
        }
      }
    }

    this._metadata = metadata

    if (!this.format) {
      throw new Error('Invalid WAV file: missing fmt chunk')
    }

    if (!this.dataChunk) {
      throw new Error('Invalid WAV file: missing data chunk')
    }

    // Calculate sample info
    this.bytesPerSample = this.format.bitsPerSample / 8
    this.totalSamples = this.dataChunk.size / (this.bytesPerSample * this.format.channels)

    // Build track info
    const track: AudioTrack = {
      type: 'audio',
      id: 1,
      index: 0,
      codec: formatCodeToCodec(this.format.formatCode),
      sampleRate: this.format.sampleRate,
      channels: this.format.channels,
      bitDepth: this.format.bitsPerSample,
      sampleFormat: formatToSampleFormat(this.format),
      bitrate: this.format.byteRate * 8,
      isDefault: true,
    }

    this._tracks = [track]
    this._duration = this.totalSamples / this.format.sampleRate

    // Set position to start of audio data
    this.currentPosition = this.dataChunk.offset
  }

  private async parseFmtChunk(size: number): Promise<void> {
    const formatCode = await this.reader.readU16LE()
    const channels = await this.reader.readU16LE()
    const sampleRate = await this.reader.readU32LE()
    const byteRate = await this.reader.readU32LE()
    const blockAlign = await this.reader.readU16LE()
    const bitsPerSample = await this.reader.readU16LE()

    this.format = {
      formatCode: formatCode!,
      channels: channels!,
      sampleRate: sampleRate!,
      byteRate: byteRate!,
      blockAlign: blockAlign!,
      bitsPerSample: bitsPerSample!,
    }

    // Read extended format info
    if (size > 16) {
      const extSize = await this.reader.readU16LE()
      if (extSize && extSize >= 22 && formatCode === WAVE_FORMAT_EXTENSIBLE) {
        this.format.validBitsPerSample = await this.reader.readU16LE() ?? undefined
        this.format.channelMask = await this.reader.readU32LE() ?? undefined
        this.format.subFormat = await this.reader.readBytes(16) ?? undefined
      }
    }
  }

  private async parseInfoChunk(size: number): Promise<Record<string, string>> {
    const info: Record<string, string> = {}
    const endPos = this.reader.position + size

    while (this.reader.position < endPos - 8) {
      const tagId = await this.reader.readFourCC()
      const tagSize = await this.reader.readU32LE()

      if (!tagId || tagSize === null) break

      const tagData = await this.reader.readBytes(tagSize)
      if (tagData) {
        // Remove null terminator and decode
        let nullIndex = tagData.indexOf(0)
        if (nullIndex === -1) nullIndex = tagData.length
        info[tagId] = new TextDecoder().decode(tagData.subarray(0, nullIndex))
      }

      // Align to 16-bit boundary
      if (tagSize % 2) await this.reader.skip(1)
    }

    return info
  }

  async readPacket(trackId: number): Promise<EncodedPacket | null> {
    if (trackId !== 1 || !this.format || !this.dataChunk) {
      return null
    }

    const remaining = this.dataChunk.size - (this.currentPosition - this.dataChunk.offset)
    if (remaining <= 0) return null

    // Read a chunk of samples (e.g., 4096 samples worth)
    const samplesToRead = Math.min(4096, remaining / (this.bytesPerSample * this.format.channels))
    const bytesToRead = Math.floor(samplesToRead) * this.bytesPerSample * this.format.channels

    this.reader.position = this.currentPosition
    const data = await this.reader.readBytes(bytesToRead)

    if (!data || data.length === 0) return null

    const timestamp = this.samplesRead / this.format.sampleRate
    const duration = (data.length / (this.bytesPerSample * this.format.channels)) / this.format.sampleRate

    this.currentPosition += data.length
    this.samplesRead += data.length / (this.bytesPerSample * this.format.channels)

    return {
      data,
      timestamp,
      duration,
      isKeyframe: true,
      trackId: 1,
    }
  }

  async seek(timeInSeconds: number): Promise<void> {
    if (!this.format || !this.dataChunk) return

    const targetSample = Math.floor(timeInSeconds * this.format.sampleRate)
    const byteOffset = targetSample * this.bytesPerSample * this.format.channels

    this.currentPosition = this.dataChunk.offset + Math.min(byteOffset, this.dataChunk.size)
    this.samplesRead = targetSample
  }
}

export class WavMuxer extends Muxer {
  private audioData: Uint8Array[] = []
  private sampleRate = 44100
  private channels = 2
  private bitsPerSample = 16
  private isFloat = false

  get formatName(): string {
    return 'wav'
  }

  get mimeType(): string {
    return 'audio/wav'
  }

  protected onTrackAdded(track: { type: string, config: { sampleRate: number, channels: number, bitDepth?: number, sampleFormat?: SampleFormat } }): void {
    if (track.type === 'audio') {
      this.sampleRate = track.config.sampleRate
      this.channels = track.config.channels
      this.bitsPerSample = track.config.bitDepth ?? 16
      this.isFloat = track.config.sampleFormat === 'f32' || track.config.sampleFormat === 'f64'
    }
  }

  protected async writeHeader(): Promise<void> {
    // Header will be written in writeTrailer when we know the data size
  }

  protected async writeAudioPacket(_track: unknown, packet: EncodedPacket): Promise<void> {
    this.audioData.push(packet.data)
  }

  protected async writeTrailer(): Promise<void> {
    const totalDataSize = this.audioData.reduce((sum, data) => sum + data.length, 0)
    const bytesPerSample = this.bitsPerSample / 8
    const blockAlign = this.channels * bytesPerSample
    const byteRate = this.sampleRate * blockAlign
    const formatCode = this.isFloat ? WAVE_FORMAT_IEEE_FLOAT : WAVE_FORMAT_PCM

    // Write RIFF header
    await this.writer.writeFourCC('RIFF')
    await this.writer.writeU32LE(36 + totalDataSize)
    await this.writer.writeFourCC('WAVE')

    // Write fmt chunk
    await this.writer.writeFourCC('fmt ')
    await this.writer.writeU32LE(16) // chunk size
    await this.writer.writeU16LE(formatCode)
    await this.writer.writeU16LE(this.channels)
    await this.writer.writeU32LE(this.sampleRate)
    await this.writer.writeU32LE(byteRate)
    await this.writer.writeU16LE(blockAlign)
    await this.writer.writeU16LE(this.bitsPerSample)

    // Write data chunk
    await this.writer.writeFourCC('data')
    await this.writer.writeU32LE(totalDataSize)

    // Write audio data
    for (const data of this.audioData) {
      await this.writer.writeBytes(data)
    }
  }
}

export class WavInputFormat extends InputFormat {
  get name(): string { return 'wav' }
  get mimeType(): string { return 'audio/wav' }
  get extensions(): string[] { return ['wav', 'wave'] }

  async canRead(source: Source): Promise<boolean> {
    const reader = Reader.fromSource(source)
    reader.position = 0
    const riff = await reader.readU32BE()
    if (riff !== RIFF_MAGIC) return false

    await reader.skip(4) // file size
    const wave = await reader.readU32BE()
    return wave === WAVE_MAGIC
  }

  createDemuxer(source: Source): Demuxer {
    return new WavDemuxer(source)
  }
}

export class WavOutputFormat extends OutputFormat {
  get name(): string { return 'wav' }
  get mimeType(): string { return 'audio/wav' }
  get extension(): string { return 'wav' }

  createMuxer(target: Target): Muxer {
    return new WavMuxer(target)
  }
}

export const WAV = new WavInputFormat()
export const WAV_OUTPUT = new WavOutputFormat()

export type { WavFormat, RiffChunk }
