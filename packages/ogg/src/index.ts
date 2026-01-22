/**
 * OGG container codec package for ts-audio
 * Supports Vorbis, Opus, and FLAC codecs within OGG container
 */

import type { Source, Target, AudioTrack, EncodedPacket, AudioMetadata, AudioCodec, VorbisComment } from 'ts-audio'
import { InputFormat, OutputFormat, Demuxer, Muxer, Reader, crc32 } from 'ts-audio'

// OGG page header magic
const OGG_MAGIC = 0x4F676753 // "OggS"

// Header type flags
const HEADER_TYPE_CONTINUATION = 0x01
const HEADER_TYPE_BOS = 0x02 // Beginning of stream
const HEADER_TYPE_EOS = 0x04 // End of stream

interface OggPage {
  version: number
  headerType: number
  granulePosition: bigint
  serialNumber: number
  pageSequence: number
  checksum: number
  segmentCount: number
  segmentTable: number[]
  data: Uint8Array
  offset: number
}

interface OggStream {
  serialNumber: number
  codec: AudioCodec
  sampleRate: number
  channels: number
  packets: OggPacket[]
  codecPrivate?: Uint8Array
  vorbisComment?: VorbisComment
}

interface OggPacket {
  data: Uint8Array
  granulePosition: bigint
  timestamp: number
}

function parseOggPage(data: Uint8Array, offset: number): OggPage | null {
  if (offset + 27 > data.length) return null

  const view = new DataView(data.buffer, data.byteOffset + offset, data.byteLength - offset)

  // Check magic
  const magic = view.getUint32(0, false)
  if (magic !== OGG_MAGIC) return null

  const version = view.getUint8(4)
  const headerType = view.getUint8(5)
  const granulePosition = view.getBigInt64(6, true)
  const serialNumber = view.getUint32(14, true)
  const pageSequence = view.getUint32(18, true)
  const checksum = view.getUint32(22, true)
  const segmentCount = view.getUint8(26)

  if (offset + 27 + segmentCount > data.length) return null

  const segmentTable: number[] = []
  let totalSize = 0
  for (let i = 0; i < segmentCount; i++) {
    const size = data[offset + 27 + i]
    segmentTable.push(size)
    totalSize += size
  }

  const dataStart = offset + 27 + segmentCount
  if (dataStart + totalSize > data.length) return null

  return {
    version,
    headerType,
    granulePosition,
    serialNumber,
    pageSequence,
    checksum,
    segmentCount,
    segmentTable,
    data: data.subarray(dataStart, dataStart + totalSize),
    offset,
  }
}

function detectCodec(data: Uint8Array): { codec: AudioCodec, sampleRate: number, channels: number } | null {
  // Check for Vorbis
  if (data.length >= 8 && data[0] === 0x01 && String.fromCharCode(...data.subarray(1, 7)) === 'vorbis') {
    if (data.length >= 30) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      const channels = view.getUint8(11)
      const sampleRate = view.getUint32(12, true)
      return { codec: 'vorbis', sampleRate, channels }
    }
  }

  // Check for Opus
  if (data.length >= 8 && String.fromCharCode(...data.subarray(0, 8)) === 'OpusHead') {
    if (data.length >= 12) {
      const channels = data[9]
      // Opus always uses 48000 Hz internally
      const sampleRate = 48000
      return { codec: 'opus', sampleRate, channels }
    }
  }

  // Check for FLAC in OGG
  if (data.length >= 5 && data[0] === 0x7F && String.fromCharCode(...data.subarray(1, 5)) === 'FLAC') {
    // Would need more parsing for sample rate/channels
    return { codec: 'flac', sampleRate: 44100, channels: 2 }
  }

  return null
}

function parseVorbisComment(data: Uint8Array): VorbisComment | null {
  // Check for Vorbis comment header
  if (data.length < 7 || data[0] !== 0x03 || String.fromCharCode(...data.subarray(1, 7)) !== 'vorbis') {
    // Check for Opus tags
    if (data.length < 8 || String.fromCharCode(...data.subarray(0, 8)) !== 'OpusTags') {
      return null
    }
    data = data.subarray(8)
  } else {
    data = data.subarray(7)
  }

  if (data.length < 4) return null

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let pos = 0

  // Vendor string
  const vendorLength = view.getUint32(pos, true)
  pos += 4
  if (pos + vendorLength > data.length) return null
  const vendor = new TextDecoder().decode(data.subarray(pos, pos + vendorLength))
  pos += vendorLength

  // Comment count
  if (pos + 4 > data.length) return null
  const commentCount = view.getUint32(pos, true)
  pos += 4

  const comments: Record<string, string[]> = {}

  for (let i = 0; i < commentCount; i++) {
    if (pos + 4 > data.length) break
    const length = view.getUint32(pos, true)
    pos += 4
    if (pos + length > data.length) break

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
  if (get('COMMENT') || get('DESCRIPTION')) {
    metadata.comment = get('COMMENT') ?? get('DESCRIPTION')
  }

  return metadata
}

// OGG CRC-32 lookup table
function createOggCrcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let r = i << 24
    for (let j = 0; j < 8; j++) {
      r = (r & 0x80000000) ? ((r << 1) ^ 0x04C11DB7) : (r << 1)
    }
    table[i] = r >>> 0
  }
  return table
}

const OGG_CRC_TABLE = createOggCrcTable()

function calculateOggCrc(data: Uint8Array): number {
  let crc = 0
  for (let i = 0; i < data.length; i++) {
    crc = ((crc << 8) ^ OGG_CRC_TABLE[(crc >>> 24) ^ data[i]]) >>> 0
  }
  return crc
}

export class OggDemuxer extends Demuxer {
  private streams: Map<number, OggStream> = new Map()
  private pages: OggPage[] = []
  private primaryStream: OggStream | null = null
  private currentPacketIndex = 0
  private _initialized = false

  get formatName(): string {
    return 'ogg'
  }

  get mimeType(): string {
    if (this.primaryStream?.codec === 'opus') return 'audio/ogg; codecs=opus'
    if (this.primaryStream?.codec === 'vorbis') return 'audio/ogg; codecs=vorbis'
    return 'audio/ogg'
  }

  async init(): Promise<void> {
    if (this._initialized) return
    this._initialized = true

    await this.scanPages()
    await this.buildStreams()
    await this.buildTrack()
  }

  private async scanPages(): Promise<void> {
    this.reader.position = 0
    const fileSize = await this.reader.getSize()
    const maxPos = fileSize ?? Number.MAX_SAFE_INTEGER

    while (this.reader.position < maxPos - 27) {
      const pos = this.reader.position
      const headerData = await this.reader.readBytes(27)
      if (!headerData) break

      // Check magic
      if (headerData[0] !== 0x4F || headerData[1] !== 0x67 ||
          headerData[2] !== 0x67 || headerData[3] !== 0x53) {
        this.reader.position = pos + 1
        continue
      }

      const segmentCount = headerData[26]
      const segmentTable = await this.reader.readBytes(segmentCount)
      if (!segmentTable) break

      let dataSize = 0
      for (let i = 0; i < segmentCount; i++) {
        dataSize += segmentTable[i]
      }

      const pageData = await this.reader.readBytes(dataSize)
      if (!pageData) break

      // Reconstruct full page for parsing
      const fullPage = new Uint8Array(27 + segmentCount + dataSize)
      fullPage.set(headerData, 0)
      fullPage.set(segmentTable, 27)
      fullPage.set(pageData, 27 + segmentCount)

      const page = parseOggPage(fullPage, 0)
      if (page) {
        page.offset = pos
        this.pages.push(page)
      }
    }
  }

  private async buildStreams(): Promise<void> {
    for (const page of this.pages) {
      let stream = this.streams.get(page.serialNumber)

      if (!stream) {
        // First page of a stream - detect codec
        const codecInfo = detectCodec(page.data)
        if (codecInfo) {
          stream = {
            serialNumber: page.serialNumber,
            codec: codecInfo.codec,
            sampleRate: codecInfo.sampleRate,
            channels: codecInfo.channels,
            packets: [],
            codecPrivate: page.data,
          }
          this.streams.set(page.serialNumber, stream)
        }
        continue
      }

      // Try to parse Vorbis comment
      if (!stream.vorbisComment) {
        const vc = parseVorbisComment(page.data)
        if (vc) {
          stream.vorbisComment = vc
          continue
        }
      }

      // Audio data page - extract packets
      if ((page.headerType & HEADER_TYPE_CONTINUATION) === 0) {
        let offset = 0
        for (const segmentSize of page.segmentTable) {
          if (segmentSize > 0) {
            const packetData = page.data.subarray(offset, offset + segmentSize)

            const timestamp = stream.packets.length > 0
              ? Number(page.granulePosition) / stream.sampleRate
              : 0

            stream.packets.push({
              data: packetData,
              granulePosition: page.granulePosition,
              timestamp,
            })
          }
          offset += segmentSize
        }
      }
    }

    // Select primary stream
    if (this.streams.size > 0) {
      this.primaryStream = this.streams.values().next().value
    }
  }

  private async buildTrack(): Promise<void> {
    if (!this.primaryStream) {
      this._tracks = []
      this._duration = 0
      this._metadata = {}
      return
    }

    const track: AudioTrack = {
      type: 'audio',
      id: 1,
      index: 0,
      codec: this.primaryStream.codec,
      sampleRate: this.primaryStream.sampleRate,
      channels: this.primaryStream.channels,
      isDefault: true,
      codecDescription: this.primaryStream.codecPrivate,
    }

    this._tracks = [track]

    // Calculate duration from last packet
    const lastPacket = this.primaryStream.packets[this.primaryStream.packets.length - 1]
    this._duration = lastPacket ? lastPacket.timestamp : 0

    // Convert Vorbis comments to metadata
    this._metadata = this.primaryStream.vorbisComment
      ? vorbisCommentToMetadata(this.primaryStream.vorbisComment)
      : {}
  }

  async readPacket(trackId: number): Promise<EncodedPacket | null> {
    if (trackId !== 1 || !this.primaryStream || this.currentPacketIndex >= this.primaryStream.packets.length) {
      return null
    }

    const packet = this.primaryStream.packets[this.currentPacketIndex]
    this.currentPacketIndex++

    return {
      data: packet.data,
      timestamp: packet.timestamp,
      isKeyframe: true,
      trackId: 1,
    }
  }

  async seek(timeInSeconds: number): Promise<void> {
    if (!this.primaryStream) return

    for (let i = 0; i < this.primaryStream.packets.length; i++) {
      if (this.primaryStream.packets[i].timestamp >= timeInSeconds) {
        this.currentPacketIndex = Math.max(0, i - 1)
        return
      }
    }
    this.currentPacketIndex = this.primaryStream.packets.length
  }
}

export class OggMuxer extends Muxer {
  private packets: Uint8Array[] = []
  private serialNumber = Math.floor(Math.random() * 0xFFFFFFFF)
  private pageSequence = 0
  private codec: AudioCodec = 'opus'
  private sampleRate = 48000
  private channels = 2
  private codecPrivate: Uint8Array | null = null

  get formatName(): string {
    return 'ogg'
  }

  get mimeType(): string {
    return this.codec === 'opus' ? 'audio/ogg; codecs=opus' : 'audio/ogg; codecs=vorbis'
  }

  protected onTrackAdded(track: { type: string, config: { codec: AudioCodec, sampleRate: number, channels: number, codecDescription?: Uint8Array } }): void {
    if (track.type === 'audio') {
      this.codec = track.config.codec
      this.sampleRate = track.config.sampleRate
      this.channels = track.config.channels
      this.codecPrivate = track.config.codecDescription ?? null
    }
  }

  protected async writeHeader(): Promise<void> {}

  protected async writeAudioPacket(_track: unknown, packet: EncodedPacket): Promise<void> {
    this.packets.push(packet.data)
  }

  protected async writeTrailer(): Promise<void> {
    // Write codec header page
    if (this.codecPrivate) {
      await this.writePage(this.codecPrivate, 0n, HEADER_TYPE_BOS)
    }

    // Write audio data pages
    let granulePosition = 0n
    for (let i = 0; i < this.packets.length; i++) {
      const isLast = i === this.packets.length - 1
      // Opus uses 960 samples per frame at 48kHz, Vorbis varies
      granulePosition += BigInt(this.codec === 'opus' ? 960 : 1024)
      await this.writePage(this.packets[i], granulePosition, isLast ? HEADER_TYPE_EOS : 0x00)
    }
  }

  private async writePage(data: Uint8Array, granulePosition: bigint, headerType: number): Promise<void> {
    const segmentCount = Math.ceil(data.length / 255)
    const segmentTable = new Uint8Array(segmentCount)

    let remaining = data.length
    for (let i = 0; i < segmentCount; i++) {
      segmentTable[i] = Math.min(255, remaining)
      remaining -= 255
    }

    const pageSize = 27 + segmentCount + data.length
    const page = new Uint8Array(pageSize)
    const view = new DataView(page.buffer)

    // Header
    view.setUint32(0, OGG_MAGIC, false)
    view.setUint8(4, 0) // version
    view.setUint8(5, headerType)
    view.setBigInt64(6, granulePosition, true)
    view.setUint32(14, this.serialNumber, true)
    view.setUint32(18, this.pageSequence++, true)
    view.setUint32(22, 0, true) // checksum placeholder
    view.setUint8(26, segmentCount)

    page.set(segmentTable, 27)
    page.set(data, 27 + segmentCount)

    // Calculate and set checksum
    const checksum = calculateOggCrc(page)
    view.setUint32(22, checksum, true)

    await this.writer.writeBytes(page)
  }
}

export class OggInputFormat extends InputFormat {
  get name(): string { return 'ogg' }
  get mimeType(): string { return 'audio/ogg' }
  get extensions(): string[] { return ['ogg', 'oga', 'ogx', 'spx', 'opus'] }

  async canRead(source: Source): Promise<boolean> {
    const reader = Reader.fromSource(source)
    reader.position = 0
    const magic = await reader.readU32BE()
    return magic === OGG_MAGIC
  }

  createDemuxer(source: Source): Demuxer {
    return new OggDemuxer(source)
  }
}

export class OggOutputFormat extends OutputFormat {
  get name(): string { return 'ogg' }
  get mimeType(): string { return 'audio/ogg' }
  get extension(): string { return 'ogg' }

  createMuxer(target: Target): Muxer {
    return new OggMuxer(target)
  }
}

export const OGG = new OggInputFormat()
export const OGG_OUTPUT = new OggOutputFormat()

// Export types and utilities
export type { OggPage, OggStream, OggPacket }
export { parseOggPage, detectCodec, parseVorbisComment, vorbisCommentToMetadata, calculateOggCrc }
export { HEADER_TYPE_CONTINUATION, HEADER_TYPE_BOS, HEADER_TYPE_EOS }
