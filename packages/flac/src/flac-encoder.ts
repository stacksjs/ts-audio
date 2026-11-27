/**
 * A FLAC encoder in plain TypeScript.
 *
 * Lossless, so there is no question of quality: a frame either decodes to the
 * samples it was given or it is wrong, and the stream's MD5 says which. What an
 * encoder chooses is only how small it gets, and this one makes the choices
 * libFLAC makes at its default level -- per block it weighs a constant, the
 * best fixed predictor, a linear predictor of the order the Levinson-Durbin
 * error suggests, and plain samples, and for stereo which of the four channel
 * assignments codes smallest.
 *
 * 8, 12, 16, 20 and 24-bit, the same depths the decoder reads.
 */

import { crc16Flac, crc8Flac } from '@ts-audio/core'
import { Md5 } from './md5'

export class FlacEncodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FlacEncodeError'
  }
}

export interface EncodeFlacOptions {
  sampleRate: number
  /** 8 to 24. Float input is scaled to this depth; integer input must already fit it. Default 16. */
  bitsPerSample?: number
  /** Samples per block. Default 4096, which is what libFLAC uses at its default level. */
  blockSize?: number
  /** The highest LPC order tried; 0 uses fixed predictors only. Default 8. */
  maxLpcOrder?: number
  /** The highest Rice partition order tried. Default 6. */
  maxPartitionOrder?: number
  /** Try left/side, right/side and mid/side for stereo. Default true. */
  stereoDecorrelation?: boolean
}

const MIN_BITS = 4
const MAX_BITS = 24

// ---------------------------------------------------------------------------
// Bits

/** Most significant bit first, which is FLAC's order. */
class BitWriter {
  private bytes: Uint8Array
  private length = 0
  private acc = 0
  private accBits = 0

  constructor(capacity = 16384) {
    this.bytes = new Uint8Array(capacity)
  }

  private grow(extra: number): void {
    if (this.length + extra <= this.bytes.length)
      return
    const next = new Uint8Array(Math.max(this.bytes.length * 2, this.length + extra))
    next.set(this.bytes.subarray(0, this.length))
    this.bytes = next
  }

  /** `count` bits of an unsigned value, up to 32. */
  writeBits(value: number, count: number): void {
    if (count > 24) {
      // Split so the accumulator never holds more than 31 bits.
      this.writeBits(Math.floor(value / 2 ** 24), count - 24)
      this.writeBits(value % 2 ** 24, 24)
      return
    }
    if (count === 0)
      return
    this.acc = (this.acc << count) | (value & ((1 << count) - 1))
    this.accBits += count
    this.grow(4)
    while (this.accBits >= 8) {
      this.accBits -= 8
      this.bytes[this.length++] = (this.acc >>> this.accBits) & 0xFF
    }
    this.acc &= (1 << this.accBits) - 1
  }

  /** A two's complement value in `count` bits. */
  writeSigned(value: number, count: number): void {
    this.writeBits(value < 0 ? value + 2 ** count : value, count)
  }

  /** `count` zeros then a one: a Rice quotient. */
  writeUnary(count: number): void {
    while (count >= 24) {
      this.writeBits(0, 24)
      count -= 24
    }
    this.writeBits(1, count + 1)
  }

  /** A Rice code: the zigzagged value's quotient in unary, then `k` bits of remainder. */
  writeRice(value: number, k: number): void {
    const folded = value >= 0 ? value * 2 : -value * 2 - 1
    const quotient = Math.floor(folded / 2 ** k)
    this.writeUnary(quotient)
    if (k)
      this.writeBits(folded - quotient * 2 ** k, k)
  }

  alignToByte(): void {
    if (this.accBits)
      this.writeBits(0, 8 - this.accBits)
  }

  get byteLength(): number {
    return this.length
  }

  /** The bytes so far. Only meaningful once aligned. */
  view(): Uint8Array {
    return this.bytes.subarray(0, this.length)
  }
}

// ---------------------------------------------------------------------------
// Frame header

const SAMPLE_RATE_CODES = new Map<number, number>([
  [88200, 1], [176400, 2], [192000, 3], [8000, 4], [16000, 5], [22050, 6],
  [24000, 7], [32000, 8], [44100, 9], [48000, 10], [96000, 11],
])
const SAMPLE_SIZE_CODES = new Map<number, number>([[8, 1], [12, 2], [16, 4], [20, 5], [24, 6]])

/** The block size code, and the bits that follow the header when the code says so. */
function blockSizeCode(size: number): { code: number, extra?: { value: number, bits: number } } {
  if (size === 192)
    return { code: 1 }
  for (let n = 2; n <= 5; n++) {
    if (size === 576 << (n - 2))
      return { code: n }
  }
  for (let n = 8; n <= 15; n++) {
    if (size === 256 << (n - 8))
      return { code: n }
  }
  return size <= 256 ? { code: 6, extra: { value: size - 1, bits: 8 } } : { code: 7, extra: { value: size - 1, bits: 16 } }
}

function sampleRateCode(rate: number): { code: number, extra?: { value: number, bits: number } } {
  const standard = SAMPLE_RATE_CODES.get(rate)
  if (standard)
    return { code: standard }
  if (rate % 1000 === 0 && rate / 1000 <= 255)
    return { code: 12, extra: { value: rate / 1000, bits: 8 } }
  if (rate <= 65535)
    return { code: 13, extra: { value: rate, bits: 16 } }
  if (rate % 10 === 0 && rate / 10 <= 65535)
    return { code: 14, extra: { value: rate / 10, bits: 16 } }
  // Defer to STREAMINFO, which holds any rate up to 20 bits.
  return { code: 0 }
}

/** FLAC writes frame numbers in UTF-8's length-prefixed form. */
function writeUtf8Number(writer: BitWriter, n: number): void {
  if (n < 0x80) {
    writer.writeBits(n, 8)
    return
  }
  let bytes = 2
  while (bytes < 6 && n >= 2 ** (5 * bytes + 1)) bytes++
  const lead = (0xFF << (8 - bytes)) & 0xFF
  writer.writeBits(lead | Math.floor(n / 2 ** (6 * (bytes - 1))), 8)
  for (let i = bytes - 2; i >= 0; i--) writer.writeBits(0x80 | (Math.floor(n / 2 ** (6 * i)) & 0x3F), 8)
}

// ---------------------------------------------------------------------------
// Rice partitioning

interface RiceCoding {
  partitionOrder: number
  parameters: number[]
  method: 0 | 1
  /** Estimated bits, header included, used to compare candidates. */
  bits: number
}

const fold = (value: number): number => (value >= 0 ? value * 2 : -value * 2 - 1)

/**
 * The partitioning and Rice parameters that code a residual smallest. Sums are
 * taken once at the finest order and merged pairwise for the coarser ones, and
 * a parameter's cost is estimated from its partition's sum, as libFLAC does --
 * so choosing costs one pass, and only the winner is written exactly.
 */
function chooseRice(residual: Int32Array, order: number, blockSize: number, maxPartitionOrder: number): RiceCoding {
  let maxOrder = 0
  while (maxOrder < maxPartitionOrder && blockSize % (1 << (maxOrder + 1)) === 0 && (blockSize >> (maxOrder + 1)) > order)
    maxOrder++

  // Folded sums per partition at the finest order.
  const finest = 1 << maxOrder
  const size = blockSize >> maxOrder
  let sums: number[] = Array.from({ length: finest }, () => 0)
  let counts: number[] = Array.from({ length: finest }, (_, p) => (p === 0 ? size - order : size))
  for (let p = 0, at = order; p < finest; p++) {
    let sum = 0
    for (let i = 0; i < counts[p]; i++) sum += fold(residual[at + i])
    sums[p] = sum
    at += counts[p]
  }

  let best: RiceCoding | null = null
  for (let partitionOrder = maxOrder; partitionOrder >= 0; partitionOrder--) {
    const parameters: number[] = []
    let bits = 2 + 4
    let needsWide = false
    for (let p = 0; p < sums.length; p++) {
      const { k, cost } = bestParameter(sums[p], counts[p])
      parameters.push(k)
      if (k > 14)
        needsWide = true
      bits += cost
    }
    bits += sums.length * (needsWide ? 5 : 4)
    if (!best || bits < best.bits)
      best = { partitionOrder, parameters, method: needsWide ? 1 : 0, bits }
    if (partitionOrder > 0) {
      // Merge neighbouring partitions for the next order down.
      const nextSums: number[] = []
      const nextCounts: number[] = []
      for (let p = 0; p < sums.length; p += 2) {
        nextSums.push(sums[p] + sums[p + 1])
        nextCounts.push(counts[p] + counts[p + 1])
      }
      sums = nextSums
      counts = nextCounts
    }
  }
  return best!
}

/** The Rice parameter whose estimated cost for a partition is least. */
function bestParameter(sum: number, count: number): { k: number, cost: number } {
  if (count === 0)
    return { k: 0, cost: 0 }
  let k = sum > count ? Math.max(0, Math.floor(Math.log2(sum / count))) : 0
  k = Math.min(30, k)
  let bestK = k
  let bestCost = Number.POSITIVE_INFINITY
  for (let candidate = Math.max(0, k - 1); candidate <= Math.min(30, k + 1); candidate++) {
    const cost = count * (candidate + 1) + Math.floor(sum / 2 ** candidate)
    if (cost < bestCost) {
      bestCost = cost
      bestK = candidate
    }
  }
  return { k: bestK, cost: bestCost }
}

function writeResidual(writer: BitWriter, residual: Int32Array, order: number, blockSize: number, coding: RiceCoding): void {
  writer.writeBits(coding.method, 2)
  writer.writeBits(coding.partitionOrder, 4)
  const partitions = 1 << coding.partitionOrder
  const size = blockSize >> coding.partitionOrder
  const parameterBits = coding.method === 0 ? 4 : 5
  let at = order
  for (let p = 0; p < partitions; p++) {
    const count = p === 0 ? size - order : size
    const k = coding.parameters[p]
    writer.writeBits(k, parameterBits)
    for (let i = 0; i < count; i++) writer.writeRice(residual[at + i], k)
    at += count
  }
}

// ---------------------------------------------------------------------------
// Prediction

/** The residual of fixed predictor `order`, which is the signal differenced `order` times. */
function fixedResidual(samples: Int32Array, order: number): Int32Array {
  const n = samples.length
  const out = new Int32Array(n)
  for (let i = 0; i < order; i++) out[i] = samples[i]
  for (let i = order; i < n; i++) {
    const x = samples
    switch (order) {
      case 0:
        out[i] = x[i]
        break
      case 1:
        out[i] = x[i] - x[i - 1]
        break
      case 2:
        out[i] = x[i] - 2 * x[i - 1] + x[i - 2]
        break
      case 3:
        out[i] = x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3]
        break
      default:
        out[i] = x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4]
    }
  }
  return out
}

/** The fixed predictor order with the least total residual, found in one pass. */
function bestFixedOrder(samples: Int32Array): number {
  const n = samples.length
  // Too short to compare the orders on: a plain residual is as good as any.
  if (n < 5)
    return 0
  const totals = [0, 0, 0, 0, 0]
  let e0Prev = samples[3]
  let e1Prev = samples[3] - samples[2]
  let e2Prev = e1Prev - (samples[2] - samples[1])
  let e3Prev = e2Prev - ((samples[2] - samples[1]) - (samples[1] - samples[0]))
  for (let i = 4; i < n; i++) {
    const e0 = samples[i]
    const e1 = e0 - e0Prev
    const e2 = e1 - e1Prev
    const e3 = e2 - e2Prev
    const e4 = e3 - e3Prev
    totals[0] += Math.abs(e0)
    totals[1] += Math.abs(e1)
    totals[2] += Math.abs(e2)
    totals[3] += Math.abs(e3)
    totals[4] += Math.abs(e4)
    e0Prev = e0
    e1Prev = e1
    e2Prev = e2
    e3Prev = e3
  }
  let order = 0
  for (let o = 1; o <= 4; o++) {
    if (totals[o] < totals[order])
      order = o
  }
  return order
}

/** A Tukey window with half its length tapered, which is libFLAC's default. */
const tukeyWindows = new Map<number, Float64Array>()
function tukey(n: number): Float64Array {
  let window = tukeyWindows.get(n)
  if (window)
    return window
  window = new Float64Array(n).fill(1)
  const taper = Math.floor(0.25 * (n - 1))
  for (let i = 0; i < taper; i++) {
    const value = 0.5 * (1 - Math.cos((Math.PI * i) / taper))
    window[i] = value
    window[n - 1 - i] = value
  }
  tukeyWindows.set(n, window)
  return window
}

interface LpcChoice {
  order: number
  precision: number
  shift: number
  coefficients: Int32Array
}

/**
 * A linear predictor: autocorrelation of the windowed block, Levinson-Durbin
 * for the coefficients of every order, the order whose remaining error
 * predicts the fewest bits, then the coefficients quantised.
 */
function chooseLpc(samples: Int32Array, maxOrder: number, bitsPerSample: number): LpcChoice | null {
  const n = samples.length
  maxOrder = Math.min(maxOrder, n - 1, 32)
  if (maxOrder < 1)
    return null
  const window = tukey(n)
  const windowed = new Float64Array(n)
  for (let i = 0; i < n; i++) windowed[i] = samples[i] * window[i]
  const r = new Float64Array(maxOrder + 1)
  for (let lag = 0; lag <= maxOrder; lag++) {
    let sum = 0
    for (let i = lag; i < n; i++) sum += windowed[i] * windowed[i - lag]
    r[lag] = sum
  }
  if (r[0] <= 0)
    return null

  // Levinson-Durbin, keeping every order's coefficients and error.
  const coefficientsByOrder: Float64Array[] = []
  const errors: number[] = []
  let a = new Float64Array(0)
  let error = r[0]
  for (let i = 1; i <= maxOrder; i++) {
    let acc = r[i]
    for (let j = 0; j < a.length; j++) acc -= a[j] * r[i - 1 - j]
    const k = acc / error
    const next = new Float64Array(i)
    for (let j = 0; j < a.length; j++) next[j] = a[j] - k * a[a.length - 1 - j]
    next[i - 1] = k
    a = next
    error *= 1 - k * k
    coefficientsByOrder.push(a)
    errors.push(error)
    if (error <= 0)
      break
  }

  // libFLAC's estimate: bits per residual sample from the remaining error,
  // plus what the coefficients themselves cost.
  const precision = bitsPerSample <= 16 ? (n <= 192 ? 12 : n <= 576 ? 13 : 15) : 15
  let bestOrder = 1
  let bestBits = Number.POSITIVE_INFINITY
  const errorScale = 0.5 / n
  for (let o = 1; o <= coefficientsByOrder.length; o++) {
    const e = errors[o - 1]
    const perSample = e > 0 ? Math.max(0, 0.5 * Math.log2(errorScale * e)) : 0
    const bits = perSample * (n - o) + o * precision
    if (bits < bestBits) {
      bestBits = bits
      bestOrder = o
    }
  }

  const real = coefficientsByOrder[bestOrder - 1]
  let largest = 0
  for (const c of real) largest = Math.max(largest, Math.abs(c))
  if (!(largest > 0))
    return null
  // As much precision as the largest coefficient leaves room for.
  const magnitude = Math.floor(Math.log2(largest)) + 1
  const shift = Math.max(0, Math.min(15, precision - 1 - magnitude))
  const limit = 2 ** (precision - 1)
  const coefficients = new Int32Array(bestOrder)
  // Quantise with the rounding error carried forward, which keeps the
  // quantised predictor closer to the real one than rounding each alone.
  let carry = 0
  for (let j = 0; j < bestOrder; j++) {
    const exact = real[j] * 2 ** shift + carry
    let q = Math.round(exact)
    q = Math.max(-limit, Math.min(limit - 1, q))
    carry = exact - q
    coefficients[j] = q
  }
  return { order: bestOrder, precision, shift, coefficients }
}

function lpcResidual(samples: Int32Array, choice: LpcChoice): Int32Array {
  const n = samples.length
  const { order, coefficients, shift } = choice
  const out = new Int32Array(n)
  for (let i = 0; i < order; i++) out[i] = samples[i]
  const divisor = 2 ** shift
  for (let i = order; i < n; i++) {
    let sum = 0
    for (let c = 0; c < order; c++) sum += coefficients[c] * samples[i - 1 - c]
    // Floor, exactly as the decoder undoes it, so the two always agree.
    out[i] = samples[i] - Math.floor(sum / divisor)
  }
  return out
}

// ---------------------------------------------------------------------------
// Subframes

type SubframePlan =
  | { kind: 'constant', bits: number, value: number }
  | { kind: 'verbatim', bits: number }
  | { kind: 'fixed', bits: number, order: number, residual: Int32Array, rice: RiceCoding }
  | { kind: 'lpc', bits: number, choice: LpcChoice, residual: Int32Array, rice: RiceCoding }

interface ChannelPlan {
  plan: SubframePlan
  /** Low bits every sample shares and the encoder dropped. */
  wasted: number
  samples: Int32Array
  bitsPerSample: number
}

/** The cheapest way to code one channel of one block, and its estimated size. */
function planChannel(raw: Int32Array, bitsPerSample: number, options: Required<Omit<EncodeFlacOptions, 'sampleRate'>>): ChannelPlan {
  const n = raw.length

  // Bits that are zero in every sample cost nothing to drop and code.
  let combined = 0
  for (let i = 0; i < n; i++) combined |= raw[i]
  let wasted = 0
  if (combined !== 0) {
    while (wasted < bitsPerSample - 1 && (combined & (1 << wasted)) === 0) wasted++
  }
  let samples = raw
  if (wasted) {
    samples = new Int32Array(n)
    for (let i = 0; i < n; i++) samples[i] = raw[i] >> wasted
  }
  const bits = bitsPerSample - wasted
  const header = 8 + (wasted ? wasted : 0)

  let allEqual = true
  for (let i = 1; i < n; i++) {
    if (samples[i] !== samples[0]) {
      allEqual = false
      break
    }
  }
  if (allEqual)
    return { plan: { kind: 'constant', bits: header + bits, value: samples[0] ?? 0 }, wasted, samples, bitsPerSample: bits }

  let best: SubframePlan = { kind: 'verbatim', bits: header + n * bits }

  const fixedOrder = Math.min(bestFixedOrder(samples), Math.max(0, n - 1))
  const fixed = fixedResidual(samples, fixedOrder)
  const fixedRice = chooseRice(fixed, fixedOrder, n, options.maxPartitionOrder)
  const fixedBits = header + fixedOrder * bits + fixedRice.bits
  if (fixedBits < best.bits)
    best = { kind: 'fixed', bits: fixedBits, order: fixedOrder, residual: fixed, rice: fixedRice }

  if (options.maxLpcOrder > 0 && n > options.maxLpcOrder) {
    const choice = chooseLpc(samples, options.maxLpcOrder, bits)
    if (choice) {
      const residual = lpcResidual(samples, choice)
      const rice = chooseRice(residual, choice.order, n, options.maxPartitionOrder)
      const lpcBits = header + choice.order * bits + 4 + 5 + choice.order * choice.precision + rice.bits
      if (lpcBits < best.bits)
        best = { kind: 'lpc', bits: lpcBits, choice, residual, rice }
    }
  }

  return { plan: best, wasted, samples, bitsPerSample: bits }
}

function writeSubframe(writer: BitWriter, channel: ChannelPlan, blockSize: number): void {
  const { plan, wasted, samples, bitsPerSample } = channel
  writer.writeBits(0, 1)
  const type = plan.kind === 'constant' ? 0 : plan.kind === 'verbatim' ? 1 : plan.kind === 'fixed' ? 8 + plan.order : 32 + plan.choice.order - 1
  writer.writeBits(type, 6)
  if (wasted) {
    writer.writeBits(1, 1)
    writer.writeUnary(wasted - 1)
  }
  else {
    writer.writeBits(0, 1)
  }
  switch (plan.kind) {
    case 'constant':
      writer.writeSigned(plan.value, bitsPerSample)
      break
    case 'verbatim':
      for (let i = 0; i < blockSize; i++) writer.writeSigned(samples[i], bitsPerSample)
      break
    case 'fixed':
      for (let i = 0; i < plan.order; i++) writer.writeSigned(samples[i], bitsPerSample)
      writeResidual(writer, plan.residual, plan.order, blockSize, plan.rice)
      break
    case 'lpc': {
      const { order, precision, shift, coefficients } = plan.choice
      for (let i = 0; i < order; i++) writer.writeSigned(samples[i], bitsPerSample)
      writer.writeBits(precision - 1, 4)
      writer.writeSigned(shift, 5)
      for (let i = 0; i < order; i++) writer.writeSigned(coefficients[i], precision)
      writeResidual(writer, plan.residual, order, blockSize, plan.rice)
      break
    }
  }
}

// ---------------------------------------------------------------------------
// Frames

/** One block of all channels as a complete FLAC frame, header to CRC-16. */
function encodeFrame(
  block: Int32Array[],
  frameNumber: number,
  sampleRate: number,
  bitsPerSample: number,
  options: Required<Omit<EncodeFlacOptions, 'sampleRate'>>,
): Uint8Array {
  const blockSize = block[0].length
  const channelCount = block.length

  // Choose the channel assignment. Stereo has four, each storing a different
  // pair; whichever codes smallest wins.
  let assignment = channelCount - 1
  let plans: ChannelPlan[]
  if (channelCount === 2 && options.stereoDecorrelation) {
    const [left, right] = block
    const side = new Int32Array(blockSize)
    const mid = new Int32Array(blockSize)
    for (let i = 0; i < blockSize; i++) {
      side[i] = left[i] - right[i]
      mid[i] = (left[i] + right[i]) >> 1
    }
    const l = planChannel(left, bitsPerSample, options)
    const r = planChannel(right, bitsPerSample, options)
    // The difference channel needs one bit more than the others.
    const s = planChannel(side, bitsPerSample + 1, options)
    const m = planChannel(mid, bitsPerSample, options)
    const candidates: [number, ChannelPlan[]][] = [
      [1, [l, r]],
      [8, [l, s]],
      [9, [s, r]],
      [10, [m, s]],
    ]
    let best = candidates[0]
    for (const candidate of candidates) {
      if (candidate[1][0].plan.bits + candidate[1][1].plan.bits < best[1][0].plan.bits + best[1][1].plan.bits)
        best = candidate
    }
    assignment = best[0]
    plans = best[1]
  }
  else {
    plans = block.map(channel => planChannel(channel, bitsPerSample, options))
  }

  const writer = new BitWriter(blockSize * channelCount * 3 + 64)
  const size = blockSizeCode(blockSize)
  const rate = sampleRateCode(sampleRate)
  writer.writeBits(0x3FFE, 14)
  writer.writeBits(0, 1)
  writer.writeBits(0, 1) // fixed block size: the number below is a frame number
  writer.writeBits(size.code, 4)
  writer.writeBits(rate.code, 4)
  writer.writeBits(assignment, 4)
  writer.writeBits(SAMPLE_SIZE_CODES.get(bitsPerSample) ?? 0, 3)
  writer.writeBits(0, 1)
  writeUtf8Number(writer, frameNumber)
  if (size.extra)
    writer.writeBits(size.extra.value, size.extra.bits)
  if (rate.extra)
    writer.writeBits(rate.extra.value, rate.extra.bits)
  writer.writeBits(crc8Flac(writer.view()), 8)

  for (const plan of plans) writeSubframe(writer, plan, blockSize)
  writer.alignToByte()
  writer.writeBits(crc16Flac(writer.view()), 16)
  return writer.view().slice()
}

// ---------------------------------------------------------------------------
// Files

/** Samples as integers at the stream's depth: floats are scaled and clamped, integers checked. */
function toIntegers(channels: (Int32Array | Float32Array)[], bitsPerSample: number): Int32Array[] {
  const max = 2 ** (bitsPerSample - 1) - 1
  const min = -(2 ** (bitsPerSample - 1))
  return channels.map((channel, c) => {
    if (channel instanceof Int32Array) {
      for (let i = 0; i < channel.length; i++) {
        if (channel[i] > max || channel[i] < min)
          throw new FlacEncodeError(`Channel ${c} sample ${i} is ${channel[i]}, outside ${bitsPerSample}-bit range`)
      }
      return channel
    }
    const scale = 2 ** (bitsPerSample - 1)
    const out = new Int32Array(channel.length)
    for (let i = 0; i < channel.length; i++) out[i] = Math.max(min, Math.min(max, Math.round(channel[i] * scale)))
    return out
  })
}

/** Little-endian signed samples, interleaved, a whole byte more than the depth needs: how FLAC's MD5 is taken. */
function md5Block(md5: Md5, block: Int32Array[], bitsPerSample: number): void {
  const width = Math.ceil(bitsPerSample / 8)
  const frames = block[0].length
  const bytes = new Uint8Array(frames * block.length * width)
  let at = 0
  for (let i = 0; i < frames; i++) {
    for (const channel of block) {
      let value = channel[i]
      for (let b = 0; b < width; b++) {
        bytes[at++] = value & 0xFF
        value >>= 8
      }
    }
  }
  md5.update(bytes)
}

/**
 * Planar samples to a complete FLAC file: the "fLaC" marker, STREAMINFO with
 * the MD5 of the audio, then one frame per block.
 *
 * Integer input is taken as already at `bitsPerSample`; float input, in -1 to
 * 1, is scaled to it. Either way `decodeFlacFile` gives the integers back.
 */
export function encodeFlac(channels: (Int32Array | Float32Array)[], options: EncodeFlacOptions): Uint8Array {
  const bitsPerSample = options.bitsPerSample ?? 16
  const sampleRate = options.sampleRate
  const blockSize = options.blockSize ?? 4096
  const settings: Required<Omit<EncodeFlacOptions, 'sampleRate'>> = {
    bitsPerSample,
    blockSize,
    maxLpcOrder: options.maxLpcOrder ?? 8,
    maxPartitionOrder: options.maxPartitionOrder ?? 6,
    stereoDecorrelation: options.stereoDecorrelation ?? true,
  }

  if (!channels.length || channels.length > 8)
    throw new FlacEncodeError(`FLAC carries 1 to 8 channels, not ${channels.length}`)
  if (channels.some(channel => channel.length !== channels[0].length))
    throw new FlacEncodeError('Every channel has to be the same length')
  if (!Number.isInteger(bitsPerSample) || bitsPerSample < MIN_BITS || bitsPerSample > MAX_BITS)
    throw new FlacEncodeError(`Encoding ${bitsPerSample}-bit FLAC is not supported; 4 to 24 bits are`)
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate >= 2 ** 20)
    throw new FlacEncodeError(`A FLAC sample rate has to be a whole number of hertz below 1048576, not ${sampleRate}`)
  if (!Number.isInteger(blockSize) || blockSize < 16 || blockSize > 65535)
    throw new FlacEncodeError(`A FLAC block size has to be 16 to 65535, not ${blockSize}`)
  if (settings.maxLpcOrder < 0 || settings.maxLpcOrder > 32)
    throw new FlacEncodeError('maxLpcOrder has to be 0 to 32')
  if (settings.maxPartitionOrder < 0 || settings.maxPartitionOrder > 15)
    throw new FlacEncodeError('maxPartitionOrder has to be 0 to 15')

  const samples = toIntegers(channels, bitsPerSample)
  const total = samples[0].length
  // STREAMINFO uses a total of 0 to mean the length is unknown, so FLAC has
  // no honest way to say "no samples". The reference encoder refuses an empty
  // input as well.
  if (total === 0)
    throw new FlacEncodeError('A FLAC stream needs at least one sample')
  const md5 = new Md5()
  const frames: Uint8Array[] = []
  let minFrame = Number.POSITIVE_INFINITY
  let maxFrame = 0
  let minBlock = blockSize
  let maxBlock = 0

  for (let start = 0, frameNumber = 0; start < total; start += blockSize, frameNumber++) {
    const end = Math.min(total, start + blockSize)
    const block = samples.map(channel => channel.subarray(start, end))
    md5Block(md5, block, bitsPerSample)
    const frame = encodeFrame(block, frameNumber, sampleRate, bitsPerSample, settings)
    frames.push(frame)
    minFrame = Math.min(minFrame, frame.length)
    maxFrame = Math.max(maxFrame, frame.length)
    // STREAMINFO's minimum block size excludes the last block, which may be short.
    if (end < total)
      minBlock = Math.min(minBlock, end - start)
    maxBlock = Math.max(maxBlock, end - start)
  }
  if (frames.length === 1)
    minBlock = maxBlock

  const streamInfo = new Uint8Array(34)
  const view = new DataView(streamInfo.buffer)
  view.setUint16(0, Math.max(16, minBlock), false)
  view.setUint16(2, Math.max(16, maxBlock), false)
  const writeU24 = (at: number, value: number): void => {
    streamInfo[at] = (value >> 16) & 0xFF
    streamInfo[at + 1] = (value >> 8) & 0xFF
    streamInfo[at + 2] = value & 0xFF
  }
  writeU24(4, minFrame)
  writeU24(7, maxFrame)
  const channelBits = channels.length - 1
  const depthBits = bitsPerSample - 1
  streamInfo[10] = (sampleRate >> 12) & 0xFF
  streamInfo[11] = (sampleRate >> 4) & 0xFF
  streamInfo[12] = ((sampleRate & 0x0F) << 4) | (channelBits << 1) | (depthBits >> 4)
  streamInfo[13] = ((depthBits & 0x0F) << 4) | (Math.floor(total / 2 ** 32) & 0x0F)
  view.setUint32(14, total >>> 0, false)
  streamInfo.set(md5.digest(), 18)

  const length = 4 + 4 + 34 + frames.reduce((n, frame) => n + frame.length, 0)
  const out = new Uint8Array(length)
  out.set([0x66, 0x4C, 0x61, 0x43], 0) // "fLaC"
  out[4] = 0x80 // last metadata block, type STREAMINFO
  out[5] = 0
  out[6] = 0
  out[7] = 34
  out.set(streamInfo, 8)
  let at = 42
  for (const frame of frames) {
    out.set(frame, at)
    at += frame.length
  }
  return out
}
