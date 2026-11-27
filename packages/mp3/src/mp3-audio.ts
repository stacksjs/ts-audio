/**
 * MP3 as decodeAudio meets it: plain .mp3 files (ID3 tags, junk between
 * frames, the Xing, Info or VBRI frame and LAME's gapless numbers) and MP3
 * tracks of any container, whose packets a caller feeds in (Matroska,
 * MPEG-TS and MP4 are read by ts-videos).
 *
 * The frame scanning here is the decoder's own: it needs the side-info
 * length and the numeric version and layer that `parseMp3Header` gives, and
 * it reads a whole file in one synchronous pass, where Mp3Demuxer reads a
 * Source asynchronously a packet at a time.
 */

import type { AudioPacketDecoder, AudioTrack, DecodedAudioChunk, EncodedPacket } from '@ts-audio/core'
import type { Mp3FrameHeader } from './mp3-decoder'
import { AudioTooLongError, UnsupportedAudioCodecError } from '@ts-audio/core'
import { Mp3DecodeError, Mp3Decoder, mp3SideInfoLength, parseMp3Header } from './mp3-decoder'

/** The decoder's own delay, which LAME's encoder delay leaves out: 528 samples of filterbank, plus one. */
const DECODER_DELAY = 529

/** The length of the ID3v2 tag at `at`, or 0 when there is none. */
function id3v2Length(bytes: Uint8Array, at: number): number {
  if (at + 10 > bytes.length || bytes[at] !== 0x49 || bytes[at + 1] !== 0x44 || bytes[at + 2] !== 0x33)
    return 0
  const size = ((bytes[at + 6] & 0x7F) << 21) | ((bytes[at + 7] & 0x7F) << 14) | ((bytes[at + 8] & 0x7F) << 7) | (bytes[at + 9] & 0x7F)
  return 10 + size + (bytes[at + 5] & 0x10 ? 10 : 0)
}

function skipId3(bytes: Uint8Array): number {
  let at = 0
  for (let length = id3v2Length(bytes, at); length; length = id3v2Length(bytes, at)) at += length
  return at
}

function sameStream(a: Mp3FrameHeader, b: Mp3FrameHeader): boolean {
  return a.version === b.version && a.layer === b.layer && a.sampleRate === b.sampleRate
}

/** A header the next frame confirms (or that ends the data): what tells a frame from bytes that look like one. */
function confirmedHeader(bytes: Uint8Array, at: number): Mp3FrameHeader | null {
  const header = parseMp3Header(bytes, at)
  // Free format gives no length to check the next frame by; it is too rare to guess at.
  if (!header || !header.frameLength)
    return null
  const next = at + header.frameLength
  if (next >= bytes.length - 4)
    return next <= bytes.length ? header : null
  const following = parseMp3Header(bytes, next)
  return following && sameStream(header, following) ? header : null
}

/** How far into the data the first frame may start: tags padded with zeros, a little junk. */
const SEARCH_LIMIT = 64 * 1024

/** The first MPEG audio frame of the data, after its ID3v2 tags. */
function firstFrame(bytes: Uint8Array): { at: number, header: Mp3FrameHeader } | null {
  const start = skipId3(bytes)
  for (let at = start; at < Math.min(bytes.length - 4, start + SEARCH_LIMIT); at++) {
    if (bytes[at] !== 0xFF)
      continue
    const header = confirmedHeader(bytes, at)
    if (header)
      return { at, header }
  }
  return null
}

/** Whether the data is an MPEG audio file (MP3, or MP2 and MP1, which are refused by name). */
export function isMp3(bytes: Uint8Array): boolean {
  // Most files start with their first frame or an ID3 tag; anything else would be a guess.
  const start = skipId3(bytes)
  if (start === 0 && bytes[0] !== 0xFF)
    return false
  return firstFrame(bytes) !== null
}

/** What the first frame says when it is a Xing, Info or VBRI frame rather than sound. */
export interface StreamInfo {
  /** LAME's encoder delay and padding, in samples. */
  delay: number
  padding: number
  hasGapless: boolean
}

function readInfoFrame(frame: Uint8Array, header: Mp3FrameHeader): StreamInfo | null {
  const text = (at: number, length: number): string => String.fromCharCode(...frame.subarray(at, at + length))
  if (frame.length >= 40 && text(36, 4) === 'VBRI')
    return { delay: 0, padding: 0, hasGapless: false }
  const at = 4 + mp3SideInfoLength(header)
  const tag = text(at, 4)
  if (tag !== 'Xing' && tag !== 'Info')
    return null
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
  if (at + 8 > frame.length)
    return { delay: 0, padding: 0, hasGapless: false }
  const flags = view.getUint32(at + 4)
  let p = at + 8
  if (flags & 1)
    p += 4
  if (flags & 2)
    p += 4
  if (flags & 4)
    p += 100
  if (flags & 8)
    p += 4
  // LAME's extension (also written by ffmpeg's encoder as Lavc/Lavf): delay and padding, 12 bits each, 21 bytes in.
  if (p + 24 > frame.length || !/^(?:LAME|Lavc|Lavf|L3\.99)/.test(text(p, 4)))
    return { delay: 0, padding: 0, hasGapless: false }
  const delay = (frame[p + 21] << 4) | (frame[p + 22] >> 4)
  const padding = ((frame[p + 22] & 0x0F) << 8) | frame[p + 23]
  return { delay, padding, hasGapless: true }
}

/** The frames of an MP3 file in order, without its tags, junk or Xing frame, and what its first frame says. */
export function readMp3Frames(bytes: Uint8Array): { frames: Uint8Array[], header: Mp3FrameHeader, info: StreamInfo | null } {
  const first = firstFrame(bytes)
  if (!first)
    throw new Error('No MPEG audio frames found')
  const frames: Uint8Array[] = []
  let at = first.at
  let synced = true
  while (at + 4 <= bytes.length) {
    const header = synced ? parseMp3Header(bytes, at) : confirmedHeader(bytes, at)
    if (header && header.frameLength && sameStream(header, first.header)) {
      if (at + header.frameLength > bytes.length)
        break
      frames.push(bytes.subarray(at, at + header.frameLength))
      at += header.frameLength
      synced = true
      continue
    }
    // Junk, a tag or the end: look for the next frame the one after it confirms.
    synced = false
    at++
  }
  const info = readInfoFrame(frames[0], first.header)
  if (info)
    frames.shift()
  return { frames, header: first.header, info }
}

export interface DecodeMp3Options {
  signal?: AbortSignal
  maxDurationSeconds?: number
}

/** An MP3 file to planar samples, without the encoder's delay and padding when LAME's tag gives them. */
export function decodeMp3File(bytes: Uint8Array, options: DecodeMp3Options = {}): { sampleRate: number, channels: Float32Array[] } {
  const { frames, header, info } = readMp3Frames(bytes)
  if (header.layer !== 3)
    throw new UnsupportedAudioCodecError(header.layer === 2 ? 'mp2' : 'mp1')
  const decoder = new Mp3Decoder()
  const channelCount = header.channels
  const total = frames.length * header.samples
  const channels = Array.from({ length: channelCount }, () => new Float32Array(total))
  // The filterbank's own delay always goes, as Apple's decoder drops it; LAME's tag adds the encoder's delay and padding.
  const skip = Math.min(total, (info?.hasGapless ? info.delay : 0) + DECODER_DELAY)
  const length = Math.max(0, info?.hasGapless ? Math.min(total - skip, total - info.delay - info.padding) : total - skip)
  const limit = options.maxDurationSeconds !== undefined ? options.maxDurationSeconds * header.sampleRate : Infinity
  let damaged = 0
  let firstError: Error | null = null
  let written = 0
  for (let i = 0; i < frames.length; i++) {
    options.signal?.throwIfAborted()
    try {
      const decoded = decoder.decodeFrame(frames[i]).channels
      if (decoded.length > channelCount) {
        // A stereo frame in a stream that began mono: both channels, mixed.
        const [left, right] = decoded
        for (let k = 0; k < left.length; k++) channels[0][written + k] = (left[k] + right[k]) / 2
      }
      else {
        for (let c = 0; c < channelCount; c++) channels[c].set(decoded[Math.min(c, decoded.length - 1)], written)
      }
    }
    catch (error) {
      if (!(error instanceof Mp3DecodeError))
        throw error
      // A damaged frame is heard as a moment of silence, as players do; a
      // stream that is mostly damage is refused.
      if (!firstError)
        firstError = error
      damaged++
      if (damaged > Math.max(3, (i + 1) * 0.05))
        throw new Mp3DecodeError(`The MP3 audio is damaged: ${firstError.message}`)
    }
    written += header.samples
    if (Math.min(written - skip, length) > limit)
      throw new AudioTooLongError(options.maxDurationSeconds!)
  }
  return { sampleRate: header.sampleRate, channels: channels.map(channel => channel.subarray(skip, skip + length)) }
}

/**
 * A decoder for an MP3 track of another container. A packet may hold one
 * frame (Matroska, MP4) or a run of bytes that frames cross (MPEG-TS).
 */
export function createMp3Decoder(track: AudioTrack): AudioPacketDecoder {
  const decoder = new Mp3Decoder()
  let pending = new Uint8Array(0)
  let frames = 0
  let damaged = 0
  let firstError: Error | null = null
  return {
    decode: (packet: EncodedPacket): DecodedAudioChunk | null => {
      const data = pending.length ? new Uint8Array(pending.length + packet.data.length) : packet.data
      if (pending.length) {
        data.set(pending)
        data.set(packet.data, pending.length)
      }
      const decoded: Float32Array[][] = []
      let sampleRate = track.sampleRate
      let at = 0
      while (at + 4 <= data.length) {
        const header = parseMp3Header(data, at)
        if (!header || !header.frameLength) {
          at++
          continue
        }
        if (at + header.frameLength > data.length)
          break
        if (header.layer !== 3)
          throw new UnsupportedAudioCodecError(header.layer === 2 ? 'mp2' : 'mp1')
        const frame = data.subarray(at, at + header.frameLength)
        at += header.frameLength
        if (frames === 0 && readInfoFrame(frame, header))
          continue
        frames++
        sampleRate = header.sampleRate
        try {
          decoded.push(decoder.decodeFrame(frame).channels)
        }
        catch (error) {
          if (!(error instanceof Mp3DecodeError))
            throw error
          if (!firstError)
            firstError = error
          damaged++
          if (damaged > Math.max(3, frames * 0.05))
            throw new Mp3DecodeError(`The MP3 audio is damaged: ${firstError.message}`)
          decoded.push(Array.from({ length: header.channels }, () => new Float32Array(header.samples)))
        }
      }
      pending = data.slice(at)
      if (!decoded.length)
        return null
      const count = decoded[0].length
      const length = decoded.reduce((n, chunk) => n + chunk[0].length, 0)
      const channels = Array.from({ length: count }, () => new Float32Array(length))
      let offset = 0
      for (const chunk of decoded) {
        for (let c = 0; c < count; c++) channels[c].set(chunk[Math.min(c, chunk.length - 1)], offset)
        offset += chunk[0].length
      }
      return { sampleRate, channels }
    },
  }
}
