/**
 * A FLAC decoder (RFC 9639) in plain TypeScript: the lossless codec, so its
 * output is the original samples rather than an approximation of them.
 *
 * Every FLAC stream carries an MD5 of its own unencoded audio in STREAMINFO,
 * which is what `flacStreamMd5` checks a decode against. That makes this the
 * one codec here whose correctness is a yes or no rather than a signal-to-
 * noise ratio.
 *
 * 8, 12, 16, 20 and 24-bit streams decode. 32-bit ones are refused by name:
 * their side channel needs 33 bits, past what JavaScript's bitwise operators
 * hold, and they are vanishingly rare.
 */

import type { FlacStreamInfo } from '@ts-audio/core'
import { crc16Flac, crc8Flac } from '@ts-audio/core'

export class FlacDecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FlacDecodeError'
  }
}

/** The 14 bits every frame starts with. */
const FRAME_SYNC = 0x3FFE

/** The widest stream this decoder reads; 32-bit FLAC needs wider arithmetic than bitwise operators give. */
const MAX_BITS_PER_SAMPLE = 24

const BLOCK_SIZES_576: readonly number[] = [576, 1152, 2304, 4608]
const BLOCK_SIZES_256: readonly number[] = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768]
const SAMPLE_RATES: readonly (number | null)[] = [null, 88200, 176400, 192000, 8000, 16000, 22050, 24000, 32000, 44100, 48000, 96000, null, null, null, null]
const SAMPLE_SIZES: readonly (number | null)[] = [null, 8, 12, null, 16, 20, 24, 32]

const SUBFRAME_CONSTANT = 0
const SUBFRAME_VERBATIM = 1
const SUBFRAME_FIXED = 2
const SUBFRAME_LPC = 3

// ---------------------------------------------------------------------------
// Bits

/**
 * FLAC's bit order, big-endian within each byte. Rice codes are read far more
 * often than anything else, so `readUnary` counts a whole byte's zeros at a
 * time rather than looping a bit at a time.
 */
class FlacBitReader {
  private byteAt = 0
  private bitAt = 0

  constructor(private readonly data: Uint8Array) {}

  /** The byte the reader has reached, once it is aligned to one. */
  get byteOffset(): number {
    return this.byteAt + (this.bitAt > 0 ? 1 : 0)
  }

  get bitsRemaining(): number {
    return (this.data.length - this.byteAt) * 8 - this.bitAt
  }

  readBits(count: number): number {
    let value = 0
    let left = count
    while (left > 0) {
      if (this.byteAt >= this.data.length)
        throw new FlacDecodeError('FLAC frame ended early')
      const available = 8 - this.bitAt
      const take = Math.min(left, available)
      const bits = (this.data[this.byteAt] >> (available - take)) & ((1 << take) - 1)
      // Multiplication rather than a shift: a 32-bit read would overflow one.
      value = value * (1 << take) + bits
      this.bitAt += take
      if (this.bitAt === 8) {
        this.bitAt = 0
        this.byteAt++
      }
      left -= take
    }
    return value
  }

  /** The same, read as a two's complement signed value. */
  readSignedBits(count: number): number {
    const value = this.readBits(count)
    const half = 2 ** (count - 1)
    return value >= half ? value - half * 2 : value
  }

  /** The zeros before the next 1 bit: how FLAC writes a Rice quotient. */
  readUnary(): number {
    let count = 0
    for (;;) {
      if (this.byteAt >= this.data.length)
        throw new FlacDecodeError('FLAC frame ended early')
      // The unread bits of this byte, left-aligned.
      const rest = (this.data[this.byteAt] << this.bitAt) & 0xFF
      if (rest === 0) {
        count += 8 - this.bitAt
        this.bitAt = 0
        this.byteAt++
        continue
      }
      const zeros = Math.clz32(rest) - 24
      count += zeros
      this.bitAt += zeros + 1
      if (this.bitAt === 8) {
        this.bitAt = 0
        this.byteAt++
      }
      return count
    }
  }

  skipToByteBoundary(): void {
    if (this.bitAt) {
      this.bitAt = 0
      this.byteAt++
    }
  }
}

/** FLAC writes frame and sample numbers in UTF-8's length-prefixed form, up to 36 bits. */
function readUtf8Number(reader: FlacBitReader): number {
  const first = reader.readBits(8)
  if ((first & 0x80) === 0)
    return first
  let extra = 0
  let mask = 0x40
  while (first & mask) {
    extra++
    mask >>= 1
  }
  if (extra === 0 || extra > 6)
    throw new FlacDecodeError('FLAC frame number is malformed')
  let value = first & (mask - 1)
  for (let i = 0; i < extra; i++) {
    const next = reader.readBits(8)
    if ((next & 0xC0) !== 0x80)
      throw new FlacDecodeError('FLAC frame number is malformed')
    value = value * 64 + (next & 0x3F)
  }
  return value
}

// ---------------------------------------------------------------------------
// Frames

/** What a frame header says about the block it carries. */
export interface FlacFrameHeader {
  blockSize: number
  /** Null where the header defers to STREAMINFO. */
  sampleRate: number | null
  channels: number
  /** 8 to 10 are the stereo modes, where one channel holds the difference. */
  channelAssignment: number
  /** Null where the header defers to STREAMINFO. */
  bitsPerSample: number | null
  /** Sample number for a variable-block-size stream, frame number otherwise. */
  number: number
  variableBlockSize: boolean
  /** Bytes of header, which the CRC-16 at the frame's end also covers. */
  length: number
}

/** The header of the frame at `offset`, or null when the bytes there are not one. */
export function parseFlacFrameHeader(data: Uint8Array, offset = 0): FlacFrameHeader | null {
  if (offset + 5 > data.length)
    return null
  const reader = new FlacBitReader(data.subarray(offset))
  let header: FlacFrameHeader
  try {
    if (reader.readBits(14) !== FRAME_SYNC)
      return null
    if (reader.readBits(1) !== 0)
      return null
    const variableBlockSize = reader.readBits(1) === 1
    const blockSizeCode = reader.readBits(4)
    const sampleRateCode = reader.readBits(4)
    const channelAssignment = reader.readBits(4)
    const sampleSizeCode = reader.readBits(3)
    if (reader.readBits(1) !== 0)
      return null
    if (blockSizeCode === 0 || sampleRateCode === 15 || channelAssignment > 10 || sampleSizeCode === 3)
      return null

    const number = readUtf8Number(reader)

    let blockSize: number
    if (blockSizeCode === 1)
      blockSize = 192
    else if (blockSizeCode <= 5)
      blockSize = BLOCK_SIZES_576[blockSizeCode - 2]
    else if (blockSizeCode === 6)
      blockSize = reader.readBits(8) + 1
    else if (blockSizeCode === 7)
      blockSize = reader.readBits(16) + 1
    else
      blockSize = BLOCK_SIZES_256[blockSizeCode - 8]

    let sampleRate = SAMPLE_RATES[sampleRateCode]
    if (sampleRateCode === 12)
      sampleRate = reader.readBits(8) * 1000
    else if (sampleRateCode === 13)
      sampleRate = reader.readBits(16)
    else if (sampleRateCode === 14)
      sampleRate = reader.readBits(16) * 10

    const length = reader.byteOffset + 1
    if (offset + length > data.length)
      return null
    // The CRC-8 covers the header including the sync word, which is what tells
    // a frame from residual bytes that happen to look like one.
    const expected = data[offset + length - 1]
    if (crc8Flac(data.subarray(offset, offset + length - 1)) !== expected)
      return null

    header = {
      blockSize,
      sampleRate: sampleRate ?? null,
      channels: channelAssignment > 7 ? 2 : channelAssignment + 1,
      channelAssignment,
      bitsPerSample: SAMPLE_SIZES[sampleSizeCode] ?? null,
      number,
      variableBlockSize,
      length,
    }
  }
  catch {
    return null
  }
  return header
}

/** What a stream says about itself, as much of it as the decoder needs. */
export interface FlacStreamShape {
  sampleRate: number
  channels: number
  bitsPerSample: number
}

/** One decoded block: integer samples per channel, as the encoder was given them. */
export interface FlacDecodedFrame {
  sampleRate: number
  bitsPerSample: number
  channels: Int32Array[]
}

/**
 * Decodes FLAC frames. A frame carries most of what it needs, so a decoder
 * made without a stream shape still reads any frame whose header states its
 * own sample rate and bit depth; `streamInfo` fills in the frames that defer
 * to STREAMINFO instead.
 */
export class FlacDecoder {
  constructor(private readonly streamInfo?: Partial<FlacStreamShape>) {}

  /** One frame, header to CRC-16, to integer samples. */
  decodeFrame(frame: Uint8Array): FlacDecodedFrame {
    const header = parseFlacFrameHeader(frame, 0)
    if (!header)
      throw new FlacDecodeError('Not a FLAC frame')

    const sampleRate = header.sampleRate ?? this.streamInfo?.sampleRate ?? 0
    const bitsPerSample = header.bitsPerSample ?? this.streamInfo?.bitsPerSample ?? 0
    if (!sampleRate)
      throw new FlacDecodeError('FLAC frame defers its sample rate to a stream header that is missing')
    if (!bitsPerSample)
      throw new FlacDecodeError('FLAC frame defers its bit depth to a stream header that is missing')
    if (bitsPerSample > MAX_BITS_PER_SAMPLE)
      throw new FlacDecodeError(`Decoding ${bitsPerSample}-bit FLAC is not supported`)

    const reader = new FlacBitReader(frame.subarray(header.length))
    const channels: Int32Array[] = []
    for (let c = 0; c < header.channels; c++) {
      // In the stereo modes the difference channel needs one bit more than the others.
      const sideChannel = (header.channelAssignment === 8 && c === 1)
        || (header.channelAssignment === 9 && c === 0)
        || (header.channelAssignment === 10 && c === 1)
      channels.push(this.decodeSubframe(reader, header.blockSize, bitsPerSample + (sideChannel ? 1 : 0)))
    }

    reader.skipToByteBoundary()
    const end = header.length + reader.byteOffset
    if (end + 2 > frame.length)
      throw new FlacDecodeError('FLAC frame ended early')
    const stated = (frame[end] << 8) | frame[end + 1]
    if (crc16Flac(frame.subarray(0, end)) !== stated)
      throw new FlacDecodeError('FLAC frame failed its CRC-16 check')

    undoStereoDecorrelation(channels, header.channelAssignment)
    return { sampleRate, bitsPerSample, channels }
  }

  private decodeSubframe(reader: FlacBitReader, blockSize: number, bitsPerSample: number): Int32Array {
    if (reader.readBits(1) !== 0)
      throw new FlacDecodeError('FLAC subframe header is malformed')
    const typeBits = reader.readBits(6)
    // Low-order bits of the encoder's output are dropped when every sample shares them.
    const wasted = reader.readBits(1) === 1 ? reader.readUnary() + 1 : 0
    const bits = bitsPerSample - wasted
    if (bits < 1)
      throw new FlacDecodeError('FLAC subframe wastes every bit it has')

    let type: number
    let order = 0
    if (typeBits === 0) {
      type = SUBFRAME_CONSTANT
    }
    else if (typeBits === 1) {
      type = SUBFRAME_VERBATIM
    }
    else if (typeBits >= 8 && typeBits <= 12) {
      type = SUBFRAME_FIXED
      order = typeBits - 8
    }
    else if (typeBits >= 32) {
      type = SUBFRAME_LPC
      order = typeBits - 31
    }
    else {
      throw new FlacDecodeError(`FLAC subframe type ${typeBits} is reserved`)
    }

    const samples = new Int32Array(blockSize)
    switch (type) {
      case SUBFRAME_CONSTANT: {
        samples.fill(reader.readSignedBits(bits))
        break
      }
      case SUBFRAME_VERBATIM: {
        for (let i = 0; i < blockSize; i++) samples[i] = reader.readSignedBits(bits)
        break
      }
      case SUBFRAME_FIXED: {
        if (order > blockSize)
          throw new FlacDecodeError('FLAC subframe predicts from more samples than the block holds')
        for (let i = 0; i < order; i++) samples[i] = reader.readSignedBits(bits)
        readResidual(reader, samples, blockSize, order)
        restoreFixed(samples, blockSize, order)
        break
      }
      case SUBFRAME_LPC: {
        if (order > blockSize)
          throw new FlacDecodeError('FLAC subframe predicts from more samples than the block holds')
        for (let i = 0; i < order; i++) samples[i] = reader.readSignedBits(bits)
        const precision = reader.readBits(4) + 1
        if (precision === 16)
          throw new FlacDecodeError('FLAC subframe uses a reserved coefficient precision')
        const shift = reader.readSignedBits(5)
        if (shift < 0)
          throw new FlacDecodeError('FLAC subframe uses a negative coefficient shift')
        const coefficients = new Int32Array(order)
        for (let i = 0; i < order; i++) coefficients[i] = reader.readSignedBits(precision)
        readResidual(reader, samples, blockSize, order)
        restoreLpc(samples, blockSize, order, coefficients, shift)
        break
      }
    }

    if (wasted) {
      for (let i = 0; i < blockSize; i++) samples[i] *= 2 ** wasted
    }
    return samples
  }
}

/** Rice-coded residuals, in partitions that each pick their own parameter. */
function readResidual(reader: FlacBitReader, samples: Int32Array, blockSize: number, order: number): void {
  const method = reader.readBits(2)
  if (method > 1)
    throw new FlacDecodeError(`FLAC residual coding method ${method} is reserved`)
  const parameterBits = method === 0 ? 4 : 5
  const escape = method === 0 ? 0xF : 0x1F
  const partitionOrder = reader.readBits(4)
  const partitions = 1 << partitionOrder
  if (blockSize % partitions !== 0)
    throw new FlacDecodeError('FLAC residual partitions do not divide the block')
  const partitionSize = blockSize >> partitionOrder
  if (partitionSize < order)
    throw new FlacDecodeError('FLAC residual partition is shorter than the predictor order')

  let at = order
  for (let p = 0; p < partitions; p++) {
    const count = p === 0 ? partitionSize - order : partitionSize
    const parameter = reader.readBits(parameterBits)
    if (parameter === escape) {
      // An escaped partition writes its residuals plainly, at a width it states.
      const raw = reader.readBits(5)
      for (let i = 0; i < count; i++) samples[at + i] = raw === 0 ? 0 : reader.readSignedBits(raw)
    }
    else {
      for (let i = 0; i < count; i++) {
        const quotient = reader.readUnary()
        const value = parameter === 0 ? quotient : quotient * 2 ** parameter + reader.readBits(parameter)
        // Zigzag: the low bit is the sign.
        samples[at + i] = (value & 1) ? -((value + 1) / 2) : value / 2
      }
    }
    at += count
  }
}

/** Undoes a fixed predictor, which is a difference taken `order` times. */
function restoreFixed(samples: Int32Array, blockSize: number, order: number): void {
  switch (order) {
    case 0:
      break
    case 1:
      for (let i = 1; i < blockSize; i++) samples[i] += samples[i - 1]
      break
    case 2:
      for (let i = 2; i < blockSize; i++) samples[i] += 2 * samples[i - 1] - samples[i - 2]
      break
    case 3:
      for (let i = 3; i < blockSize; i++) samples[i] += 3 * samples[i - 1] - 3 * samples[i - 2] + samples[i - 3]
      break
    case 4:
      for (let i = 4; i < blockSize; i++) samples[i] += 4 * samples[i - 1] - 6 * samples[i - 2] + 4 * samples[i - 3] - samples[i - 4]
      break
    default:
      throw new FlacDecodeError(`FLAC fixed predictor of order ${order} is reserved`)
  }
}

/** Undoes a linear predictor: each sample plus the shifted sum of the ones before it. */
function restoreLpc(samples: Int32Array, blockSize: number, order: number, coefficients: Int32Array, shift: number): void {
  for (let i = order; i < blockSize; i++) {
    let sum = 0
    for (let c = 0; c < order; c++) sum += coefficients[c] * samples[i - 1 - c]
    samples[i] += Math.floor(sum / 2 ** shift)
  }
}

/** The stereo modes keep one channel as the difference between the two; this puts left and right back. */
function undoStereoDecorrelation(channels: Int32Array[], assignment: number): void {
  if (assignment < 8)
    return
  const [a, b] = channels
  const frames = a.length
  if (assignment === 8) {
    // Left and (left - right).
    for (let i = 0; i < frames; i++) b[i] = a[i] - b[i]
  }
  else if (assignment === 9) {
    // (left - right) and right.
    for (let i = 0; i < frames; i++) a[i] += b[i]
  }
  else {
    // Mid and side, the mid having dropped the bit the side's parity carries.
    for (let i = 0; i < frames; i++) {
      const side = b[i]
      const mid = a[i] * 2 + (side & 1)
      a[i] = (mid + side) >> 1
      b[i] = (mid - side) >> 1
    }
  }
}

/** Integer samples to the planar floats the rest of ts-audio passes around. */
export function flacSamplesToFloat(channels: Int32Array[], bitsPerSample: number): Float32Array[] {
  const scale = 2 ** (bitsPerSample - 1)
  return channels.map((channel) => {
    const out = new Float32Array(channel.length)
    for (let i = 0; i < channel.length; i++) out[i] = channel[i] / scale
    return out
  })
}

/**
 * Interleaves integer samples the way FLAC's own MD5 is taken over them:
 * little-endian, signed, one whole byte more than the bit depth needs.
 */
export function flacMd5Bytes(channels: Int32Array[], bitsPerSample: number): Uint8Array {
  const width = Math.ceil(bitsPerSample / 8)
  const frames = channels[0]?.length ?? 0
  const bytes = new Uint8Array(frames * channels.length * width)
  let at = 0
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) {
      let value = channel[i]
      for (let b = 0; b < width; b++) {
        bytes[at++] = value & 0xFF
        value >>= 8
      }
    }
  }
  return bytes
}

// ---------------------------------------------------------------------------
// STREAMINFO

/**
 * The STREAMINFO block: what the stream says about itself, including the MD5
 * of its unencoded audio that `flacMd5Bytes` is checked against.
 */
export function parseFlacStreamInfo(data: Uint8Array): FlacStreamInfo {
  if (data.length < 34)
    throw new FlacDecodeError('FLAC STREAMINFO block is too short')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const totalSamplesHigh = data[13] & 0x0F
  const totalSamplesLow = (data[14] << 24) | (data[15] << 16) | (data[16] << 8) | data[17]
  return {
    minBlockSize: view.getUint16(0, false),
    maxBlockSize: view.getUint16(2, false),
    minFrameSize: (data[4] << 16) | (data[5] << 8) | data[6],
    maxFrameSize: (data[7] << 16) | (data[8] << 8) | data[9],
    sampleRate: (data[10] << 12) | (data[11] << 4) | (data[12] >> 4),
    channels: ((data[12] >> 1) & 0x07) + 1,
    // The five bits are one value, so the + 1 applies to all of it; splitting
    // it across the | reported a 32-bit stream as 16-bit.
    bitsPerSample: (((data[12] & 0x01) << 4) | (data[13] >> 4)) + 1,
    totalSamples: (BigInt(totalSamplesHigh) << 32n) | BigInt(totalSamplesLow >>> 0),
    md5: data.subarray(18, 34),
  }
}
