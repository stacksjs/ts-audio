/**
 * The CELT layer of Opus (RFC 6716 section 4.3): the music and full-band
 * codec, and the upper band of hybrid frames. Floating point, 48 kHz.
 *
 * Ported from libopus 1.5.2 (celt/celt_decoder.c, bands.c, vq.c, cwrs.c,
 * rate.c, quant_bands.c, mdct.c, celt.c), BSD 3-clause licence, in
 * THIRD_PARTY_NOTICES.md. Packet loss concealment is reduced to what
 * decoding whole files needs.
 */

import { BITRES, ilog, RangeDecoder } from './range-decoder'
import {
  BAND_ALLOCATION,
  CACHE_BITS,
  CACHE_CAPS,
  CACHE_INDEX,
  E_MEANS,
  E_PROB_MODEL,
  EBANDS,
  LOG_N,
  LOG2_FRAC_TABLE,
  MDCT_TWIDDLES,
  PVQ_U_DATA,
  PVQ_U_ROWS,
  WINDOW,
} from './celt-tables'

const NB_EBANDS = 21
const OVERLAP = 120
const SHORT_MDCT_SIZE = 120
const MAX_LM = 3
const NB_ALLOC_VECTORS = 11
const PREEMPH = 0.85000610
const DECODE_BUFFER_SIZE = 2048
const COMBFILTER_MINPERIOD = 15
const MAX_FINE_BITS = 8
const FINE_OFFSET = 21
const QTHETA_OFFSET = 4
const QTHETA_OFFSET_TWOPHASE = 16
const LOG_MAX_PSEUDO = 6
const ALLOC_STEPS = 6
const SPREAD_NONE = 0
const SPREAD_NORMAL = 2
const SPREAD_AGGRESSIVE = 3
const EPSILON = 1e-15
const VERY_SMALL = 1e-30

const TRIM_ICDF = [126, 124, 119, 109, 87, 41, 19, 9, 4, 2, 0]
const SPREAD_ICDF = [25, 23, 2, 0]
const TAPSET_ICDF = [2, 1, 0]
const SMALL_ENERGY_ICDF = [2, 1, 0]
const PRED_COEF = [29440 / 32768, 26112 / 32768, 21248 / 32768, 16384 / 32768]
const BETA_COEF = [30147 / 32768, 22282 / 32768, 12124 / 32768, 6554 / 32768]
const BETA_INTRA = 4915 / 32768
const TF_SELECT_TABLE = [
  [0, -1, 0, -1, 0, -1, 0, -1],
  [0, -1, 0, -2, 1, 0, 1, -1],
  [0, -2, 0, -3, 2, 0, 1, -1],
  [0, -2, 0, -3, 3, 0, 1, -1],
]
const ORDERY_TABLE = [1, 0, 3, 0, 2, 1, 7, 0, 4, 3, 6, 1, 5, 2, 15, 0, 8, 7, 12, 3, 11, 4, 14, 1, 9, 6, 13, 2, 10, 5]
const COMB_GAINS = [
  [0.3066406250, 0.2170410156, 0.1296386719],
  [0.4638671875, 0.2680664062, 0],
  [0.7998046875, 0.1000976562, 0],
]
const EXP2_TABLE8 = [16384, 17866, 19483, 21247, 23170, 25267, 27554, 30048]
const BIT_INTERLEAVE_TABLE = [0, 1, 1, 1, 2, 3, 3, 3, 2, 3, 3, 3, 2, 3, 3, 3]
const BIT_DEINTERLEAVE_TABLE = [0x00, 0x03, 0x0C, 0x0F, 0x30, 0x33, 0x3C, 0x3F, 0xC0, 0xC3, 0xCC, 0xCF, 0xF0, 0xF3, 0xFC, 0xFF]
const SPREAD_FACTOR = [15, 10, 5]

const f32 = Math.fround

// ---------------------------------------------------------------------------
// Small helpers

function int16(x: number): number {
  return (x << 16) >> 16
}

function fracMul16(a: number, b: number): number {
  return (16384 + int16(a) * int16(b)) >> 15
}

function bitexactCos(x: number): number {
  const tmp = (4096 + x * x) >> 13
  let x2 = tmp
  x2 = (32767 - x2) + fracMul16(x2, -7651 + fracMul16(x2, 8277 + fracMul16(-626, x2)))
  return 1 + x2
}

function bitexactLog2tan(isinIn: number, icosIn: number): number {
  const lc = ilog(icosIn)
  const ls = ilog(isinIn)
  const icos = icosIn << (15 - lc)
  const isin = isinIn << (15 - ls)
  return (ls - lc) * (1 << 11)
    + fracMul16(isin, fracMul16(isin, -2597) + 7932)
    - fracMul16(icos, fracMul16(icos, -2597) + 7932)
}

function isqrt32(value: number): number {
  return Math.floor(Math.sqrt(value))
}

function lcgRand(seed: number): number {
  return (Math.imul(1664525, seed) + 1013904223) >>> 0
}

function sudiv(n: number, d: number): number {
  return Math.trunc(n / d)
}

function pvqU(n: number, k: number): number {
  return PVQ_U_DATA[PVQ_U_ROWS[Math.min(n, k)] + Math.max(n, k)]
}

function pvqRow(row: number, column: number): number {
  return PVQ_U_DATA[PVQ_U_ROWS[row] + column]
}

// ---------------------------------------------------------------------------
// FFT (forward, unscaled, any size that factors into 2, 3, 4 and 5)

interface FftPlan {
  size: number
  factors: number[]
  cos: Float64Array
  sin: Float64Array
}

const fftPlans = new Map<number, FftPlan>()

function fftPlan(size: number): FftPlan {
  let plan = fftPlans.get(size)
  if (plan)
    return plan
  const factors: number[] = []
  let n = size
  for (const p of [4, 2, 3, 5]) {
    while (n % p === 0) {
      factors.push(p)
      n /= p
    }
  }
  const cos = new Float64Array(size)
  const sin = new Float64Array(size)
  for (let i = 0; i < size; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / size)
    sin[i] = Math.sin((-2 * Math.PI * i) / size)
  }
  plan = { size, factors, cos, sin }
  fftPlans.set(size, plan)
  return plan
}

/** In place: re/im become the DFT of re/im (e^-iθ), unscaled. */
function fft(re: Float64Array, im: Float64Array): void {
  const plan = fftPlan(re.length)
  const outRe = new Float64Array(re.length)
  const outIm = new Float64Array(re.length)
  fftRecurse(plan, re, im, 0, 1, outRe, outIm, 0, re.length, 0)
  re.set(outRe)
  im.set(outIm)
}

function fftRecurse(plan: FftPlan, re: Float64Array, im: Float64Array, inOffset: number, stride: number, outRe: Float64Array, outIm: Float64Array, outOffset: number, n: number, level: number): void {
  if (n === 1) {
    outRe[outOffset] = re[inOffset]
    outIm[outOffset] = im[inOffset]
    return
  }
  const p = plan.factors[level]
  const m = n / p
  for (let j = 0; j < p; j++)
    fftRecurse(plan, re, im, inOffset + j * stride, stride * p, outRe, outIm, outOffset + j * m, m, level + 1)
  const twiddleStep = plan.size / n
  const sumRe = new Float64Array(p)
  const sumIm = new Float64Array(p)
  for (let k = 0; k < m; k++) {
    for (let q = 0; q < p; q++) {
      let accRe = 0
      let accIm = 0
      const index = k + q * m
      for (let j = 0; j < p; j++) {
        const t = ((j * index) % n) * twiddleStep
        const c = plan.cos[t]
        const s = plan.sin[t]
        const xr = outRe[outOffset + j * m + k]
        const xi = outIm[outOffset + j * m + k]
        accRe += xr * c - xi * s
        accIm += xr * s + xi * c
      }
      sumRe[q] = accRe
      sumIm[q] = accIm
    }
    for (let q = 0; q < p; q++) {
      outRe[outOffset + k + q * m] = sumRe[q]
      outIm[outOffset + k + q * m] = sumIm[q]
    }
  }
}

// ---------------------------------------------------------------------------
// Inverse MDCT with the low-overlap window

function mdctBackward(input: Float32Array, inOffset: number, out: Float32Array, outOffset: number, shift: number, stride: number): void {
  let n = 1920
  let trig = 0
  for (let i = 0; i < shift; i++) {
    n >>= 1
    trig += n
  }
  const n2 = n >> 1
  const n4 = n >> 2
  const re = new Float64Array(n4)
  const im = new Float64Array(n4)
  let xp1 = inOffset
  let xp2 = inOffset + stride * (n2 - 1)
  for (let i = 0; i < n4; i++) {
    const t0 = MDCT_TWIDDLES[trig + i]
    const t1 = MDCT_TWIDDLES[trig + n4 + i]
    const yr = input[xp2] * t0 + input[xp1] * t1
    const yi = input[xp1] * t0 - input[xp2] * t1
    re[i] = yi
    im[i] = yr
    xp1 += 2 * stride
    xp2 -= 2 * stride
  }
  fft(re, im)
  const base = outOffset + (OVERLAP >> 1)
  for (let k = 0; k < n4; k++) {
    out[base + 2 * k] = re[k]
    out[base + 2 * k + 1] = im[k]
  }
  let yp0 = base
  let yp1 = base + n2 - 2
  for (let i = 0; i < (n4 + 1) >> 1; i++) {
    let re0 = out[yp0 + 1]
    let im0 = out[yp0]
    let t0 = MDCT_TWIDDLES[trig + i]
    let t1 = MDCT_TWIDDLES[trig + n4 + i]
    let yr = re0 * t0 + im0 * t1
    let yi = re0 * t1 - im0 * t0
    re0 = out[yp1 + 1]
    im0 = out[yp1]
    out[yp0] = yr
    out[yp1 + 1] = yi
    t0 = MDCT_TWIDDLES[trig + n4 - i - 1]
    t1 = MDCT_TWIDDLES[trig + n2 - i - 1]
    yr = re0 * t0 + im0 * t1
    yi = re0 * t1 - im0 * t0
    out[yp1] = yr
    out[yp0 + 1] = yi
    yp0 += 2
    yp1 -= 2
  }
  let x1p = outOffset + OVERLAP - 1
  let y1p = outOffset
  for (let i = 0; i < OVERLAP / 2; i++) {
    const w1 = WINDOW[i]
    const w2 = WINDOW[OVERLAP - 1 - i]
    const x1 = out[x1p]
    const x2 = out[y1p]
    out[y1p++] = w2 * x2 - w1 * x1
    out[x1p--] = w1 * x2 + w2 * x1
  }
}

// ---------------------------------------------------------------------------
// Bit allocation

function initCaps(cap: Int32Array, lm: number, channels: number): void {
  for (let i = 0; i < NB_EBANDS; i++) {
    const n = (EBANDS[i + 1] - EBANDS[i]) << lm
    cap[i] = ((CACHE_CAPS[NB_EBANDS * (2 * lm + channels - 1) + i] + 64) * channels * n) >> 2
  }
}

function getPulses(i: number): number {
  return i < 8 ? i : (8 + (i & 7)) << ((i >> 3) - 1)
}

function bits2pulses(band: number, lmIn: number, bitsIn: number): number {
  const lm = lmIn + 1
  const cache = CACHE_INDEX[lm * NB_EBANDS + band]
  let lo = 0
  let hi = CACHE_BITS[cache]
  const bits = bitsIn - 1
  for (let i = 0; i < LOG_MAX_PSEUDO; i++) {
    const mid = (lo + hi + 1) >> 1
    if (CACHE_BITS[cache + mid] >= bits)
      hi = mid
    else
      lo = mid
  }
  if (bits - (lo === 0 ? -1 : CACHE_BITS[cache + lo]) <= CACHE_BITS[cache + hi] - bits)
    return lo
  return hi
}

function pulses2bits(band: number, lmIn: number, pulses: number): number {
  const lm = lmIn + 1
  const cache = CACHE_INDEX[lm * NB_EBANDS + band]
  return pulses === 0 ? 0 : CACHE_BITS[cache + pulses] + 1
}

interface Allocation {
  codedBands: number
  intensity: number
  dualStereo: number
  balance: number
}

function computeAllocation(start: number, end: number, offsets: Int32Array, cap: Int32Array, allocTrim: number, totalIn: number, pulses: Int32Array, ebits: Int32Array, finePriority: Int32Array, channels: number, lm: number, dec: RangeDecoder): Allocation {
  let total = Math.max(totalIn, 0)
  const len = NB_EBANDS
  let skipStart = start
  const skipRsv = total >= 1 << BITRES ? 1 << BITRES : 0
  total -= skipRsv
  let intensityRsv = 0
  let dualStereoRsv = 0
  if (channels === 2) {
    intensityRsv = LOG2_FRAC_TABLE[end - start]
    if (intensityRsv > total) {
      intensityRsv = 0
    }
    else {
      total -= intensityRsv
      dualStereoRsv = total >= 1 << BITRES ? 1 << BITRES : 0
      total -= dualStereoRsv
    }
  }
  const bits1 = new Int32Array(len)
  const bits2 = new Int32Array(len)
  const thresh = new Int32Array(len)
  const trimOffset = new Int32Array(len)
  for (let j = start; j < end; j++) {
    thresh[j] = Math.max(channels << BITRES, (3 * (EBANDS[j + 1] - EBANDS[j]) << lm << BITRES) >> 4)
    trimOffset[j] = (channels * (EBANDS[j + 1] - EBANDS[j]) * (allocTrim - 5 - lm) * (end - j - 1) * (1 << (lm + BITRES))) >> 6
    if ((EBANDS[j + 1] - EBANDS[j]) << lm === 1)
      trimOffset[j] -= channels << BITRES
  }
  let lo = 1
  let hi = NB_ALLOC_VECTORS - 1
  do {
    let done = false
    let psum = 0
    const mid = (lo + hi) >> 1
    for (let j = end; j-- > start;) {
      const n = EBANDS[j + 1] - EBANDS[j]
      let bitsj = (channels * n * BAND_ALLOCATION[mid * len + j] << lm) >> 2
      if (bitsj > 0)
        bitsj = Math.max(0, bitsj + trimOffset[j])
      bitsj += offsets[j]
      if (bitsj >= thresh[j] || done) {
        done = true
        psum += Math.min(bitsj, cap[j])
      }
      else if (bitsj >= channels << BITRES) {
        psum += channels << BITRES
      }
    }
    if (psum > total)
      hi = mid - 1
    else
      lo = mid + 1
  } while (lo <= hi)
  hi = lo--
  for (let j = start; j < end; j++) {
    const n = EBANDS[j + 1] - EBANDS[j]
    let bits1j = (channels * n * BAND_ALLOCATION[lo * len + j] << lm) >> 2
    let bits2j = hi >= NB_ALLOC_VECTORS ? cap[j] : (channels * n * BAND_ALLOCATION[hi * len + j] << lm) >> 2
    if (bits1j > 0)
      bits1j = Math.max(0, bits1j + trimOffset[j])
    if (bits2j > 0)
      bits2j = Math.max(0, bits2j + trimOffset[j])
    if (lo > 0)
      bits1j += offsets[j]
    bits2j += offsets[j]
    if (offsets[j] > 0)
      skipStart = j
    bits2j = Math.max(0, bits2j - bits1j)
    bits1[j] = bits1j
    bits2[j] = bits2j
  }
  return interpBits2Pulses(start, end, skipStart, bits1, bits2, thresh, cap, total, skipRsv, intensityRsv, dualStereoRsv, pulses, ebits, finePriority, channels, lm, dec)
}

function interpBits2Pulses(start: number, end: number, skipStart: number, bits1: Int32Array, bits2: Int32Array, thresh: Int32Array, cap: Int32Array, totalIn: number, skipRsv: number, intensityRsvIn: number, dualStereoRsvIn: number, bits: Int32Array, ebits: Int32Array, finePriority: Int32Array, channels: number, lm: number, dec: RangeDecoder): Allocation {
  let total = totalIn
  let intensityRsv = intensityRsvIn
  let dualStereoRsv = dualStereoRsvIn
  const allocFloor = channels << BITRES
  const stereo = channels > 1 ? 1 : 0
  const logM = lm << BITRES
  let lo = 0
  let hi = 1 << ALLOC_STEPS
  for (let i = 0; i < ALLOC_STEPS; i++) {
    const mid = (lo + hi) >> 1
    let psum = 0
    let done = false
    for (let j = end; j-- > start;) {
      const tmp = bits1[j] + ((mid * bits2[j]) >> ALLOC_STEPS)
      if (tmp >= thresh[j] || done) {
        done = true
        psum += Math.min(tmp, cap[j])
      }
      else if (tmp >= allocFloor) {
        psum += allocFloor
      }
    }
    if (psum > total)
      hi = mid
    else
      lo = mid
  }
  let psum = 0
  let done = false
  for (let j = end; j-- > start;) {
    let tmp = bits1[j] + ((lo * bits2[j]) >> ALLOC_STEPS)
    if (tmp < thresh[j] && !done)
      tmp = tmp >= allocFloor ? allocFloor : 0
    else
      done = true
    tmp = Math.min(tmp, cap[j])
    bits[j] = tmp
    psum += tmp
  }
  let codedBands: number
  for (codedBands = end; ; codedBands--) {
    const j = codedBands - 1
    if (j <= skipStart) {
      total += skipRsv
      break
    }
    let left = total - psum
    const percoeff = Math.floor(left / (EBANDS[codedBands] - EBANDS[start]))
    left -= (EBANDS[codedBands] - EBANDS[start]) * percoeff
    const rem = Math.max(left - (EBANDS[j] - EBANDS[start]), 0)
    const bandWidth = EBANDS[codedBands] - EBANDS[j]
    let bandBits = bits[j] + percoeff * bandWidth + rem
    if (bandBits >= Math.max(thresh[j], allocFloor + (1 << BITRES))) {
      if (dec.bitLogp(1))
        break
      psum += 1 << BITRES
      bandBits -= 1 << BITRES
    }
    psum -= bits[j] + intensityRsv
    if (intensityRsv > 0)
      intensityRsv = LOG2_FRAC_TABLE[j - start]
    psum += intensityRsv
    if (bandBits >= allocFloor) {
      psum += allocFloor
      bits[j] = allocFloor
    }
    else {
      bits[j] = 0
    }
  }
  let intensity = 0
  if (intensityRsv > 0)
    intensity = start + dec.uint(codedBands + 1 - start)
  if (intensity <= start) {
    total += dualStereoRsv
    dualStereoRsv = 0
  }
  const dualStereo = dualStereoRsv > 0 ? dec.bitLogp(1) : 0
  let left = total - psum
  const percoeff = Math.floor(left / (EBANDS[codedBands] - EBANDS[start]))
  left -= (EBANDS[codedBands] - EBANDS[start]) * percoeff
  for (let j = start; j < codedBands; j++)
    bits[j] += percoeff * (EBANDS[j + 1] - EBANDS[j])
  for (let j = start; j < codedBands; j++) {
    const tmp = Math.min(left, EBANDS[j + 1] - EBANDS[j])
    bits[j] += tmp
    left -= tmp
  }
  let balance = 0
  let j: number
  for (j = start; j < codedBands; j++) {
    const n0 = EBANDS[j + 1] - EBANDS[j]
    const n = n0 << lm
    const bit = bits[j] + balance
    let excess: number
    if (n > 1) {
      excess = Math.max(bit - cap[j], 0)
      bits[j] = bit - excess
      const den = channels * n + ((channels === 2 && n > 2 && !dualStereo && j < intensity) ? 1 : 0)
      const nclogn = den * (LOG_N[j] + logM)
      let offset = (nclogn >> 1) - den * FINE_OFFSET
      if (n === 2)
        offset += (den << BITRES) >> 2
      if (bits[j] + offset < (den * 2) << BITRES)
        offset += nclogn >> 2
      else if (bits[j] + offset < (den * 3) << BITRES)
        offset += nclogn >> 3
      ebits[j] = Math.max(0, bits[j] + offset + (den << (BITRES - 1)))
      ebits[j] = Math.floor(ebits[j] / den) >> BITRES
      if (channels * ebits[j] > bits[j] >> BITRES)
        ebits[j] = bits[j] >> stereo >> BITRES
      ebits[j] = Math.min(ebits[j], MAX_FINE_BITS)
      finePriority[j] = ebits[j] * (den << BITRES) >= bits[j] + offset ? 1 : 0
      bits[j] -= (channels * ebits[j]) << BITRES
    }
    else {
      excess = Math.max(0, bit - (channels << BITRES))
      bits[j] = bit - excess
      ebits[j] = 0
      finePriority[j] = 1
    }
    if (excess > 0) {
      const extraFine = Math.min(excess >> (stereo + BITRES), MAX_FINE_BITS - ebits[j])
      ebits[j] += extraFine
      const extraBits = (extraFine * channels) << BITRES
      finePriority[j] = extraBits >= excess - balance ? 1 : 0
      excess -= extraBits
    }
    balance = excess
  }
  for (; j < end; j++) {
    ebits[j] = bits[j] >> stereo >> BITRES
    bits[j] = 0
    finePriority[j] = ebits[j] < 1 ? 1 : 0
  }
  return { codedBands, intensity, dualStereo, balance }
}

// ---------------------------------------------------------------------------
// Energy

function unquantCoarseEnergy(start: number, end: number, oldEBands: Float32Array, intra: number, dec: RangeDecoder, channels: number, lm: number): void {
  const model = (lm * 2 + intra) * 42
  const prev = [0, 0]
  const coef = intra ? 0 : PRED_COEF[lm]
  const beta = intra ? BETA_INTRA : BETA_COEF[lm]
  const budget = dec.storage * 8
  for (let i = start; i < end; i++) {
    for (let c = 0; c < channels; c++) {
      const tell = dec.tell()
      let qi: number
      if (budget - tell >= 15) {
        const pi = 2 * Math.min(i, 20)
        qi = dec.laplace(E_PROB_MODEL[model + pi] << 7, E_PROB_MODEL[model + pi + 1] << 6)
      }
      else if (budget - tell >= 2) {
        qi = dec.icdf(SMALL_ENERGY_ICDF, 2)
        qi = (qi >> 1) ^ -(qi & 1)
      }
      else if (budget - tell >= 1) {
        qi = -dec.bitLogp(1)
      }
      else {
        qi = -1
      }
      const q = qi
      const index = i + c * NB_EBANDS
      oldEBands[index] = Math.max(-9, oldEBands[index])
      const tmp = f32(coef * oldEBands[index]) + prev[c] + q
      oldEBands[index] = tmp
      prev[c] = f32(prev[c] + q - f32(beta * q))
    }
  }
}

function unquantFineEnergy(start: number, end: number, oldEBands: Float32Array, fineQuant: Int32Array, dec: RangeDecoder, channels: number): void {
  for (let i = start; i < end; i++) {
    if (fineQuant[i] <= 0)
      continue
    for (let c = 0; c < channels; c++) {
      const q2 = dec.bits(fineQuant[i])
      const offset = (q2 + 0.5) * (1 << (14 - fineQuant[i])) * (1 / 16384) - 0.5
      oldEBands[i + c * NB_EBANDS] += offset
    }
  }
}

function unquantEnergyFinalise(start: number, end: number, oldEBands: Float32Array, fineQuant: Int32Array, finePriority: Int32Array, bitsLeftIn: number, dec: RangeDecoder, channels: number): void {
  let bitsLeft = bitsLeftIn
  for (let prio = 0; prio < 2; prio++) {
    for (let i = start; i < end && bitsLeft >= channels; i++) {
      if (fineQuant[i] >= MAX_FINE_BITS || finePriority[i] !== prio)
        continue
      for (let c = 0; c < channels; c++) {
        const q2 = dec.bits(1)
        const offset = (q2 - 0.5) * (1 << (14 - fineQuant[i] - 1)) * (1 / 16384)
        oldEBands[i + c * NB_EBANDS] += offset
        bitsLeft--
      }
    }
  }
}

// ---------------------------------------------------------------------------
// PVQ

function decodePulses(y: Int32Array, nIn: number, kIn: number, dec: RangeDecoder): number {
  const v = pvqU(nIn, kIn) + pvqU(nIn, kIn + 1)
  let index = dec.uint(v)
  let n = nIn
  let k = kIn
  let yy = 0
  let pos = 0
  while (n > 2) {
    let p: number
    let s: number
    let k0: number
    let val: number
    if (k >= n) {
      p = pvqRow(n, k + 1)
      s = index >= p ? -1 : 0
      if (s)
        index -= p
      k0 = k
      const q = pvqRow(n, n)
      if (q > index) {
        k = n
        do p = pvqRow(--k, n)
        while (p > index)
      }
      else {
        for (p = pvqRow(n, k); p > index; p = pvqRow(n, k)) k--
      }
      index -= p
      val = (k0 - k + s) ^ s
      y[pos++] = val
      yy += val * val
    }
    else {
      p = pvqRow(k, n)
      const q = pvqRow(k + 1, n)
      if (p <= index && index < q) {
        index -= p
        y[pos++] = 0
      }
      else {
        s = index >= q ? -1 : 0
        if (s)
          index -= q
        k0 = k
        do p = pvqRow(--k, n)
        while (p > index)
        index -= p
        val = (k0 - k + s) ^ s
        y[pos++] = val
        yy += val * val
      }
    }
    n--
  }
  const p = 2 * k + 1
  let s = index >= p ? -1 : 0
  if (s)
    index -= p
  const k0 = k
  k = (index + 1) >> 1
  if (k)
    index -= 2 * k - 1
  let val = (k0 - k + s) ^ s
  y[pos++] = val
  yy += val * val
  s = -index
  val = (k + s) ^ s
  y[pos] = val
  yy += val * val
  return yy
}

function expRotation1(x: Float32Array, offset: number, len: number, stride: number, c: number, s: number): void {
  const ms = -s
  let ptr = offset
  for (let i = 0; i < len - stride; i++) {
    const x1 = x[ptr]
    const x2 = x[ptr + stride]
    x[ptr + stride] = c * x2 + s * x1
    x[ptr++] = c * x1 + ms * x2
  }
  ptr = offset + len - 2 * stride - 1
  for (let i = len - 2 * stride - 1; i >= 0; i--) {
    const x1 = x[ptr]
    const x2 = x[ptr + stride]
    x[ptr + stride] = c * x2 + s * x1
    x[ptr--] = c * x1 + ms * x2
  }
}

function expRotation(x: Float32Array, offset: number, lenIn: number, dir: number, stride: number, k: number, spread: number): void {
  if (2 * k >= lenIn || spread === SPREAD_NONE)
    return
  const factor = SPREAD_FACTOR[spread - 1]
  const gain = f32(lenIn / (lenIn + factor * k))
  const theta = f32(0.5 * f32(gain * gain))
  const c = f32(Math.cos(0.5 * Math.PI * theta))
  const s = f32(Math.cos(0.5 * Math.PI * (1 - theta)))
  let stride2 = 0
  if (lenIn >= 8 * stride) {
    stride2 = 1
    while ((stride2 * stride2 + stride2) * stride + (stride >> 2) < lenIn)
      stride2++
  }
  const len = Math.floor(lenIn / stride)
  for (let i = 0; i < stride; i++) {
    if (dir < 0) {
      if (stride2)
        expRotation1(x, offset + i * len, len, stride2, s, c)
      expRotation1(x, offset + i * len, len, 1, c, s)
    }
    else {
      expRotation1(x, offset + i * len, len, 1, c, -s)
      if (stride2)
        expRotation1(x, offset + i * len, len, stride2, s, -c)
    }
  }
}

function algUnquant(x: Float32Array, offset: number, n: number, k: number, spread: number, b: number, dec: RangeDecoder, gain: number): number {
  const iy = new Int32Array(n)
  const ryy = decodePulses(iy, n, k, dec)
  const g = f32(f32(1 / Math.sqrt(ryy)) * gain)
  for (let i = 0; i < n; i++) x[offset + i] = g * iy[i]
  expRotation(x, offset, n, -1, b, k, spread)
  if (b <= 1)
    return 1
  const n0 = Math.floor(n / b)
  let mask = 0
  for (let i = 0; i < b; i++) {
    let any = 0
    for (let j = 0; j < n0; j++) any |= iy[i * n0 + j]
    if (any)
      mask |= 1 << i
  }
  return mask
}

function renormaliseVector(x: Float32Array, offset: number, n: number, gain: number): void {
  let e = EPSILON
  for (let i = 0; i < n; i++) e += x[offset + i] * x[offset + i]
  const g = f32(f32(1 / Math.sqrt(f32(e))) * gain)
  for (let i = 0; i < n; i++) x[offset + i] = g * x[offset + i]
}

// ---------------------------------------------------------------------------
// Band reconstruction

function haar1(x: Float32Array, offset: number, n0In: number, stride: number): void {
  const n0 = n0In >> 1
  const r = f32(0.70710678)
  for (let i = 0; i < stride; i++) {
    for (let j = 0; j < n0; j++) {
      const a = offset + stride * 2 * j + i
      const b = offset + stride * (2 * j + 1) + i
      const tmp1 = r * x[a]
      const tmp2 = r * x[b]
      x[a] = tmp1 + tmp2
      x[b] = tmp1 - tmp2
    }
  }
}

function deinterleaveHadamard(x: Float32Array, offset: number, n0: number, stride: number, hadamard: boolean): void {
  const n = n0 * stride
  const tmp = new Float32Array(n)
  if (hadamard) {
    const ordery = stride - 2
    for (let i = 0; i < stride; i++) {
      for (let j = 0; j < n0; j++) tmp[ORDERY_TABLE[ordery + i] * n0 + j] = x[offset + j * stride + i]
    }
  }
  else {
    for (let i = 0; i < stride; i++) {
      for (let j = 0; j < n0; j++) tmp[i * n0 + j] = x[offset + j * stride + i]
    }
  }
  x.set(tmp, offset)
}

function interleaveHadamard(x: Float32Array, offset: number, n0: number, stride: number, hadamard: boolean): void {
  const n = n0 * stride
  const tmp = new Float32Array(n)
  if (hadamard) {
    const ordery = stride - 2
    for (let i = 0; i < stride; i++) {
      for (let j = 0; j < n0; j++) tmp[j * stride + i] = x[offset + ORDERY_TABLE[ordery + i] * n0 + j]
    }
  }
  else {
    for (let i = 0; i < stride; i++) {
      for (let j = 0; j < n0; j++) tmp[j * stride + i] = x[offset + i * n0 + j]
    }
  }
  x.set(tmp, offset)
}

function computeQn(n: number, b: number, offset: number, pulseCap: number, stereo: boolean): number {
  let n2 = 2 * n - 1
  if (stereo && n === 2)
    n2--
  let qb = sudiv(b + n2 * offset, n2)
  qb = Math.min(b - pulseCap - (4 << BITRES), qb)
  qb = Math.min(8 << BITRES, qb)
  if (qb < (1 << BITRES >> 1))
    return 1
  let qn = EXP2_TABLE8[qb & 0x7] >> (14 - (qb >> BITRES))
  qn = ((qn + 1) >> 1) << 1
  return qn
}

/** A slice of a buffer: the C code's pointers. */
interface Slice {
  data: Float32Array
  offset: number
}

interface BandContext {
  i: number
  intensity: number
  spread: number
  tfChange: number
  dec: RangeDecoder
  remainingBits: number
  seed: number
  disableInv: boolean
  avoidSplitNoise: boolean
}

interface Split {
  inv: number
  imid: number
  iside: number
  delta: number
  itheta: number
  qalloc: number
}

function computeTheta(ctx: BandContext, n: number, b: { value: number }, bBlocks: number, b0: number, lm: number, stereo: boolean, fill: { value: number }): Split {
  const dec = ctx.dec
  const i = ctx.i
  const pulseCap = LOG_N[i] + lm * (1 << BITRES)
  const offset = (pulseCap >> 1) - (stereo && n === 2 ? QTHETA_OFFSET_TWOPHASE : QTHETA_OFFSET)
  let qn = computeQn(n, b.value, offset, pulseCap, stereo)
  if (stereo && i >= ctx.intensity)
    qn = 1
  const tell = dec.tellFrac()
  let itheta = 0
  let inv = 0
  if (qn !== 1) {
    if (stereo && n > 2) {
      const p0 = 3
      const x0 = qn >> 1
      const ft = p0 * (x0 + 1) + x0
      const fs = dec.decode(ft)
      const x = fs < (x0 + 1) * p0 ? Math.floor(fs / p0) : x0 + 1 + (fs - (x0 + 1) * p0)
      dec.update(x <= x0 ? p0 * x : (x - 1 - x0) + (x0 + 1) * p0, x <= x0 ? p0 * (x + 1) : (x - x0) + (x0 + 1) * p0, ft)
      itheta = x
    }
    else if (b0 > 1 || stereo) {
      itheta = dec.uint(qn + 1)
    }
    else {
      const ft = ((qn >> 1) + 1) * ((qn >> 1) + 1)
      const fm = dec.decode(ft)
      let fs: number
      let fl: number
      if (fm < (((qn >> 1) * ((qn >> 1) + 1)) >> 1)) {
        itheta = (isqrt32(8 * fm + 1) - 1) >> 1
        fs = itheta + 1
        fl = (itheta * (itheta + 1)) >> 1
      }
      else {
        itheta = (2 * (qn + 1) - isqrt32(8 * (ft - fm - 1) + 1)) >> 1
        fs = qn + 1 - itheta
        fl = ft - (((qn + 1 - itheta) * (qn + 2 - itheta)) >> 1)
      }
      dec.update(fl, fl + fs, ft)
    }
    itheta = Math.floor((itheta * 16384) / qn)
  }
  else if (stereo) {
    if (b.value > 2 << BITRES && ctx.remainingBits > 2 << BITRES)
      inv = dec.bitLogp(2)
    if (ctx.disableInv)
      inv = 0
    itheta = 0
  }
  const qalloc = dec.tellFrac() - tell
  b.value -= qalloc
  let imid: number
  let iside: number
  let delta: number
  if (itheta === 0) {
    imid = 32767
    iside = 0
    fill.value &= (1 << bBlocks) - 1
    delta = -16384
  }
  else if (itheta === 16384) {
    imid = 0
    iside = 32767
    fill.value &= ((1 << bBlocks) - 1) << bBlocks
    delta = 16384
  }
  else {
    imid = bitexactCos(itheta)
    iside = bitexactCos(16384 - itheta)
    delta = fracMul16((n - 1) << 7, bitexactLog2tan(iside, imid))
  }
  return { inv, imid, iside, delta, itheta, qalloc }
}

function quantBandN1(ctx: BandContext, x: Slice, y: Slice | null, lowbandOut: Slice | null): number {
  for (const target of y ? [x, y] : [x]) {
    let sign = 0
    if (ctx.remainingBits >= 1 << BITRES) {
      sign = ctx.dec.bits(1)
      ctx.remainingBits -= 1 << BITRES
    }
    target.data[target.offset] = sign ? -1 : 1
  }
  if (lowbandOut)
    lowbandOut.data[lowbandOut.offset] = x.data[x.offset]
  return 1
}

function quantPartition(ctx: BandContext, x: Slice, nIn: number, bIn: number, bBlocksIn: number, lowband: Slice | null, lmIn: number, gain: number, fillIn: number): number {
  let n = nIn
  let lm = lmIn
  let bBlocks = bBlocksIn
  let fill = fillIn
  const b0 = bBlocks
  const i = ctx.i
  const cache = CACHE_INDEX[(lm + 1) * NB_EBANDS + i]
  let cm = 0
  if (lm !== -1 && bIn > CACHE_BITS[cache + CACHE_BITS[cache]] + 12 && n > 2) {
    n >>= 1
    const y: Slice = { data: x.data, offset: x.offset + n }
    lm -= 1
    if (bBlocks === 1)
      fill = (fill & 1) | (fill << 1)
    bBlocks = (bBlocks + 1) >> 1
    const b = { value: bIn }
    const fillRef = { value: fill }
    const split = computeTheta(ctx, n, b, bBlocks, b0, lm, false, fillRef)
    fill = fillRef.value
    let { delta } = split
    const { imid, iside, itheta, qalloc } = split
    const mid = f32((1 / 32768) * imid)
    const side = f32((1 / 32768) * iside)
    if (b0 > 1 && (itheta & 0x3FFF)) {
      if (itheta > 8192)
        delta -= delta >> (4 - lm)
      else
        delta = Math.min(0, delta + ((n << BITRES) >> (5 - lm)))
    }
    let mbits = Math.max(0, Math.min(b.value, sudiv(b.value - delta, 2)))
    let sbits = b.value - mbits
    ctx.remainingBits -= qalloc
    const nextLowband2 = lowband ? { data: lowband.data, offset: lowband.offset + n } : null
    let rebalance = ctx.remainingBits
    if (mbits >= sbits) {
      cm = quantPartition(ctx, x, n, mbits, bBlocks, lowband, lm, f32(gain * mid), fill)
      rebalance = mbits - (rebalance - ctx.remainingBits)
      if (rebalance > 3 << BITRES && itheta !== 0)
        sbits += rebalance - (3 << BITRES)
      cm |= quantPartition(ctx, y, n, sbits, bBlocks, nextLowband2, lm, f32(gain * side), fill >> bBlocks) << (b0 >> 1)
    }
    else {
      cm = quantPartition(ctx, y, n, sbits, bBlocks, nextLowband2, lm, f32(gain * side), fill >> bBlocks) << (b0 >> 1)
      rebalance = sbits - (rebalance - ctx.remainingBits)
      if (rebalance > 3 << BITRES && itheta !== 16384)
        mbits += rebalance - (3 << BITRES)
      cm |= quantPartition(ctx, x, n, mbits, bBlocks, lowband, lm, f32(gain * mid), fill)
    }
    return cm
  }
  let q = bits2pulses(i, lm, bIn)
  let currBits = pulses2bits(i, lm, q)
  ctx.remainingBits -= currBits
  while (ctx.remainingBits < 0 && q > 0) {
    ctx.remainingBits += currBits
    q--
    currBits = pulses2bits(i, lm, q)
    ctx.remainingBits -= currBits
  }
  if (q !== 0)
    return algUnquant(x.data, x.offset, n, getPulses(q), ctx.spread, bBlocks, ctx.dec, gain)
  const cmMask = (1 << bBlocks) - 1
  fill &= cmMask
  if (!fill) {
    x.data.fill(0, x.offset, x.offset + n)
    return 0
  }
  if (!lowband) {
    for (let j = 0; j < n; j++) {
      ctx.seed = lcgRand(ctx.seed)
      x.data[x.offset + j] = (ctx.seed | 0) >> 20
    }
    cm = cmMask
  }
  else {
    for (let j = 0; j < n; j++) {
      ctx.seed = lcgRand(ctx.seed)
      const tmp = ctx.seed & 0x8000 ? 1 / 256 : -1 / 256
      x.data[x.offset + j] = lowband.data[lowband.offset + j] + tmp
    }
    cm = fill
  }
  renormaliseVector(x.data, x.offset, n, gain)
  return cm
}

function quantBand(ctx: BandContext, x: Slice, n: number, b: number, bBlocksIn: number, lowbandIn: Slice | null, lm: number, lowbandOut: Slice | null, gain: number, lowbandScratch: Slice | null, fillIn: number): number {
  const n0 = n
  let nB = n
  let bBlocks = bBlocksIn
  let fill = fillIn
  let lowband = lowbandIn
  const longBlocks = bBlocks === 1
  let timeDivide = 0
  let recombine = 0
  let tfChange = ctx.tfChange
  nB = Math.floor(nB / bBlocks)
  if (n === 1)
    return quantBandN1(ctx, x, null, lowbandOut)
  if (tfChange > 0)
    recombine = tfChange
  if (lowbandScratch && lowband && (recombine || ((nB & 1) === 0 && tfChange < 0) || bBlocks > 1)) {
    lowbandScratch.data.set(lowband.data.subarray(lowband.offset, lowband.offset + n), lowbandScratch.offset)
    lowband = lowbandScratch
  }
  for (let k = 0; k < recombine; k++) {
    if (lowband)
      haar1(lowband.data, lowband.offset, n >> k, 1 << k)
    fill = BIT_INTERLEAVE_TABLE[fill & 0xF] | (BIT_INTERLEAVE_TABLE[fill >> 4] << 2)
  }
  bBlocks >>= recombine
  nB <<= recombine
  while ((nB & 1) === 0 && tfChange < 0) {
    if (lowband)
      haar1(lowband.data, lowband.offset, nB, bBlocks)
    fill |= fill << bBlocks
    bBlocks <<= 1
    nB >>= 1
    timeDivide++
    tfChange++
  }
  const b0 = bBlocks
  const nB0 = nB
  if (b0 > 1 && lowband)
    deinterleaveHadamard(lowband.data, lowband.offset, nB >> recombine, b0 << recombine, longBlocks)
  let cm = quantPartition(ctx, x, n, b, bBlocks, lowband, lm, gain, fill)
  if (b0 > 1)
    interleaveHadamard(x.data, x.offset, nB >> recombine, b0 << recombine, longBlocks)
  nB = nB0
  bBlocks = b0
  for (let k = 0; k < timeDivide; k++) {
    bBlocks >>= 1
    nB <<= 1
    cm |= cm >> bBlocks
    haar1(x.data, x.offset, nB, bBlocks)
  }
  for (let k = 0; k < recombine; k++) {
    cm = BIT_DEINTERLEAVE_TABLE[cm]
    haar1(x.data, x.offset, n0 >> k, 1 << k)
  }
  bBlocks <<= recombine
  if (lowbandOut) {
    const scale = f32(Math.sqrt(n0))
    for (let j = 0; j < n0; j++) lowbandOut.data[lowbandOut.offset + j] = scale * x.data[x.offset + j]
  }
  cm &= (1 << bBlocks) - 1
  return cm
}

function stereoMerge(x: Slice, y: Slice, mid: number, n: number): void {
  let xp = 0
  let side = 0
  for (let j = 0; j < n; j++) {
    xp += y.data[y.offset + j] * x.data[x.offset + j]
    side += y.data[y.offset + j] * y.data[y.offset + j]
  }
  xp = f32(mid * f32(xp))
  const mid2 = mid
  const el = f32(mid2 * mid2) + f32(side) - 2 * xp
  const er = f32(mid2 * mid2) + f32(side) + 2 * xp
  if (er < 6e-4 || el < 6e-4) {
    y.data.set(x.data.subarray(x.offset, x.offset + n), y.offset)
    return
  }
  const lgain = f32(1 / Math.sqrt(el))
  const rgain = f32(1 / Math.sqrt(er))
  for (let j = 0; j < n; j++) {
    const l = mid * x.data[x.offset + j]
    const r = y.data[y.offset + j]
    x.data[x.offset + j] = lgain * (l - r)
    y.data[y.offset + j] = rgain * (l + r)
  }
}

function quantBandStereo(ctx: BandContext, x: Slice, y: Slice, n: number, bIn: number, bBlocks: number, lowband: Slice | null, lm: number, lowbandOut: Slice | null, lowbandScratch: Slice | null, fillIn: number): number {
  if (n === 1)
    return quantBandN1(ctx, x, y, lowbandOut)
  const origFill = fillIn
  const b = { value: bIn }
  const fill = { value: fillIn }
  const { inv, imid, iside, delta, itheta, qalloc } = computeTheta(ctx, n, b, bBlocks, bBlocks, lm, true, fill)
  const mid = f32((1 / 32768) * imid)
  const side = f32((1 / 32768) * iside)
  let cm = 0
  if (n === 2) {
    let mbits = b.value
    let sbits = 0
    if (itheta !== 0 && itheta !== 16384)
      sbits = 1 << BITRES
    mbits -= sbits
    const c = itheta > 8192
    ctx.remainingBits -= qalloc + sbits
    const x2 = c ? y : x
    const y2 = c ? x : y
    let sign = 0
    if (sbits)
      sign = ctx.dec.bits(1)
    sign = 1 - 2 * sign
    cm = quantBand(ctx, x2, n, mbits, bBlocks, lowband, lm, lowbandOut, 1, lowbandScratch, origFill)
    y2.data[y2.offset] = -sign * x2.data[x2.offset + 1]
    y2.data[y2.offset + 1] = sign * x2.data[x2.offset]
    x.data[x.offset] = mid * x.data[x.offset]
    x.data[x.offset + 1] = mid * x.data[x.offset + 1]
    y.data[y.offset] = side * y.data[y.offset]
    y.data[y.offset + 1] = side * y.data[y.offset + 1]
    let tmp = x.data[x.offset]
    x.data[x.offset] = tmp - y.data[y.offset]
    y.data[y.offset] = tmp + y.data[y.offset]
    tmp = x.data[x.offset + 1]
    x.data[x.offset + 1] = tmp - y.data[y.offset + 1]
    y.data[y.offset + 1] = tmp + y.data[y.offset + 1]
  }
  else {
    let mbits = Math.max(0, Math.min(b.value, sudiv(b.value - delta, 2)))
    let sbits = b.value - mbits
    ctx.remainingBits -= qalloc
    let rebalance = ctx.remainingBits
    if (mbits >= sbits) {
      cm = quantBand(ctx, x, n, mbits, bBlocks, lowband, lm, lowbandOut, 1, lowbandScratch, fill.value)
      rebalance = mbits - (rebalance - ctx.remainingBits)
      if (rebalance > 3 << BITRES && itheta !== 0)
        sbits += rebalance - (3 << BITRES)
      cm |= quantBand(ctx, y, n, sbits, bBlocks, null, lm, null, side, null, fill.value >> bBlocks)
    }
    else {
      cm = quantBand(ctx, y, n, sbits, bBlocks, null, lm, null, side, null, fill.value >> bBlocks)
      rebalance = sbits - (rebalance - ctx.remainingBits)
      if (rebalance > 3 << BITRES && itheta !== 16384)
        mbits += rebalance - (3 << BITRES)
      cm |= quantBand(ctx, x, n, mbits, bBlocks, lowband, lm, lowbandOut, 1, lowbandScratch, fill.value)
    }
  }
  if (n !== 2)
    stereoMerge(x, y, mid, n)
  if (inv) {
    for (let j = 0; j < n; j++) y.data[y.offset + j] = -y.data[y.offset + j]
  }
  return cm
}

function quantAllBands(start: number, end: number, xBuffer: Float32Array, yBuffer: Float32Array | null, collapseMasks: Uint8Array, pulses: Int32Array, shortBlocks: number, spread: number, dualStereoIn: number, intensity: number, tfRes: Int32Array, totalBits: number, balanceIn: number, dec: RangeDecoder, lm: number, codedBands: number, seed: number, disableInv: boolean, legacy: boolean): number {
  const m = 1 << lm
  const bBlocks = shortBlocks ? m : 1
  const normOffset = m * EBANDS[start]
  const channels = yBuffer ? 2 : 1
  const normLength = m * EBANDS[NB_EBANDS - 1] - normOffset
  const normBuffer = new Float32Array(channels * normLength)
  const norm: Slice = { data: normBuffer, offset: 0 }
  const norm2: Slice = { data: normBuffer, offset: normLength }
  let lowbandScratch: Slice | null = { data: xBuffer, offset: m * EBANDS[NB_EBANDS - 1] }
  let lowbandOffset = 0
  let updateLowband = true
  let dualStereo = dualStereoIn
  let balance = balanceIn
  const ctx: BandContext = { i: 0, intensity, spread, tfChange: 0, dec, remainingBits: 0, seed, disableInv, avoidSplitNoise: bBlocks > 1 }
  for (let i = start; i < end; i++) {
    ctx.i = i
    const last = i === end - 1
    let x: Slice = { data: xBuffer, offset: m * EBANDS[i] }
    let y: Slice | null = yBuffer ? { data: yBuffer, offset: m * EBANDS[i] } : null
    const n = m * EBANDS[i + 1] - m * EBANDS[i]
    const tell = dec.tellFrac()
    if (i !== start)
      balance -= tell
    const remainingBits = totalBits - tell - 1
    ctx.remainingBits = remainingBits
    let b = 0
    if (i <= codedBands - 1) {
      const currBalance = sudiv(balance, Math.min(3, codedBands - i))
      b = Math.max(0, Math.min(16383, Math.min(remainingBits + 1, pulses[i] + currBalance)))
    }
    if ((m * EBANDS[i] - n >= m * EBANDS[start] || (!legacy && i === start + 1)) && (updateLowband || lowbandOffset === 0))
      lowbandOffset = i
    if (!legacy && i === start + 1)
      specialHybridFolding(normBuffer, normLength, start, m, dualStereo)
    const tfChange = tfRes[i]
    ctx.tfChange = tfChange
    if (i >= NB_EBANDS) {
      x = norm
      if (yBuffer)
        y = norm
      lowbandScratch = null
    }
    if (last)
      lowbandScratch = null
    let effectiveLowband = -1
    let xCm: number
    let yCm: number
    if (lowbandOffset !== 0 && (spread !== SPREAD_AGGRESSIVE || bBlocks > 1 || tfChange < 0)) {
      effectiveLowband = Math.max(0, m * EBANDS[lowbandOffset] - normOffset - n)
      let foldStart = lowbandOffset
      while (m * EBANDS[--foldStart] > effectiveLowband + normOffset);
      let foldEnd = lowbandOffset - 1
      if (legacy)
        while (m * EBANDS[++foldEnd] < effectiveLowband + normOffset + n);
      else
        while (++foldEnd < i && m * EBANDS[foldEnd] < effectiveLowband + normOffset + n);
      xCm = 0
      yCm = 0
      let foldI = foldStart
      do {
        xCm |= collapseMasks[foldI * channels]
        yCm |= collapseMasks[foldI * channels + channels - 1]
      } while (++foldI < foldEnd)
    }
    else {
      xCm = (1 << bBlocks) - 1
      yCm = xCm
    }
    if (dualStereo && i === intensity) {
      dualStereo = 0
      for (let j = 0; j < m * EBANDS[i] - normOffset; j++) normBuffer[j] = 0.5 * (normBuffer[j] + normBuffer[normLength + j])
    }
    const lowbandOutFor = (target: Slice): Slice | null => last ? null : { data: target.data, offset: target.offset + m * EBANDS[i] - normOffset }
    const lowbandFor = (target: Slice): Slice | null => effectiveLowband !== -1 ? { data: target.data, offset: target.offset + effectiveLowband } : null
    if (dualStereo) {
      xCm = quantBand(ctx, x, n, b >> 1, bBlocks, lowbandFor(norm), lm, lowbandOutFor(norm), 1, lowbandScratch, xCm)
      yCm = quantBand(ctx, y!, n, b >> 1, bBlocks, lowbandFor(norm2), lm, lowbandOutFor(norm2), 1, lowbandScratch, yCm)
    }
    else {
      if (y)
        xCm = quantBandStereo(ctx, x, y, n, b, bBlocks, lowbandFor(norm), lm, lowbandOutFor(norm), lowbandScratch, xCm | yCm)
      else
        xCm = quantBand(ctx, x, n, b, bBlocks, lowbandFor(norm), lm, lowbandOutFor(norm), 1, lowbandScratch, xCm | yCm)
      yCm = xCm
    }
    collapseMasks[i * channels] = xCm & 0xFF
    collapseMasks[i * channels + channels - 1] = yCm & 0xFF
    balance += pulses[i] + tell
    updateLowband = b > n << BITRES
    ctx.avoidSplitNoise = false
  }
  return ctx.seed
}

function specialHybridFolding(norm: Float32Array, normLength: number, start: number, m: number, dualStereo: number): void {
  const n1 = m * (EBANDS[start + 1] - EBANDS[start])
  const n2 = m * (EBANDS[start + 2] - EBANDS[start + 1])
  // OPUS_COPY(&norm[n1], &norm[2*n1 - n2], n2 - n1): the source ends where the copy starts.
  norm.copyWithin(n1, 2 * n1 - n2, n1)
  if (dualStereo)
    norm.copyWithin(normLength + n1, normLength + 2 * n1 - n2, normLength + n1)
}

function antiCollapse(x: Float32Array, collapseMasks: Uint8Array, lm: number, channels: number, size: number, start: number, end: number, logE: Float32Array, prev1LogE: Float32Array, prev2LogE: Float32Array, pulses: Int32Array, seedIn: number): void {
  let seed = seedIn
  for (let i = start; i < end; i++) {
    const n0 = EBANDS[i + 1] - EBANDS[i]
    const depth = Math.floor((1 + pulses[i]) / n0) >> lm
    const thresh = f32(0.5 * Math.exp(Math.LN2 * (-0.125 * depth)))
    const sqrt1 = f32(1 / Math.sqrt(n0 << lm))
    for (let c = 0; c < channels; c++) {
      let prev1 = prev1LogE[c * NB_EBANDS + i]
      let prev2 = prev2LogE[c * NB_EBANDS + i]
      if (channels === 1) {
        prev1 = Math.max(prev1, prev1LogE[NB_EBANDS + i])
        prev2 = Math.max(prev2, prev2LogE[NB_EBANDS + i])
      }
      const ediff = Math.max(0, logE[c * NB_EBANDS + i] - Math.min(prev1, prev2))
      let r = f32(2 * Math.exp(Math.LN2 * -ediff))
      if (lm === 3)
        r *= 1.41421356
      r = Math.min(thresh, r)
      r = f32(r * sqrt1)
      const base = c * size + (EBANDS[i] << lm)
      let renormalize = false
      for (let k = 0; k < 1 << lm; k++) {
        if (!(collapseMasks[i * channels + c] & (1 << k))) {
          for (let j = 0; j < n0; j++) {
            seed = lcgRand(seed)
            x[base + (j << lm) + k] = seed & 0x8000 ? r : -r
          }
          renormalize = true
        }
      }
      if (renormalize)
        renormaliseVector(x, base, n0 << lm, 1)
    }
  }
}

function denormaliseBands(x: Float32Array, xOffset: number, freq: Float32Array, bandLogE: Float32Array, logOffset: number, startIn: number, endIn: number, m: number, silence: boolean): void {
  const n = m * SHORT_MDCT_SIZE
  let start = startIn
  let end = endIn
  let bound = m * EBANDS[end]
  if (silence) {
    bound = 0
    start = 0
    end = 0
  }
  let f = 0
  let xi = xOffset + m * EBANDS[start]
  for (let i = 0; i < m * EBANDS[start]; i++) freq[f++] = 0
  for (let i = start; i < end; i++) {
    const bandEnd = m * EBANDS[i + 1]
    const lg = f32(bandLogE[logOffset + i] + E_MEANS[i])
    const g = f32(Math.exp(Math.LN2 * Math.min(32, lg)))
    for (let j = m * EBANDS[i]; j < bandEnd; j++) freq[f++] = x[xi++] * g
  }
  freq.fill(0, bound, n)
}

// ---------------------------------------------------------------------------
// Postfilter

function combFilter(y: Float32Array, yOffset: number, x: Float32Array, xOffset: number, t0In: number, t1In: number, n: number, g0: number, g1: number, tapset0: number, tapset1: number, overlapIn: number): void {
  if (g0 === 0 && g1 === 0) {
    if (x !== y || xOffset !== yOffset)
      y.set(x.subarray(xOffset, xOffset + n), yOffset)
    return
  }
  const t0 = Math.max(t0In, COMBFILTER_MINPERIOD)
  const t1 = Math.max(t1In, COMBFILTER_MINPERIOD)
  const g00 = f32(g0 * COMB_GAINS[tapset0][0])
  const g01 = f32(g0 * COMB_GAINS[tapset0][1])
  const g02 = f32(g0 * COMB_GAINS[tapset0][2])
  const g10 = f32(g1 * COMB_GAINS[tapset1][0])
  const g11 = f32(g1 * COMB_GAINS[tapset1][1])
  const g12 = f32(g1 * COMB_GAINS[tapset1][2])
  let x1 = x[xOffset - t1 + 1]
  let x2 = x[xOffset - t1]
  let x3 = x[xOffset - t1 - 1]
  let x4 = x[xOffset - t1 - 2]
  let overlap = overlapIn
  if (g0 === g1 && t0 === t1 && tapset0 === tapset1)
    overlap = 0
  let i: number
  for (i = 0; i < overlap; i++) {
    const x0 = x[xOffset + i - t1 + 2]
    const f = f32(WINDOW[i] * WINDOW[i])
    const xi = xOffset + i
    y[yOffset + i] = x[xi]
      + f32((1 - f) * g00) * x[xi - t0]
      + f32((1 - f) * g01) * (x[xi - t0 + 1] + x[xi - t0 - 1])
      + f32((1 - f) * g02) * (x[xi - t0 + 2] + x[xi - t0 - 2])
      + f32(f * g10) * x2
      + f32(f * g11) * (x1 + x3)
      + f32(f * g12) * (x0 + x4)
    x4 = x3
    x3 = x2
    x2 = x1
    x1 = x0
  }
  if (g1 === 0) {
    if (x !== y || xOffset !== yOffset)
      y.set(x.subarray(xOffset + overlap, xOffset + n), yOffset + overlap)
    return
  }
  // The constant part: comb_filter_const_c.
  let c4 = x[xOffset + i - t1 - 2]
  let c3 = x[xOffset + i - t1 - 1]
  let c2 = x[xOffset + i - t1]
  let c1 = x[xOffset + i - t1 + 1]
  for (let j = i; j < n; j++) {
    const c0 = x[xOffset + j - t1 + 2]
    y[yOffset + j] = x[xOffset + j] + g10 * c2 + g11 * (c1 + c3) + g12 * (c0 + c4)
    c4 = c3
    c3 = c2
    c2 = c1
    c1 = c0
  }
}

// ---------------------------------------------------------------------------
// The decoder

export class CeltDecoder {
  /** Output channels. */
  readonly channels: number
  /** Coded channels of the current packet. */
  streamChannels: number
  start: number = 0
  end: number = NB_EBANDS
  rng: number = 0
  private readonly disableInv: boolean
  private postfilterPeriod = 0
  private postfilterPeriodOld = 0
  private postfilterGain = 0
  private postfilterGainOld = 0
  private postfilterTapset = 0
  private postfilterTapsetOld = 0
  private readonly preemphMem = new Float64Array(2)
  private readonly decodeMem: Float32Array[]
  private readonly oldBandE = new Float32Array(2 * NB_EBANDS)
  private readonly oldLogE = new Float32Array(2 * NB_EBANDS)
  private readonly oldLogE2 = new Float32Array(2 * NB_EBANDS)
  private readonly backgroundLogE = new Float32Array(2 * NB_EBANDS)
  private lossDuration = 0
  private readonly legacyHybridFolding: boolean

  /**
   * `legacyHybridFolding` decodes hybrid frames the way decoders from before
   * RFC 8251 (libopus before 1.2, and Apple's) do; off, it follows RFC 8251
   * and libopus today. Both are conformant and sound the same.
   */
  constructor(channels: number, options: { legacyHybridFolding?: boolean } = {}) {
    this.channels = channels
    this.streamChannels = channels
    this.legacyHybridFolding = options.legacyHybridFolding ?? false
    this.disableInv = channels === 1 && !this.legacyHybridFolding
    this.decodeMem = Array.from({ length: channels }, () => new Float32Array(DECODE_BUFFER_SIZE + OVERLAP))
    this.reset()
  }

  reset(): void {
    this.rng = 0
    this.postfilterPeriod = 0
    this.postfilterPeriodOld = 0
    this.postfilterGain = 0
    this.postfilterGainOld = 0
    this.postfilterTapset = 0
    this.postfilterTapsetOld = 0
    this.preemphMem.fill(0)
    for (const mem of this.decodeMem) mem.fill(0)
    this.oldBandE.fill(0)
    this.backgroundLogE.fill(0)
    this.oldLogE.fill(-28)
    this.oldLogE2.fill(-28)
    this.lossDuration = 0
  }

  /**
   * One CELT frame of `frameSize` samples (120 to 960 at 48 kHz), written
   * interleaved into `pcm` from `pcmOffset`, in -1 to 1. With `accumulate`
   * the samples are added to what is there (the SILK half of a hybrid frame).
   * `data` null decodes silence where a frame is missing.
   */
  decode(data: Uint8Array | null, length: number, pcm: Float32Array, pcmOffset: number, frameSize: number, rangeDecoder: RangeDecoder | null, accumulate = false): number {
    const cc = this.channels
    const c = this.streamChannels
    const start = this.start
    const end = this.end
    let lm = 0
    while (lm <= MAX_LM && SHORT_MDCT_SIZE << lm !== frameSize) lm++
    if (lm > MAX_LM)
      throw new Error(`CELT frame of ${frameSize} samples`)
    const m = 1 << lm
    const n = m * SHORT_MDCT_SIZE
    const outSyn = DECODE_BUFFER_SIZE - n

    if (!data || length <= 1) {
      // A missing frame: fade what was playing into silence.
      for (const mem of this.decodeMem) {
        mem.copyWithin(0, n, DECODE_BUFFER_SIZE + OVERLAP)
        mem.fill(0, DECODE_BUFFER_SIZE - n, DECODE_BUFFER_SIZE + OVERLAP)
      }
      this.deemphasis(outSyn, pcm, pcmOffset, n, accumulate)
      this.lossDuration = Math.min(10000, this.lossDuration + m)
      return frameSize
    }

    const dec = rangeDecoder ?? new RangeDecoder(data, length)
    if (c === 1) {
      for (let i = 0; i < NB_EBANDS; i++) this.oldBandE[i] = Math.max(this.oldBandE[i], this.oldBandE[NB_EBANDS + i])
    }
    let totalBits = length * 8
    let tell = dec.tell()
    let silence = 0
    if (tell >= totalBits)
      silence = 1
    else if (tell === 1)
      silence = dec.bitLogp(15)
    if (silence) {
      tell = length * 8
      dec.nbitsTotal += tell - dec.tell()
    }
    let postfilterGain = 0
    let postfilterPitch = 0
    let postfilterTapset = 0
    if (start === 0 && tell + 16 <= totalBits) {
      if (dec.bitLogp(1)) {
        const octave = dec.uint(6)
        postfilterPitch = (16 << octave) + dec.bits(4 + octave) - 1
        const qg = dec.bits(3)
        if (dec.tell() + 2 <= totalBits)
          postfilterTapset = dec.icdf(TAPSET_ICDF, 2)
        postfilterGain = f32(0.09375 * (qg + 1))
      }
      tell = dec.tell()
    }
    let isTransient = 0
    if (lm > 0 && tell + 3 <= totalBits) {
      isTransient = dec.bitLogp(3)
      tell = dec.tell()
    }
    const shortBlocks = isTransient ? m : 0
    const intraEner = tell + 3 <= totalBits ? dec.bitLogp(3) : 0
    if (!intraEner && this.lossDuration !== 0) {
      // After a gap, the energies the next frame predicts from are pulled down towards what was last heard.
      const missing = Math.min(10, this.lossDuration >> lm)
      const safety = lm === 0 ? 1.5 : lm === 1 ? 0.5 : 0
      for (let ch = 0; ch < 2; ch++) {
        for (let i = start; i < end; i++) {
          const index = ch * NB_EBANDS + i
          if (this.oldBandE[index] < Math.max(this.oldLogE[index], this.oldLogE2[index])) {
            let e0 = this.oldBandE[index]
            const slope = Math.max(this.oldLogE[index] - e0, 0.5 * (this.oldLogE2[index] - e0))
            e0 -= Math.max(0, (1 + missing) * slope)
            this.oldBandE[index] = Math.max(-20, e0)
          }
          else {
            this.oldBandE[index] = Math.min(this.oldBandE[index], this.oldLogE[index], this.oldLogE2[index])
          }
          this.oldBandE[index] -= safety
        }
      }
    }

    unquantCoarseEnergy(start, end, this.oldBandE, intraEner, dec, c, lm)

    const tfRes = new Int32Array(NB_EBANDS)
    this.tfDecode(start, end, isTransient, tfRes, lm, dec)

    tell = dec.tell()
    let spreadDecision = SPREAD_NORMAL
    if (tell + 4 <= totalBits)
      spreadDecision = dec.icdf(SPREAD_ICDF, 5)

    const cap = new Int32Array(NB_EBANDS)
    initCaps(cap, lm, c)
    const offsets = new Int32Array(NB_EBANDS)
    let dynallocLogp = 6
    totalBits <<= BITRES
    tell = dec.tellFrac()
    for (let i = start; i < end; i++) {
      const width = (c * (EBANDS[i + 1] - EBANDS[i])) << lm
      const quanta = Math.min(width << BITRES, Math.max(6 << BITRES, width))
      let loopLogp = dynallocLogp
      let boost = 0
      while (tell + (loopLogp << BITRES) < totalBits && boost < cap[i]) {
        const flag = dec.bitLogp(loopLogp)
        tell = dec.tellFrac()
        if (!flag)
          break
        boost += quanta
        totalBits -= quanta
        loopLogp = 1
      }
      offsets[i] = boost
      if (boost > 0)
        dynallocLogp = Math.max(2, dynallocLogp - 1)
    }

    const fineQuant = new Int32Array(NB_EBANDS)
    const allocTrim = tell + (6 << BITRES) <= totalBits ? dec.icdf(TRIM_ICDF, 7) : 5
    let bits = ((length * 8) << BITRES) - dec.tellFrac() - 1
    const antiCollapseRsv = isTransient && lm >= 2 && bits >= (lm + 2) << BITRES ? 1 << BITRES : 0
    bits -= antiCollapseRsv
    const pulses = new Int32Array(NB_EBANDS)
    const finePriority = new Int32Array(NB_EBANDS)
    const allocation = computeAllocation(start, end, offsets, cap, allocTrim, bits, pulses, fineQuant, finePriority, c, lm, dec)

    unquantFineEnergy(start, end, this.oldBandE, fineQuant, dec, c)

    for (const mem of this.decodeMem) mem.copyWithin(0, n, DECODE_BUFFER_SIZE + OVERLAP)

    const collapseMasks = new Uint8Array(c * NB_EBANDS)
    const x = new Float32Array(c * n)
    this.rng = quantAllBands(start, end, x, c === 2 ? x.subarray(n) : null, collapseMasks, pulses, shortBlocks, spreadDecision, allocation.dualStereo, allocation.intensity, tfRes, length * (8 << BITRES) - antiCollapseRsv, allocation.balance, dec, lm, allocation.codedBands, this.rng, this.disableInv, this.legacyHybridFolding)

    let antiCollapseOn = 0
    if (antiCollapseRsv > 0)
      antiCollapseOn = dec.bits(1)
    unquantEnergyFinalise(start, end, this.oldBandE, fineQuant, finePriority, length * 8 - dec.tell(), dec, c)
    if (antiCollapseOn)
      antiCollapse(x, collapseMasks, lm, c, n, start, end, this.oldBandE, this.oldLogE, this.oldLogE2, pulses, this.rng)
    if (silence)
      this.oldBandE.fill(-28, 0, c * NB_EBANDS)

    this.synthesis(x, outSyn, start, Math.min(end, NB_EBANDS), c, cc, isTransient, lm, silence === 1)

    for (let ch = 0; ch < cc; ch++) {
      this.postfilterPeriod = Math.max(this.postfilterPeriod, COMBFILTER_MINPERIOD)
      this.postfilterPeriodOld = Math.max(this.postfilterPeriodOld, COMBFILTER_MINPERIOD)
      const mem = this.decodeMem[ch]
      combFilter(mem, outSyn, mem, outSyn, this.postfilterPeriodOld, this.postfilterPeriod, SHORT_MDCT_SIZE, this.postfilterGainOld, this.postfilterGain, this.postfilterTapsetOld, this.postfilterTapset, OVERLAP)
      if (lm !== 0)
        combFilter(mem, outSyn + SHORT_MDCT_SIZE, mem, outSyn + SHORT_MDCT_SIZE, this.postfilterPeriod, postfilterPitch, n - SHORT_MDCT_SIZE, this.postfilterGain, postfilterGain, this.postfilterTapset, postfilterTapset, OVERLAP)
    }
    this.postfilterPeriodOld = this.postfilterPeriod
    this.postfilterGainOld = this.postfilterGain
    this.postfilterTapsetOld = this.postfilterTapset
    this.postfilterPeriod = postfilterPitch
    this.postfilterGain = postfilterGain
    this.postfilterTapset = postfilterTapset
    if (lm !== 0) {
      this.postfilterPeriodOld = this.postfilterPeriod
      this.postfilterGainOld = this.postfilterGain
      this.postfilterTapsetOld = this.postfilterTapset
    }

    if (c === 1)
      this.oldBandE.copyWithin(NB_EBANDS, 0, NB_EBANDS)
    if (!isTransient) {
      this.oldLogE2.set(this.oldLogE)
      this.oldLogE.set(this.oldBandE)
    }
    else {
      for (let i = 0; i < 2 * NB_EBANDS; i++) this.oldLogE[i] = Math.min(this.oldLogE[i], this.oldBandE[i])
    }
    const maxBackgroundIncrease = Math.min(160, this.lossDuration + m) * 0.001
    for (let i = 0; i < 2 * NB_EBANDS; i++) this.backgroundLogE[i] = Math.min(this.backgroundLogE[i] + maxBackgroundIncrease, this.oldBandE[i])
    for (let ch = 0; ch < 2; ch++) {
      for (let i = 0; i < start; i++) {
        this.oldBandE[ch * NB_EBANDS + i] = 0
        this.oldLogE[ch * NB_EBANDS + i] = -28
        this.oldLogE2[ch * NB_EBANDS + i] = -28
      }
      for (let i = end; i < NB_EBANDS; i++) {
        this.oldBandE[ch * NB_EBANDS + i] = 0
        this.oldLogE[ch * NB_EBANDS + i] = -28
        this.oldLogE2[ch * NB_EBANDS + i] = -28
      }
    }
    this.rng = dec.rng
    this.deemphasis(outSyn, pcm, pcmOffset, n, accumulate)
    this.lossDuration = 0
    return frameSize
  }

  private tfDecode(start: number, end: number, isTransient: number, tfRes: Int32Array, lm: number, dec: RangeDecoder): void {
    let budget = dec.storage * 8
    let tell = dec.tell()
    let logp = isTransient ? 2 : 4
    const tfSelectRsv = lm > 0 && tell + logp + 1 <= budget ? 1 : 0
    budget -= tfSelectRsv
    let tfChanged = 0
    let curr = 0
    for (let i = start; i < end; i++) {
      if (tell + logp <= budget) {
        curr ^= dec.bitLogp(logp)
        tell = dec.tell()
        tfChanged |= curr
      }
      tfRes[i] = curr
      logp = isTransient ? 4 : 5
    }
    let tfSelect = 0
    if (tfSelectRsv && TF_SELECT_TABLE[lm][4 * isTransient + tfChanged] !== TF_SELECT_TABLE[lm][4 * isTransient + 2 + tfChanged])
      tfSelect = dec.bitLogp(1)
    for (let i = start; i < end; i++) tfRes[i] = TF_SELECT_TABLE[lm][4 * isTransient + 2 * tfSelect + tfRes[i]]
  }

  private synthesis(x: Float32Array, outSyn: number, start: number, effEnd: number, c: number, cc: number, isTransient: number, lm: number, silence: boolean): void {
    const m = 1 << lm
    const n = m * SHORT_MDCT_SIZE
    const freq = new Float32Array(n)
    const blocks = isTransient ? m : 1
    const nb = isTransient ? SHORT_MDCT_SIZE : SHORT_MDCT_SIZE << lm
    const shift = isTransient ? MAX_LM : MAX_LM - lm
    if (cc === 2 && c === 1) {
      denormaliseBands(x, 0, freq, this.oldBandE, 0, start, effEnd, m, silence)
      const freq2 = this.decodeMem[1]
      const freq2Offset = outSyn + OVERLAP / 2
      freq2.set(freq, freq2Offset)
      for (let b = 0; b < blocks; b++) mdctBackward(freq2, freq2Offset + b, this.decodeMem[0], outSyn + nb * b, shift, blocks)
      for (let b = 0; b < blocks; b++) mdctBackward(freq, b, this.decodeMem[1], outSyn + nb * b, shift, blocks)
    }
    else if (cc === 1 && c === 2) {
      const freq2 = new Float32Array(n)
      denormaliseBands(x, 0, freq, this.oldBandE, 0, start, effEnd, m, silence)
      denormaliseBands(x, n, freq2, this.oldBandE, NB_EBANDS, start, effEnd, m, silence)
      for (let i = 0; i < n; i++) freq[i] = 0.5 * freq[i] + 0.5 * freq2[i]
      for (let b = 0; b < blocks; b++) mdctBackward(freq, b, this.decodeMem[0], outSyn + nb * b, shift, blocks)
    }
    else {
      for (let ch = 0; ch < cc; ch++) {
        denormaliseBands(x, ch * n, freq, this.oldBandE, ch * NB_EBANDS, start, effEnd, m, silence)
        for (let b = 0; b < blocks; b++) mdctBackward(freq, b, this.decodeMem[ch], outSyn + nb * b, shift, blocks)
      }
    }
  }

  private deemphasis(outSyn: number, pcm: Float32Array, pcmOffset: number, n: number, accumulate: boolean): void {
    const cc = this.channels
    for (let ch = 0; ch < cc; ch++) {
      const x = this.decodeMem[ch]
      let m = this.preemphMem[ch]
      for (let j = 0; j < n; j++) {
        const tmp = f32(x[outSyn + j] + VERY_SMALL + m)
        m = f32(PREEMPH * tmp)
        const out = tmp * (1 / 32768)
        const index = pcmOffset + j * cc + ch
        pcm[index] = accumulate ? pcm[index] + out : out
      }
      this.preemphMem[ch] = m
    }
  }
}
