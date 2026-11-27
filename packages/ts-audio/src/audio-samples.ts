/**
 * Decoded audio samples: the planar float shape every decoder hands back,
 * the PCM and WAV reading that needs no codec, and the mixing and
 * resampling `decodeAudioToWav` finishes with.
 *
 * These live in the core package because `decodeAudio` reads PCM itself and
 * because a codec package would otherwise have to depend on @ts-audio/wav to
 * hand back samples. @ts-audio/wav re-exports them under its own name.
 */

import type { AudioCodec, AudioTrack, EncodedPacket } from './types'
import { UnsupportedAudioCodecError } from './audio-errors'

/** Planar samples: one Float32Array per channel, each in -1 to 1. */
export interface DecodedAudio {
  sampleRate: number
  channels: Float32Array[]
  /** Seconds. */
  duration: number
  /** The codec the samples were decoded from, as the container names it. */
  codec: AudioCodec
}

/** One decoded piece of a track. */
export interface DecodedAudioChunk {
  sampleRate: number
  channels: Float32Array[]
}

/**
 * Turns one compressed codec's packets into samples. A decoder may hold
 * samples back (codec delay) and hand them over from `flush`. Its output rate
 * may differ from the container's (HE-AAC doubles it).
 */
export interface AudioPacketDecoder {
  decode: (_packet: EncodedPacket) => DecodedAudioChunk | null
  flush?: () => DecodedAudioChunk | null
  close?: () => void
}

export type AudioDecoderFactory = (_track: AudioTrack) => AudioPacketDecoder

// ---------------------------------------------------------------------------
// PCM

export type PcmEncoding = 'u8' | 's16' | 's24' | 's32' | 'f32' | 'f64' | 'alaw' | 'mulaw'

function pcmLayout(codec: AudioCodec): { encoding: PcmEncoding, littleEndian: boolean } {
  const match = /^pcm_([suf])(\d+)(le|be)$/.exec(codec)
  if (match) {
    const [, kind, bits, endian] = match
    return { encoding: (kind === 'f' ? `f${bits}` : `s${bits}`) as PcmEncoding, littleEndian: endian === 'le' }
  }
  if (codec === 'pcm_alaw')
    return { encoding: 'alaw', littleEndian: true }
  if (codec === 'pcm_mulaw')
    return { encoding: 'mulaw', littleEndian: true }
  throw new UnsupportedAudioCodecError(codec)
}

export function pcmPacketDecoder(track: AudioTrack): AudioPacketDecoder {
  const { encoding, littleEndian } = pcmLayout(track.codec)
  return {
    decode: packet => ({ sampleRate: track.sampleRate, channels: deinterleavePcm(packet.data, encoding, littleEndian, track.channels) }),
  }
}

const BYTES: Record<PcmEncoding, number> = { u8: 1, s16: 2, s24: 3, s32: 4, f32: 4, f64: 8, alaw: 1, mulaw: 1 }

/** Interleaved PCM bytes to planar floats. A trailing partial frame is dropped. */
export function deinterleavePcm(data: Uint8Array, encoding: PcmEncoding, littleEndian: boolean, channelCount: number): Float32Array[] {
  const width = BYTES[encoding]
  const frames = Math.floor(data.length / (width * channelCount))
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frames))
  const read = sampleReader(encoding, data, view, littleEndian)
  let offset = 0
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channelCount; c++) {
      channels[c][i] = read(offset)
      offset += width
    }
  }
  return channels
}

/** One sample at a byte offset, as a float in -1 to 1. */
function sampleReader(encoding: PcmEncoding, data: Uint8Array, view: DataView, littleEndian: boolean): (_offset: number) => number {
  switch (encoding) {
    case 'u8':
      return offset => (data[offset] - 128) / 128
    case 's16':
      return offset => view.getInt16(offset, littleEndian) / 32768
    case 's24':
      return (offset) => {
        const raw = littleEndian
          ? (data[offset + 2] << 16) | (data[offset + 1] << 8) | data[offset]
          : (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2]
        return ((raw << 8) >> 8) / 8388608
      }
    case 's32':
      return offset => view.getInt32(offset, littleEndian) / 2147483648
    case 'f32':
      return offset => view.getFloat32(offset, littleEndian)
    case 'f64':
      return offset => view.getFloat64(offset, littleEndian)
    case 'alaw':
      return offset => alawToLinear(data[offset]) / 32768
    case 'mulaw':
      return offset => mulawToLinear(data[offset]) / 32768
  }
}

function alawToLinear(byte: number): number {
  const a = byte ^ 0x55
  const exponent = (a & 0x70) >> 4
  let magnitude = (a & 0x0F) << 4
  magnitude = exponent === 0 ? magnitude + 8 : (magnitude + 0x108) << (exponent - 1)
  return a & 0x80 ? magnitude : -magnitude
}

function mulawToLinear(byte: number): number {
  const u = ~byte & 0xFF
  const exponent = (u >> 4) & 0x07
  const magnitude = (((u & 0x0F) << 3) + 0x84) << exponent
  return u & 0x80 ? 0x84 - magnitude : magnitude - 0x84
}

// ---------------------------------------------------------------------------
// WAV

function fourCC(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
}

/** RIFF/WAVE, RF64 or BW64. */
export function isWav(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && ['RIFF', 'RF64', 'BW64'].includes(fourCC(bytes, 0)) && fourCC(bytes, 8) === 'WAVE'
}

const WAVE_FORMAT_PCM = 0x0001
const WAVE_FORMAT_FLOAT = 0x0003
const WAVE_FORMAT_ALAW = 0x0006
const WAVE_FORMAT_MULAW = 0x0007
const WAVE_FORMAT_EXTENSIBLE = 0xFFFE

/** A WAV file's samples: integer PCM of 8 to 32 bits, float, A-law or µ-law, plain or extensible, RIFF or RF64. */
export function decodeWav(bytes: Uint8Array): DecodedAudio {
  if (!isWav(bytes))
    throw new Error('Not a WAV file')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let format: { tag: number, channels: number, sampleRate: number, bits: number } | null = null
  let rf64DataSize: number | null = null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = fourCC(bytes, offset)
    let size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'ds64' && size >= 16)
      rf64DataSize = Number(view.getBigUint64(body + 8, true))
    if (id === 'fmt ' && size >= 16) {
      let tag = view.getUint16(body, true)
      const channels = view.getUint16(body + 2, true)
      const sampleRate = view.getUint32(body + 4, true)
      const bits = view.getUint16(body + 14, true)
      // The sub-format's first two bytes are the plain format tag.
      if (tag === WAVE_FORMAT_EXTENSIBLE && size >= 40)
        tag = view.getUint16(body + 24, true)
      format = { tag, channels, sampleRate, bits }
    }
    if (id === 'data') {
      if (!format)
        throw new Error('WAV file has no format before its samples')
      if (size === 0xFFFFFFFF)
        size = rf64DataSize ?? bytes.length - body
      const data = bytes.subarray(body, Math.min(bytes.length, body + size))
      const encoding = wavEncoding(format.tag, format.bits)
      if (!format.channels || !format.sampleRate)
        throw new Error('WAV file has no channels or sample rate')
      const channels = deinterleavePcm(data, encoding, true, format.channels)
      const codec = wavCodec(encoding)
      return { sampleRate: format.sampleRate, channels, duration: channels[0].length / format.sampleRate, codec }
    }
    offset = body + size + (size % 2)
  }
  throw new Error('WAV file has no samples')
}

function wavEncoding(tag: number, bits: number): PcmEncoding {
  if (tag === WAVE_FORMAT_PCM) {
    if (bits === 8) return 'u8'
    if (bits === 16) return 's16'
    if (bits === 24) return 's24'
    if (bits === 32) return 's32'
  }
  if (tag === WAVE_FORMAT_FLOAT) {
    if (bits === 32) return 'f32'
    if (bits === 64) return 'f64'
  }
  if (tag === WAVE_FORMAT_ALAW && bits === 8) return 'alaw'
  if (tag === WAVE_FORMAT_MULAW && bits === 8) return 'mulaw'
  throw new UnsupportedAudioCodecError(`WAV format ${tag} at ${bits} bits`)
}

function wavCodec(encoding: PcmEncoding): AudioCodec {
  switch (encoding) {
    case 'alaw': return 'pcm_alaw'
    case 'mulaw': return 'pcm_mulaw'
    case 'f32': return 'pcm_f32le'
    case 'f64': return 'pcm_f64le'
    case 's24': return 'pcm_s24le'
    case 's32': return 'pcm_s32le'
    default: return 'pcm_s16le'
  }
}

/** Planar floats to a 16-bit PCM WAV, clipped to range. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const channelCount = channels.length
  const frames = channels[0]?.length ?? 0
  const dataSize = frames * channelCount * 2
  const bytes = new Uint8Array(44 + dataSize)
  const view = new DataView(bytes.buffer)
  const write = (offset: number, text: string): void => {
    for (let i = 0; i < 4; i++) bytes[offset + i] = text.charCodeAt(i)
  }
  write(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, WAVE_FORMAT_PCM, true)
  view.setUint16(22, channelCount, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channelCount * 2, true)
  view.setUint16(32, channelCount * 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, dataSize, true)
  let offset = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channelCount; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]))
      view.setInt16(offset, Math.round(sample < 0 ? sample * 32768 : sample * 32767), true)
      offset += 2
    }
  }
  return bytes
}

// ---------------------------------------------------------------------------
// Mixing and resampling

/**
 * To the given number of channels: mono is the average of every channel,
 * stereo from mono copies it, stereo from more keeps the first two (front
 * left and right in every common layout).
 */
export function mixChannels(channels: Float32Array[], count: number): Float32Array[] {
  if (channels.length === count)
    return channels
  const frames = channels[0]?.length ?? 0
  if (count === 1) {
    const mono = new Float32Array(frames)
    for (const channel of channels) {
      for (let i = 0; i < frames; i++) mono[i] += channel[i]
    }
    for (let i = 0; i < frames; i++) mono[i] /= channels.length
    return [mono]
  }
  return Array.from({ length: count }, (_, c) => channels[Math.min(c, channels.length - 1)])
}

/** Taps on each side of the centre at the cutoff: enough for a steep, quiet band edge. */
const SINC_ZERO_CROSSINGS = 16
/** Filter phases between two input samples; coefficients in between are interpolated. */
const SINC_PHASES = 256
const KAISER_BETA = 8.6

/**
 * Band-limited resampling: a Kaiser-windowed sinc, with its cutoff below
 * both rates' Nyquist frequency so that going down does not alias.
 *
 * Common rates are exact ratios (44.1 to 16 kHz is 160 to 441), so the
 * filter for each of the output's phases is worked out once and every
 * sample is one dot product. Rates with no small ratio between them read the
 * filter from an interpolated table instead.
 */
export function resampleAudio(channels: Float32Array[], fromRate: number, toRate: number): Float32Array[] {
  if (fromRate === toRate || !channels.length)
    return channels
  const ratio = toRate / fromRate
  // 95% of the lower Nyquist frequency, in input-sample terms.
  const cutoff = Math.min(1, ratio) * 0.95
  const halfWidth = SINC_ZERO_CROSSINGS / cutoff
  const divisor = Number.isInteger(fromRate) && Number.isInteger(toRate) ? gcd(fromRate, toRate) : 0
  const phases = divisor ? toRate / divisor : 0
  if (phases && phases <= 4096)
    return channels.map(input => resamplePolyphase(input, fromRate / divisor, phases, cutoff, halfWidth))
  const table = sincTable()
  const inputFrames = channels[0].length
  const outputFrames = Math.floor(inputFrames * ratio)
  const step = 1 / ratio
  return channels.map((input) => {
    const output = new Float32Array(outputFrames)
    for (let n = 0; n < outputFrames; n++) {
      const position = n * step
      const first = Math.max(0, Math.ceil(position - halfWidth))
      const last = Math.min(inputFrames - 1, Math.floor(position + halfWidth))
      let sum = 0
      for (let k = first; k <= last; k++)
        sum += input[k] * tableValue(table, Math.abs(position - k) * cutoff)
      output[n] = sum * cutoff
    }
    return output
  })
}

/** Output sample n sits at input position n * step / phases: a whole part and one of `phases` fractions. */
function resamplePolyphase(input: Float32Array, step: number, phases: number, cutoff: number, halfWidth: number): Float32Array {
  const lowest = -Math.floor(halfWidth)
  const taps = Math.ceil(halfWidth) - lowest + 1
  const filters = new Float32Array(phases * taps)
  const denominator = besselI0(KAISER_BETA)
  for (let p = 0; p < phases; p++) {
    const fraction = p / phases
    for (let t = 0; t < taps; t++) {
      const x = Math.abs(lowest + t - fraction) * cutoff
      if (x >= SINC_ZERO_CROSSINGS)
        continue
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
      const r = x / SINC_ZERO_CROSSINGS
      filters[p * taps + t] = cutoff * sinc * besselI0(KAISER_BETA * Math.sqrt(1 - r * r)) / denominator
    }
  }
  const inputFrames = input.length
  const outputFrames = Math.floor(inputFrames * phases / step)
  const output = new Float32Array(outputFrames)
  for (let n = 0; n < outputFrames; n++) {
    const scaled = n * step
    const base = Math.floor(scaled / phases)
    const filter = (scaled - base * phases) * taps
    const first = base + lowest
    let sum = 0
    if (first >= 0 && first + taps <= inputFrames) {
      for (let t = 0; t < taps; t++) sum += input[first + t] * filters[filter + t]
    }
    else {
      for (let t = 0; t < taps; t++) {
        const k = first + t
        if (k >= 0 && k < inputFrames) sum += input[k] * filters[filter + t]
      }
    }
    output[n] = sum
  }
  return output
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b]
  return a
}

/** The windowed sinc at 0 to SINC_ZERO_CROSSINGS zero crossings, SINC_PHASES points to each. */
function sincTable(): Float32Array {
  const size = SINC_ZERO_CROSSINGS * SINC_PHASES + 2
  const table = new Float32Array(size)
  const denominator = besselI0(KAISER_BETA)
  for (let i = 0; i < size; i++) {
    const x = i / SINC_PHASES
    if (x >= SINC_ZERO_CROSSINGS)
      continue
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
    const r = x / SINC_ZERO_CROSSINGS
    table[i] = sinc * besselI0(KAISER_BETA * Math.sqrt(1 - r * r)) / denominator
  }
  return table
}

function tableValue(table: Float32Array, x: number): number {
  const index = x * SINC_PHASES
  const i = Math.floor(index)
  if (i >= table.length - 1)
    return 0
  const fraction = index - i
  return table[i] + (table[i + 1] - table[i]) * fraction
}

/** The zeroth-order modified Bessel function of the first kind, by its series. */
function besselI0(x: number): number {
  let sum = 1
  let term = 1
  const half = x / 2
  for (let k = 1; k < 50; k++) {
    term *= (half / k) * (half / k)
    sum += term
    if (term < sum * 1e-12)
      break
  }
  return sum
}
