/**
 * FLAC as decodeAudio meets it: a whole .flac file, and FLAC tracks of other
 * containers whose packets a caller feeds in (Ogg FLAC here, Matroska and MP4
 * in ts-videos).
 *
 * Both go through `parseFlacFrameHeader`, so a sync word that turns up inside
 * residual data is rejected by its CRC-8 rather than splitting a frame.
 */

import type { AudioPacketDecoder, AudioTrack, DecodedAudioChunk, EncodedPacket, FlacStreamInfo } from '@ts-audio/core'
import type { FlacStreamShape } from './flac-decoder'
import { AudioTooLongError } from '@ts-audio/core'
import { FlacDecodeError, FlacDecoder, flacSamplesToFloat, parseFlacFrameHeader, parseFlacStreamInfo } from './flac-decoder'

/** Every FLAC file starts "fLaC". */
export function isFlac(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x66 && bytes[1] === 0x4C && bytes[2] === 0x61 && bytes[3] === 0x43
}

/** The STREAMINFO block type, which comes first in any well-formed list. */
const BLOCK_STREAMINFO = 0

/** The length STREAMINFO always has. */
const STREAMINFO_LENGTH = 34

/** Walks a FLAC metadata block list: the STREAMINFO in it, and where the list ends. */
function readMetadataBlocks(bytes: Uint8Array, at: number): { streamInfo: FlacStreamInfo | null, end: number, complete: boolean } {
  let streamInfo: FlacStreamInfo | null = null
  while (at + 4 <= bytes.length) {
    const isLast = (bytes[at] & 0x80) !== 0
    const type = bytes[at] & 0x7F
    const length = (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]
    const body = at + 4
    if (body + length > bytes.length)
      break
    if (type === BLOCK_STREAMINFO && !streamInfo && length >= STREAMINFO_LENGTH)
      streamInfo = parseFlacStreamInfo(bytes.subarray(body, body + length))
    at = body + length
    if (isLast)
      return { streamInfo, end: at, complete: true }
  }
  return { streamInfo, end: at, complete: false }
}

/** Where the frames start, and the STREAMINFO block before them. */
export function readFlacMetadata(bytes: Uint8Array): { streamInfo: FlacStreamInfo, audioStart: number } {
  if (!isFlac(bytes))
    throw new FlacDecodeError('Not a FLAC file')
  const { streamInfo, end, complete } = readMetadataBlocks(bytes, 4)
  if (!complete)
    throw new FlacDecodeError('FLAC file ends inside its metadata')
  if (!streamInfo)
    throw new FlacDecodeError('FLAC file has no STREAMINFO block')
  return { streamInfo, audioStart: end }
}

/**
 * The STREAMINFO a container hands over as a track's description, in any of
 * the three shapes one arrives in:
 *
 * - "fLaC" then the metadata blocks, which is the WebCodecs registry's shape
 *   and what Matroska's CodecPrivate holds;
 * - the metadata blocks alone, which is MP4's dfLa box past its FullBox
 *   header;
 * - a bare STREAMINFO block, which is what this package's own demuxer has.
 *
 * Null where it is none of them. Telling the second from the third is safe:
 * a STREAMINFO block header reads 0x00 or 0x80 then a length of 34, and for a
 * bare block to begin the same way its minimum block size would have to be 0,
 * which FLAC does not allow below 16.
 */
export function streamInfoFromDescription(description: Uint8Array): FlacStreamInfo | null {
  if (description.length < STREAMINFO_LENGTH)
    return null
  if (isFlac(description))
    return readMetadataBlocks(description, 4).streamInfo
  const type = description[0] & 0x7F
  const length = (description[1] << 16) | (description[2] << 8) | description[3]
  if (type === BLOCK_STREAMINFO && length === STREAMINFO_LENGTH && description.length >= 4 + STREAMINFO_LENGTH)
    return readMetadataBlocks(description, 0).streamInfo
  return parseFlacStreamInfo(description)
}

/**
 * The frames of a FLAC file in order. A frame states no length, so each one
 * runs to the next header that passes its CRC-8, or to the end of the file.
 */
export function readFlacFrames(bytes: Uint8Array, audioStart: number): Uint8Array[] {
  const frames: Uint8Array[] = []
  let at = audioStart
  while (at + 5 <= bytes.length) {
    if (!parseFlacFrameHeader(bytes, at)) {
      at++
      continue
    }
    let end = at + 5
    while (end + 5 <= bytes.length && !parseFlacFrameHeader(bytes, end)) end++
    if (end + 5 > bytes.length)
      end = bytes.length
    frames.push(bytes.subarray(at, end))
    at = end
  }
  return frames
}

export interface DecodeFlacOptions {
  signal?: AbortSignal
  maxDurationSeconds?: number
}

/** A FLAC file decoded to the integer samples the encoder was given. */
export interface DecodedFlac {
  sampleRate: number
  bitsPerSample: number
  channels: Int32Array[]
  streamInfo: FlacStreamInfo
}

/**
 * A FLAC file to its original integer samples. Lossless is the point of FLAC,
 * so this hands back the integers; `flacSamplesToFloat` scales them where
 * floats are wanted, and `flacMd5Bytes` packs them the way the stream's own
 * MD5 was taken.
 */
export function decodeFlacFile(bytes: Uint8Array, options: DecodeFlacOptions = {}): DecodedFlac {
  const { streamInfo, audioStart } = readFlacMetadata(bytes)
  const frames = readFlacFrames(bytes, audioStart)
  if (!frames.length) {
    // A stream with no frames is valid, and libFLAC decodes it to nothing. One
    // whose STREAMINFO promises samples has lost its frames, which is damage.
    if (streamInfo.totalSamples > 0n)
      throw new FlacDecodeError('FLAC file holds no frames')
    const channels = Array.from({ length: streamInfo.channels }, () => new Int32Array(0))
    return { sampleRate: streamInfo.sampleRate, bitsPerSample: streamInfo.bitsPerSample, channels, streamInfo }
  }
  const decoder = new FlacDecoder(streamInfo)
  const blocks: Int32Array[][] = []
  let total = 0
  for (const frame of frames) {
    options.signal?.throwIfAborted()
    const decoded = decoder.decodeFrame(frame)
    blocks.push(decoded.channels)
    total += decoded.channels[0].length
    if (options.maxDurationSeconds !== undefined && total / streamInfo.sampleRate > options.maxDurationSeconds)
      throw new AudioTooLongError(options.maxDurationSeconds)
  }
  const channelCount = blocks[0].length
  const channels = Array.from({ length: channelCount }, () => new Int32Array(total))
  let at = 0
  for (const block of blocks) {
    for (let c = 0; c < channelCount; c++) channels[c].set(block[Math.min(c, block.length - 1)], at)
    at += block[0].length
  }
  return { sampleRate: streamInfo.sampleRate, bitsPerSample: streamInfo.bitsPerSample, channels, streamInfo }
}

/**
 * A decoder for a FLAC track: one packet is one frame, which is what the
 * demuxer here and ts-videos' Matroska and MP4 readers hand over. The track's
 * `codecDescription` is its STREAMINFO block, for the frames that defer their
 * sample rate or bit depth to it.
 */
export function createFlacDecoder(track: AudioTrack): AudioPacketDecoder {
  let shape: Partial<FlacStreamShape> = {
    sampleRate: track.sampleRate,
    channels: track.channels,
    bitsPerSample: track.bitDepth,
  }
  if (track.codecDescription?.length) {
    try {
      shape = streamInfoFromDescription(track.codecDescription) ?? shape
    }
    catch {
      // A description that holds no STREAMINFO leaves the track's own numbers
      // in place; the frames themselves state the rate and depth unless they
      // defer, and a frame that defers with nothing to defer to is refused by
      // name rather than guessed at.
    }
  }
  const decoder = new FlacDecoder(shape)
  return {
    decode: (packet: EncodedPacket): DecodedAudioChunk | null => {
      const decoded = decoder.decodeFrame(packet.data)
      if (!decoded.channels[0]?.length)
        return null
      return { sampleRate: decoded.sampleRate, channels: flacSamplesToFloat(decoded.channels, decoded.bitsPerSample) }
    },
  }
}
