/**
 * Vorbis as decodeAudio meets it: a whole Ogg Vorbis file, and Vorbis tracks
 * of other containers whose packets a caller feeds in. Ogg pages are parsed by
 * @ts-audio/ogg, which owns the container.
 */

import type { AudioPacketDecoder, AudioTrack, DecodedAudioChunk, EncodedPacket } from '@ts-audio/core'
import { AudioTooLongError } from '@ts-audio/core'
import { parseOggPage } from '@ts-audio/ogg'
import { VorbisDecoder } from './vorbis-decoder'
import { VorbisDecodeError } from './vorbis-bitstream'
import { isVorbisIdentification, parseVorbisIdentification, parseVorbisSetup } from './vorbis-setup'

/** Ogg starts every page with "OggS". */
function isOgg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53
}

/** The packets of the first logical stream of an Ogg file, and the last granule position seen. */
export function readOggPackets(bytes: Uint8Array): { packets: Uint8Array[], lastGranule: number } {
  const packets: Uint8Array[] = []
  let serial: number | null = null
  let lastGranule = -1
  let pending: Uint8Array[] = []
  let offset = 0
  while (offset + 27 <= bytes.length) {
    if (!isOgg(bytes.subarray(offset)))
      throw new VorbisDecodeError('Damaged Ogg file: a page does not start with OggS')
    const page = parseOggPage(bytes, offset)
    if (!page)
      break
    if (serial === null)
      serial = page.serialNumber
    const ours = page.serialNumber === serial
    let body = 0
    for (const size of page.segmentTable) {
      if (ours)
        pending.push(page.data.subarray(body, body + size))
      body += size
      if (ours && size < 255) {
        const length = pending.reduce((n, part) => n + part.length, 0)
        const packet = new Uint8Array(length)
        let at = 0
        for (const part of pending) {
          packet.set(part, at)
          at += part.length
        }
        packets.push(packet)
        pending = []
      }
    }
    if (ours && page.granulePosition >= 0n)
      lastGranule = Number(page.granulePosition)
    offset = page.data.byteOffset - bytes.byteOffset + body
  }
  return { packets, lastGranule }
}

/** Whether the data is an Ogg file whose first logical stream is Vorbis. */
export function isOggVorbis(bytes: Uint8Array): boolean {
  if (!isOgg(bytes))
    return false
  try {
    const page = parseOggPage(bytes, 0)
    if (!page || !page.segmentTable.length)
      return false
    return isVorbisIdentification(page.data.subarray(0, page.segmentTable[0]))
  }
  catch {
    return false
  }
}

export interface DecodeVorbisOptions {
  signal?: AbortSignal
  maxDurationSeconds?: number
}

/**
 * An Ogg Vorbis file to planar samples at the stream's own rate. The first
 * audio packet only primes the lap and yields nothing, and the last page's
 * granule position says where the sound ends.
 */
export function decodeOggVorbis(bytes: Uint8Array, options: DecodeVorbisOptions = {}): { sampleRate: number, channels: Float32Array[] } {
  const { packets, lastGranule } = readOggPackets(bytes)
  if (packets.length < 3)
    throw new VorbisDecodeError('The Ogg file holds no Vorbis stream')
  const identification = parseVorbisIdentification(packets[0])
  // Packet 1 is the comment header, which @ts-audio/ogg reads for metadata.
  const setup = parseVorbisSetup(packets[2], identification)
  const decoder = new VorbisDecoder(identification, setup)

  const blocks: Float32Array[][] = []
  let total = 0
  for (let i = 3; i < packets.length; i++) {
    options.signal?.throwIfAborted()
    const block = decoder.decodePacket(packets[i])
    if (!block.channels.length)
      continue
    blocks.push(block.channels)
    total += block.channels[0].length
    if (options.maxDurationSeconds !== undefined && total / identification.sampleRate > options.maxDurationSeconds)
      throw new AudioTooLongError(options.maxDurationSeconds)
  }

  const keep = lastGranule >= 0 ? Math.min(total, lastGranule) : total
  const channels = Array.from({ length: identification.channels }, () => new Float32Array(keep))
  let at = 0
  for (const block of blocks) {
    const length = Math.min(block[0].length, keep - at)
    if (length <= 0)
      break
    for (let ch = 0; ch < identification.channels; ch++) channels[ch].set(block[ch].subarray(0, length), at)
    at += length
  }
  return { sampleRate: identification.sampleRate, channels }
}

/**
 * A decoder for a Vorbis track of a container. Its three headers arrive as the
 * track's description, in the layout Matroska's CodecPrivate uses: a count of
 * packet lengths, then the packets.
 */
export function createVorbisDecoder(track: AudioTrack): AudioPacketDecoder {
  let decoder: VorbisDecoder | null = null
  let sampleRate = track.sampleRate
  if (track.codecDescription?.length) {
    const headers = splitVorbisHeaders(track.codecDescription)
    if (headers) {
      const identification = parseVorbisIdentification(headers[0])
      decoder = new VorbisDecoder(identification, parseVorbisSetup(headers[2], identification))
      sampleRate = identification.sampleRate
    }
  }
  let seen = 0
  return {
    decode: (packet: EncodedPacket): DecodedAudioChunk | null => {
      // Without a description the headers come as the first three packets.
      if (!decoder) {
        if (seen === 0 && !isVorbisIdentification(packet.data))
          throw new VorbisDecodeError('The Vorbis track carries no headers, and its packets do not start with them')
        pendingHeaders[seen] = packet.data
        seen++
        if (seen === 3) {
          const identification = parseVorbisIdentification(pendingHeaders[0])
          decoder = new VorbisDecoder(identification, parseVorbisSetup(pendingHeaders[2], identification))
          sampleRate = identification.sampleRate
        }
        return null
      }
      const block = decoder.decodePacket(packet.data)
      return block.channels.length ? { sampleRate, channels: block.channels } : null
    },
  }

  function splitVorbisHeaders(description: Uint8Array): [Uint8Array, Uint8Array, Uint8Array] | null {
    // Matroska's Xiph lacing: a packet count, then all but the last length as
    // chains of 255, then the packets themselves.
    if (description.length < 3 || description[0] !== 2)
      return null
    let at = 1
    const lengths: number[] = []
    for (let i = 0; i < 2; i++) {
      let length = 0
      while (at < description.length && description[at] === 255) {
        length += 255
        at++
      }
      if (at >= description.length)
        return null
      length += description[at++]
      lengths.push(length)
    }
    const first = description.subarray(at, at + lengths[0])
    const second = description.subarray(at + lengths[0], at + lengths[0] + lengths[1])
    const third = description.subarray(at + lengths[0] + lengths[1])
    if (!isVorbisIdentification(first) || !third.length)
      return null
    return [first, second, third]
  }
}

const pendingHeaders: Uint8Array[] = []
