/**
 * AAC codec package for ts-audio
 * Implements ADTS (Audio Data Transport Stream) format demuxing/muxing
 */

import type { Source, Target, AudioTrack, EncodedPacket } from 'ts-audio'
import { InputFormat, OutputFormat, Demuxer, Muxer, Reader } from 'ts-audio'

// AAC sample rates
const AAC_SAMPLE_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000,
  24000, 22050, 16000, 12000, 11025, 8000, 7350,
  null, null, null,
]

// AAC profiles
const AAC_PROFILES = ['AAC-Main', 'AAC-LC', 'AAC-SSR', 'AAC-LTP'] as const
type AacProfile = typeof AAC_PROFILES[number]

interface AdtsHeader {
  syncWord: number
  id: number // MPEG identifier (0 = MPEG-4, 1 = MPEG-2)
  layer: number
  protectionAbsent: boolean
  profile: number // Object type - 1
  samplingFrequencyIndex: number
  privateBit: boolean
  channelConfiguration: number
  originalCopy: boolean
  home: boolean
  copyrightIdBit: boolean
  copyrightIdStart: boolean
  frameLength: number
  bufferFullness: number
  numberOfRawDataBlocksInFrame: number
  crcCheck?: number
}

interface AdtsFrame {
  header: AdtsHeader
  data: Uint8Array
  offset: number
  timestamp: number
}

function parseAdtsHeader(data: Uint8Array, offset: number): AdtsHeader | null {
  if (offset + 7 > data.length) return null

  // Check sync word (12 bits, all 1s)
  if (data[offset] !== 0xFF || (data[offset + 1] & 0xF0) !== 0xF0) {
    return null
  }

  const b1 = data[offset + 1]
  const b2 = data[offset + 2]
  const b3 = data[offset + 3]
  const b4 = data[offset + 4]
  const b5 = data[offset + 5]
  const b6 = data[offset + 6]

  const id = (b1 >> 3) & 0x01
  const layer = (b1 >> 1) & 0x03
  const protectionAbsent = (b1 & 0x01) === 1
  const profile = (b2 >> 6) & 0x03
  const samplingFrequencyIndex = (b2 >> 2) & 0x0F
  const privateBit = ((b2 >> 1) & 0x01) === 1
  const channelConfiguration = ((b2 & 0x01) << 2) | ((b3 >> 6) & 0x03)
  const originalCopy = ((b3 >> 5) & 0x01) === 1
  const home = ((b3 >> 4) & 0x01) === 1
  const copyrightIdBit = ((b3 >> 3) & 0x01) === 1
  const copyrightIdStart = ((b3 >> 2) & 0x01) === 1
  const frameLength = ((b3 & 0x03) << 11) | (b4 << 3) | ((b5 >> 5) & 0x07)
  const bufferFullness = ((b5 & 0x1F) << 6) | ((b6 >> 2) & 0x3F)
  const numberOfRawDataBlocksInFrame = b6 & 0x03

  // Validate
  if (layer !== 0) return null // Must be 0 for AAC
  if (samplingFrequencyIndex > 12) return null
  if (frameLength < 7) return null

  const header: AdtsHeader = {
    syncWord: 0xFFF,
    id,
    layer,
    protectionAbsent,
    profile,
    samplingFrequencyIndex,
    privateBit,
    channelConfiguration,
    originalCopy,
    home,
    copyrightIdBit,
    copyrightIdStart,
    frameLength,
    bufferFullness,
    numberOfRawDataBlocksInFrame,
  }

  // Read CRC if present
  if (!protectionAbsent && offset + 9 <= data.length) {
    header.crcCheck = (data[offset + 7] << 8) | data[offset + 8]
  }

  return header
}

function createAdtsHeader(
  profile: number,
  sampleRateIndex: number,
  channels: number,
  frameLength: number,
): Uint8Array {
  const header = new Uint8Array(7)

  // Sync word (12 bits)
  header[0] = 0xFF
  header[1] = 0xF1 // MPEG-4, Layer 0, no CRC

  // Profile, sample rate, private bit, channel config (first bit)
  header[2] = ((profile & 0x03) << 6) | ((sampleRateIndex & 0x0F) << 2) | ((channels >> 2) & 0x01)

  // Channel config (lower 2 bits), original/copy, home, copyright, frame length (upper 2 bits)
  header[3] = ((channels & 0x03) << 6) | ((frameLength >> 11) & 0x03)

  // Frame length (middle 8 bits)
  header[4] = (frameLength >> 3) & 0xFF

  // Frame length (lower 3 bits), buffer fullness (upper 5 bits)
  header[5] = ((frameLength & 0x07) << 5) | 0x1F // Buffer fullness = VBR

  // Buffer fullness (lower 6 bits), number of raw data blocks
  header[6] = 0xFC // Buffer fullness = VBR, 0 raw data blocks

  return header
}

function getSampleRateIndex(sampleRate: number): number {
  const index = AAC_SAMPLE_RATES.indexOf(sampleRate)
  return index >= 0 ? index : 4 // Default to 44100 Hz
}

export class AacDemuxer extends Demuxer {
  private frames: AdtsFrame[] = []
  private currentFrameIndex = 0
  private sampleRate = 44100
  private channels = 2
  private profile: AacProfile = 'AAC-LC'
  private _initialized = false

  get formatName(): string {
    return 'aac'
  }

  get mimeType(): string {
    return 'audio/aac'
  }

  async init(): Promise<void> {
    if (this._initialized) return
    this._initialized = true

    await this.scanFrames()

    if (this.frames.length > 0) {
      const firstFrame = this.frames[0]
      const lastFrame = this.frames[this.frames.length - 1]

      this.sampleRate = AAC_SAMPLE_RATES[firstFrame.header.samplingFrequencyIndex] ?? 44100
      this.channels = firstFrame.header.channelConfiguration || 2
      this.profile = AAC_PROFILES[firstFrame.header.profile] ?? 'AAC-LC'

      const track: AudioTrack = {
        type: 'audio',
        id: 1,
        index: 0,
        codec: 'aac',
        sampleRate: this.sampleRate,
        channels: this.channels,
        isDefault: true,
      }

      this._tracks = [track]

      // AAC uses 1024 samples per frame
      const samplesPerFrame = 1024
      this._duration = lastFrame.timestamp + (samplesPerFrame / this.sampleRate)
    }

    this._metadata = {}
  }

  private async scanFrames(): Promise<void> {
    this.reader.position = 0
    const fileSize = await this.reader.getSize() ?? 0
    let timestamp = 0
    const samplesPerFrame = 1024

    while (this.reader.position < fileSize - 7) {
      const pos = this.reader.position
      const headerBytes = await this.reader.readBytes(9)
      if (!headerBytes) break

      const header = parseAdtsHeader(headerBytes, 0)
      if (!header) {
        // Not a valid frame, scan forward
        this.reader.position = pos + 1
        continue
      }

      // Read full frame
      this.reader.position = pos
      const frameData = await this.reader.readBytes(header.frameLength)
      if (!frameData) break

      const sampleRate = AAC_SAMPLE_RATES[header.samplingFrequencyIndex] ?? 44100

      this.frames.push({
        header,
        data: frameData,
        offset: pos,
        timestamp,
      })

      timestamp += samplesPerFrame / sampleRate
    }
  }

  async readPacket(trackId: number): Promise<EncodedPacket | null> {
    if (trackId !== 1 || this.currentFrameIndex >= this.frames.length) {
      return null
    }

    const frame = this.frames[this.currentFrameIndex]
    this.currentFrameIndex++

    const sampleRate = AAC_SAMPLE_RATES[frame.header.samplingFrequencyIndex] ?? 44100
    const samplesPerFrame = 1024

    return {
      data: frame.data,
      timestamp: frame.timestamp,
      duration: samplesPerFrame / sampleRate,
      isKeyframe: true,
      trackId: 1,
    }
  }

  async seek(timeInSeconds: number): Promise<void> {
    for (let i = 0; i < this.frames.length; i++) {
      if (this.frames[i].timestamp >= timeInSeconds) {
        this.currentFrameIndex = Math.max(0, i - 1)
        return
      }
    }
    this.currentFrameIndex = this.frames.length
  }
}

export class AacMuxer extends Muxer {
  private packets: Uint8Array[] = []
  private sampleRate = 44100
  private channels = 2
  private profile = 1 // AAC-LC

  get formatName(): string {
    return 'aac'
  }

  get mimeType(): string {
    return 'audio/aac'
  }

  protected onTrackAdded(track: { type: string, config: { sampleRate: number, channels: number } }): void {
    if (track.type === 'audio') {
      this.sampleRate = track.config.sampleRate
      this.channels = track.config.channels
    }
  }

  protected async writeHeader(): Promise<void> {
    // ADTS doesn't have a file header
  }

  protected async writeAudioPacket(_track: unknown, packet: EncodedPacket): Promise<void> {
    // Check if packet already has ADTS header
    if (packet.data[0] === 0xFF && (packet.data[1] & 0xF0) === 0xF0) {
      this.packets.push(packet.data)
    } else {
      // Add ADTS header to raw AAC frame
      const sampleRateIndex = getSampleRateIndex(this.sampleRate)
      const frameLength = 7 + packet.data.length
      const header = createAdtsHeader(this.profile, sampleRateIndex, this.channels, frameLength)

      const frame = new Uint8Array(frameLength)
      frame.set(header, 0)
      frame.set(packet.data, 7)

      this.packets.push(frame)
    }
  }

  protected async writeTrailer(): Promise<void> {
    for (const packet of this.packets) {
      await this.writer.writeBytes(packet)
    }
  }
}

export class AacInputFormat extends InputFormat {
  get name(): string { return 'aac' }
  get mimeType(): string { return 'audio/aac' }
  get extensions(): string[] { return ['aac', 'adts'] }

  async canRead(source: Source): Promise<boolean> {
    const reader = Reader.fromSource(source)
    reader.position = 0
    const header = await reader.readBytes(4)
    if (!header) return false

    // Check for ADTS sync word
    return header[0] === 0xFF && (header[1] & 0xF6) === 0xF0
  }

  createDemuxer(source: Source): Demuxer {
    return new AacDemuxer(source)
  }
}

export class AacOutputFormat extends OutputFormat {
  get name(): string { return 'aac' }
  get mimeType(): string { return 'audio/aac' }
  get extension(): string { return 'aac' }

  createMuxer(target: Target): Muxer {
    return new AacMuxer(target)
  }
}

export const AAC = new AacInputFormat()
export const AAC_OUTPUT = new AacOutputFormat()

// Export types
export type { AdtsHeader, AdtsFrame, AacProfile }

// Export utilities
export { parseAdtsHeader, createAdtsHeader, getSampleRateIndex, AAC_SAMPLE_RATES, AAC_PROFILES }
