/**
 * An AAC decoder (ISO/IEC 14496-3, the low complexity profile) in plain
 * TypeScript: what phones, Safari and most MP4 and M4A files carry.
 *
 * HE-AAC (SBR) and HE-AAC v2 (parametric stereo) decode their AAC core: the
 * sound below half the output rate, at half the rate, in mono for v2. That
 * is all of a voice. Main and LTP prediction, coupling channels and 960-line
 * frames are refused with a plain error.
 */

import type { AudioPacketDecoder, AudioTrack, DecodedAudioChunk, EncodedPacket } from '@ts-audio/core'
import type { AacCodebook } from './aac-tables'
import {
  AAC_SAMPLE_RATES,
  AAC_SCALEFACTOR_CODEBOOK,
  AAC_SPECTRAL_CODEBOOKS,
  AAC_SWB_OFFSETS_LONG,
  AAC_SWB_OFFSETS_SHORT,
  AAC_TNS_MAX_BANDS_LONG,
  AAC_TNS_MAX_BANDS_SHORT,
} from './aac-tables'
import { parseAacAudioSpecificConfig } from './aac-config'

// eslint-disable-next-line pickier/no-unused-vars
const ONLY_LONG_SEQUENCE = 0
const LONG_START_SEQUENCE = 1
const EIGHT_SHORT_SEQUENCE = 2
const LONG_STOP_SEQUENCE = 3

const ZERO_HCB = 0
const ESC_HCB = 11
const NOISE_HCB = 13
const INTENSITY_HCB2 = 14
const INTENSITY_HCB = 15

const ID_SCE = 0
const ID_CPE = 1
const ID_CCE = 2
const ID_LFE = 3
const ID_DSE = 4
const ID_PCE = 5
const ID_FIL = 6
const ID_END = 7

/** Samples a frame makes, per channel. */
export const AAC_FRAME_LENGTH = 1024

export class AacDecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AacDecodeError'
  }
}

// ---------------------------------------------------------------------------
// Bits

class BitReader {
  private position = 0
  private readonly end: number

  constructor(private readonly data: Uint8Array) {
    this.end = data.length * 8
  }

  bit(): number {
    if (this.position >= this.end)
      throw new AacDecodeError('AAC frame ended early')
    const value = (this.data[this.position >> 3] >> (7 - (this.position & 7))) & 1
    this.position++
    return value
  }

  read(count: number): number {
    if (this.position + count > this.end)
      throw new AacDecodeError('AAC frame ended early')
    let value = 0
    let remaining = count
    while (remaining > 0) {
      const offset = this.position & 7
      const take = Math.min(remaining, 8 - offset)
      const bits = (this.data[this.position >> 3] >> (8 - offset - take)) & ((1 << take) - 1)
      value = value * (1 << take) + bits
      this.position += take
      remaining -= take
    }
    return value
  }

  skip(count: number): void {
    if (this.position + count > this.end)
      throw new AacDecodeError('AAC frame ended early')
    this.position += count
  }

  byteAlign(): void {
    this.position = (this.position + 7) & ~7
  }
}

// ---------------------------------------------------------------------------
// Huffman

/**
 * A codebook as a binary tree in one array: node i's children are at 2i
 * and 2i + 1; a child above zero is another node, below zero a leaf holding
 * -(index + 1).
 */
function buildTree(codebook: AacCodebook): Int32Array {
  const nodes: number[] = [0, 0]
  codebook.codes.forEach((code, symbol) => {
    const length = codebook.lengths[symbol]
    let node = 0
    for (let i = length - 1; i > 0; i--) {
      const bit = Math.floor(code / 2 ** i) & 1
      let next = nodes[2 * node + bit]
      if (!next) {
        next = nodes.length / 2
        nodes.push(0, 0)
        nodes[2 * node + bit] = next
      }
      node = next
    }
    nodes[2 * node + (code & 1)] = -(symbol + 1)
  })
  return Int32Array.from(nodes)
}

function readSymbol(bits: BitReader, tree: Int32Array): number {
  let node = 0
  for (;;) {
    const next = tree[2 * node + bits.bit()]
    if (next < 0)
      return -next - 1
    if (next === 0)
      throw new AacDecodeError('AAC frame holds an invalid Huffman codeword')
    node = next
  }
}

const SCALEFACTOR_TREE = buildTree(AAC_SCALEFACTOR_CODEBOOK)
const SPECTRAL_TREES = AAC_SPECTRAL_CODEBOOKS.map(codebook => codebook ? buildTree(codebook) : null)

/** How each spectral codebook's index splits into values: 4 or 2 of them, signed or with sign bits, in base `modulo`. */
const SPECTRAL_LAYOUT: readonly ({ dimension: 2 | 4, unsigned: boolean, modulo: number, offset: number } | null)[] = [
  null,
  { dimension: 4, unsigned: false, modulo: 3, offset: 1 },
  { dimension: 4, unsigned: false, modulo: 3, offset: 1 },
  { dimension: 4, unsigned: true, modulo: 3, offset: 0 },
  { dimension: 4, unsigned: true, modulo: 3, offset: 0 },
  { dimension: 2, unsigned: false, modulo: 9, offset: 4 },
  { dimension: 2, unsigned: false, modulo: 9, offset: 4 },
  { dimension: 2, unsigned: true, modulo: 8, offset: 0 },
  { dimension: 2, unsigned: true, modulo: 8, offset: 0 },
  { dimension: 2, unsigned: true, modulo: 13, offset: 0 },
  { dimension: 2, unsigned: true, modulo: 13, offset: 0 },
  { dimension: 2, unsigned: true, modulo: 17, offset: 0 },
]

/** |q| to the power 4/3, the inverse of the encoder's quantiser, for every value a frame can hold. */
const POW43 = (() => {
  const table = new Float64Array(8192)
  for (let i = 0; i < table.length; i++) table[i] = i ** (4 / 3)
  return table
})()

// ---------------------------------------------------------------------------
// Channel streams

interface IcsInfo {
  windowSequence: number
  windowShape: number
  maxSfb: number
  /** Windows per group; one group of one window for a long frame. */
  groupLengths: number[]
  windows: 1 | 8
  swbOffsets: readonly number[]
  bandCount: number
}

interface TnsFilter {
  start: number
  end: number
  direction: number
  lpc: Float64Array
}

interface ChannelStream {
  info: IcsInfo
  /** The codebook of every band, group by group: [group * maxSfb + sfb]. */
  codebooks: Uint8Array
  /** The scale factor, intensity position or noise energy of every band, laid out as `codebooks`. */
  scales: Int32Array
  /** Dequantised spectrum, windows one after another (8 × 128 for short frames). */
  spectrum: Float32Array
  /** TNS filters by window. */
  tns: TnsFilter[][] | null
}

interface ChannelState {
  overlap: Float32Array
  previousShape: number
}

class AacFrameDecoder {
  readonly sampleRate: number
  private readonly sampleRateIndex: number
  private states: ChannelState[] = []
  private noiseSeed = 0x1F2E3D4C

  constructor(sampleRateIndex: number) {
    this.sampleRateIndex = Math.min(sampleRateIndex, 11)
    this.sampleRate = AAC_SAMPLE_RATES[sampleRateIndex] ?? 0
    if (!this.sampleRate)
      throw new AacDecodeError('AAC stream has an unknown sampling rate')
  }

  /** One raw_data_block to one 1024-sample frame per channel, in the order the elements come. */
  decodeFrame(data: Uint8Array): Float32Array[] {
    const bits = new BitReader(data)
    const output: Float32Array[] = []
    let channel = 0
    for (;;) {
      const id = bits.read(3)
      if (id === ID_END)
        break
      switch (id) {
        case ID_SCE:
        case ID_LFE: {
          bits.skip(4)
          const stream = this.readChannelStream(bits, null)
          output.push(this.synthesize(stream, channel++))
          break
        }
        case ID_CPE: {
          bits.skip(4)
          const commonWindow = bits.bit()
          let shared: IcsInfo | null = null
          let msMaskPresent = 0
          let msUsed: Uint8Array | null = null
          if (commonWindow) {
            shared = this.readIcsInfo(bits)
            msMaskPresent = bits.read(2)
            if (msMaskPresent === 1) {
              msUsed = new Uint8Array(shared.groupLengths.length * shared.maxSfb)
              for (let i = 0; i < msUsed.length; i++) msUsed[i] = bits.bit()
            }
          }
          const left = this.readChannelStream(bits, shared)
          const right = this.readChannelStream(bits, shared)
          if (commonWindow)
            applyStereo(left, right, msMaskPresent, msUsed)
          output.push(this.synthesize(left, channel++))
          output.push(this.synthesize(right, channel++))
          break
        }
        case ID_CCE:
          throw new AacDecodeError('AAC coupling channels are not supported')
        case ID_DSE: {
          bits.skip(4)
          const align = bits.bit()
          let count = bits.read(8)
          if (count === 255)
            count += bits.read(8)
          if (align)
            bits.byteAlign()
          bits.skip(count * 8)
          break
        }
        case ID_PCE:
          skipProgramConfig(bits)
          break
        case ID_FIL: {
          // Extension payloads (SBR among them) are skipped: the core is decoded on its own.
          let count = bits.read(4)
          if (count === 15)
            count += bits.read(8) - 1
          bits.skip(count * 8)
          break
        }
      }
    }
    return output
  }

  private readIcsInfo(bits: BitReader): IcsInfo {
    bits.skip(1)
    const windowSequence = bits.read(2)
    const windowShape = bits.bit()
    if (windowSequence === EIGHT_SHORT_SEQUENCE) {
      const maxSfb = bits.read(4)
      const grouping = bits.read(7)
      const groupLengths = [1]
      for (let i = 6; i >= 0; i--) {
        if ((grouping >> i) & 1)
          groupLengths[groupLengths.length - 1]++
        else
          groupLengths.push(1)
      }
      const swbOffsets = AAC_SWB_OFFSETS_SHORT[this.sampleRateIndex]
      const bandCount = swbOffsets.length - 1
      if (maxSfb > bandCount)
        throw new AacDecodeError('AAC frame has more bands than its rate allows')
      return { windowSequence, windowShape, maxSfb, groupLengths, windows: 8, swbOffsets, bandCount }
    }
    const maxSfb = bits.read(6)
    if (bits.bit())
      throw new AacDecodeError('AAC prediction (Main and LTP profiles) is not supported')
    const swbOffsets = AAC_SWB_OFFSETS_LONG[this.sampleRateIndex]
    const bandCount = swbOffsets.length - 1
    if (maxSfb > bandCount)
      throw new AacDecodeError('AAC frame has more bands than its rate allows')
    return { windowSequence, windowShape, maxSfb, groupLengths: [1], windows: 1, swbOffsets, bandCount }
  }

  private readChannelStream(bits: BitReader, shared: IcsInfo | null): ChannelStream {
    const globalGain = bits.read(8)
    const info = shared ?? this.readIcsInfo(bits)
    const { maxSfb, groupLengths, windows, swbOffsets } = info
    const long = windows === 1

    // Sections: runs of bands that share a codebook.
    const codebooks = new Uint8Array(groupLengths.length * maxSfb)
    const sectionBits = long ? 5 : 3
    const escape = (1 << sectionBits) - 1
    for (let g = 0; g < groupLengths.length; g++) {
      let k = 0
      while (k < maxSfb) {
        const codebook = bits.read(4)
        if (codebook === 12)
          throw new AacDecodeError('AAC frame uses a reserved codebook')
        let length = 0
        let increment: number
        do {
          increment = bits.read(sectionBits)
          length += increment
        } while (increment === escape)
        if (k + length > maxSfb)
          throw new AacDecodeError('AAC section runs past the last band')
        codebooks.fill(codebook, g * maxSfb + k, g * maxSfb + k + length)
        k += length
      }
    }

    // Scale factors, intensity positions and noise energies, each coded as a difference from the last.
    const scales = new Int32Array(codebooks.length)
    let scaleFactor = globalGain
    let intensity = 0
    let noise = globalGain - 90
    let firstNoise = true
    for (let i = 0; i < codebooks.length; i++) {
      const codebook = codebooks[i]
      if (codebook === ZERO_HCB)
        continue
      if (codebook === INTENSITY_HCB || codebook === INTENSITY_HCB2) {
        intensity += readSymbol(bits, SCALEFACTOR_TREE) - 60
        scales[i] = intensity
      }
      else if (codebook === NOISE_HCB) {
        if (firstNoise) {
          firstNoise = false
          noise += bits.read(9) - 256
        }
        else {
          noise += readSymbol(bits, SCALEFACTOR_TREE) - 60
        }
        scales[i] = noise
      }
      else {
        scaleFactor += readSymbol(bits, SCALEFACTOR_TREE) - 60
        if (scaleFactor < 0 || scaleFactor > 255)
          throw new AacDecodeError('AAC scale factor out of range')
        scales[i] = scaleFactor
      }
    }

    let pulses: { start: number, offsets: number[], amplitudes: number[] } | null = null
    if (bits.bit()) {
      if (!long)
        throw new AacDecodeError('AAC pulse data in a short frame')
      const count = bits.read(2) + 1
      const start = bits.read(6)
      if (start >= info.bandCount)
        throw new AacDecodeError('AAC pulse data starts past the last band')
      const offsets: number[] = []
      const amplitudes: number[] = []
      for (let i = 0; i < count; i++) {
        offsets.push(bits.read(5))
        amplitudes.push(bits.read(4))
      }
      pulses = { start, offsets, amplitudes }
    }

    const tns = bits.bit() ? this.readTns(bits, info) : null

    if (bits.bit())
      throw new AacDecodeError('AAC gain control (SSR profile) is not supported')

    // Spectral data, quantised, in each group's own order: band by band, and within a band window by window.
    const quantised = new Int32Array(1024)
    for (let g = 0, window = 0; g < groupLengths.length; window += groupLengths[g], g++) {
      const groupLength = groupLengths[g]
      for (let sfb = 0; sfb < maxSfb; sfb++) {
        const codebook = codebooks[g * maxSfb + sfb]
        const width = swbOffsets[sfb + 1] - swbOffsets[sfb]
        if (codebook === ZERO_HCB || codebook >= NOISE_HCB) {
          continue
        }
        for (let w = 0; w < groupLength; w++) {
          const base = (window + w) * 128 * (long ? 8 : 1) + swbOffsets[sfb]
          readSpectralBand(bits, codebook, quantised, base, width)
        }
      }
    }

    if (pulses) {
      let k = swbOffsets[pulses.start]
      for (let i = 0; i < pulses.offsets.length; i++) {
        k += pulses.offsets[i]
        if (k >= 1024)
          throw new AacDecodeError('AAC pulse lands past the spectrum')
        quantised[k] += quantised[k] > 0 ? pulses.amplitudes[i] : -pulses.amplitudes[i]
      }
    }

    const spectrum = new Float32Array(1024)
    for (let g = 0, window = 0; g < groupLengths.length; window += groupLengths[g], g++) {
      for (let sfb = 0; sfb < maxSfb; sfb++) {
        const codebook = codebooks[g * maxSfb + sfb]
        const from = swbOffsets[sfb]
        const to = swbOffsets[sfb + 1]
        for (let w = 0; w < groupLengths[g]; w++) {
          const base = (window + w) * (long ? 1024 : 128)
          if (codebook === NOISE_HCB) {
            this.fillNoise(spectrum, base + from, base + to, scales[g * maxSfb + sfb])
          }
          else if (codebook !== ZERO_HCB && codebook !== INTENSITY_HCB && codebook !== INTENSITY_HCB2) {
            const gain = 2 ** (0.25 * (scales[g * maxSfb + sfb] - 100))
            for (let k = base + from; k < base + to; k++) {
              const q = quantised[k]
              spectrum[k] = q === 0 ? 0 : q > 0 ? POW43[q] * gain : -POW43[-q] * gain
            }
          }
        }
      }
    }

    return { info, codebooks, scales, spectrum, tns }
  }

  private readTns(bits: BitReader, info: IcsInfo): TnsFilter[][] {
    const long = info.windows === 1
    const maxOrder = long ? 12 : 7
    const maxBands = Math.min(info.maxSfb, (long ? AAC_TNS_MAX_BANDS_LONG : AAC_TNS_MAX_BANDS_SHORT)[this.sampleRateIndex])
    const filters: TnsFilter[][] = []
    for (let w = 0; w < info.windows; w++) {
      const windowFilters: TnsFilter[] = []
      const count = bits.read(long ? 2 : 1)
      const resolution = count ? bits.bit() : 0
      let top = info.bandCount
      for (let f = 0; f < count; f++) {
        const length = bits.read(long ? 6 : 4)
        const order = bits.read(long ? 5 : 3)
        const bottom = Math.max(top - length, 0)
        if (order) {
          const direction = bits.bit()
          const compress = bits.bit()
          const coefficientBits = resolution + 3 - compress
          const coefficients: number[] = []
          for (let i = 0; i < order; i++) {
            const raw = bits.read(coefficientBits)
            coefficients.push(raw >= 1 << (coefficientBits - 1) ? raw - (1 << coefficientBits) : raw)
          }
          if (order > maxOrder)
            throw new AacDecodeError('AAC TNS filter order too high')
          const start = info.swbOffsets[Math.min(bottom, maxBands)]
          const end = info.swbOffsets[Math.min(top, maxBands)]
          if (end > start)
            windowFilters.push({ start, end, direction, lpc: tnsLpc(coefficients, resolution + 3) })
        }
        top = bottom
      }
      filters.push(windowFilters)
    }
    return filters
  }

  /** Noise of the band's energy where the encoder sent none (perceptual noise substitution). */
  private fillNoise(spectrum: Float32Array, from: number, to: number, energy: number): void {
    let sum = 0
    for (let k = from; k < to; k++) {
      this.noiseSeed = (Math.imul(this.noiseSeed, 1664525) + 1013904223) | 0
      spectrum[k] = this.noiseSeed
      sum += this.noiseSeed * this.noiseSeed
    }
    const scale = sum > 0 ? 2 ** (0.25 * energy) / Math.sqrt(sum) : 0
    for (let k = from; k < to; k++) spectrum[k] *= scale
  }

  /** TNS, then the inverse transform, windowing and overlap with the frame before: 1024 samples in -1 to 1. */
  private synthesize(stream: ChannelStream, channel: number): Float32Array {
    const state = this.states[channel] ??= { overlap: new Float32Array(1024), previousShape: 0 }
    const { info, spectrum, tns } = stream
    if (tns) {
      for (let w = 0; w < info.windows; w++) {
        const offset = w * (info.windows === 1 ? 1024 : 128)
        for (const filter of tns[w]) applyTns(spectrum, offset + filter.start, offset + filter.end, filter.direction, filter.lpc)
      }
    }
    const output = filterBank(spectrum, info.windowSequence, info.windowShape, state)
    for (let i = 0; i < 1024; i++) output[i] /= 32768
    return output
  }
}

/** Reads one band of one window's quantised values. */
function readSpectralBand(bits: BitReader, codebook: number, out: Int32Array, base: number, width: number): void {
  const layout = SPECTRAL_LAYOUT[codebook]!
  const tree = SPECTRAL_TREES[codebook]!
  const { dimension, unsigned, modulo, offset } = layout
  for (let k = 0; k < width; k += dimension) {
    const index = readSymbol(bits, tree)
    const values = dimension === 4
      ? [Math.floor(index / 27), Math.floor(index / 9) % 3, Math.floor(index / 3) % 3, index % 3]
      : [Math.floor(index / modulo), index % modulo]
    for (let i = 0; i < dimension; i++) {
      let value = values[i] - offset
      if (unsigned && value !== 0 && bits.bit())
        value = -value
      values[i] = value
    }
    if (codebook === ESC_HCB) {
      for (let i = 0; i < 2; i++) {
        if (Math.abs(values[i]) === 16) {
          let exponent = 4
          while (bits.bit()) {
            exponent++
            if (exponent > 12)
              throw new AacDecodeError('AAC escape value too long')
          }
          const magnitude = (1 << exponent) + bits.read(exponent)
          values[i] = values[i] < 0 ? -magnitude : magnitude
        }
      }
    }
    for (let i = 0; i < dimension; i++) {
      const value = values[i]
      if (value > 8191 || value < -8191)
        throw new AacDecodeError('AAC quantised value out of range')
      out[base + k + i] = value
    }
  }
}


/** Mid/side to left/right, and intensity stereo: the right channel as a scaled copy of the left. */
function applyStereo(left: ChannelStream, right: ChannelStream, msMaskPresent: number, msUsed: Uint8Array | null): void {
  const { info } = left
  const long = info.windows === 1
  for (let g = 0, window = 0; g < info.groupLengths.length; window += info.groupLengths[g], g++) {
    for (let sfb = 0; sfb < info.maxSfb; sfb++) {
      const band = g * info.maxSfb + sfb
      const rightCodebook = right.codebooks[band]
      const leftCodebook = left.codebooks[band]
      const used = msMaskPresent === 2 || (msMaskPresent === 1 && msUsed![band] === 1)
      const intensity = rightCodebook === INTENSITY_HCB || rightCodebook === INTENSITY_HCB2
      for (let w = 0; w < info.groupLengths[g]; w++) {
        const base = (window + w) * (long ? 1024 : 128)
        const from = base + info.swbOffsets[sfb]
        const to = base + info.swbOffsets[sfb + 1]
        if (intensity) {
          const sign = (rightCodebook === INTENSITY_HCB ? 1 : -1) * (msMaskPresent === 1 && used ? -1 : 1)
          const scale = sign * 0.5 ** (0.25 * right.scales[band])
          for (let k = from; k < to; k++) right.spectrum[k] = left.spectrum[k] * scale
        }
        else if (used && leftCodebook !== NOISE_HCB && rightCodebook !== NOISE_HCB) {
          for (let k = from; k < to; k++) {
            const mid = left.spectrum[k]
            const side = right.spectrum[k]
            left.spectrum[k] = mid + side
            right.spectrum[k] = mid - side
          }
        }
      }
    }
  }
}

/** The TNS coefficients (reflection coefficients, quantised) to the all-pole filter they describe. */
function tnsLpc(coefficients: number[], resolutionBits: number): Float64Array {
  const half = 1 << (resolutionBits - 1)
  const positive = (half - 0.5) / (Math.PI / 2)
  const negative = (half + 0.5) / (Math.PI / 2)
  const order = coefficients.length
  const lpc = new Float64Array(order + 1)
  const scratch = new Float64Array(order + 1)
  lpc[0] = 1
  for (let m = 1; m <= order; m++) {
    const value = coefficients[m - 1]
    const reflection = Math.sin(value / (value >= 0 ? positive : negative))
    for (let i = 1; i < m; i++) scratch[i] = lpc[i] + reflection * lpc[m - i]
    for (let i = 1; i < m; i++) lpc[i] = scratch[i]
    lpc[m] = reflection
  }
  return lpc
}

function applyTns(spectrum: Float32Array, start: number, end: number, direction: number, lpc: Float64Array): void {
  const order = lpc.length - 1
  const state = new Float64Array(order)
  const count = end - start
  let k = direction ? end - 1 : start
  const step = direction ? -1 : 1
  for (let n = 0; n < count; n++, k += step) {
    let y = spectrum[k]
    for (let i = 0; i < order; i++) y -= state[i] * lpc[i + 1]
    for (let i = order - 1; i > 0; i--) state[i] = state[i - 1]
    if (order)
      state[0] = y
    spectrum[k] = y
  }
}

function skipProgramConfig(bits: BitReader): void {
  bits.skip(4 + 2 + 4)
  const front = bits.read(4)
  const side = bits.read(4)
  const back = bits.read(4)
  const lfe = bits.read(2)
  const assoc = bits.read(3)
  const cc = bits.read(4)
  if (bits.bit()) bits.skip(4)
  if (bits.bit()) bits.skip(4)
  if (bits.bit()) bits.skip(3)
  bits.skip((front + side + back) * 5 + lfe * 4 + assoc * 4 + cc * 5)
  bits.byteAlign()
  bits.skip(bits.read(8) * 8)
}

// ---------------------------------------------------------------------------
// Filter bank

/** The rising half of a window of N samples: sine, or Kaiser-Bessel derived with the given alpha. */
function risingWindow(length: number, shape: number): Float32Array {
  const half = length / 2
  const window = new Float32Array(half)
  if (shape === 0) {
    for (let n = 0; n < half; n++) window[n] = Math.sin(Math.PI / length * (n + 0.5))
    return window
  }
  const alpha = length === 2048 ? 4 : 6
  const kernel = new Float64Array(half + 1)
  let total = 0
  for (let n = 0; n <= half; n++) {
    const x = (2 * n) / half - 1
    kernel[n] = besselI0(Math.PI * alpha * Math.sqrt(1 - x * x))
    total += kernel[n]
  }
  let running = 0
  for (let n = 0; n < half; n++) {
    running += kernel[n]
    window[n] = Math.sqrt(running / total)
  }
  return window
}

function besselI0(x: number): number {
  let sum = 1
  let term = 1
  const half = x / 2
  for (let k = 1; k < 64; k++) {
    term *= (half / k) * (half / k)
    sum += term
    if (term < sum * 1e-14)
      break
  }
  return sum
}

const LONG_WINDOWS = [risingWindow(2048, 0), risingWindow(2048, 1)]
const SHORT_WINDOWS = [risingWindow(256, 0), risingWindow(256, 1)]

function filterBank(spectrum: Float32Array, sequence: number, shape: number, state: ChannelState): Float32Array {
  const output = new Float32Array(1024)
  const { overlap } = state
  const previous = state.previousShape
  if (sequence === EIGHT_SHORT_SEQUENCE) {
    const buffer = new Float32Array(2048)
    const rising = SHORT_WINDOWS[shape]
    for (let w = 0; w < 8; w++) {
      const samples = imdct(spectrum.subarray(w * 128, w * 128 + 128))
      const left = w === 0 ? SHORT_WINDOWS[previous] : rising
      const offset = 448 + w * 128
      for (let n = 0; n < 128; n++) {
        buffer[offset + n] += samples[n] * left[n]
        buffer[offset + 128 + n] += samples[128 + n] * rising[127 - n]
      }
    }
    for (let n = 0; n < 1024; n++) {
      output[n] = overlap[n] + buffer[n]
      overlap[n] = buffer[1024 + n]
    }
  }
  else {
    const samples = imdct(spectrum)
    if (sequence === LONG_STOP_SEQUENCE) {
      const left = SHORT_WINDOWS[previous]
      for (let n = 0; n < 448; n++) output[n] = overlap[n]
      for (let n = 0; n < 128; n++) output[448 + n] = overlap[448 + n] + samples[448 + n] * left[n]
      for (let n = 576; n < 1024; n++) output[n] = overlap[n] + samples[n]
    }
    else {
      const left = LONG_WINDOWS[previous]
      for (let n = 0; n < 1024; n++) output[n] = overlap[n] + samples[n] * left[n]
    }
    if (sequence === LONG_START_SEQUENCE) {
      const right = SHORT_WINDOWS[shape]
      for (let n = 0; n < 448; n++) overlap[n] = samples[1024 + n]
      for (let n = 0; n < 128; n++) overlap[448 + n] = samples[1472 + n] * right[127 - n]
      overlap.fill(0, 576)
    }
    else {
      const right = LONG_WINDOWS[shape]
      for (let n = 0; n < 1024; n++) overlap[n] = samples[1024 + n] * right[1023 - n]
    }
  }
  state.previousShape = shape
  return output
}

interface ImdctPlan {
  cos: Float64Array
  sin: Float64Array
  fftCos: Float64Array
  fftSin: Float64Array
  reversed: Uint16Array
}

const plans = new Map<number, ImdctPlan>()

function imdctPlan(length: number): ImdctPlan {
  let plan = plans.get(length)
  if (plan)
    return plan
  const quarter = length / 4
  const cos = new Float64Array(quarter)
  const sin = new Float64Array(quarter)
  for (let k = 0; k < quarter; k++) {
    const angle = (2 * Math.PI * (k + 1 / 8)) / length
    cos[k] = Math.cos(angle)
    sin[k] = Math.sin(angle)
  }
  const fftCos = new Float64Array(quarter / 2)
  const fftSin = new Float64Array(quarter / 2)
  for (let k = 0; k < quarter / 2; k++) {
    fftCos[k] = Math.cos((2 * Math.PI * k) / quarter)
    fftSin[k] = Math.sin((2 * Math.PI * k) / quarter)
  }
  const bits = Math.log2(quarter)
  const reversed = new Uint16Array(quarter)
  for (let i = 0; i < quarter; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
    reversed[i] = r
  }
  plan = { cos, sin, fftCos, fftSin, reversed }
  plans.set(length, plan)
  return plan
}

/**
 * The inverse MDCT of N/2 coefficients to N samples,
 * x[n] = 2/N · Σ X[k] cos(2π/N · (n + n0) · (k + 1/2)), n0 = (N/2 + 1)/2,
 * through a complex FFT of N/4 points.
 */
export function imdct(input: Float32Array): Float32Array {
  const half = input.length
  const length = half * 2
  const quarter = half / 2
  const eighth = quarter / 2
  const plan = imdctPlan(length)
  const re = new Float64Array(quarter)
  const im = new Float64Array(quarter)
  for (let k = 0; k < quarter; k++) {
    const a = input[2 * k]
    const b = input[half - 1 - 2 * k]
    const c = plan.cos[k]
    const s = plan.sin[k]
    im[k] = a * c + b * s
    re[k] = b * c - a * s
  }
  inverseFft(re, im, plan)
  const scale = 2 / length
  for (let k = 0; k < quarter; k++) {
    const x = re[k]
    const y = im[k]
    const c = plan.cos[k]
    const s = plan.sin[k]
    im[k] = (y * c + x * s) * scale
    re[k] = (x * c - y * s) * scale
  }
  const out = new Float32Array(length)
  for (let k = 0; k < eighth; k += 2) {
    out[2 * k] = im[eighth + k]
    out[2 + 2 * k] = im[eighth + 1 + k]
    out[1 + 2 * k] = -re[eighth - 1 - k]
    out[3 + 2 * k] = -re[eighth - 2 - k]
    out[quarter + 2 * k] = re[k]
    out[quarter + 2 + 2 * k] = re[1 + k]
    out[quarter + 1 + 2 * k] = -im[quarter - 1 - k]
    out[quarter + 3 + 2 * k] = -im[quarter - 2 - k]
    out[half + 2 * k] = re[eighth + k]
    out[half + 2 + 2 * k] = re[eighth + 1 + k]
    out[half + 1 + 2 * k] = -im[eighth - 1 - k]
    out[half + 3 + 2 * k] = -im[eighth - 2 - k]
    out[half + quarter + 2 * k] = -im[k]
    out[half + quarter + 2 + 2 * k] = -im[1 + k]
    out[half + quarter + 1 + 2 * k] = re[quarter - 1 - k]
    out[half + quarter + 3 + 2 * k] = re[quarter - 2 - k]
  }
  return out
}

/** An unscaled complex FFT with a positive exponent, in place, radix 2. */
function inverseFft(re: Float64Array, im: Float64Array, plan: ImdctPlan): void {
  const size = re.length
  for (let i = 0; i < size; i++) {
    const j = plan.reversed[i]
    if (j > i) {
      let t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
  }
  for (let span = 2; span <= size; span *= 2) {
    const half = span / 2
    const step = size / span
    for (let start = 0; start < size; start += span) {
      for (let k = 0; k < half; k++) {
        const c = plan.fftCos[k * step]
        const s = plan.fftSin[k * step]
        const a = start + k
        const b = a + half
        const tr = re[b] * c - im[b] * s
        const ti = re[b] * s + im[b] * c
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The decoder decodeAudio uses

/**
 * The raw AAC frame of a packet. An ADTS file (and MPEG-TS) puts a 7-byte
 * header, or 9 with a CRC, in front of every frame; MP4 and Matroska packets
 * are the frame alone. A header is taken as one only when it says the frame
 * is exactly as long as the packet, so a raw frame is never mistaken for one.
 */
function rawAacFrame(data: Uint8Array): Uint8Array {
  const layer = (data[1] >> 1) & 0x03
  if (data.length < 7 || data[0] !== 0xFF || (data[1] & 0xF0) !== 0xF0 || layer !== 0)
    return data
  const frameLength = ((data[3] & 0x03) << 11) | (data[4] << 3) | ((data[5] >> 5) & 0x07)
  if (frameLength !== data.length)
    return data
  const protectionAbsent = (data[1] & 0x01) === 1
  return data.subarray(protectionAbsent ? 7 : 9)
}

/** A decoder for an AAC track, configured from its AudioSpecificConfig. */
export function createAacDecoder(track: AudioTrack): AudioPacketDecoder {
  const description = (track as AudioTrack & { codecDescription?: Uint8Array }).codecDescription
  let sampleRateIndex: number
  if (description?.length) {
    const config = parseAacAudioSpecificConfig(description)
    if (config.frameLengthFlag)
      throw new AacDecodeError('AAC with 960-sample frames is not supported')
    if (![1, 2, 4, 5, 29].includes(config.audioObjectType))
      throw new AacDecodeError(`AAC object type ${config.audioObjectType} is not supported`)
    sampleRateIndex = config.samplingFrequencyIndex === 15
      ? AAC_SAMPLE_RATES.indexOf(config.samplingFrequency)
      : config.samplingFrequencyIndex
  }
  else {
    sampleRateIndex = AAC_SAMPLE_RATES.indexOf(track.sampleRate)
  }
  if (sampleRateIndex < 0)
    throw new AacDecodeError('AAC stream has an unknown sampling rate')
  let decoder = new AacFrameDecoder(sampleRateIndex)
  let frames = 0
  let damaged = 0
  let firstError: Error | null = null
  let channelCount = 0
  return {
    decode: (packet: EncodedPacket): DecodedAudioChunk | null => {
      frames++
      try {
        const channels = decoder.decodeFrame(rawAacFrame(packet.data))
        if (!channelCount)
          channelCount = channels.length
        return channels.length ? { sampleRate: decoder.sampleRate, channels } : null
      }
      catch (error) {
        if (!(error instanceof AacDecodeError))
          throw error
        // A damaged frame is heard as a moment of silence, as players do; a
        // file with more than a few is refused. The overlap the bad frame
        // would have carried is unknown, so the next frame starts afresh.
        damaged++
        firstError ??= error
        if (damaged > Math.max(3, frames * 0.05))
          throw new AacDecodeError(`The AAC audio is damaged: ${firstError.message}`)
        decoder = new AacFrameDecoder(sampleRateIndex)
        const silent = channelCount || 1
        return { sampleRate: decoder.sampleRate, channels: Array.from({ length: silent }, () => new Float32Array(AAC_FRAME_LENGTH)) }
      }
    },
  }
}
