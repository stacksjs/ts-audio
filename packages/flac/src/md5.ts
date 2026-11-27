/**
 * MD5, incrementally, for the signature FLAC's STREAMINFO carries of its own
 * unencoded audio.
 *
 * Written out rather than taken from the platform: WebCrypto has no MD5, and
 * node:crypto is not everywhere ts-audio runs. MD5 is not used here for
 * security -- only as the checksum the FLAC format specifies.
 */

const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]

/** floor(|sin(i + 1)| * 2^32), which IEEE doubles give exactly. */
const K = Uint32Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32))

export class Md5 {
  private readonly state = new Uint32Array([0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476])
  private readonly block = new Uint8Array(64)
  private readonly words = new Uint32Array(16)
  private filled = 0
  private totalBytes = 0

  update(data: Uint8Array): this {
    let at = 0
    this.totalBytes += data.length
    if (this.filled) {
      const take = Math.min(64 - this.filled, data.length)
      this.block.set(data.subarray(0, take), this.filled)
      this.filled += take
      at = take
      if (this.filled < 64)
        return this
      this.compress(this.block, 0)
      this.filled = 0
    }
    for (; at + 64 <= data.length; at += 64) this.compress(data, at)
    if (at < data.length) {
      this.block.set(data.subarray(at), 0)
      this.filled = data.length - at
    }
    return this
  }

  digest(): Uint8Array {
    const bits = this.totalBytes * 8
    const padLength = this.filled < 56 ? 56 - this.filled : 120 - this.filled
    const padding = new Uint8Array(padLength + 8)
    padding[0] = 0x80
    // The length goes in little-endian, as two 32-bit halves.
    const view = new DataView(padding.buffer)
    view.setUint32(padLength, bits >>> 0, true)
    view.setUint32(padLength + 4, Math.floor(bits / 2 ** 32), true)
    this.update(padding)
    const out = new Uint8Array(16)
    const outView = new DataView(out.buffer)
    for (let i = 0; i < 4; i++) outView.setUint32(i * 4, this.state[i], true)
    return out
  }

  private compress(data: Uint8Array, offset: number): void {
    const w = this.words
    for (let i = 0; i < 16; i++) {
      const p = offset + i * 4
      w[i] = data[p] | (data[p + 1] << 8) | (data[p + 2] << 16) | (data[p + 3] << 24)
    }
    let [a, b, c, d] = this.state
    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      }
      else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      }
      else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      }
      else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }
      const sum = (a + f + K[i] + w[g]) | 0
      a = d
      d = c
      c = b
      b = (b + ((sum << SHIFTS[i]) | (sum >>> (32 - SHIFTS[i])))) | 0
    }
    this.state[0] = (this.state[0] + a) | 0
    this.state[1] = (this.state[1] + b) | 0
    this.state[2] = (this.state[2] + c) | 0
    this.state[3] = (this.state[3] + d) | 0
  }
}
