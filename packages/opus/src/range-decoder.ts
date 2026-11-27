/**
 * The Opus range decoder (RFC 6716 section 4.1), shared by SILK and CELT:
 * symbols from the front of the packet, raw bits from the back.
 *
 * Ported from libopus 1.5.2 (celt/entdec.c, celt/entcode.c, celt/laplace.c),
 * BSD 3-clause licence, in THIRD_PARTY_NOTICES.md.
 */

const SYM_BITS = 8
const CODE_BITS = 32
const SYM_MAX = 255
const CODE_TOP = 2 ** 31
const CODE_BOT = 2 ** 23
const CODE_EXTRA = 7
const UINT_BITS = 8
const WINDOW_SIZE = 32
export const BITRES = 3

/** The number of bits needed to write v: 0 for 0, floor(log2 v) + 1 otherwise. */
export function ilog(v: number): number {
  return v === 0 ? 0 : 32 - Math.clz32(v)
}

export class RangeDecoder {
  /** Bytes of the buffer the decoder may read; the redundancy at the end of a hybrid packet is taken off. */
  storage: number
  private offset = 0
  private endOffset = 0
  private endWindow = 0
  private endBits = 0
  nbitsTotal: number
  rng: number
  private val: number
  private rem: number
  private ext = 0
  error: boolean = false

  constructor(private readonly buffer: Uint8Array, storage: number = buffer.length) {
    this.storage = storage
    this.nbitsTotal = CODE_BITS + 1 - Math.floor((CODE_BITS - CODE_EXTRA) / SYM_BITS) * SYM_BITS
    this.rng = 2 ** CODE_EXTRA
    this.rem = this.readByte()
    this.val = this.rng - 1 - (this.rem >>> (SYM_BITS - CODE_EXTRA))
    this.normalize()
  }

  private readByte(): number {
    return this.offset < this.storage ? this.buffer[this.offset++] : 0
  }

  private readByteFromEnd(): number {
    return this.endOffset < this.storage ? this.buffer[this.storage - ++this.endOffset] : 0
  }

  private normalize(): void {
    while (this.rng <= CODE_BOT) {
      this.nbitsTotal += SYM_BITS
      this.rng = (this.rng * 256) >>> 0
      let sym = this.rem
      this.rem = this.readByte()
      sym = ((sym << SYM_BITS) | this.rem) >>> (SYM_BITS - CODE_EXTRA)
      this.val = (((this.val * 256) >>> 0) + (SYM_MAX & ~sym)) & (CODE_TOP - 1)
      this.val >>>= 0
    }
  }

  decode(ft: number): number {
    this.ext = Math.floor(this.rng / ft)
    const s = Math.floor(this.val / this.ext)
    return ft - Math.min(s + 1, ft)
  }

  decodeBin(bits: number): number {
    this.ext = this.rng >>> bits
    const s = Math.floor(this.val / this.ext)
    return (1 << bits) - Math.min(s + 1, 1 << bits)
  }

  update(fl: number, fh: number, ft: number): void {
    const s = this.ext * (ft - fh)
    this.val = (this.val - s) >>> 0
    this.rng = fl > 0 ? this.ext * (fh - fl) : (this.rng - s) >>> 0
    this.normalize()
  }

  bitLogp(logp: number): number {
    const r = this.rng
    const d = this.val
    const s = r >>> logp
    const ret = d < s ? 1 : 0
    if (!ret)
      this.val = (d - s) >>> 0
    this.rng = ret ? s : (r - s) >>> 0
    this.normalize()
    return ret
  }

  /** A symbol from an inverse cumulative table whose total is 2^ftb. */
  icdf(icdf: ArrayLike<number>, ftb: number, offset = 0): number {
    let s = this.rng
    const d = this.val
    const r = s >>> ftb
    let ret = -1
    let t: number
    do {
      t = s
      s = r * icdf[offset + ++ret]
    } while (d < s)
    this.val = (d - s) >>> 0
    this.rng = (t - s) >>> 0
    this.normalize()
    return ret
  }

  /** A uniform integer in [0, ft). */
  uint(ftIn: number): number {
    let ft = ftIn - 1
    let ftb = ilog(ft)
    if (ftb > UINT_BITS) {
      ftb -= UINT_BITS
      const f = Math.floor(ft / 2 ** ftb) + 1
      const s = this.decode(f)
      this.update(s, s + 1, f)
      const t = s * 2 ** ftb + this.bits(ftb)
      if (t <= ft)
        return t
      this.error = true
      return ft
    }
    ft++
    const s = this.decode(ft)
    this.update(s, s + 1, ft)
    return s
  }

  /** Raw bits from the end of the packet. */
  bits(count: number): number {
    let window = this.endWindow
    let available = this.endBits
    if (available < count) {
      do {
        window = (window | (this.readByteFromEnd() << available)) >>> 0
        available += SYM_BITS
      } while (available <= WINDOW_SIZE - SYM_BITS)
    }
    const ret = count === 32 ? window : (window & ((2 ** count) - 1)) >>> 0
    window = count === 32 ? 0 : window >>> count
    available -= count
    this.endWindow = window
    this.endBits = available
    this.nbitsTotal += count
    return ret
  }

  /** Bits used so far, rounded up. */
  tell(): number {
    return this.nbitsTotal - ilog(this.rng)
  }

  /** Bits used so far, in 1/8 bits. */
  tellFrac(): number {
    const correction = [35733, 38967, 42495, 46340, 50535, 55109, 60097, 65535]
    const nbits = this.nbitsTotal * 8
    let l = ilog(this.rng)
    const r = this.rng >>> (l - 16)
    let b = (r >>> 12) - 8
    b += r > correction[b] ? 1 : 0
    l = l * 8 + b
    return nbits - l
  }

  /** CELT's Laplace-distributed energy deltas. */
  laplace(fsIn: number, decay: number): number {
    let val = 0
    let fs = fsIn
    const fm = this.decodeBin(15)
    let fl = 0
    if (fm >= fs) {
      val++
      fl = fs
      fs = laplaceFreq1(fs, decay) + 1
      while (fs > 1 && fm >= fl + 2 * fs) {
        fs *= 2
        fl += fs
        fs = ((fs - 2) * decay) >> 15
        fs += 1
        val++
      }
      if (fs <= 1) {
        const di = (fm - fl) >> 1
        val += di
        fl += 2 * di
      }
      if (fm < fl + fs)
        val = -val
      else
        fl += fs
    }
    this.update(fl, Math.min(fl + fs, 32768), 32768)
    return val
  }
}

function laplaceFreq1(fs0: number, decay: number): number {
  const ft = 32768 - 2 * 16 - fs0
  return (ft * (16384 - decay)) >> 15
}
