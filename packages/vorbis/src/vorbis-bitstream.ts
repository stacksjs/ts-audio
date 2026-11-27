/**
 * Vorbis packs its bits the other way round from every other codec here:
 * least significant first within each byte. Running off the end of a packet is
 * a normal event mid-audio -- the encoder stops writing once the rest would be
 * zeros -- so reads past the end return 0 and raise a flag rather than throw,
 * and the header parsing checks that flag instead.
 */

export class VorbisDecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VorbisDecodeError'
  }
}

export class VorbisBitReader {
  private byteAt = 0
  private bitAt = 0
  /** Set once a read has asked for more bits than the packet holds. */
  endOfPacket = false

  constructor(private readonly data: Uint8Array) {}

  get bitsRead(): number {
    return this.byteAt * 8 + this.bitAt
  }

  /** `count` bits, the first read being the least significant. */
  read(count: number): number {
    let value = 0
    let got = 0
    while (got < count) {
      if (this.byteAt >= this.data.length) {
        this.endOfPacket = true
        return value
      }
      const available = 8 - this.bitAt
      const take = Math.min(count - got, available)
      const bits = (this.data[this.byteAt] >> this.bitAt) & ((1 << take) - 1)
      // Multiplied rather than shifted: a 32-bit read would overflow a shift.
      value += bits * 2 ** got
      got += take
      this.bitAt += take
      if (this.bitAt === 8) {
        this.bitAt = 0
        this.byteAt++
      }
    }
    return value
  }

  readBit(): number {
    return this.read(1)
  }

  /** A 32-bit field read as a signed value, which the bitrate hints are. */
  readSigned32(): number {
    return this.read(32) | 0
  }

  /** Throws when the packet ran out, which in a header means it is unusable. */
  requireWithin(what: string): void {
    if (this.endOfPacket)
      throw new VorbisDecodeError(`The Vorbis ${what} ends before it is complete`)
  }
}

/** Vorbis's own 32-bit float layout, which is not IEEE 754. */
export function unpackFloat32(bits: number): number {
  const mantissa = bits & 0x1FFFFF
  const sign = bits & 0x80000000
  const exponent = (bits & 0x7FE00000) >>> 21
  return (sign ? -mantissa : mantissa) * 2 ** (exponent - 788)
}

/** The number of bits needed to hold `value`, and 0 for anything below 1. */
export function ilog(value: number): number {
  let bits = 0
  while (value > 0) {
    bits++
    value >>= 1
  }
  return bits
}

/** The largest r with r ** dimensions <= entries: how many values a type 1 lookup stores. */
export function lookup1Values(entries: number, dimensions: number): number {
  let r = Math.floor(entries ** (1 / dimensions))
  while ((r + 1) ** dimensions <= entries) r++
  while (r ** dimensions > entries) r--
  return r
}
