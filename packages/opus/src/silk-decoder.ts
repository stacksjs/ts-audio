/**
 * The SILK layer of Opus (RFC 6716 section 4.2): the speech codec, at 8, 12
 * or 16 kHz inside, resampled to 48 kHz. Fixed point and bit exact, as the
 * reference decoder is.
 *
 * Ported from libopus 1.5.2 (silk/dec_API.c, decode_frame.c,
 * decode_indices.c, decode_pulses.c, shell_coder.c, code_signs.c,
 * decode_parameters.c, gain_quant.c, NLSF_decode.c, NLSF_unpack.c,
 * NLSF_stabilize.c, NLSF2A.c, LPC_fit.c, LPC_inv_pred_gain.c, bwexpander*.c,
 * decode_pitch.c, decode_core.c, LPC_analysis_filter.c, stereo_*.c,
 * resampler*.c, log2lin.c, Inlines.h), BSD 3-clause licence, in
 * THIRD_PARTY_NOTICES.md. Packet loss concealment is reduced to silence:
 * whole files have no lost packets, and Opus only uses it for 2.5 ms
 * crossfades between modes.
 */

import type { RangeDecoder } from './range-decoder'
import type { NlsfCodebook } from './silk-tables'
import {
  CB_LAGS_STAGE2,
  CB_LAGS_STAGE2_10_MS,
  CB_LAGS_STAGE3,
  CB_LAGS_STAGE3_10_MS,
  DELTA_GAIN_ICDF,
  GAIN_ICDF,
  LBRR_FLAGS_2_ICDF,
  LBRR_FLAGS_3_ICDF,
  LSB_ICDF,
  LSFCOSTAB_FIX_Q12,
  LTP_GAIN_ICDF_0,
  LTP_GAIN_ICDF_1,
  LTP_GAIN_ICDF_2,
  LTP_GAIN_VQ_0,
  LTP_GAIN_VQ_1,
  LTP_GAIN_VQ_2,
  LTP_PER_INDEX_ICDF,
  LTPSCALE_ICDF,
  LTPSCALES_TABLE_Q14,
  NLSF_CB_NB_MB,
  NLSF_CB_WB,
  NLSF_EXT_ICDF,
  NLSF_INTERPOLATION_FACTOR_ICDF,
  PITCH_CONTOUR_10_MS_ICDF,
  PITCH_CONTOUR_10_MS_NB_ICDF,
  PITCH_CONTOUR_ICDF,
  PITCH_CONTOUR_NB_ICDF,
  PITCH_DELTA_ICDF,
  PITCH_LAG_ICDF,
  PULSES_PER_BLOCK_ICDF,
  QUANTIZATION_OFFSETS_Q10,
  RATE_LEVELS_ICDF,
  RESAMPLER_FRAC_FIR_12,
  RESAMPLER_UP2_HQ_0,
  RESAMPLER_UP2_HQ_1,
  SHELL_CODE_TABLE_OFFSETS,
  SHELL_CODE_TABLE0,
  SHELL_CODE_TABLE1,
  SHELL_CODE_TABLE2,
  SHELL_CODE_TABLE3,
  SIGN_ICDF,
  STEREO_ONLY_CODE_MID_ICDF,
  STEREO_PRED_JOINT_ICDF,
  STEREO_PRED_QUANT_Q13,
  TYPE_OFFSET_NO_VAD_ICDF,
  TYPE_OFFSET_VAD_ICDF,
  UNIFORM3_ICDF,
  UNIFORM4_ICDF,
  UNIFORM5_ICDF,
  UNIFORM6_ICDF,
  UNIFORM8_ICDF,
} from './silk-tables'

const MAX_NB_SUBFR = 4
const MAX_LPC_ORDER = 16
const MIN_LPC_ORDER = 10
const LTP_ORDER = 5
const MAX_FRAME_LENGTH = 320
const MAX_SUB_FRAME_LENGTH = 80
const SHELL_CODEC_FRAME_LENGTH = 16
const LOG2_SHELL_CODEC_FRAME_LENGTH = 4
const SILK_MAX_PULSES = 16
const N_RATE_LEVELS = 10
const NLSF_QUANT_MAX_AMPLITUDE = 4
const N_LEVELS_QGAIN = 64
const MAX_DELTA_GAIN_QUANT = 36
const MIN_DELTA_GAIN_QUANT = -4
const QUANT_LEVEL_ADJUST_Q10 = 80
const MAX_LPC_STABILIZE_ITERATIONS = 16
const STEREO_INTERP_LEN_MS = 8
const BWE_AFTER_LOSS_Q16 = 63570
const TYPE_NO_VOICE_ACTIVITY = 0
const TYPE_VOICED = 2
const CODE_INDEPENDENTLY = 0
const CODE_INDEPENDENTLY_NO_LTP_SCALING = 1
const CODE_CONDITIONALLY = 2
const FLAG_DECODE_NORMAL = 0
const FLAG_PACKET_LOST = 1
const INT32_MAX = 2147483647
const INT32_MIN = -2147483648
const OFFSET_GAIN = Math.trunc((2 * 128) / 6) + 16 * 128
const INV_SCALE_Q16 = Math.trunc((65536 * Math.trunc(((88 - 2) * 128) / 6)) / (N_LEVELS_QGAIN - 1))

// ---------------------------------------------------------------------------
// Fixed point

function i16(x: number): number {
  return (x << 16) >> 16
}
function smulbb(a: number, b: number): number {
  return i16(a) * i16(b)
}
function smlabb(a: number, b: number, c: number): number {
  return (a + i16(b) * i16(c)) | 0
}
function smulwb(a: number, b: number): number {
  return Math.floor((a * i16(b)) / 65536)
}
function smlawb(a: number, b: number, c: number): number {
  return (a + smulwb(b, c)) | 0
}
function rshiftRound(a: number, shift: number): number {
  return shift === 1 ? (a >> 1) + (a & 1) : ((a >> (shift - 1)) + 1) >> 1
}
function smulww(a: number, b: number): number {
  return (smulwb(a, b) + Math.imul(a, rshiftRound(b, 16))) | 0
}
function smlaww(a: number, b: number, c: number): number {
  return (a + smulww(b, c)) | 0
}
function sat16(x: number): number {
  return x > 32767 ? 32767 : x < -32768 ? -32768 : x
}
function addSat32(a: number, b: number): number {
  const sum = a + b
  return sum > INT32_MAX ? INT32_MAX : sum < INT32_MIN ? INT32_MIN : sum
}
function subSat32(a: number, b: number): number {
  const diff = a - b
  return diff > INT32_MAX ? INT32_MAX : diff < INT32_MIN ? INT32_MIN : diff
}
function limit(a: number, limit1: number, limit2: number): number {
  return limit1 > limit2 ? (a > limit1 ? limit1 : a < limit2 ? limit2 : a) : (a > limit2 ? limit2 : a < limit1 ? limit1 : a)
}
function lshiftSat32(a: number, shift: number): number {
  return limit(a, INT32_MIN >> shift, INT32_MAX >> shift) << shift
}
function smmul(a: number, b: number): number {
  return Number((BigInt(a) * BigInt(b)) >> 32n)
}
function rshiftRound64(a: bigint, shift: number): bigint {
  return shift === 1 ? (a >> 1n) + (a & 1n) : ((a >> BigInt(shift - 1)) + 1n) >> 1n
}
function clz32(x: number): number {
  return Math.clz32(x)
}
function silkRand(seed: number): number {
  return (907633515 + Math.imul(seed, 196314165)) | 0
}

function inverse32VarQ(b32: number, qres: number): number {
  const bHeadrm = clz32(Math.abs(b32)) - 1
  const b32Nrm = b32 << bHeadrm
  const b32Inv = Math.trunc((INT32_MAX >> 2) / (b32Nrm >> 16))
  let result = b32Inv << 16
  const errQ32 = ((1 << 29) - smulwb(b32Nrm, b32Inv)) << 3
  result = smlaww(result, errQ32, b32Inv)
  const lshift = 61 - bHeadrm - qres
  if (lshift <= 0)
    return lshiftSat32(result, -lshift)
  return lshift < 32 ? result >> lshift : 0
}

function div32VarQ(a32: number, b32: number, qres: number): number {
  const aHeadrm = clz32(Math.abs(a32)) - 1
  let a32Nrm = a32 << aHeadrm
  const bHeadrm = clz32(Math.abs(b32)) - 1
  const b32Nrm = b32 << bHeadrm
  const b32Inv = Math.trunc((INT32_MAX >> 2) / (b32Nrm >> 16))
  let result = smulwb(a32Nrm, b32Inv)
  a32Nrm = (a32Nrm - (smmul(b32Nrm, result) << 3)) | 0
  result = smlawb(result, a32Nrm, b32Inv)
  const lshift = 29 + aHeadrm - bHeadrm - qres
  if (lshift < 0)
    return lshiftSat32(result, -lshift)
  return lshift < 32 ? result >> lshift : 0
}

function log2lin(inLogQ7: number): number {
  if (inLogQ7 < 0)
    return 0
  if (inLogQ7 >= 3967)
    return INT32_MAX
  let out = 1 << (inLogQ7 >> 7)
  const fracQ7 = inLogQ7 & 0x7F
  if (inLogQ7 < 2048)
    out = (out + ((Math.imul(out, smlawb(fracQ7, smulbb(fracQ7, 128 - fracQ7), -174))) >> 7)) | 0
  else
    out = (out + Math.imul(out >> 7, smlawb(fracQ7, smulbb(fracQ7, 128 - fracQ7), -174))) | 0
  return out
}

// ---------------------------------------------------------------------------
// LPC

function bwexpander(ar: Int16Array, d: number, chirpIn: number): void {
  let chirp = chirpIn
  const chirpMinusOne = chirp - 65536
  for (let i = 0; i < d - 1; i++) {
    ar[i] = rshiftRound(Math.imul(chirp, ar[i]), 16)
    chirp += rshiftRound(Math.imul(chirp, chirpMinusOne), 16)
  }
  ar[d - 1] = rshiftRound(Math.imul(chirp, ar[d - 1]), 16)
}

function bwexpander32(ar: Int32Array, d: number, chirpIn: number): void {
  let chirp = chirpIn
  const chirpMinusOne = chirp - 65536
  for (let i = 0; i < d - 1; i++) {
    ar[i] = smulww(chirp, ar[i])
    chirp += rshiftRound(Math.imul(chirp, chirpMinusOne), 16)
  }
  ar[d - 1] = smulww(chirp, ar[d - 1])
}

const A_LIMIT = Math.trunc(0.99975 * (1 << 24) + 0.5)
const INV_GAIN_MIN_Q30 = Math.trunc((1 / 1e4) * (1 << 30) + 0.5)

function lpcInversePredGainQA(aQA: Int32Array, order: number): number {
  let invGainQ30 = 1 << 30
  for (let k = order - 1; k > 0; k--) {
    if (aQA[k] > A_LIMIT || aQA[k] < -A_LIMIT)
      return 0
    const rcQ31 = -(aQA[k] << 7)
    const rcMult1Q30 = (1 << 30) - smmul(rcQ31, rcQ31)
    invGainQ30 = smmul(invGainQ30, rcMult1Q30) << 2
    if (invGainQ30 < INV_GAIN_MIN_Q30)
      return 0
    const mult2Q = 32 - clz32(Math.abs(rcMult1Q30))
    const rcMult2 = inverse32VarQ(rcMult1Q30, mult2Q + 30)
    for (let n = 0; n < (k + 1) >> 1; n++) {
      const tmp1 = aQA[n]
      const tmp2 = aQA[k - n - 1]
      let tmp64 = rshiftRound64(BigInt(subSat32(tmp1, Number(rshiftRound64(BigInt(tmp2) * BigInt(rcQ31), 31)))) * BigInt(rcMult2), mult2Q)
      if (tmp64 > 2147483647n || tmp64 < -2147483648n)
        return 0
      aQA[n] = Number(tmp64)
      tmp64 = rshiftRound64(BigInt(subSat32(tmp2, Number(rshiftRound64(BigInt(tmp1) * BigInt(rcQ31), 31)))) * BigInt(rcMult2), mult2Q)
      if (tmp64 > 2147483647n || tmp64 < -2147483648n)
        return 0
      aQA[k - n - 1] = Number(tmp64)
    }
  }
  if (aQA[0] > A_LIMIT || aQA[0] < -A_LIMIT)
    return 0
  const rcQ31 = -(aQA[0] << 7)
  const rcMult1Q30 = (1 << 30) - smmul(rcQ31, rcQ31)
  invGainQ30 = smmul(invGainQ30, rcMult1Q30) << 2
  if (invGainQ30 < INV_GAIN_MIN_Q30)
    return 0
  return invGainQ30
}

function lpcInversePredGain(aQ12: Int16Array, order: number): number {
  const aQA = new Int32Array(order)
  let dcResp = 0
  for (let k = 0; k < order; k++) {
    dcResp += aQ12[k]
    aQA[k] = aQ12[k] << 12
  }
  if (dcResp >= 4096)
    return 0
  return lpcInversePredGainQA(aQA, order)
}

function lpcFit(aOut: Int16Array, aIn: Int32Array, qout: number, qin: number, d: number): void {
  let idx = 0
  let i: number
  for (i = 0; i < 10; i++) {
    let maxabs = 0
    for (let k = 0; k < d; k++) {
      const absval = Math.abs(aIn[k])
      if (absval > maxabs) {
        maxabs = absval
        idx = k
      }
    }
    maxabs = rshiftRound(maxabs, qin - qout)
    if (maxabs > 32767) {
      maxabs = Math.min(maxabs, 163838)
      const chirpQ16 = Math.trunc(0.999 * 65536 + 0.5) - Math.trunc(((maxabs - 32767) << 14) / (Math.imul(maxabs, idx + 1) >> 2))
      bwexpander32(aIn, d, chirpQ16)
    }
    else {
      break
    }
  }
  if (i === 10) {
    for (let k = 0; k < d; k++) {
      aOut[k] = sat16(rshiftRound(aIn[k], qin - qout))
      aIn[k] = aOut[k] << (qin - qout)
    }
  }
  else {
    for (let k = 0; k < d; k++) aOut[k] = rshiftRound(aIn[k], qin - qout)
  }
}

const ORDERING16 = [0, 15, 8, 7, 4, 11, 12, 3, 2, 13, 10, 5, 6, 9, 14, 1]
const ORDERING10 = [0, 9, 6, 3, 4, 5, 8, 1, 2, 7]
const QA = 16

function nlsf2aFindPoly(out: Int32Array, cLSF: Int32Array, offset: number, dd: number): void {
  out[0] = 1 << QA
  out[1] = -cLSF[offset]
  for (let k = 1; k < dd; k++) {
    const ftmp = cLSF[offset + 2 * k]
    out[k + 1] = ((out[k - 1] << 1) - Number(rshiftRound64(BigInt(ftmp) * BigInt(out[k]), QA))) | 0
    for (let n = k; n > 1; n--) out[n] = (out[n] + out[n - 2] - Number(rshiftRound64(BigInt(ftmp) * BigInt(out[n - 1]), QA))) | 0
    out[1] = (out[1] - ftmp) | 0
  }
}

function nlsf2a(aQ12: Int16Array, nlsf: Int16Array, d: number): void {
  const ordering = d === 16 ? ORDERING16 : ORDERING10
  const cosLSF = new Int32Array(d)
  for (let k = 0; k < d; k++) {
    const fInt = nlsf[k] >> 8
    const fFrac = nlsf[k] - (fInt << 8)
    const cosVal = LSFCOSTAB_FIX_Q12[fInt]
    const delta = LSFCOSTAB_FIX_Q12[fInt + 1] - cosVal
    cosLSF[ordering[k]] = rshiftRound((cosVal << 8) + delta * fFrac, 20 - QA)
  }
  const dd = d >> 1
  const p = new Int32Array(dd + 1)
  const q = new Int32Array(dd + 1)
  nlsf2aFindPoly(p, cosLSF, 0, dd)
  nlsf2aFindPoly(q, cosLSF, 1, dd)
  const a32 = new Int32Array(d)
  for (let k = 0; k < dd; k++) {
    const ptmp = p[k + 1] + p[k]
    const qtmp = q[k + 1] - q[k]
    a32[k] = -qtmp - ptmp
    a32[d - k - 1] = qtmp - ptmp
  }
  lpcFit(aQ12, a32, 12, QA + 1, d)
  for (let i = 0; lpcInversePredGain(aQ12, d) === 0 && i < MAX_LPC_STABILIZE_ITERATIONS; i++) {
    bwexpander32(a32, d, 65536 - (2 << i))
    for (let k = 0; k < d; k++) aQ12[k] = rshiftRound(a32[k], QA + 1 - 12)
  }
}

function nlsfUnpack(ecIx: Int16Array, predQ8: Uint8Array, cb: NlsfCodebook, cb1Index: number): void {
  let sel = (cb1Index * cb.order) / 2
  for (let i = 0; i < cb.order; i += 2) {
    const entry = cb.ecSel[sel++]
    ecIx[i] = smulbb((entry >> 1) & 7, 2 * NLSF_QUANT_MAX_AMPLITUDE + 1)
    predQ8[i] = cb.predQ8[i + (entry & 1) * (cb.order - 1)]
    ecIx[i + 1] = smulbb((entry >> 5) & 7, 2 * NLSF_QUANT_MAX_AMPLITUDE + 1)
    predQ8[i + 1] = cb.predQ8[i + ((entry >> 4) & 1) * (cb.order - 1) + 1]
  }
}

function nlsfStabilize(nlsf: Int16Array, deltaMin: Int16Array, l: number): void {
  let loops: number
  for (loops = 0; loops < 20; loops++) {
    let minDiff = nlsf[0] - deltaMin[0]
    let index = 0
    for (let i = 1; i <= l - 1; i++) {
      const diff = nlsf[i] - (nlsf[i - 1] + deltaMin[i])
      if (diff < minDiff) {
        minDiff = diff
        index = i
      }
    }
    const diff = (1 << 15) - (nlsf[l - 1] + deltaMin[l])
    if (diff < minDiff) {
      minDiff = diff
      index = l
    }
    if (minDiff >= 0)
      return
    if (index === 0) {
      nlsf[0] = deltaMin[0]
    }
    else if (index === l) {
      nlsf[l - 1] = (1 << 15) - deltaMin[l]
    }
    else {
      let minCenter = 0
      for (let k = 0; k < index; k++) minCenter += deltaMin[k]
      minCenter += deltaMin[index] >> 1
      let maxCenter = 1 << 15
      for (let k = l; k > index; k--) maxCenter -= deltaMin[k]
      maxCenter -= deltaMin[index] >> 1
      const center = limit(rshiftRound(nlsf[index - 1] + nlsf[index], 1), minCenter, maxCenter)
      nlsf[index - 1] = center - (deltaMin[index] >> 1)
      nlsf[index] = nlsf[index - 1] + deltaMin[index]
    }
  }
  if (loops === 20) {
    const sorted = Array.from(nlsf.subarray(0, l)).sort((a, b) => a - b)
    for (let i = 0; i < l; i++) nlsf[i] = sorted[i]
    nlsf[0] = Math.max(nlsf[0], deltaMin[0])
    for (let i = 1; i < l; i++) nlsf[i] = Math.max(nlsf[i], sat16(nlsf[i - 1] + deltaMin[i]))
    nlsf[l - 1] = Math.min(nlsf[l - 1], (1 << 15) - deltaMin[l])
    for (let i = l - 2; i >= 0; i--) nlsf[i] = Math.min(nlsf[i], nlsf[i + 1] - deltaMin[i + 1])
  }
}

function nlsfDecode(nlsfQ15: Int16Array, indices: Int8Array, cb: NlsfCodebook): void {
  const ecIx = new Int16Array(MAX_LPC_ORDER)
  const predQ8 = new Uint8Array(MAX_LPC_ORDER)
  nlsfUnpack(ecIx, predQ8, cb, indices[0])
  const resQ10 = new Int16Array(MAX_LPC_ORDER)
  let outQ10 = 0
  for (let i = cb.order - 1; i >= 0; i--) {
    const predQ10 = smulbb(outQ10, predQ8[i]) >> 8
    outQ10 = indices[i + 1] << 10
    if (outQ10 > 0)
      outQ10 -= 102
    else if (outQ10 < 0)
      outQ10 += 102
    outQ10 = smlawb(predQ10, outQ10, cb.quantStepSizeQ16)
    resQ10[i] = outQ10
  }
  const base = indices[0] * cb.order
  for (let i = 0; i < cb.order; i++) {
    const tmp = Math.trunc((resQ10[i] << 14) / cb.cb1WghtQ9[base + i]) + (cb.cb1NlsfQ8[base + i] << 7)
    nlsfQ15[i] = limit(tmp, 0, 32767)
  }
  nlsfStabilize(nlsfQ15, cb.deltaMinQ15, cb.order)
}

function lpcAnalysisFilter(out: Int16Array, outOffset: number, input: Int16Array, inOffset: number, b: Int16Array, len: number, d: number): void {
  for (let ix = d; ix < len; ix++) {
    const p = inOffset + ix - 1
    let out32Q12 = smulbb(input[p], b[0])
    for (let j = 1; j < d; j++) out32Q12 = (out32Q12 + i16(input[p - j]) * i16(b[j])) | 0
    out32Q12 = ((input[p + 1] << 12) - out32Q12) | 0
    out[outOffset + ix] = sat16(rshiftRound(out32Q12, 12))
  }
  out.fill(0, outOffset, outOffset + d)
}

// ---------------------------------------------------------------------------
// Resampler: 8, 12 or 16 kHz up to 48 kHz (2x allpass IIR, then a 12-phase FIR)

class Resampler {
  private readonly sIIR = new Int32Array(6)
  private readonly sFIR = new Int16Array(8)
  private readonly delayBuf = new Int16Array(48)
  readonly fsInKHz: number
  readonly fsOutKHz: number
  private readonly inputDelay: number
  private readonly batchSize: number
  private readonly invRatioQ16: number
  private readonly copy: boolean

  constructor(fsIn: number, fsOut: number) {
    const rateId = (r: number): number => ((((r >> 12) - (r > 16000 ? 1 : 0)) >> (r > 24000 ? 1 : 0)) - 1)
    const delayMatrix = [[4, 0, 2, 0, 0], [0, 9, 4, 7, 4], [0, 3, 12, 7, 7]]
    this.inputDelay = delayMatrix[rateId(fsIn)][rateId(fsOut)]
    this.fsInKHz = Math.trunc(fsIn / 1000)
    this.fsOutKHz = Math.trunc(fsOut / 1000)
    this.batchSize = this.fsInKHz * 10
    if (fsOut === fsIn * 2 || fsOut < fsIn)
      throw new Error(`SILK resampling from ${fsIn} to ${fsOut} Hz`)
    this.copy = fsOut === fsIn
    const up2x = this.copy ? 0 : 1
    let inv = Math.trunc((fsIn << (14 + up2x)) / fsOut) << 2
    while (smulww(inv, fsOut) < fsIn << up2x) inv++
    this.invRatioQ16 = inv
  }

  copyStateFrom(other: Resampler): void {
    this.sIIR.set(other.sIIR)
    this.sFIR.set(other.sFIR)
    this.delayBuf.set(other.delayBuf)
  }

  process(out: Int16Array, outOffset: number, input: Int16Array, inOffset: number, inLen: number): void {
    const nSamples = this.fsInKHz - this.inputDelay
    this.delayBuf.set(input.subarray(inOffset, inOffset + nSamples), this.inputDelay)
    if (this.copy) {
      out.set(this.delayBuf.subarray(0, this.fsInKHz), outOffset)
      out.set(input.subarray(inOffset + nSamples, inOffset + inLen), outOffset + this.fsOutKHz)
    }
    else {
      this.iirFir(out, outOffset, this.delayBuf, 0, this.fsInKHz)
      this.iirFir(out, outOffset + this.fsOutKHz, input, inOffset + nSamples, inLen - this.fsInKHz)
    }
    this.delayBuf.set(input.subarray(inOffset + inLen - this.inputDelay, inOffset + inLen), 0)
  }

  private iirFir(out: Int16Array, outOffsetIn: number, input: Int16Array, inOffsetIn: number, inLenIn: number): void {
    let outOffset = outOffsetIn
    let inOffset = inOffsetIn
    let inLen = inLenIn
    const buf = new Int16Array(2 * this.batchSize + 8)
    buf.set(this.sFIR)
    let nSamplesIn = 0
    for (;;) {
      nSamplesIn = Math.min(inLen, this.batchSize)
      this.up2HQ(buf, 8, input, inOffset, nSamplesIn)
      const maxIndexQ16 = nSamplesIn << 17
      for (let index = 0; index < maxIndexQ16; index += this.invRatioQ16) {
        const table = smulwb(index & 0xFFFF, 12)
        const p = index >> 16
        let res = smulbb(buf[p], RESAMPLER_FRAC_FIR_12[table * 4])
        res = smlabb(res, buf[p + 1], RESAMPLER_FRAC_FIR_12[table * 4 + 1])
        res = smlabb(res, buf[p + 2], RESAMPLER_FRAC_FIR_12[table * 4 + 2])
        res = smlabb(res, buf[p + 3], RESAMPLER_FRAC_FIR_12[table * 4 + 3])
        res = smlabb(res, buf[p + 4], RESAMPLER_FRAC_FIR_12[(11 - table) * 4 + 3])
        res = smlabb(res, buf[p + 5], RESAMPLER_FRAC_FIR_12[(11 - table) * 4 + 2])
        res = smlabb(res, buf[p + 6], RESAMPLER_FRAC_FIR_12[(11 - table) * 4 + 1])
        res = smlabb(res, buf[p + 7], RESAMPLER_FRAC_FIR_12[(11 - table) * 4])
        out[outOffset++] = sat16(rshiftRound(res, 15))
      }
      inOffset += nSamplesIn
      inLen -= nSamplesIn
      if (inLen > 0)
        buf.copyWithin(0, nSamplesIn << 1, (nSamplesIn << 1) + 8)
      else
        break
    }
    this.sFIR.set(buf.subarray(nSamplesIn << 1, (nSamplesIn << 1) + 8))
  }

  private up2HQ(out: Int16Array, outOffset: number, input: Int16Array, inOffset: number, len: number): void {
    const s = this.sIIR
    for (let k = 0; k < len; k++) {
      const in32 = input[inOffset + k] << 10
      let y = in32 - s[0]
      let x = smulwb(y, RESAMPLER_UP2_HQ_0[0])
      let out1 = s[0] + x
      s[0] = in32 + x
      y = out1 - s[1]
      x = smulwb(y, RESAMPLER_UP2_HQ_0[1])
      let out2 = s[1] + x
      s[1] = out1 + x
      y = out2 - s[2]
      x = smlawb(y, y, RESAMPLER_UP2_HQ_0[2])
      out1 = s[2] + x
      s[2] = out2 + x
      out[outOffset + 2 * k] = sat16(rshiftRound(out1, 10))
      y = in32 - s[3]
      x = smulwb(y, RESAMPLER_UP2_HQ_1[0])
      out1 = s[3] + x
      s[3] = in32 + x
      y = out1 - s[4]
      x = smulwb(y, RESAMPLER_UP2_HQ_1[1])
      out2 = s[4] + x
      s[4] = out1 + x
      y = out2 - s[5]
      x = smlawb(y, y, RESAMPLER_UP2_HQ_1[2])
      out1 = s[5] + x
      s[5] = out2 + x
      out[outOffset + 2 * k + 1] = sat16(rshiftRound(out1, 10))
    }
  }
}

// ---------------------------------------------------------------------------
// One channel

interface Indices {
  gainsIndices: Int8Array
  ltpIndex: Int8Array
  nlsfIndices: Int8Array
  lagIndex: number
  contourIndex: number
  signalType: number
  quantOffsetType: number
  nlsfInterpCoefQ2: number
  perIndex: number
  ltpScaleIndex: number
  seed: number
}

interface Control {
  pitchL: Int32Array
  gainsQ16: Int32Array
  predCoefQ12: [Int16Array, Int16Array]
  ltpCoefQ14: Int16Array
  ltpScaleQ14: number
}

class ChannelDecoder {
  prevGainQ16 = 65536
  excQ14 = new Int32Array(MAX_FRAME_LENGTH)
  sLPCQ14Buf = new Int32Array(MAX_LPC_ORDER)
  outBuf = new Int16Array(MAX_FRAME_LENGTH + 2 * MAX_SUB_FRAME_LENGTH)
  lagPrev = 0
  lastGainIndex = 0
  fsKHz = 0
  fsApiHz = 0
  nbSubfr = 0
  frameLength = 0
  subfrLength = 0
  ltpMemLength = 0
  lpcOrder = 0
  prevNLSFQ15 = new Int16Array(MAX_LPC_ORDER)
  firstFrameAfterReset = 1
  pitchLagLowBitsIcdf: Uint8Array = UNIFORM4_ICDF
  pitchContourIcdf: Uint8Array = PITCH_CONTOUR_NB_ICDF
  nFramesDecoded = 0
  nFramesPerPacket = 0
  ecPrevSignalType = 0
  ecPrevLagIndex = 0
  vadFlags = [0, 0, 0]
  lbrrFlag = 0
  lbrrFlags = [0, 0, 0]
  resampler: Resampler | null = null
  nlsfCb: NlsfCodebook = NLSF_CB_NB_MB
  indices: Indices = {
    gainsIndices: new Int8Array(MAX_NB_SUBFR),
    ltpIndex: new Int8Array(MAX_NB_SUBFR),
    nlsfIndices: new Int8Array(MAX_LPC_ORDER + 1),
    lagIndex: 0,
    contourIndex: 0,
    signalType: 0,
    quantOffsetType: 0,
    nlsfInterpCoefQ2: 0,
    perIndex: 0,
    ltpScaleIndex: 0,
    seed: 0,
  }

  lossCnt = 0
  prevSignalType = 0

  reset(): void {
    this.prevGainQ16 = 65536
    this.excQ14.fill(0)
    this.sLPCQ14Buf.fill(0)
    this.outBuf.fill(0)
    this.lagPrev = 0
    this.lastGainIndex = 0
    this.fsKHz = 0
    this.fsApiHz = 0
    this.nbSubfr = 0
    this.frameLength = 0
    this.subfrLength = 0
    this.ltpMemLength = 0
    this.lpcOrder = 0
    this.prevNLSFQ15.fill(0)
    this.firstFrameAfterReset = 1
    this.nFramesDecoded = 0
    this.nFramesPerPacket = 0
    this.ecPrevSignalType = 0
    this.ecPrevLagIndex = 0
    this.vadFlags = [0, 0, 0]
    this.lbrrFlag = 0
    this.lbrrFlags = [0, 0, 0]
    this.resampler = null
    this.lossCnt = 0
    this.prevSignalType = 0
  }

  setFs(fsKHz: number, fsApiHz: number): void {
    this.subfrLength = smulbb(5, fsKHz)
    const frameLength = smulbb(this.nbSubfr, this.subfrLength)
    if (this.fsKHz !== fsKHz || this.fsApiHz !== fsApiHz) {
      this.resampler = new Resampler(fsKHz * 1000, fsApiHz)
      this.fsApiHz = fsApiHz
    }
    if (this.fsKHz !== fsKHz || frameLength !== this.frameLength) {
      if (fsKHz === 8)
        this.pitchContourIcdf = this.nbSubfr === MAX_NB_SUBFR ? PITCH_CONTOUR_NB_ICDF : PITCH_CONTOUR_10_MS_NB_ICDF
      else
        this.pitchContourIcdf = this.nbSubfr === MAX_NB_SUBFR ? PITCH_CONTOUR_ICDF : PITCH_CONTOUR_10_MS_ICDF
      if (this.fsKHz !== fsKHz) {
        this.ltpMemLength = smulbb(20, fsKHz)
        if (fsKHz === 8 || fsKHz === 12) {
          this.lpcOrder = MIN_LPC_ORDER
          this.nlsfCb = NLSF_CB_NB_MB
        }
        else {
          this.lpcOrder = MAX_LPC_ORDER
          this.nlsfCb = NLSF_CB_WB
        }
        this.pitchLagLowBitsIcdf = fsKHz === 16 ? UNIFORM8_ICDF : fsKHz === 12 ? UNIFORM6_ICDF : UNIFORM4_ICDF
        this.firstFrameAfterReset = 1
        this.lagPrev = 100
        this.lastGainIndex = 10
        this.prevSignalType = TYPE_NO_VOICE_ACTIVITY
        this.outBuf.fill(0)
        this.sLPCQ14Buf.fill(0)
      }
      this.fsKHz = fsKHz
      this.frameLength = frameLength
    }
  }

  decodeIndices(dec: RangeDecoder, frameIndex: number, decodeLbrr: boolean, condCoding: number): void {
    const ix = this.indices
    let index: number
    if (decodeLbrr || this.vadFlags[frameIndex])
      index = dec.icdf(TYPE_OFFSET_VAD_ICDF, 8) + 2
    else
      index = dec.icdf(TYPE_OFFSET_NO_VAD_ICDF, 8)
    ix.signalType = index >> 1
    ix.quantOffsetType = index & 1
    if (condCoding === CODE_CONDITIONALLY) {
      ix.gainsIndices[0] = dec.icdf(DELTA_GAIN_ICDF, 8)
    }
    else {
      ix.gainsIndices[0] = dec.icdf(GAIN_ICDF, 8, ix.signalType * 8) << 3
      ix.gainsIndices[0] += dec.icdf(UNIFORM8_ICDF, 8)
    }
    for (let i = 1; i < this.nbSubfr; i++) ix.gainsIndices[i] = dec.icdf(DELTA_GAIN_ICDF, 8)
    const cb = this.nlsfCb
    ix.nlsfIndices[0] = dec.icdf(cb.cb1Icdf, 8, (ix.signalType >> 1) * cb.nVectors)
    const ecIx = new Int16Array(MAX_LPC_ORDER)
    const predQ8 = new Uint8Array(MAX_LPC_ORDER)
    nlsfUnpack(ecIx, predQ8, cb, ix.nlsfIndices[0])
    for (let i = 0; i < cb.order; i++) {
      index = dec.icdf(cb.ecIcdf, 8, ecIx[i])
      if (index === 0)
        index -= dec.icdf(NLSF_EXT_ICDF, 8)
      else if (index === 2 * NLSF_QUANT_MAX_AMPLITUDE)
        index += dec.icdf(NLSF_EXT_ICDF, 8)
      ix.nlsfIndices[i + 1] = index - NLSF_QUANT_MAX_AMPLITUDE
    }
    ix.nlsfInterpCoefQ2 = this.nbSubfr === MAX_NB_SUBFR ? dec.icdf(NLSF_INTERPOLATION_FACTOR_ICDF, 8) : 4
    if (ix.signalType === TYPE_VOICED) {
      let absolute = true
      if (condCoding === CODE_CONDITIONALLY && this.ecPrevSignalType === TYPE_VOICED) {
        let delta = dec.icdf(PITCH_DELTA_ICDF, 8)
        if (delta > 0) {
          delta -= 9
          ix.lagIndex = i16(this.ecPrevLagIndex + delta)
          absolute = false
        }
      }
      if (absolute) {
        ix.lagIndex = i16(dec.icdf(PITCH_LAG_ICDF, 8) * (this.fsKHz >> 1))
        ix.lagIndex = i16(ix.lagIndex + dec.icdf(this.pitchLagLowBitsIcdf, 8))
      }
      this.ecPrevLagIndex = ix.lagIndex
      ix.contourIndex = dec.icdf(this.pitchContourIcdf, 8)
      ix.perIndex = dec.icdf(LTP_PER_INDEX_ICDF, 8)
      const gainIcdf = [LTP_GAIN_ICDF_0, LTP_GAIN_ICDF_1, LTP_GAIN_ICDF_2][ix.perIndex]
      for (let k = 0; k < this.nbSubfr; k++) ix.ltpIndex[k] = dec.icdf(gainIcdf, 8)
      ix.ltpScaleIndex = condCoding === CODE_INDEPENDENTLY ? dec.icdf(LTPSCALE_ICDF, 8) : 0
    }
    this.ecPrevSignalType = ix.signalType
    ix.seed = dec.icdf(UNIFORM4_ICDF, 8)
  }

  decodeParameters(ctrl: Control, condCoding: number): void {
    const ix = this.indices
    // Gains.
    for (let k = 0; k < this.nbSubfr; k++) {
      if (k === 0 && condCoding !== CODE_CONDITIONALLY) {
        this.lastGainIndex = Math.max(ix.gainsIndices[k], this.lastGainIndex - 16)
      }
      else {
        const indTmp = ix.gainsIndices[k] + MIN_DELTA_GAIN_QUANT
        const threshold = 2 * MAX_DELTA_GAIN_QUANT - N_LEVELS_QGAIN + this.lastGainIndex
        if (indTmp > threshold)
          this.lastGainIndex += (indTmp << 1) - threshold
        else
          this.lastGainIndex += indTmp
      }
      this.lastGainIndex = limit(this.lastGainIndex, 0, N_LEVELS_QGAIN - 1)
      ctrl.gainsQ16[k] = log2lin(Math.min(smulwb(INV_SCALE_Q16, this.lastGainIndex) + OFFSET_GAIN, 3967))
    }
    const nlsfQ15 = new Int16Array(MAX_LPC_ORDER)
    nlsfDecode(nlsfQ15, ix.nlsfIndices, this.nlsfCb)
    nlsf2a(ctrl.predCoefQ12[1], nlsfQ15, this.lpcOrder)
    if (this.firstFrameAfterReset === 1)
      ix.nlsfInterpCoefQ2 = 4
    if (ix.nlsfInterpCoefQ2 < 4) {
      const nlsf0 = new Int16Array(MAX_LPC_ORDER)
      for (let i = 0; i < this.lpcOrder; i++) nlsf0[i] = this.prevNLSFQ15[i] + ((ix.nlsfInterpCoefQ2 * (nlsfQ15[i] - this.prevNLSFQ15[i])) >> 2)
      nlsf2a(ctrl.predCoefQ12[0], nlsf0, this.lpcOrder)
    }
    else {
      ctrl.predCoefQ12[0].set(ctrl.predCoefQ12[1].subarray(0, this.lpcOrder))
    }
    this.prevNLSFQ15.set(nlsfQ15.subarray(0, this.lpcOrder))
    if (this.lossCnt) {
      bwexpander(ctrl.predCoefQ12[0], this.lpcOrder, BWE_AFTER_LOSS_Q16)
      bwexpander(ctrl.predCoefQ12[1], this.lpcOrder, BWE_AFTER_LOSS_Q16)
    }
    if (ix.signalType === TYPE_VOICED) {
      this.decodePitch(ix.lagIndex, ix.contourIndex, ctrl.pitchL)
      const cbk = [LTP_GAIN_VQ_0, LTP_GAIN_VQ_1, LTP_GAIN_VQ_2][ix.perIndex]
      for (let k = 0; k < this.nbSubfr; k++) {
        const index = ix.ltpIndex[k]
        for (let i = 0; i < LTP_ORDER; i++) ctrl.ltpCoefQ14[k * LTP_ORDER + i] = cbk[index * LTP_ORDER + i] << 7
      }
      ctrl.ltpScaleQ14 = LTPSCALES_TABLE_Q14[ix.ltpScaleIndex]
    }
    else {
      ctrl.pitchL.fill(0, 0, this.nbSubfr)
      ctrl.ltpCoefQ14.fill(0, 0, LTP_ORDER * this.nbSubfr)
      ix.perIndex = 0
      ctrl.ltpScaleQ14 = 0
    }
  }

  private decodePitch(lagIndex: number, contourIndex: number, pitchLags: Int32Array): void {
    let lagCb: Int8Array
    let cbkSize: number
    if (this.fsKHz === 8) {
      if (this.nbSubfr === MAX_NB_SUBFR) {
        lagCb = CB_LAGS_STAGE2
        cbkSize = 11
      }
      else {
        lagCb = CB_LAGS_STAGE2_10_MS
        cbkSize = 3
      }
    }
    else if (this.nbSubfr === MAX_NB_SUBFR) {
      lagCb = CB_LAGS_STAGE3
      cbkSize = 34
    }
    else {
      lagCb = CB_LAGS_STAGE3_10_MS
      cbkSize = 12
    }
    const minLag = smulbb(2, this.fsKHz)
    const maxLag = smulbb(18, this.fsKHz)
    const lag = minLag + lagIndex
    for (let k = 0; k < this.nbSubfr; k++) pitchLags[k] = limit(lag + lagCb[k * cbkSize + contourIndex], minLag, maxLag)
  }

  decodeCore(ctrl: Control, xq: Int16Array, xqOffset: number, pulses: Int16Array): void {
    const ix = this.indices
    const sLTP = new Int16Array(this.ltpMemLength)
    const sLTPQ15 = new Int32Array(this.ltpMemLength + this.frameLength)
    const resQ14 = new Int32Array(this.subfrLength)
    const sLPCQ14 = new Int32Array(this.subfrLength + MAX_LPC_ORDER)
    const offsetQ10 = QUANTIZATION_OFFSETS_Q10[ix.signalType >> 1][ix.quantOffsetType]
    const nlsfInterpolationFlag = ix.nlsfInterpCoefQ2 < 4
    let randSeed = ix.seed
    for (let i = 0; i < this.frameLength; i++) {
      randSeed = silkRand(randSeed)
      let e = pulses[i] << 14
      if (e > 0)
        e -= QUANT_LEVEL_ADJUST_Q10 << 4
      else if (e < 0)
        e += QUANT_LEVEL_ADJUST_Q10 << 4
      e += offsetQ10 << 4
      if (randSeed < 0)
        e = -e
      this.excQ14[i] = e
      randSeed = (randSeed + pulses[i]) | 0
    }
    sLPCQ14.set(this.sLPCQ14Buf)
    let excOffset = 0
    let xqPos = xqOffset
    let sLTPBufIdx = this.ltpMemLength
    let lag = 0
    const aTmp = new Int16Array(MAX_LPC_ORDER)
    for (let k = 0; k < this.nbSubfr; k++) {
      const aQ12 = ctrl.predCoefQ12[k >> 1]
      aTmp.set(aQ12.subarray(0, this.lpcOrder))
      const bOffset = k * LTP_ORDER
      let signalType = ix.signalType
      const gainQ10 = ctrl.gainsQ16[k] >> 6
      let invGainQ31 = inverse32VarQ(ctrl.gainsQ16[k], 47)
      let gainAdjQ16: number
      if (ctrl.gainsQ16[k] !== this.prevGainQ16) {
        gainAdjQ16 = div32VarQ(this.prevGainQ16, ctrl.gainsQ16[k], 16)
        for (let i = 0; i < MAX_LPC_ORDER; i++) sLPCQ14[i] = smulww(gainAdjQ16, sLPCQ14[i])
      }
      else {
        gainAdjQ16 = 1 << 16
      }
      this.prevGainQ16 = ctrl.gainsQ16[k]
      if (this.lossCnt && this.prevSignalType === TYPE_VOICED && ix.signalType !== TYPE_VOICED && k < MAX_NB_SUBFR / 2) {
        ctrl.ltpCoefQ14.fill(0, bOffset, bOffset + LTP_ORDER)
        ctrl.ltpCoefQ14[bOffset + LTP_ORDER / 2 | 0] = Math.trunc(0.25 * (1 << 14) + 0.5)
        signalType = TYPE_VOICED
        ctrl.pitchL[k] = this.lagPrev
      }
      if (signalType === TYPE_VOICED) {
        lag = ctrl.pitchL[k]
        if (k === 0 || (k === 2 && nlsfInterpolationFlag)) {
          const startIdx = this.ltpMemLength - lag - this.lpcOrder - (LTP_ORDER >> 1)
          if (k === 2)
            this.outBuf.set(xq.subarray(xqOffset, xqOffset + 2 * this.subfrLength), this.ltpMemLength)
          lpcAnalysisFilter(sLTP, startIdx, this.outBuf, startIdx + k * this.subfrLength, aQ12, this.ltpMemLength - startIdx, this.lpcOrder)
          if (k === 0)
            invGainQ31 = smulwb(invGainQ31, ctrl.ltpScaleQ14) << 2
          for (let i = 0; i < lag + (LTP_ORDER >> 1); i++) sLTPQ15[sLTPBufIdx - i - 1] = smulwb(invGainQ31, sLTP[this.ltpMemLength - i - 1])
        }
        else if (gainAdjQ16 !== 1 << 16) {
          for (let i = 0; i < lag + (LTP_ORDER >> 1); i++) sLTPQ15[sLTPBufIdx - i - 1] = smulww(gainAdjQ16, sLTPQ15[sLTPBufIdx - i - 1])
        }
      }
      let res: Int32Array
      let resOffset: number
      if (signalType === TYPE_VOICED) {
        let predLag = sLTPBufIdx - lag + (LTP_ORDER >> 1)
        const b = ctrl.ltpCoefQ14
        for (let i = 0; i < this.subfrLength; i++) {
          let ltpPredQ13 = 2
          ltpPredQ13 = smlawb(ltpPredQ13, sLTPQ15[predLag], b[bOffset])
          ltpPredQ13 = smlawb(ltpPredQ13, sLTPQ15[predLag - 1], b[bOffset + 1])
          ltpPredQ13 = smlawb(ltpPredQ13, sLTPQ15[predLag - 2], b[bOffset + 2])
          ltpPredQ13 = smlawb(ltpPredQ13, sLTPQ15[predLag - 3], b[bOffset + 3])
          ltpPredQ13 = smlawb(ltpPredQ13, sLTPQ15[predLag - 4], b[bOffset + 4])
          predLag++
          resQ14[i] = (this.excQ14[excOffset + i] + (ltpPredQ13 << 1)) | 0
          sLTPQ15[sLTPBufIdx] = resQ14[i] << 1
          sLTPBufIdx++
        }
        res = resQ14
        resOffset = 0
      }
      else {
        res = this.excQ14
        resOffset = excOffset
      }
      for (let i = 0; i < this.subfrLength; i++) {
        let lpcPredQ10 = this.lpcOrder >> 1
        for (let j = 0; j < this.lpcOrder; j++) lpcPredQ10 = smlawb(lpcPredQ10, sLPCQ14[MAX_LPC_ORDER + i - j - 1], aTmp[j])
        sLPCQ14[MAX_LPC_ORDER + i] = addSat32(res[resOffset + i], lshiftSat32(lpcPredQ10, 4))
        xq[xqPos + i] = sat16(rshiftRound(smulww(sLPCQ14[MAX_LPC_ORDER + i], gainQ10), 8))
      }
      sLPCQ14.copyWithin(0, this.subfrLength, this.subfrLength + MAX_LPC_ORDER)
      excOffset += this.subfrLength
      xqPos += this.subfrLength
    }
    this.sLPCQ14Buf.set(sLPCQ14.subarray(0, MAX_LPC_ORDER))
  }

  decodeFrame(dec: RangeDecoder | null, out: Int16Array, outOffset: number, lostFlag: number, condCoding: number): number {
    const l = this.frameLength
    const ctrl: Control = {
      pitchL: new Int32Array(MAX_NB_SUBFR),
      gainsQ16: new Int32Array(MAX_NB_SUBFR),
      predCoefQ12: [new Int16Array(MAX_LPC_ORDER), new Int16Array(MAX_LPC_ORDER)],
      ltpCoefQ14: new Int16Array(LTP_ORDER * MAX_NB_SUBFR),
      ltpScaleQ14: 0,
    }
    if (lostFlag === FLAG_DECODE_NORMAL && dec) {
      const pulses = new Int16Array((l + SHELL_CODEC_FRAME_LENGTH - 1) & ~(SHELL_CODEC_FRAME_LENGTH - 1))
      this.decodeIndices(dec, this.nFramesDecoded, false, condCoding)
      decodePulses(dec, pulses, this.indices.signalType, this.indices.quantOffsetType, l)
      this.decodeParameters(ctrl, condCoding)
      this.decodeCore(ctrl, out, outOffset, pulses)
      const mvLen = this.ltpMemLength - l
      this.outBuf.copyWithin(0, l, l + mvLen)
      this.outBuf.set(out.subarray(outOffset, outOffset + l), mvLen)
      this.lossCnt = 0
      this.prevSignalType = this.indices.signalType
      this.firstFrameAfterReset = 0
    }
    else {
      // A missing frame is heard as silence.
      out.fill(0, outOffset, outOffset + l)
      const mvLen = this.ltpMemLength - l
      this.outBuf.copyWithin(0, l, l + mvLen)
      this.outBuf.fill(0, mvLen, mvLen + l)
    }
    this.lagPrev = ctrl.pitchL[this.nbSubfr - 1]
    return l
  }
}

function decodeSplit(out: Int16Array, child1: number, child2: number, dec: RangeDecoder, p: number, table: Uint8Array): void {
  if (p > 0) {
    out[child1] = dec.icdf(table, 8, SHELL_CODE_TABLE_OFFSETS[p])
    out[child2] = p - out[child1]
  }
  else {
    out[child1] = 0
    out[child2] = 0
  }
}

function shellDecoder(pulses0: Int16Array, offset: number, dec: RangeDecoder, pulses4: number): void {
  const p3 = new Int16Array(2)
  const p2 = new Int16Array(4)
  const p1 = new Int16Array(8)
  const p0 = new Int16Array(16)
  decodeSplit(p3, 0, 1, dec, pulses4, SHELL_CODE_TABLE3)
  decodeSplit(p2, 0, 1, dec, p3[0], SHELL_CODE_TABLE2)
  decodeSplit(p1, 0, 1, dec, p2[0], SHELL_CODE_TABLE1)
  decodeSplit(p0, 0, 1, dec, p1[0], SHELL_CODE_TABLE0)
  decodeSplit(p0, 2, 3, dec, p1[1], SHELL_CODE_TABLE0)
  decodeSplit(p1, 2, 3, dec, p2[1], SHELL_CODE_TABLE1)
  decodeSplit(p0, 4, 5, dec, p1[2], SHELL_CODE_TABLE0)
  decodeSplit(p0, 6, 7, dec, p1[3], SHELL_CODE_TABLE0)
  decodeSplit(p2, 2, 3, dec, p3[1], SHELL_CODE_TABLE2)
  decodeSplit(p1, 4, 5, dec, p2[2], SHELL_CODE_TABLE1)
  decodeSplit(p0, 8, 9, dec, p1[4], SHELL_CODE_TABLE0)
  decodeSplit(p0, 10, 11, dec, p1[5], SHELL_CODE_TABLE0)
  decodeSplit(p1, 6, 7, dec, p2[3], SHELL_CODE_TABLE1)
  decodeSplit(p0, 12, 13, dec, p1[6], SHELL_CODE_TABLE0)
  decodeSplit(p0, 14, 15, dec, p1[7], SHELL_CODE_TABLE0)
  pulses0.set(p0, offset)
}

function decodePulses(dec: RangeDecoder, pulses: Int16Array, signalType: number, quantOffsetType: number, frameLength: number): void {
  const rateLevel = dec.icdf(RATE_LEVELS_ICDF, 8, (signalType >> 1) * 9)
  let iter = frameLength >> LOG2_SHELL_CODEC_FRAME_LENGTH
  if (iter * SHELL_CODEC_FRAME_LENGTH < frameLength)
    iter++
  const sumPulses = new Int32Array(iter)
  const nLshifts = new Int32Array(iter)
  for (let i = 0; i < iter; i++) {
    sumPulses[i] = dec.icdf(PULSES_PER_BLOCK_ICDF, 8, rateLevel * 18)
    while (sumPulses[i] === SILK_MAX_PULSES + 1) {
      nLshifts[i]++
      sumPulses[i] = dec.icdf(PULSES_PER_BLOCK_ICDF, 8, (N_RATE_LEVELS - 1) * 18 + (nLshifts[i] === 10 ? 1 : 0))
    }
  }
  for (let i = 0; i < iter; i++) {
    if (sumPulses[i] > 0)
      shellDecoder(pulses, i * SHELL_CODEC_FRAME_LENGTH, dec, sumPulses[i])
    else
      pulses.fill(0, i * SHELL_CODEC_FRAME_LENGTH, (i + 1) * SHELL_CODEC_FRAME_LENGTH)
  }
  for (let i = 0; i < iter; i++) {
    if (nLshifts[i] > 0) {
      const nLS = nLshifts[i]
      const base = i * SHELL_CODEC_FRAME_LENGTH
      for (let k = 0; k < SHELL_CODEC_FRAME_LENGTH; k++) {
        let absQ = pulses[base + k]
        for (let j = 0; j < nLS; j++) absQ = (absQ << 1) + dec.icdf(LSB_ICDF, 8)
        pulses[base + k] = absQ
      }
      sumPulses[i] |= nLS << 5
    }
  }
  // Signs.
  const icdf = new Uint8Array(2)
  const signBase = smulbb(7, quantOffsetType + (signalType << 1))
  const length = (frameLength + SHELL_CODEC_FRAME_LENGTH / 2) >> LOG2_SHELL_CODEC_FRAME_LENGTH
  for (let i = 0; i < length; i++) {
    const p = sumPulses[i]
    if (p > 0) {
      icdf[0] = SIGN_ICDF[signBase + Math.min(p & 0x1F, 6)]
      for (let j = 0; j < SHELL_CODEC_FRAME_LENGTH; j++) {
        const index = i * SHELL_CODEC_FRAME_LENGTH + j
        if (pulses[index] > 0)
          pulses[index] *= (dec.icdf(icdf, 8) << 1) - 1
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The decoder

export interface SilkControl {
  channelsInternal: number
  internalSampleRate: number
  payloadMs: number
}

export class SilkDecoder {
  private readonly channelStates = [new ChannelDecoder(), new ChannelDecoder()]
  private nChannelsApi = 0
  private nChannelsInternal = 0
  private prevDecodeOnlyMiddle = 0
  private readonly predPrevQ13 = new Int32Array(2)
  private readonly sMid = new Int16Array(2)
  private readonly sSide = new Int16Array(2)
  private lastControl: SilkControl | null = null

  constructor(readonly channels: number) {
    this.reset()
  }

  reset(): void {
    for (const state of this.channelStates) {
      state.reset()
      state.firstFrameAfterReset = 1
      state.prevGainQ16 = 65536
    }
    this.prevDecodeOnlyMiddle = 0
    this.predPrevQ13.fill(0)
    this.sMid.fill(0)
    this.sSide.fill(0)
  }

  /** One SILK frame (10 or 20 ms), resampled to 48 kHz and interleaved into `out` from `outOffset`. Returns samples per channel. */
  decode(dec: RangeDecoder | null, lostFlag: number, newPacket: boolean, controlIn: SilkControl, out: Int16Array, outOffset: number): number {
    const control = lostFlag === FLAG_PACKET_LOST && this.lastControl ? { ...this.lastControl, payloadMs: controlIn.payloadMs } : controlIn
    this.lastControl = control
    const channels = this.channelStates
    const apiRate = 48000
    const nApi = this.channels
    const nInternal = control.channelsInternal
    if (newPacket) {
      for (let n = 0; n < nInternal; n++) channels[n].nFramesDecoded = 0
    }
    if (nInternal > this.nChannelsInternal && this.nChannelsInternal > 0) {
      channels[1].reset()
      channels[1].firstFrameAfterReset = 1
      channels[1].prevGainQ16 = 65536
    }
    const stereoToMono = nInternal === 1 && this.nChannelsInternal === 2 && control.internalSampleRate === 1000 * channels[0].fsKHz
    if (channels[0].nFramesDecoded === 0) {
      for (let n = 0; n < nInternal; n++) {
        const ms = control.payloadMs
        if (ms === 0 || ms === 10) {
          channels[n].nFramesPerPacket = 1
          channels[n].nbSubfr = 2
        }
        else if (ms === 20) {
          channels[n].nFramesPerPacket = 1
          channels[n].nbSubfr = 4
        }
        else if (ms === 40) {
          channels[n].nFramesPerPacket = 2
          channels[n].nbSubfr = 4
        }
        else if (ms === 60) {
          channels[n].nFramesPerPacket = 3
          channels[n].nbSubfr = 4
        }
        else {
          throw new Error(`SILK frame of ${ms} ms`)
        }
        const fsKHz = (control.internalSampleRate >> 10) + 1
        channels[n].setFs(fsKHz, apiRate)
      }
    }
    if (nApi === 2 && nInternal === 2 && (this.nChannelsApi === 1 || this.nChannelsInternal === 1)) {
      this.predPrevQ13.fill(0)
      this.sSide.fill(0)
      if (channels[0].resampler && channels[1].resampler)
        channels[1].resampler.copyStateFrom(channels[0].resampler)
    }
    this.nChannelsApi = nApi
    this.nChannelsInternal = nInternal

    const msPredQ13 = new Int32Array(2)
    let decodeOnlyMiddle = 0
    if (lostFlag !== FLAG_PACKET_LOST && dec && channels[0].nFramesDecoded === 0) {
      for (let n = 0; n < nInternal; n++) {
        for (let i = 0; i < channels[n].nFramesPerPacket; i++) channels[n].vadFlags[i] = dec.bitLogp(1)
        channels[n].lbrrFlag = dec.bitLogp(1)
      }
      for (let n = 0; n < nInternal; n++) {
        channels[n].lbrrFlags = [0, 0, 0]
        if (channels[n].lbrrFlag) {
          if (channels[n].nFramesPerPacket === 1) {
            channels[n].lbrrFlags[0] = 1
          }
          else {
            const symbol = dec.icdf(channels[n].nFramesPerPacket === 2 ? LBRR_FLAGS_2_ICDF : LBRR_FLAGS_3_ICDF, 8) + 1
            for (let i = 0; i < channels[n].nFramesPerPacket; i++) channels[n].lbrrFlags[i] = (symbol >> i) & 1
          }
        }
      }
      // The low-bitrate redundancy of the previous packet is read and set aside.
      for (let i = 0; i < channels[0].nFramesPerPacket; i++) {
        for (let n = 0; n < nInternal; n++) {
          if (channels[n].lbrrFlags[i]) {
            if (nInternal === 2 && n === 0) {
              stereoDecodePred(dec, msPredQ13)
              if (channels[1].lbrrFlags[i] === 0)
                decodeOnlyMiddle = dec.icdf(STEREO_ONLY_CODE_MID_ICDF, 8)
            }
            const condCoding = i > 0 && channels[n].lbrrFlags[i - 1] ? CODE_CONDITIONALLY : CODE_INDEPENDENTLY
            channels[n].decodeIndices(dec, i, true, condCoding)
            const pulses = new Int16Array(MAX_FRAME_LENGTH)
            decodePulses(dec, pulses, channels[n].indices.signalType, channels[n].indices.quantOffsetType, channels[n].frameLength)
          }
        }
      }
    }
    if (nInternal === 2) {
      if (lostFlag === FLAG_DECODE_NORMAL && dec) {
        stereoDecodePred(dec, msPredQ13)
        if (channels[1].vadFlags[channels[0].nFramesDecoded] === 0)
          decodeOnlyMiddle = dec.icdf(STEREO_ONLY_CODE_MID_ICDF, 8)
        else
          decodeOnlyMiddle = 0
      }
      else {
        msPredQ13[0] = this.predPrevQ13[0]
        msPredQ13[1] = this.predPrevQ13[1]
      }
    }
    if (nInternal === 2 && decodeOnlyMiddle === 0 && this.prevDecodeOnlyMiddle === 1) {
      const side = channels[1]
      side.outBuf.fill(0)
      side.sLPCQ14Buf.fill(0)
      side.lagPrev = 100
      side.lastGainIndex = 10
      side.prevSignalType = TYPE_NO_VOICE_ACTIVITY
      side.firstFrameAfterReset = 1
    }

    const frameLength = channels[0].frameLength
    const tmp = [new Int16Array(frameLength + 2), new Int16Array(frameLength + 2)]
    const hasSide = lostFlag === FLAG_DECODE_NORMAL ? !decodeOnlyMiddle : !this.prevDecodeOnlyMiddle
    let nSamplesOutDec = frameLength
    for (let n = 0; n < nInternal; n++) {
      if (n === 0 || hasSide) {
        const frameIndex = channels[0].nFramesDecoded - n
        let condCoding: number
        if (frameIndex <= 0)
          condCoding = CODE_INDEPENDENTLY
        else if (n > 0 && this.prevDecodeOnlyMiddle)
          condCoding = CODE_INDEPENDENTLY_NO_LTP_SCALING
        else
          condCoding = CODE_CONDITIONALLY
        nSamplesOutDec = channels[n].decodeFrame(lostFlag === FLAG_DECODE_NORMAL ? dec : null, tmp[n], 2, lostFlag, condCoding)
      }
      else {
        tmp[n].fill(0, 2, 2 + nSamplesOutDec)
      }
      channels[n].nFramesDecoded++
    }
    if (nApi === 2 && nInternal === 2) {
      this.msToLr(tmp[0], tmp[1], msPredQ13, channels[0].fsKHz, nSamplesOutDec)
    }
    else {
      tmp[0].set(this.sMid, 0)
      this.sMid.set(tmp[0].subarray(nSamplesOutDec, nSamplesOutDec + 2))
    }
    const nSamplesOut = Math.trunc((nSamplesOutDec * apiRate) / smulbb(channels[0].fsKHz, 1000))
    const resampled = new Int16Array(nSamplesOut)
    for (let n = 0; n < Math.min(nApi, nInternal); n++) {
      channels[n].resampler!.process(resampled, 0, tmp[n], 1, nSamplesOutDec)
      for (let i = 0; i < nSamplesOut; i++) out[outOffset + nApi * i + n] = resampled[i]
    }
    if (nApi === 2 && nInternal === 1) {
      if (stereoToMono && channels[1].resampler) {
        channels[1].resampler.process(resampled, 0, tmp[0], 1, nSamplesOutDec)
        for (let i = 0; i < nSamplesOut; i++) out[outOffset + 2 * i + 1] = resampled[i]
      }
      else {
        for (let i = 0; i < nSamplesOut; i++) out[outOffset + 2 * i + 1] = out[outOffset + 2 * i]
      }
    }
    if (lostFlag === FLAG_PACKET_LOST) {
      for (let i = 0; i < this.nChannelsInternal; i++) channels[i].lastGainIndex = 10
    }
    else {
      this.prevDecodeOnlyMiddle = decodeOnlyMiddle
    }
    return nSamplesOut
  }

  private msToLr(x1: Int16Array, x2: Int16Array, predQ13: Int32Array, fsKHz: number, frameLength: number): void {
    x1.set(this.sMid, 0)
    x2.set(this.sSide, 0)
    this.sMid.set(x1.subarray(frameLength, frameLength + 2))
    this.sSide.set(x2.subarray(frameLength, frameLength + 2))
    let pred0 = this.predPrevQ13[0]
    let pred1 = this.predPrevQ13[1]
    const denomQ16 = Math.trunc((1 << 16) / (STEREO_INTERP_LEN_MS * fsKHz))
    const delta0 = rshiftRound(smulbb(predQ13[0] - this.predPrevQ13[0], denomQ16), 16)
    const delta1 = rshiftRound(smulbb(predQ13[1] - this.predPrevQ13[1], denomQ16), 16)
    const step = (n: number): void => {
      let sum = ((x1[n] + x1[n + 2]) + (x1[n + 1] << 1)) << 9
      sum = smlawb(x2[n + 1] << 8, sum, pred0)
      sum = smlawb(sum, x1[n + 1] << 11, pred1)
      x2[n + 1] = sat16(rshiftRound(sum, 8))
    }
    for (let n = 0; n < STEREO_INTERP_LEN_MS * fsKHz; n++) {
      pred0 += delta0
      pred1 += delta1
      step(n)
    }
    pred0 = predQ13[0]
    pred1 = predQ13[1]
    for (let n = STEREO_INTERP_LEN_MS * fsKHz; n < frameLength; n++) step(n)
    this.predPrevQ13[0] = predQ13[0]
    this.predPrevQ13[1] = predQ13[1]
    for (let n = 0; n < frameLength; n++) {
      const sum = x1[n + 1] + x2[n + 1]
      const diff = x1[n + 1] - x2[n + 1]
      x1[n + 1] = sat16(sum)
      x2[n + 1] = sat16(diff)
    }
  }
}

function stereoDecodePred(dec: RangeDecoder, predQ13: Int32Array): void {
  const ix = [[0, 0, 0], [0, 0, 0]]
  let n = dec.icdf(STEREO_PRED_JOINT_ICDF, 8)
  ix[0][2] = Math.trunc(n / 5)
  ix[1][2] = n - 5 * ix[0][2]
  for (n = 0; n < 2; n++) {
    ix[n][0] = dec.icdf(UNIFORM3_ICDF, 8)
    ix[n][1] = dec.icdf(UNIFORM5_ICDF, 8)
  }
  for (n = 0; n < 2; n++) {
    ix[n][0] += 3 * ix[n][2]
    const lowQ13 = STEREO_PRED_QUANT_Q13[ix[n][0]]
    const stepQ13 = smulwb(STEREO_PRED_QUANT_Q13[ix[n][0] + 1] - lowQ13, Math.trunc((0.5 / 5) * 65536 + 0.5))
    predQ13[n] = smlabb(lowQ13, stepQ13, 2 * ix[n][1] + 1)
  }
  predQ13[0] -= predQ13[1]
}
