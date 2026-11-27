/**
 * Opus as decodeAudio meets it: the OpusHead header, a decoder for an Opus
 * track of any container, and Ogg Opus files read directly.
 */

import type { AudioPacketDecoder, AudioTrack, DecodedAudioChunk, EncodedPacket } from '@ts-audio/core'
import { UnsupportedAudioCodecError } from '@ts-audio/core'
import { parseOggPage } from '@ts-audio/ogg'
import { OpusDecoder } from './opus-decoder'

/** What an Opus stream says about itself (RFC 7845 section 5.1). */
export interface OpusHead {
  channels: number
  /** Samples at 48 kHz to drop from the start: the encoder's lookahead. */
  preSkip: number
  inputSampleRate: number
  /** Gain to apply, in dB. */
  outputGainDb: number
  mappingFamily: number
}

export function parseOpusHead(data: Uint8Array): OpusHead | null {
  if (data.length < 19 || String.fromCharCode(...data.subarray(0, 8)) !== 'OpusHead')
    return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return {
    channels: data[9],
    preSkip: view.getUint16(10, true),
    inputSampleRate: view.getUint32(12, true),
    outputGainDb: view.getInt16(16, true) / 256,
    mappingFamily: data[18],
  }
}

function checkSupported(head: OpusHead): void {
  if (head.channels < 1 || head.channels > 2 || head.mappingFamily > 1)
    throw new Error(`Opus with ${head.channels} channels (mapping family ${head.mappingFamily}) is not supported`)
}

/** Interleaved to planar, dropping `skip` frames at the start and applying a gain. */
function planar(interleaved: Float32Array, channels: number, skip: number, gain: number): Float32Array[] {
  const frames = interleaved.length / channels - skip
  const out = Array.from({ length: channels }, () => new Float32Array(Math.max(0, frames)))
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) out[c][i] = interleaved[(i + skip) * channels + c] * gain
  }
  return out
}

/**
 * A decoder for an Opus track. The pre-skip from the track's OpusHead (WebM's
 * CodecPrivate) is dropped here; a container that marks it otherwise (an MP4
 * edit list) leaves it to the track's trimStart.
 */
export function createOpusDecoder(track: AudioTrack): AudioPacketDecoder {
  const head = track.codecDescription ? parseOpusHead(track.codecDescription) : null
  const channels = head?.channels ?? Math.min(track.channels || 1, 2)
  if (head)
    checkSupported(head)
  const decoder = new OpusDecoder(channels)
  const gain = head ? 10 ** (head.outputGainDb / 20) : 1
  let toSkip = head?.preSkip ?? 0
  return {
    decode: (packet: EncodedPacket): DecodedAudioChunk | null => {
      const pcm = decoder.decode(packet.data)
      const frames = pcm.length / channels
      const skip = Math.min(toSkip, frames)
      toSkip -= skip
      if (skip === frames)
        return null
      return { sampleRate: 48000, channels: planar(pcm, channels, skip, gain) }
    },
  }
}

/** Ogg starts every page with "OggS". */
export function isOgg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53
}

/**
 * The packets of the first logical stream of an Ogg file, and the last
 * granule position seen. The pages themselves are parsed by @ts-audio/ogg,
 * which owns the container.
 */
export function readOggPackets(bytes: Uint8Array): { packets: Uint8Array[], lastGranule: number } {
  const packets: Uint8Array[] = []
  let serial: number | null = null
  let lastGranule = -1
  let pending: Uint8Array[] = []
  let offset = 0
  while (offset + 27 <= bytes.length) {
    if (!isOgg(bytes.subarray(offset)))
      throw new Error('Damaged Ogg file: a page does not start with OggS')
    const page = parseOggPage(bytes, offset)
    // A page the file cuts short: there is nothing whole left to decode.
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

/** An Ogg Opus file (Firefox's recordings, WhatsApp's voice notes) to planar 48 kHz samples. */
export function decodeOggOpus(bytes: Uint8Array, signal?: AbortSignal): { sampleRate: number, channels: Float32Array[] } {
  const { packets, lastGranule } = readOggPackets(bytes)
  const head = packets.length ? parseOpusHead(packets[0]) : null
  if (!head) {
    const id = packets[0] ? String.fromCharCode(...packets[0].subarray(1, 7)) : ''
    throw id === 'vorbis' ? new UnsupportedAudioCodecError('vorbis') : new Error('The Ogg file holds no Opus stream')
  }
  checkSupported(head)
  const decoder = new OpusDecoder(head.channels)
  const decoded: Float32Array[] = []
  let total = 0
  // Packet 1 is OpusTags.
  for (let i = 2; i < packets.length; i++) {
    signal?.throwIfAborted()
    const pcm = decoder.decode(packets[i])
    decoded.push(pcm)
    total += pcm.length
  }
  const all = new Float32Array(total)
  let at = 0
  for (const pcm of decoded) {
    all.set(pcm, at)
    at += pcm.length
  }
  const channels = planar(all, head.channels, Math.min(head.preSkip, total / head.channels), 10 ** (head.outputGainDb / 20))
  // The last granule position counts the pre-skip too: what is left is the padding at the end.
  if (lastGranule >= head.preSkip) {
    const keep = Math.min(channels[0].length, lastGranule - head.preSkip)
    return { sampleRate: 48000, channels: channels.map(channel => channel.subarray(0, keep)) }
  }
  return { sampleRate: 48000, channels }
}
