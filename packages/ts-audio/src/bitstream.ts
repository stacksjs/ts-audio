/**
 * Bit-level reading and writing utilities
 * Essential for parsing audio codec bitstreams (MP3, AAC, etc.)
 */

/**
 * BitReader for reading bits from a byte buffer
 */
export class BitReader {
  private data: Uint8Array
  private bytePos = 0
  private bitPos = 0

  constructor(data: Uint8Array) {
    this.data = data
  }

  get position(): number {
    return this.bytePos * 8 + this.bitPos
  }

  get bytesRemaining(): number {
    return this.data.length - this.bytePos - (this.bitPos > 0 ? 1 : 0)
  }

  get bitsRemaining(): number {
    return (this.data.length - this.bytePos) * 8 - this.bitPos
  }

  readBit(): number {
    if (this.bytePos >= this.data.length) {
      throw new Error('End of buffer')
    }

    const bit = (this.data[this.bytePos] >> (7 - this.bitPos)) & 1
    this.bitPos++

    if (this.bitPos === 8) {
      this.bitPos = 0
      this.bytePos++
    }

    return bit
  }

  readBits(count: number): number {
    if (count > 32) {
      throw new Error('Cannot read more than 32 bits at once')
    }

    let result = 0
    for (let i = 0; i < count; i++) {
      result = (result << 1) | this.readBit()
    }
    return result
  }

  readBitsBigInt(count: number): bigint {
    let result = 0n
    for (let i = 0; i < count; i++) {
      result = (result << 1n) | BigInt(this.readBit())
    }
    return result
  }

  readByte(): number {
    return this.readBits(8)
  }

  readBytes(count: number): Uint8Array {
    const result = new Uint8Array(count)
    for (let i = 0; i < count; i++) {
      result[i] = this.readByte()
    }
    return result
  }

  readU16BE(): number {
    return this.readBits(16)
  }

  readU32BE(): number {
    return this.readBits(32) >>> 0
  }

  skipBits(count: number): void {
    const totalBits = this.bytePos * 8 + this.bitPos + count
    this.bytePos = Math.floor(totalBits / 8)
    this.bitPos = totalBits % 8
  }

  alignToByte(): void {
    if (this.bitPos !== 0) {
      this.bitPos = 0
      this.bytePos++
    }
  }

  seek(bitPosition: number): void {
    this.bytePos = Math.floor(bitPosition / 8)
    this.bitPos = bitPosition % 8
  }

  peek(count: number): number {
    const savedBytePos = this.bytePos
    const savedBitPos = this.bitPos
    const result = this.readBits(count)
    this.bytePos = savedBytePos
    this.bitPos = savedBitPos
    return result
  }

  peekBit(): number {
    if (this.bytePos >= this.data.length) {
      throw new Error('End of buffer')
    }
    return (this.data[this.bytePos] >> (7 - this.bitPos)) & 1
  }

  /**
   * Read unsigned Exp-Golomb coded integer (used in H.264, but also some audio codecs)
   */
  readUExpGolomb(): number {
    let leadingZeros = 0
    while (this.readBit() === 0) {
      leadingZeros++
      if (leadingZeros > 32) {
        throw new Error('Invalid Exp-Golomb code')
      }
    }

    if (leadingZeros === 0) {
      return 0
    }

    const suffix = this.readBits(leadingZeros)
    return (1 << leadingZeros) - 1 + suffix
  }

  /**
   * Read signed Exp-Golomb coded integer
   */
  readSExpGolomb(): number {
    const code = this.readUExpGolomb()
    if (code === 0) return 0
    const sign = (code & 1) === 1 ? 1 : -1
    return sign * Math.ceil(code / 2)
  }

  /**
   * Read unary coded integer
   */
  readUnary(): number {
    let count = 0
    while (this.readBit() === 0) {
      count++
      if (count > 32) {
        throw new Error('Invalid unary code')
      }
    }
    return count
  }

  /**
   * Read Rice coded integer (used in FLAC)
   */
  readRice(param: number): number {
    const quotient = this.readUnary()
    const remainder = this.readBits(param)
    const value = (quotient << param) | remainder
    // Convert from unsigned to signed (zig-zag decoding)
    return (value >> 1) ^ -(value & 1)
  }
}

/**
 * BitWriter for writing bits to a buffer
 */
export class BitWriter {
  private buffers: Uint8Array[] = []
  private currentByte = 0
  private bitPos = 0
  private totalBits = 0

  writeBit(bit: number): void {
    this.currentByte = (this.currentByte << 1) | (bit & 1)
    this.bitPos++
    this.totalBits++

    if (this.bitPos === 8) {
      this.buffers.push(new Uint8Array([this.currentByte]))
      this.currentByte = 0
      this.bitPos = 0
    }
  }

  writeBits(value: number, count: number): void {
    if (count > 32) {
      throw new Error('Cannot write more than 32 bits at once')
    }

    for (let i = count - 1; i >= 0; i--) {
      this.writeBit((value >> i) & 1)
    }
  }

  writeBitsBigInt(value: bigint, count: number): void {
    for (let i = count - 1; i >= 0; i--) {
      this.writeBit(Number((value >> BigInt(i)) & 1n))
    }
  }

  writeByte(value: number): void {
    this.writeBits(value, 8)
  }

  writeBytes(data: Uint8Array): void {
    for (const byte of data) {
      this.writeByte(byte)
    }
  }

  writeU16BE(value: number): void {
    this.writeBits(value, 16)
  }

  writeU32BE(value: number): void {
    this.writeBits(value >>> 0, 32)
  }

  alignToByte(padBit = 0): void {
    while (this.bitPos !== 0) {
      this.writeBit(padBit)
    }
  }

  /**
   * Write unsigned Exp-Golomb coded integer
   */
  writeUExpGolomb(value: number): void {
    if (value === 0) {
      this.writeBit(1)
      return
    }

    const code = value + 1
    const bits = Math.floor(Math.log2(code)) + 1
    const leadingZeros = bits - 1

    // Write leading zeros
    for (let i = 0; i < leadingZeros; i++) {
      this.writeBit(0)
    }

    // Write the code
    this.writeBits(code, bits)
  }

  /**
   * Write signed Exp-Golomb coded integer
   */
  writeSExpGolomb(value: number): void {
    if (value === 0) {
      this.writeUExpGolomb(0)
    } else if (value > 0) {
      this.writeUExpGolomb(value * 2 - 1)
    } else {
      this.writeUExpGolomb(-value * 2)
    }
  }

  /**
   * Write unary coded integer
   */
  writeUnary(value: number): void {
    for (let i = 0; i < value; i++) {
      this.writeBit(0)
    }
    this.writeBit(1)
  }

  /**
   * Write Rice coded integer (used in FLAC)
   */
  writeRice(value: number, param: number): void {
    // Convert from signed to unsigned (zig-zag encoding)
    const unsigned = value >= 0 ? value * 2 : -value * 2 - 1
    const quotient = unsigned >> param
    const remainder = unsigned & ((1 << param) - 1)

    this.writeUnary(quotient)
    this.writeBits(remainder, param)
  }

  get length(): number {
    return Math.ceil(this.totalBits / 8)
  }

  getBuffer(): Uint8Array {
    // Flush remaining bits
    const flushBits = this.bitPos > 0 ? 8 - this.bitPos : 0
    const savedBitPos = this.bitPos

    if (flushBits > 0) {
      for (let i = 0; i < flushBits; i++) {
        this.writeBit(0)
      }
    }

    const totalLength = this.buffers.reduce((sum, buf) => sum + buf.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0

    for (const buf of this.buffers) {
      result.set(buf, offset)
      offset += buf.length
    }

    // Restore state (in case we want to continue writing)
    if (flushBits > 0) {
      this.buffers.pop()
      this.bitPos = savedBitPos
      this.currentByte = result[result.length - 1] >> flushBits
    }

    return result
  }

  reset(): void {
    this.buffers = []
    this.currentByte = 0
    this.bitPos = 0
    this.totalBits = 0
  }
}

/**
 * CRC calculation utilities
 */
export function crc8(data: Uint8Array, poly = 0x07): number {
  let crc = 0
  for (const byte of data) {
    crc ^= byte
    for (let i = 0; i < 8; i++) {
      if (crc & 0x80) {
        crc = ((crc << 1) ^ poly) & 0xFF
      } else {
        crc = (crc << 1) & 0xFF
      }
    }
  }
  return crc
}

export function crc16(data: Uint8Array, poly = 0x8005, init = 0): number {
  let crc = init
  for (const byte of data) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ poly) & 0xFFFF
      } else {
        crc = (crc << 1) & 0xFFFF
      }
    }
  }
  return crc
}

export function crc32(data: Uint8Array, poly = 0xEDB88320, init = 0xFFFFFFFF): number {
  let crc = init
  for (const byte of data) {
    crc ^= byte
    for (let i = 0; i < 8; i++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ poly
      } else {
        crc = crc >>> 1
      }
    }
  }
  return (~crc) >>> 0
}

/**
 * MP3 CRC-16 (used in MP3 frame headers)
 */
export function crc16Mp3(data: Uint8Array): number {
  return crc16(data, 0x8005, 0xFFFF)
}

/**
 * FLAC CRC-8 (used in FLAC frame headers)
 */
export function crc8Flac(data: Uint8Array): number {
  return crc8(data, 0x07)
}

/**
 * FLAC CRC-16 (used in FLAC frame footers)
 */
export function crc16Flac(data: Uint8Array): number {
  let crc = 0
  for (const byte of data) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x8005) & 0xFFFF : (crc << 1) & 0xFFFF
    }
  }
  return crc
}
