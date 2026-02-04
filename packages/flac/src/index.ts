/**
 * FLAC codec package for ts-audio
 * Implements FLAC format demuxing/muxing with metadata support
 */

import type { Source, Target, AudioTrack, EncodedPacket, AudioMetadata, FlacStreamInfo, FlacPicture, VorbisComment } from 'ts-audio'
import { InputFormat, OutputFormat, Demuxer, Muxer, Reader, crc8Flac, crc16Flac } from 'ts-audio'

// FLAC magic number
const FLAC_MAGIC = 0x664C6143 // "fLaC"

// Metadata block types
const BLOCK_STREAMINFO = 0
const BLOCK_PADDING = 1
const BLOCK_APPLICATION = 2
const BLOCK_SEEKTABLE = 3
const BLOCK_VORBIS_COMMENT = 4
const BLOCK_CUESHEET = 5
const BLOCK_PICTURE = 6

// Frame sync code
const FRAME_SYNC = 0x3FFE

// Picture types
const PICTURE_TYPES = [
  'Other', 'File icon', 'Other file icon', 'Front cover', 'Back cover',
  'Leaflet', 'Media', 'Lead artist', 'Artist', 'Conductor', 'Band/Orchestra',
  'Composer', 'Lyricist', 'Recording Location', 'During recording', 'During performance',
  'Movie/video screen capture', 'A bright coloured fish', 'Illustration', 'Band/artist logotype',
  'Publisher/Studio logotype',
] as const

interface MetadataBlock {
  type: number
  isLast: boolean
  length: number
  data: Uint8Array
  offset: number
}

interface FlacFrame {
  data: Uint8Array
  offset: number
  blockSize: number
  sampleNumber: bigint
  timestamp: number
}

function parseStreamInfo(data: Uint8Array): FlacStreamInfo {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  const minBlockSize = view.getUint16(0, false)
  const maxBlockSize = view.getUint16(2, false)
  const minFrameSize = (data[4] << 16) | (data[5] << 8) | data[6]
  const maxFrameSize = (data[7] << 16) | (data[8] << 8) | data[9]

  // Sample rate (20 bits), channels (3 bits), bits per sample (5 bits)
  const sampleRate = (data[10] << 12) | (data[11] << 4) | (data[12] >> 4)
  const channels = ((data[12] >> 1) & 0x07) + 1
  const bitsPerSample = ((data[12] & 0x01) << 4) | (data[13] >> 4) + 1

  // Total samples (36 bits)
  const totalSamplesHigh = data[13] & 0x0F
  const totalSamplesLow = (data[14] << 24) | (data[15] << 16) | (data[16] << 8) | data[17]
  const totalSamples = (BigInt(totalSamplesHigh) << 32n) | BigInt(totalSamplesLow >>> 0)

  // MD5 signature
  const md5 = data.subarray(18, 34)

  return {
    minBlockSize,
    maxBlockSize,
    minFrameSize,
    maxFrameSize,
    sampleRate,
    channels,
    bitsPerSample,
    totalSamples,
    md5,
  }
}

function parseVorbisComment(data: Uint8Array): VorbisComment {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let pos = 0

  // Vendor string
  const vendorLength = view.getUint32(pos, true)
  pos += 4
  const vendor = new TextDecoder().decode(data.subarray(pos, pos + vendorLength))
  pos += vendorLength

  // Comment count
  const commentCount = view.getUint32(pos, true)
  pos += 4

  const comments: Record<string, string[]> = {}

  for (let i = 0; i < commentCount; i++) {
    const length = view.getUint32(pos, true)
    pos += 4
    const comment = new TextDecoder().decode(data.subarray(pos, pos + length))
    pos += length

    const eqIndex = comment.indexOf('=')
    if (eqIndex > 0) {
      const key = comment.substring(0, eqIndex).toUpperCase()
      const value = comment.substring(eqIndex + 1)
      if (!comments[key]) comments[key] = []
      comments[key].push(value)
    }
  }

  return { vendor, comments }
}

function parsePicture(data: Uint8Array): FlacPicture {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let pos = 0

  const type = view.getUint32(pos, false)
  pos += 4

  const mimeLength = view.getUint32(pos, false)
  pos += 4
  const mimeType = new TextDecoder().decode(data.subarray(pos, pos + mimeLength))
  pos += mimeLength

  const descLength = view.getUint32(pos, false)
  pos += 4
  const description = new TextDecoder().decode(data.subarray(pos, pos + descLength))
  pos += descLength

  const width = view.getUint32(pos, false)
  pos += 4
  const height = view.getUint32(pos, false)
  pos += 4
  const colorDepth = view.getUint32(pos, false)
  pos += 4
  const colorCount = view.getUint32(pos, false)
  pos += 4

  const pictureLength = view.getUint32(pos, false)
  pos += 4
  const pictureData = data.subarray(pos, pos + pictureLength)

  return {
    type,
    mimeType,
    description,
    width,
    height,
    colorDepth,
    colorCount,
    data: pictureData,
  }
}

function vorbisCommentToMetadata(vc: VorbisComment): AudioMetadata {
  const metadata: AudioMetadata = {}
  const get = (key: string) => vc.comments[key]?.[0]

  if (get('TITLE')) metadata.title = get('TITLE')
  if (get('ARTIST')) metadata.artist = get('ARTIST')
  if (get('ALBUM')) metadata.album = get('ALBUM')
  if (get('ALBUMARTIST')) metadata.albumArtist = get('ALBUMARTIST')
  if (get('COMPOSER')) metadata.composer = get('COMPOSER')
  if (get('GENRE')) metadata.genre = get('GENRE')
  if (get('DATE')) {
    const year = Number.parseInt(get('DATE')!.substring(0, 4), 10)
    if (!Number.isNaN(year)) metadata.year = year
    metadata.date = get('DATE')
  }
  if (get('TRACKNUMBER')) {
    metadata.trackNumber = Number.parseInt(get('TRACKNUMBER')!, 10)
  }
  if (get('TRACKTOTAL') || get('TOTALTRACKS')) {
    metadata.trackTotal = Number.parseInt(get('TRACKTOTAL') ?? get('TOTALTRACKS')!, 10)
  }
  if (get('DISCNUMBER')) {
    metadata.discNumber = Number.parseInt(get('DISCNUMBER')!, 10)
  }
  if (get('DISCTOTAL') || get('TOTALDISCS')) {
    metadata.discTotal = Number.parseInt(get('DISCTOTAL') ?? get('TOTALDISCS')!, 10)
  }
  if (get('COMMENT') || get('DESCRIPTION')) {
    metadata.comment = get('COMMENT') ?? get('DESCRIPTION')
  }
  if (get('COPYRIGHT')) metadata.copyright = get('COPYRIGHT')
  if (get('ENCODER')) metadata.encoder = get('ENCODER')
  if (get('ISRC')) metadata.isrc = get('ISRC')
  if (get('BPM')) {
    const bpm = Number.parseInt(get('BPM')!, 10)
    if (!Number.isNaN(bpm)) metadata.bpm = bpm
  }
  if (get('LYRICS') || get('UNSYNCEDLYRICS')) {
    metadata.lyrics = get('LYRICS') ?? get('UNSYNCEDLYRICS')
  }

  // Replay gain
  if (get('REPLAYGAIN_TRACK_GAIN') || get('REPLAYGAIN_ALBUM_GAIN')) {
    metadata.replayGain = {}
    if (get('REPLAYGAIN_TRACK_GAIN')) {
      metadata.replayGain.trackGain = Number.parseFloat(get('REPLAYGAIN_TRACK_GAIN')!.replace(' dB', ''))
    }
    if (get('REPLAYGAIN_TRACK_PEAK')) {
      metadata.replayGain.trackPeak = Number.parseFloat(get('REPLAYGAIN_TRACK_PEAK')!)
    }
    if (get('REPLAYGAIN_ALBUM_GAIN')) {
      metadata.replayGain.albumGain = Number.parseFloat(get('REPLAYGAIN_ALBUM_GAIN')!.replace(' dB', ''))
    }
    if (get('REPLAYGAIN_ALBUM_PEAK')) {
      metadata.replayGain.albumPeak = Number.parseFloat(get('REPLAYGAIN_ALBUM_PEAK')!)
    }
  }

  return metadata
}

export class FlacDemuxer extends Demuxer {
  private streamInfo: FlacStreamInfo | null = null
  private vorbisComment: VorbisComment | null = null
  private pictures: FlacPicture[] = []
  private frames: FlacFrame[] = []
  private audioDataStart = 0
  private currentFrameIndex = 0
  private _initialized = false

  get formatName(): string {
    return 'flac'
  }

  get mimeType(): string {
    return 'audio/flac'
  }

  async init(): Promise<void> {
    if (this._initialized) return
    this._initialized = true

    this.reader.position = 0

    // Read FLAC magic
    const magic = await this.reader.readU32BE()
    if (magic !== FLAC_MAGIC) {
      throw new Error('Invalid FLAC file: missing fLaC header')
    }

    // Parse metadata blocks
    let isLast = false
    while (!isLast) {
      const header = await this.reader.readU8()
      if (header === null) break

      isLast = (header & 0x80) !== 0
      const blockType = header & 0x7F
      const length = await this.reader.readU24BE()
      if (length === null) break

      const offset = this.reader.position
      const data = await this.reader.readBytes(length)
      if (!data) break

      const block: MetadataBlock = {
        type: blockType,
        isLast,
        length,
        data,
        offset,
      }

      this.processMetadataBlock(block)
    }

    this.audioDataStart = this.reader.position

    if (!this.streamInfo) {
      throw new Error('Invalid FLAC file: missing STREAMINFO block')
    }

    // Scan frames
    await this.scanFrames()

    // Build track
    const track: AudioTrack = {
      type: 'audio',
      id: 1,
      index: 0,
      codec: 'flac',
      sampleRate: this.streamInfo.sampleRate,
      channels: this.streamInfo.channels,
      bitDepth: this.streamInfo.bitsPerSample,
      isDefault: true,
    }

    this._tracks = [track]
    this._duration = Number(this.streamInfo.totalSamples) / this.streamInfo.sampleRate

    // Build metadata
    const metadata = this.vorbisComment ? vorbisCommentToMetadata(this.vorbisComment) : {}

    if (this.pictures.length > 0) {
      metadata.coverArt = this.pictures.map(pic => ({
        data: pic.data,
        mimeType: pic.mimeType,
        description: pic.description || PICTURE_TYPES[pic.type] || 'Unknown',
      }))
    }

    this._metadata = metadata
  }

  private processMetadataBlock(block: MetadataBlock): void {
    switch (block.type) {
      case BLOCK_STREAMINFO:
        this.streamInfo = parseStreamInfo(block.data)
        break
      case BLOCK_VORBIS_COMMENT:
        this.vorbisComment = parseVorbisComment(block.data)
        break
      case BLOCK_PICTURE:
        this.pictures.push(parsePicture(block.data))
        break
    }
  }

  private async scanFrames(): Promise<void> {
    if (!this.streamInfo) return

    this.reader.position = this.audioDataStart
    const fileSize = await this.reader.getSize() ?? 0
    let sampleNumber = 0n

    while (this.reader.position < fileSize - 2) {
      const pos = this.reader.position
      const syncBytes = await this.reader.readBytes(2)
      if (!syncBytes) break

      // Check for frame sync (14 bits: 0x3FFE)
      const syncWord = ((syncBytes[0] << 8) | syncBytes[1]) >> 2
      if (syncWord !== FRAME_SYNC) {
        this.reader.position = pos + 1
        continue
      }

      // Read frame header to get block size
      this.reader.position = pos
      const headerBytes = await this.reader.readBytes(16)
      if (!headerBytes) break

      // Parse enough to get block size
      const blockSizeCode = (headerBytes[2] >> 4) & 0x0F
      let blockSize: number

      switch (blockSizeCode) {
        case 0: blockSize = 0; break
        case 1: blockSize = 192; break
        case 2: case 3: case 4: case 5:
          blockSize = 576 * (1 << (blockSizeCode - 2))
          break
        case 6: blockSize = 0; break // Read from end of header
        case 7: blockSize = 0; break // Read from end of header
        default:
          blockSize = 256 * (1 << (blockSizeCode - 8))
      }

      // Skip to find frame end (look for next sync or EOF)
      this.reader.position = pos + 16
      let frameEnd = fileSize

      while (this.reader.position < fileSize - 2) {
        const nextSync = await this.reader.readBytes(2)
        if (!nextSync) break
        const nextSyncWord = ((nextSync[0] << 8) | nextSync[1]) >> 2
        if (nextSyncWord === FRAME_SYNC) {
          frameEnd = this.reader.position - 2
          break
        }
        this.reader.position--
      }

      // Read full frame
      this.reader.position = pos
      const frameSize = frameEnd - pos
      const frameData = await this.reader.readBytes(frameSize)
      if (!frameData) break

      const timestamp = Number(sampleNumber) / this.streamInfo.sampleRate

      this.frames.push({
        data: frameData,
        offset: pos,
        blockSize: blockSize || this.streamInfo.maxBlockSize,
        sampleNumber,
        timestamp,
      })

      sampleNumber += BigInt(blockSize || this.streamInfo.maxBlockSize)
      this.reader.position = frameEnd
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
      duration: frame.blockSize / (this.streamInfo?.sampleRate ?? 44100),
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

export class FlacMuxer extends Muxer {
  private packets: Uint8Array[] = []
  private sampleRate = 44100
  private channels = 2
  private bitsPerSample = 16

  get formatName(): string {
    return 'flac'
  }

  get mimeType(): string {
    return 'audio/flac'
  }

  protected onTrackAdded(track: { type: string, config: { sampleRate: number, channels: number, bitDepth?: number } }): void {
    if (track.type === 'audio') {
      this.sampleRate = track.config.sampleRate
      this.channels = track.config.channels
      this.bitsPerSample = track.config.bitDepth ?? 16
    }
  }

  protected async writeHeader(): Promise<void> {
    // Write fLaC magic
    await this.writer.writeFourCC('fLaC')
  }

  protected async writeAudioPacket(_track: unknown, packet: EncodedPacket): Promise<void> {
    this.packets.push(packet.data)
  }

  protected async writeTrailer(): Promise<void> {
    // Calculate total samples
    let totalSamples = 0n
    for (const packet of this.packets) {
      // Estimate based on typical FLAC block size
      totalSamples += 4096n
    }

    // Write STREAMINFO block (last metadata block)
    const streamInfo = new Uint8Array(34)
    const view = new DataView(streamInfo.buffer)

    // Block sizes (min/max) - typical values
    view.setUint16(0, 4096, false) // min block size
    view.setUint16(2, 4096, false) // max block size

    // Frame sizes (0 = unknown)
    streamInfo[4] = 0
    streamInfo[5] = 0
    streamInfo[6] = 0
    streamInfo[7] = 0
    streamInfo[8] = 0
    streamInfo[9] = 0

    // Sample rate (20 bits), channels (3 bits), bits per sample (5 bits), total samples (36 bits)
    streamInfo[10] = (this.sampleRate >> 12) & 0xFF
    streamInfo[11] = (this.sampleRate >> 4) & 0xFF
    streamInfo[12] = ((this.sampleRate & 0x0F) << 4) | ((this.channels - 1) << 1) | ((this.bitsPerSample - 1) >> 4)
    streamInfo[13] = (((this.bitsPerSample - 1) & 0x0F) << 4) | Number((totalSamples >> 32n) & 0x0Fn)
    view.setUint32(14, Number(totalSamples & 0xFFFFFFFFn), false)

    // MD5 signature (zeros = unknown)
    for (let i = 18; i < 34; i++) {
      streamInfo[i] = 0
    }

    // Write metadata block header (last block)
    await this.writer.writeU8(0x80 | BLOCK_STREAMINFO)
    await this.writer.writeU24BE(34)
    await this.writer.writeBytes(streamInfo)

    // Write all audio frames
    for (const packet of this.packets) {
      await this.writer.writeBytes(packet)
    }
  }
}

export class FlacInputFormat extends InputFormat {
  get name(): string { return 'flac' }
  get mimeType(): string { return 'audio/flac' }
  get extensions(): string[] { return ['flac'] }

  async canRead(source: Source): Promise<boolean> {
    const reader = Reader.fromSource(source)
    reader.position = 0
    const magic = await reader.readU32BE()
    return magic === FLAC_MAGIC
  }

  createDemuxer(source: Source): Demuxer {
    return new FlacDemuxer(source)
  }
}

export class FlacOutputFormat extends OutputFormat {
  get name(): string { return 'flac' }
  get mimeType(): string { return 'audio/flac' }
  get extension(): string { return 'flac' }

  createMuxer(target: Target): Muxer {
    return new FlacMuxer(target)
  }
}

export const FLAC = new FlacInputFormat()
export const FLAC_OUTPUT = new FlacOutputFormat()

// Export types and utilities
export type { MetadataBlock, FlacFrame }
export { parseStreamInfo, parseVorbisComment, parsePicture, vorbisCommentToMetadata }
export { BLOCK_STREAMINFO, BLOCK_PADDING, BLOCK_APPLICATION, BLOCK_SEEKTABLE, BLOCK_VORBIS_COMMENT, BLOCK_CUESHEET, BLOCK_PICTURE }
