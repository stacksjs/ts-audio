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

/** Where the frames start, and the STREAMINFO block before them. */
export function readFlacMetadata(bytes: Uint8Array): { streamInfo: FlacStreamInfo, audioStart: number } {
  if (!isFlac(bytes))
    throw new FlacDecodeError('Not a FLAC file')
  let at = 4
  let streamInfo: FlacStreamInfo | null = null
  for (;;) {
    if (at + 4 > bytes.length)
      throw new FlacDecodeError('FLAC file ends inside its metadata')
    const isLast = (bytes[at] & 0x80) !== 0
    const type = bytes[at] & 0x7F
    const length = (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]
    const body = at + 4
    if (type === 0)
      streamInfo = parseFlacStreamInfo(bytes.subarray(body, body + length))
    at = body + length
    if (isLast)
      break
  }
  if (!streamInfo)
    throw new FlacDecodeError('FLAC file has no STREAMINFO block')
  return { streamInfo, audioStart: at }
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
  if (!frames.length)
    throw new FlacDecodeError('FLAC file holds no frames')
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
      const streamInfo = parseFlacStreamInfo(track.codecDescription)
      shape = streamInfo
    }
    catch {
      // A description that is not a STREAMINFO block leaves the track's own numbers in place.
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
