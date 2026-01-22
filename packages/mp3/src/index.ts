/**
 * MP3 codec package for ts-audio
 * Implements MPEG Audio Layer III demuxing/muxing with ID3 tag support
 */

import type { Source, Target, AudioTrack, EncodedPacket, AudioMetadata, ID3v1Tag, ID3v2Tag, ID3v2Frame } from 'ts-audio'
import { InputFormat, OutputFormat, Demuxer, Muxer, Reader, crc16Mp3 } from 'ts-audio'

// MPEG Audio version
const MPEG_VERSIONS = ['MPEG2.5', null, 'MPEG2', 'MPEG1'] as const
type MpegVersion = 'MPEG1' | 'MPEG2' | 'MPEG2.5'

// MPEG Audio layer
const LAYERS = [null, 'Layer3', 'Layer2', 'Layer1'] as const
type Layer = 'Layer1' | 'Layer2' | 'Layer3'

// Bitrate lookup tables (in kbps)
const BITRATES: Record<string, (number | null)[]> = {
  'MPEG1-Layer1': [null, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, null],
  'MPEG1-Layer2': [null, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, null],
  'MPEG1-Layer3': [null, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, null],
  'MPEG2-Layer1': [null, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, null],
  'MPEG2-Layer2': [null, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, null],
  'MPEG2-Layer3': [null, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, null],
}

// Sample rate lookup table (in Hz)
const SAMPLE_RATES: Record<MpegVersion, (number | null)[]> = {
  'MPEG1': [44100, 48000, 32000, null],
  'MPEG2': [22050, 24000, 16000, null],
  'MPEG2.5': [11025, 12000, 8000, null],
}

// Samples per frame
const SAMPLES_PER_FRAME: Record<string, number> = {
  'MPEG1-Layer1': 384,
  'MPEG1-Layer2': 1152,
  'MPEG1-Layer3': 1152,
  'MPEG2-Layer1': 384,
  'MPEG2-Layer2': 1152,
  'MPEG2-Layer3': 576,
  'MPEG2.5-Layer1': 384,
  'MPEG2.5-Layer2': 1152,
  'MPEG2.5-Layer3': 576,
}

// Channel modes
const CHANNEL_MODES = ['Stereo', 'Joint Stereo', 'Dual Channel', 'Mono'] as const
type ChannelMode = typeof CHANNEL_MODES[number]

interface Mp3FrameHeader {
  version: MpegVersion
  layer: Layer
  hasCrc: boolean
  bitrate: number
  sampleRate: number
  padding: boolean
  channelMode: ChannelMode
  channels: number
  samplesPerFrame: number
  frameSize: number
}

interface Mp3Frame {
  header: Mp3FrameHeader
  data: Uint8Array
  offset: number
  timestamp: number
}

function parseFrameHeader(data: Uint8Array, offset: number): Mp3FrameHeader | null {
  if (offset + 4 > data.length) return null

  const h0 = data[offset]
  const h1 = data[offset + 1]
  const h2 = data[offset + 2]
  const h3 = data[offset + 3]

  // Check sync bits (11 bits)
  if (h0 !== 0xFF || (h1 & 0xE0) !== 0xE0) return null

  const versionBits = (h1 >> 3) & 0x03
  const layerBits = (h1 >> 1) & 0x03
  const protectionBit = h1 & 0x01
  const bitrateBits = (h2 >> 4) & 0x0F
  const sampleRateBits = (h2 >> 2) & 0x03
  const paddingBit = (h2 >> 1) & 0x01
  const channelModeBits = (h3 >> 6) & 0x03

  const version = MPEG_VERSIONS[versionBits]
  const layer = LAYERS[layerBits]

  if (!version || !layer) return null

  const bitrateKey = version === 'MPEG2.5' ? `MPEG2-${layer}` : `${version}-${layer}`
  const bitrate = BITRATES[bitrateKey]?.[bitrateBits]
  const sampleRate = SAMPLE_RATES[version]?.[sampleRateBits]

  if (!bitrate || !sampleRate) return null

  const samplesPerFrame = SAMPLES_PER_FRAME[`${version}-${layer}`] ?? 1152
  const channelMode = CHANNEL_MODES[channelModeBits]
  const channels = channelMode === 'Mono' ? 1 : 2

  // Calculate frame size
  let frameSize: number
  if (layer === 'Layer1') {
    frameSize = Math.floor((12 * bitrate * 1000 / sampleRate + (paddingBit ? 1 : 0)) * 4)
  } else {
    const slotSize = layer === 'Layer3' && version !== 'MPEG1' ? 72 : 144
    frameSize = Math.floor(slotSize * bitrate * 1000 / sampleRate + (paddingBit ? 1 : 0))
  }

  return {
    version,
    layer,
    hasCrc: protectionBit === 0,
    bitrate: bitrate * 1000,
    sampleRate,
    padding: paddingBit === 1,
    channelMode,
    channels,
    samplesPerFrame,
    frameSize,
  }
}

function parseID3v1(data: Uint8Array): ID3v1Tag | null {
  if (data.length < 128) return null

  const offset = data.length - 128
  if (data[offset] !== 0x54 || data[offset + 1] !== 0x41 || data[offset + 2] !== 0x47) {
    return null // "TAG" not found
  }

  const decoder = new TextDecoder('latin1')
  const trimNull = (s: string) => s.replace(/\0+$/, '').trim()

  const title = trimNull(decoder.decode(data.subarray(offset + 3, offset + 33)))
  const artist = trimNull(decoder.decode(data.subarray(offset + 33, offset + 63)))
  const album = trimNull(decoder.decode(data.subarray(offset + 63, offset + 93)))
  const year = trimNull(decoder.decode(data.subarray(offset + 93, offset + 97)))
  const comment = trimNull(decoder.decode(data.subarray(offset + 97, offset + 125)))

  // Check for ID3v1.1 (track number in comment field)
  let track: number | undefined
  if (data[offset + 125] === 0 && data[offset + 126] !== 0) {
    track = data[offset + 126]
  }

  const genre = data[offset + 127]

  return { title, artist, album, year, comment, track, genre }
}

function parseID3v2(data: Uint8Array): ID3v2Tag | null {
  if (data.length < 10) return null

  // Check "ID3" header
  if (data[0] !== 0x49 || data[1] !== 0x44 || data[2] !== 0x33) {
    return null
  }

  const major = data[3]
  const minor = data[4]
  const flags = data[5]

  // Syncsafe integer for size
  const size = ((data[6] & 0x7F) << 21) |
               ((data[7] & 0x7F) << 14) |
               ((data[8] & 0x7F) << 7) |
               (data[9] & 0x7F)

  if (10 + size > data.length) return null

  const frames: ID3v2Frame[] = []
  let pos = 10

  // Skip extended header if present
  if (flags & 0x40) {
    const extSize = ((data[pos] & 0x7F) << 21) |
                    ((data[pos + 1] & 0x7F) << 14) |
                    ((data[pos + 2] & 0x7F) << 7) |
                    (data[pos + 3] & 0x7F)
    pos += extSize
  }

  while (pos < 10 + size - 10) {
    // Frame ID (4 bytes for v2.3+, 3 bytes for v2.2)
    const frameIdLen = major >= 3 ? 4 : 3
    const frameId = String.fromCharCode(...data.subarray(pos, pos + frameIdLen))

    if (frameId[0] === '\0') break // Padding

    pos += frameIdLen

    // Frame size
    let frameSize: number
    if (major >= 4) {
      // Syncsafe integer
      frameSize = ((data[pos] & 0x7F) << 21) |
                  ((data[pos + 1] & 0x7F) << 14) |
                  ((data[pos + 2] & 0x7F) << 7) |
                  (data[pos + 3] & 0x7F)
      pos += 4
    } else if (major === 3) {
      frameSize = (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3]
      pos += 4
    } else {
      frameSize = (data[pos] << 16) | (data[pos + 1] << 8) | data[pos + 2]
      pos += 3
    }

    // Frame flags (2 bytes for v2.3+)
    let frameFlags = 0
    if (major >= 3) {
      frameFlags = (data[pos] << 8) | data[pos + 1]
      pos += 2
    }

    if (frameSize <= 0 || pos + frameSize > 10 + size) break

    const frameData = data.subarray(pos, pos + frameSize)
    frames.push({ id: frameId, data: frameData, flags: frameFlags })

    pos += frameSize
  }

  return { version: { major, minor }, flags, frames }
}

function id3v2FrameToString(frame: ID3v2Frame): string {
  const data = frame.data
  if (data.length === 0) return ''

  const encoding = data[0]
  const textData = data.subarray(1)

  let decoder: TextDecoder
  switch (encoding) {
    case 0: // ISO-8859-1
      decoder = new TextDecoder('latin1')
      break
    case 1: // UTF-16 with BOM
    case 2: // UTF-16BE
      decoder = new TextDecoder('utf-16')
      break
    case 3: // UTF-8
    default:
      decoder = new TextDecoder('utf-8')
  }

  return decoder.decode(textData).replace(/\0+$/, '')
}

function convertID3ToMetadata(id3v1: ID3v1Tag | null, id3v2: ID3v2Tag | null): AudioMetadata {
  const metadata: AudioMetadata = {}

  // Process ID3v2 first (higher priority)
  if (id3v2) {
    for (const frame of id3v2.frames) {
      const value = id3v2FrameToString(frame)
      switch (frame.id) {
        case 'TIT2': case 'TT2': metadata.title = value; break
        case 'TPE1': case 'TP1': metadata.artist = value; break
        case 'TALB': case 'TAL': metadata.album = value; break
        case 'TPE2': case 'TP2': metadata.albumArtist = value; break
        case 'TCOM': case 'TCM': metadata.composer = value; break
        case 'TCON': case 'TCO': metadata.genre = value; break
        case 'TYER': case 'TYE': case 'TDRC':
          const year = Number.parseInt(value, 10)
          if (!Number.isNaN(year)) metadata.year = year
          break
        case 'TRCK': case 'TRK':
          const [trackNum, trackTotal] = value.split('/')
          metadata.trackNumber = Number.parseInt(trackNum, 10)
          if (trackTotal) metadata.trackTotal = Number.parseInt(trackTotal, 10)
          break
        case 'TPOS': case 'TPA':
          const [discNum, discTotal] = value.split('/')
          metadata.discNumber = Number.parseInt(discNum, 10)
          if (discTotal) metadata.discTotal = Number.parseInt(discTotal, 10)
          break
        case 'COMM': case 'COM': metadata.comment = value; break
        case 'TCOP': case 'TCR': metadata.copyright = value; break
        case 'TENC': case 'TEN': metadata.encodedBy = value; break
        case 'TBPM': case 'TBP':
          const bpm = Number.parseInt(value, 10)
          if (!Number.isNaN(bpm)) metadata.bpm = bpm
          break
        case 'TSRC': metadata.isrc = value; break
        case 'APIC': case 'PIC':
          // Picture handling - simplified
          if (!metadata.coverArt) metadata.coverArt = []
          // Would need more parsing for actual picture data
          break
      }
    }
  }

  // Fill in from ID3v1 if missing
  if (id3v1) {
    if (!metadata.title && id3v1.title) metadata.title = id3v1.title
    if (!metadata.artist && id3v1.artist) metadata.artist = id3v1.artist
    if (!metadata.album && id3v1.album) metadata.album = id3v1.album
    if (!metadata.year && id3v1.year) metadata.year = Number.parseInt(id3v1.year, 10)
    if (!metadata.comment && id3v1.comment) metadata.comment = id3v1.comment
    if (!metadata.trackNumber && id3v1.track) metadata.trackNumber = id3v1.track
  }

  return metadata
}

export class Mp3Demuxer extends Demuxer {
  private frames: Mp3Frame[] = []
  private id3v1: ID3v1Tag | null = null
  private id3v2: ID3v2Tag | null = null
  private audioDataStart = 0
  private audioDataEnd = 0
  private currentFrameIndex = 0
  private _initialized = false

  get formatName(): string {
    return 'mp3'
  }

  get mimeType(): string {
    return 'audio/mpeg'
  }

  async init(): Promise<void> {
    if (this._initialized) return
    this._initialized = true

    // Read enough data for headers and scanning
    const fileSize = await this.reader.getSize() ?? 0
    this.audioDataEnd = fileSize

    // Check for ID3v2 at start
    this.reader.position = 0
    const headerData = await this.reader.readBytes(10)
    if (headerData && headerData[0] === 0x49 && headerData[1] === 0x44 && headerData[2] === 0x33) {
      const tagSize = ((headerData[6] & 0x7F) << 21) |
                      ((headerData[7] & 0x7F) << 14) |
                      ((headerData[8] & 0x7F) << 7) |
                      (headerData[9] & 0x7F)

      this.reader.position = 0
      const id3Data = await this.reader.readBytes(10 + tagSize)
      if (id3Data) {
        this.id3v2 = parseID3v2(id3Data)
        this.audioDataStart = 10 + tagSize
      }
    }

    // Check for ID3v1 at end
    if (fileSize >= 128) {
      this.reader.position = fileSize - 128
      const tailData = await this.reader.readBytes(128)
      if (tailData && tailData[0] === 0x54 && tailData[1] === 0x41 && tailData[2] === 0x47) {
        this.id3v1 = parseID3v1(tailData)
        this.audioDataEnd = fileSize - 128
      }
    }

    // Scan for MP3 frames
    await this.scanFrames()

    // Build track info
    if (this.frames.length > 0) {
      const firstFrame = this.frames[0]
      const lastFrame = this.frames[this.frames.length - 1]

      const track: AudioTrack = {
        type: 'audio',
        id: 1,
        index: 0,
        codec: 'mp3',
        sampleRate: firstFrame.header.sampleRate,
        channels: firstFrame.header.channels,
        bitrate: firstFrame.header.bitrate,
        isDefault: true,
      }

      this._tracks = [track]
      this._duration = lastFrame.timestamp + (lastFrame.header.samplesPerFrame / lastFrame.header.sampleRate)
    }

    this._metadata = convertID3ToMetadata(this.id3v1, this.id3v2)
  }

  private async scanFrames(): Promise<void> {
    this.reader.position = this.audioDataStart
    let timestamp = 0

    while (this.reader.position < this.audioDataEnd - 4) {
      const pos = this.reader.position
      const headerBytes = await this.reader.readBytes(4)
      if (!headerBytes) break

      const header = parseFrameHeader(headerBytes, 0)
      if (!header) {
        // Not a valid frame, scan forward
        this.reader.position = pos + 1
        continue
      }

      // Read full frame
      this.reader.position = pos
      const frameData = await this.reader.readBytes(header.frameSize)
      if (!frameData) break

      this.frames.push({
        header,
        data: frameData,
        offset: pos,
        timestamp,
      })

      timestamp += header.samplesPerFrame / header.sampleRate
    }
  }

  async readPacket(trackId: number): Promise<EncodedPacket | null> {
    if (trackId !== 1 || this.currentFrameIndex >= this.frames.length) {
      return null
    }

    const frame = this.frames[this.currentFrameIndex]
    this.currentFrameIndex++

    return {
      data: frame.data,
      timestamp: frame.timestamp,
      duration: frame.header.samplesPerFrame / frame.header.sampleRate,
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

export class Mp3Muxer extends Muxer {
  private packets: Uint8Array[] = []
  private sampleRate = 44100
  private channels = 2
  private bitrate = 128000

  get formatName(): string {
    return 'mp3'
  }

  get mimeType(): string {
    return 'audio/mpeg'
  }

  protected onTrackAdded(track: { type: string, config: { sampleRate: number, channels: number, bitrate?: number } }): void {
    if (track.type === 'audio') {
      this.sampleRate = track.config.sampleRate
      this.channels = track.config.channels
      this.bitrate = track.config.bitrate ?? 128000
    }
  }

  protected async writeHeader(): Promise<void> {
    // MP3 typically doesn't need a header, but we could add ID3v2 here
  }

  protected async writeAudioPacket(_track: unknown, packet: EncodedPacket): Promise<void> {
    this.packets.push(packet.data)
  }

  protected async writeTrailer(): Promise<void> {
    // Write all collected packets
    for (const packet of this.packets) {
      await this.writer.writeBytes(packet)
    }
  }
}

export class Mp3InputFormat extends InputFormat {
  get name(): string { return 'mp3' }
  get mimeType(): string { return 'audio/mpeg' }
  get extensions(): string[] { return ['mp3'] }

  async canRead(source: Source): Promise<boolean> {
    const reader = Reader.fromSource(source)
    reader.position = 0
    const header = await reader.readBytes(10)
    if (!header) return false

    // Check for ID3v2
    if (header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) {
      return true
    }

    // Check for MP3 sync word
    if (header[0] === 0xFF && (header[1] & 0xE0) === 0xE0) {
      return parseFrameHeader(header, 0) !== null
    }

    return false
  }

  createDemuxer(source: Source): Demuxer {
    return new Mp3Demuxer(source)
  }
}

export class Mp3OutputFormat extends OutputFormat {
  get name(): string { return 'mp3' }
  get mimeType(): string { return 'audio/mpeg' }
  get extension(): string { return 'mp3' }

  createMuxer(target: Target): Muxer {
    return new Mp3Muxer(target)
  }
}

export const MP3 = new Mp3InputFormat()
export const MP3_OUTPUT = new Mp3OutputFormat()

// Re-export types
export type { Mp3FrameHeader, Mp3Frame, ID3v1Tag, ID3v2Tag, ID3v2Frame }
