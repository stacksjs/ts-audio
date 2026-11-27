/**
 * MPEG audio Layer III (MP3) in floating point: ISO/IEC 11172-3 (MPEG-1),
 * 13818-3 (MPEG-2's lower sampling rates) and the MPEG 2.5 extension.
 *
 * One frame at a time: the header, side information, the bit reservoir,
 * scale factors, Huffman decoding, requantisation, joint stereo, alias
 * reduction, the IMDCT and the polyphase synthesis filterbank.
 */

import type { Mp3Codebook } from './mp3-tables'
import { MP3_LONG_BANDS, MP3_LSF_PARTITIONS, MP3_PAIR_CODEBOOKS, MP3_QUAD_CODEBOOK_A, MP3_SHORT_BANDS, MP3_SYNTHESIS_WINDOW } from './mp3-tables'

export class Mp3DecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Mp3DecodeError'
  }
}

// ---------------------------------------------------------------------------
// Frame header

export interface Mp3FrameHeader {
  /** 1, 2 or 2.5. */
  version: 1 | 2 | 2.5
  layer: 1 | 2 | 3
  hasCrc: boolean
  /** Bits per second; 0 for free format. */
  bitrate: number
  sampleRate: number
  /** Index into the band tables: 0-2 MPEG-1, 3-5 MPEG-2, 6-8 MPEG 2.5. */
  rateIndex: number
  padding: boolean
  /** 0 stereo, 1 joint stereo, 2 dual channel, 3 mono. */
  mode: number
  modeExtension: number
  channels: 1 | 2
  /** Bytes, header included; 0 for free format, whose length the header does not give. */
  frameLength: number
  /** Samples per channel. */
  samples: number
}

const BITRATES_V1 = [
  [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
]
const BITRATES_V2 = [
  [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
]
const SAMPLE_RATES = [44100, 48000, 32000, 22050, 24000, 16000, 11025, 12000, 8000]

/** The MPEG audio frame header at `at`, or null when the bytes there are not one. */
export function parseMp3Header(bytes: Uint8Array, at: number): Mp3FrameHeader | null {
  if (at + 4 > bytes.length || bytes[at] !== 0xFF || (bytes[at + 1] & 0xE0) !== 0xE0)
    return null
  const b1 = bytes[at + 1]
  const b2 = bytes[at + 2]
  const b3 = bytes[at + 3]
  const versionBits = (b1 >> 3) & 3
  const layerBits = (b1 >> 1) & 3
  const bitrateIndex = b2 >> 4
  const rateBits = (b2 >> 2) & 3
  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 15 || rateBits === 3 || (b3 & 3) === 2)
    return null
  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5
  const layer = (4 - layerBits) as 1 | 2 | 3
  const rateIndex = (version === 1 ? 0 : version === 2 ? 3 : 6) + rateBits
  const sampleRate = SAMPLE_RATES[rateIndex]
  const bitrate = (version === 1 ? BITRATES_V1 : BITRATES_V2)[layer - 1][bitrateIndex] * 1000
  const padding = ((b2 >> 1) & 1) === 1
  const mode = b3 >> 6
  const samples = layer === 1 ? 384 : layer === 3 && version !== 1 ? 576 : 1152
  let frameLength = 0
  if (bitrate) {
    frameLength = layer === 1
      ? (Math.floor(12 * bitrate / sampleRate) + (padding ? 1 : 0)) * 4
      : Math.floor(samples / 8 * bitrate / sampleRate) + (padding ? 1 : 0)
  }
  return {
    version,
    layer,
    hasCrc: (b1 & 1) === 0,
    bitrate,
    sampleRate,
    rateIndex,
    padding,
    mode,
    modeExtension: (b3 >> 4) & 3,
    channels: mode === 3 ? 1 : 2,
    frameLength,
    samples,
  }
}

/** Bytes of Layer III side information after the header (and CRC). */
export function mp3SideInfoLength(header: Mp3FrameHeader): number {
  if (header.version === 1)
    return header.channels === 1 ? 17 : 32
  return header.channels === 1 ? 9 : 17
}

// ---------------------------------------------------------------------------
// Bits

class BitReader {
  pos = 0

  constructor(readonly data: Uint8Array) {}

  /** Up to 24 bits; past the end reads zeros. */
  read(n: number): number {
    if (n === 0)
      return 0
    const d = this.data
    const byte = this.pos >> 3
    const word = ((d[byte] << 24) | (d[byte + 1] << 16) | (d[byte + 2] << 8) | d[byte + 3]) >>> 0
    this.pos += n
    return ((word << (this.pos - n - (byte << 3))) >>> 0) >>> (32 - n)
  }

  bit(): number {
    const pos = this.pos++
    return (this.data[pos >> 3] >> (7 - (pos & 7))) & 1
  }
}

// ---------------------------------------------------------------------------
// Huffman

/** A codebook as a binary tree: node n's children at 2n and 2n+1; a leaf holds -(value + 1). */
function buildTree(codebook: Mp3Codebook): Int32Array {
  const tree = new Int32Array(codebook.values.length * 4)
  let next = 1
  for (let i = 0; i < codebook.values.length; i++) {
    const code = codebook.codes[i]
    let node = 0
    for (let b = codebook.lengths[i] - 1; b >= 0; b--) {
      const slot = node * 2 + ((code >> b) & 1)
      if (b === 0) {
        tree[slot] = -(codebook.values[i] + 1)
      }
      else {
        if (tree[slot] === 0)
          tree[slot] = next++
        node = tree[slot]
      }
    }
  }
  return tree
}

function decodeTree(tree: Int32Array, reader: BitReader): number {
  let node = 0
  for (;;) {
    const child = tree[node * 2 + reader.bit()]
    if (child < 0)
      return -child - 1
    node = child
  }
}

const LINBITS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 6, 8, 10, 13, 4, 5, 6, 7, 8, 9, 11, 13]
let pairTrees: (Int32Array | null)[] | null = null
let quadTree: Int32Array | null = null

function trees(): { pairs: (Int32Array | null)[], quad: Int32Array } {
  if (!pairTrees) {
    pairTrees = Array.from({ length: 32 }, (_, table) => {
      const source = table < 16 ? table : table < 24 ? 16 : 24
      const codebook = MP3_PAIR_CODEBOOKS[source]
      return codebook ? buildTree(codebook) : null
    })
    quadTree = buildTree(MP3_QUAD_CODEBOOK_A)
  }
  return { pairs: pairTrees, quad: quadTree! }
}

// ---------------------------------------------------------------------------
// Constant tables

/** MPEG-1 scale factor lengths by scalefac_compress. */
const SLEN = [[0, 0], [0, 1], [0, 2], [0, 3], [3, 0], [1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3], [3, 1], [3, 2], [3, 3], [4, 2], [4, 3]]
const PRETAB = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 3, 2, 0]

interface Constants {
  pow43: Float64Array
  cs: Float64Array
  ca: Float64Array
  /** cos for the 36-point IMDCT, [i * 18 + k]. */
  cos36: Float64Array
  /** cos for the 12-point IMDCT, [i * 6 + k]. */
  cos12: Float64Array
  /** Windows for block types 0, 1 and 3 (36 points) and 2 (12 points). */
  windows: Float64Array[]
  synthesis: Float64Array
  dctCoefficients: Float64Array[]
}

let constants: Constants | null = null

function getConstants(): Constants {
  if (constants)
    return constants
  const pow43 = new Float64Array(8207)
  for (let i = 0; i < pow43.length; i++) pow43[i] = i ** (4 / 3)
  const alias = [-0.6, -0.535, -0.33, -0.185, -0.095, -0.041, -0.0142, -0.0037]
  const cs = new Float64Array(alias.map(c => 1 / Math.sqrt(1 + c * c)))
  const ca = new Float64Array(alias.map(c => c / Math.sqrt(1 + c * c)))
  const cos36 = new Float64Array(36 * 18)
  for (let i = 0; i < 36; i++) {
    for (let k = 0; k < 18; k++) cos36[i * 18 + k] = Math.cos(Math.PI / 72 * (2 * i + 19) * (2 * k + 1))
  }
  const cos12 = new Float64Array(12 * 6)
  for (let i = 0; i < 12; i++) {
    for (let k = 0; k < 6; k++) cos12[i * 6 + k] = Math.cos(Math.PI / 24 * (2 * i + 7) * (2 * k + 1))
  }
  const normal = new Float64Array(36)
  const start = new Float64Array(36)
  const stop = new Float64Array(36)
  for (let i = 0; i < 36; i++) normal[i] = Math.sin(Math.PI / 36 * (i + 0.5))
  for (let i = 0; i < 18; i++) start[i] = normal[i]
  for (let i = 18; i < 24; i++) start[i] = 1
  for (let i = 24; i < 30; i++) start[i] = Math.sin(Math.PI / 12 * (i - 18 + 0.5))
  for (let i = 6; i < 12; i++) stop[i] = Math.sin(Math.PI / 12 * (i - 6 + 0.5))
  for (let i = 12; i < 18; i++) stop[i] = 1
  for (let i = 18; i < 36; i++) stop[i] = normal[i]
  const short = new Float64Array(12)
  for (let i = 0; i < 12; i++) short[i] = Math.sin(Math.PI / 12 * (i + 0.5))
  const synthesis = new Float64Array(512)
  for (let i = 0; i < 512; i++) synthesis[i] = MP3_SYNTHESIS_WINDOW[i] / 65536
  const dctCoefficients: Float64Array[] = []
  for (let n = 2; n <= 32; n *= 2) {
    const c = new Float64Array(n / 2)
    for (let k = 0; k < n / 2; k++) c[k] = 1 / (2 * Math.cos((2 * k + 1) * Math.PI / (2 * n)))
    dctCoefficients[n] = c
  }
  constants = { pow43, cs, ca, cos36, cos12, windows: [normal, start, short, stop], synthesis, dctCoefficients }
  return constants
}

// ---------------------------------------------------------------------------
// Side information

interface GranuleChannel {
  part23Length: number
  bigValues: number
  globalGain: number
  scalefacCompress: number
  windowSwitching: boolean
  blockType: number
  mixed: boolean
  tableSelect: number[]
  subblockGain: number[]
  region0Count: number
  region1Count: number
  preflag: boolean
  scalefacScale: boolean
  count1Table: number
}

interface SideInfo {
  mainDataBegin: number
  scfsi: number[][]
  granules: GranuleChannel[][]
}

function readSideInfo(reader: BitReader, header: Mp3FrameHeader): SideInfo {
  const mpeg1 = header.version === 1
  const channels = header.channels
  const mainDataBegin = reader.read(mpeg1 ? 9 : 8)
  reader.read(mpeg1 ? (channels === 1 ? 5 : 3) : (channels === 1 ? 1 : 2))
  const scfsi: number[][] = []
  for (let ch = 0; ch < channels; ch++) scfsi.push(mpeg1 ? [reader.read(1), reader.read(1), reader.read(1), reader.read(1)] : [0, 0, 0, 0])
  const granules: GranuleChannel[][] = []
  for (let gr = 0; gr < (mpeg1 ? 2 : 1); gr++) {
    const row: GranuleChannel[] = []
    for (let ch = 0; ch < channels; ch++) {
      const part23Length = reader.read(12)
      const bigValues = reader.read(9)
      const globalGain = reader.read(8)
      const scalefacCompress = reader.read(mpeg1 ? 4 : 9)
      const windowSwitching = reader.read(1) === 1
      let blockType = 0
      let mixed = false
      let tableSelect: number[]
      const subblockGain = [0, 0, 0]
      let region0Count: number
      let region1Count: number
      if (windowSwitching) {
        blockType = reader.read(2)
        mixed = reader.read(1) === 1
        tableSelect = [reader.read(5), reader.read(5), 0]
        for (let w = 0; w < 3; w++) subblockGain[w] = reader.read(3)
        region0Count = blockType === 2 && !mixed ? 8 : 7
        region1Count = 36
      }
      else {
        tableSelect = [reader.read(5), reader.read(5), reader.read(5)]
        region0Count = reader.read(4)
        region1Count = reader.read(3)
      }
      const preflag = mpeg1 ? reader.read(1) === 1 : false
      const scalefacScale = reader.read(1) === 1
      const count1Table = reader.read(1)
      if (bigValues > 288)
        throw new Mp3DecodeError('A granule claims more than 576 values')
      if (windowSwitching && blockType === 0)
        throw new Mp3DecodeError('A switched window with block type 0')
      row.push({ part23Length, bigValues, globalGain, scalefacCompress, windowSwitching, blockType, mixed, tableSelect, subblockGain, region0Count, region1Count, preflag, scalefacScale, count1Table })
    }
    granules.push(row)
  }
  return { mainDataBegin, scfsi, granules }
}

// ---------------------------------------------------------------------------
// The decoder

/** Scale factors of one channel: long bands 0-21, short bands 0-12 by window ([sfb * 3 + w]). */
interface ScaleFactors {
  long: Int32Array
  short: Int32Array
  /** MPEG-2 intensity stereo: the band's position is the illegal one (the right channel only). */
  illegalLong: Uint8Array
  illegalShort: Uint8Array
}

function newScaleFactors(): ScaleFactors {
  return { long: new Int32Array(22), short: new Int32Array(39), illegalLong: new Uint8Array(22), illegalShort: new Uint8Array(39) }
}

const SQRT1_2 = Math.SQRT1_2

/** Decodes MP3 frames in order, keeping the bit reservoir and the filterbanks' state between them. */
export class Mp3Decoder {
  private reservoir = new Uint8Array(0)
  private readonly overlap = [new Float64Array(576), new Float64Array(576)]
  private readonly history = [new Float64Array(1024), new Float64Array(1024)]
  private readonly historyOffset = [0, 0]
  private readonly scalefactors = [newScaleFactors(), newScaleFactors()]
  private readonly values = [new Int32Array(576), new Int32Array(576)]
  private readonly xr = [new Float64Array(576), new Float64Array(576)]
  private readonly reordered = new Float64Array(576)
  private readonly subbands = new Float64Array(576)
  private readonly slot = new Float64Array(32)
  private readonly dctOut = new Float64Array(32)
  private readonly dctScratch: Float64Array[] = []
  private readonly imdctOut = new Float64Array(36)
  private readonly shortOut = new Float64Array(12)
  private readonly counts = [0, 0]

  constructor() {
    for (let n = 2; n <= 32; n *= 2) this.dctScratch[n] = new Float64Array(2 * n)
  }

  /**
   * One whole frame, header first, to planar samples at its rate. A frame
   * whose main data begins in bytes this decoder has not seen (the first
   * frames after a cut) decodes to silence.
   */
  decodeFrame(frame: Uint8Array): { sampleRate: number, channels: Float32Array[] } {
    const header = parseMp3Header(frame, 0)
    if (!header)
      throw new Mp3DecodeError('Not an MPEG audio frame')
    if (header.layer !== 3)
      throw new Mp3DecodeError(`MPEG audio Layer ${header.layer === 1 ? 'I' : 'II'} is not Layer III`)
    const sideStart = 4 + (header.hasCrc ? 2 : 0)
    const sideLength = mp3SideInfoLength(header)
    if (frame.length < sideStart + sideLength)
      throw new Mp3DecodeError('The frame is shorter than its side information')
    const side = readSideInfo(new BitReader(frame.subarray(sideStart, sideStart + sideLength)), header)
    const own = frame.subarray(sideStart + sideLength)
    const available = this.reservoir.length >= side.mainDataBegin
    const main = new Uint8Array((available ? side.mainDataBegin : 0) + own.length + 4)
    if (available)
      main.set(this.reservoir.subarray(this.reservoir.length - side.mainDataBegin))
    main.set(own, available ? side.mainDataBegin : 0)
    // Keep what a later frame can point back to (at most 511 bytes), whatever happens to this one.
    const kept = new Uint8Array(Math.min(this.reservoir.length + own.length, 4096))
    const fromOld = kept.length - own.length
    if (fromOld > 0)
      kept.set(this.reservoir.subarray(this.reservoir.length - fromOld))
    kept.set(own.subarray(Math.max(0, own.length - kept.length)), Math.max(0, fromOld))
    this.reservoir = kept

    const channels = header.channels
    const out = Array.from({ length: channels }, () => new Float32Array(header.samples))
    const reader = new BitReader(main)
    for (let gr = 0; gr < side.granules.length; gr++) {
      for (let ch = 0; ch < channels; ch++) {
        const info = side.granules[gr][ch]
        if (!available) {
          this.values[ch].fill(0)
          this.counts[ch] = 0
          this.xr[ch].fill(0)
          continue
        }
        const start = reader.pos
        if (header.version === 1)
          this.readScaleFactors(reader, info, side.scfsi[ch], gr, ch)
        else
          this.readLsfScaleFactors(reader, info, ch, header)
        this.readHuffman(reader, info, header, start + info.part23Length, ch)
        reader.pos = start + info.part23Length
        this.requantize(info, header, ch)
      }
      if (available && channels === 2 && header.mode === 1)
        this.stereo(side.granules[gr], header)
      for (let ch = 0; ch < channels; ch++) this.synthesize(side.granules[gr][ch], header, ch, out[ch], gr * 576)
    }
    return { sampleRate: header.sampleRate, channels: out }
  }

  private readScaleFactors(reader: BitReader, info: GranuleChannel, scfsi: number[], gr: number, ch: number): void {
    const sf = this.scalefactors[ch]
    const [slen1, slen2] = SLEN[info.scalefacCompress]
    if (info.windowSwitching && info.blockType === 2) {
      if (info.mixed) {
        for (let sfb = 0; sfb < 8; sfb++) sf.long[sfb] = reader.read(slen1)
        for (let sfb = 3; sfb < 12; sfb++) {
          for (let w = 0; w < 3; w++) sf.short[sfb * 3 + w] = reader.read(sfb < 6 ? slen1 : slen2)
        }
      }
      else {
        for (let sfb = 0; sfb < 12; sfb++) {
          for (let w = 0; w < 3; w++) sf.short[sfb * 3 + w] = reader.read(sfb < 6 ? slen1 : slen2)
        }
      }
      sf.short[36] = sf.short[37] = sf.short[38] = 0
      return
    }
    const groups = [0, 6, 11, 16, 21]
    for (let g = 0; g < 4; g++) {
      if (gr === 1 && scfsi[g])
        continue
      for (let sfb = groups[g]; sfb < groups[g + 1]; sfb++) sf.long[sfb] = reader.read(g < 2 ? slen1 : slen2)
    }
    sf.long[21] = 0
  }

  private readLsfScaleFactors(reader: BitReader, info: GranuleChannel, ch: number, header: Mp3FrameHeader): void {
    const sf = this.scalefactors[ch]
    const intensityRight = ch === 1 && header.mode === 1 && (header.modeExtension & 1) === 1
    let sfc = info.scalefacCompress
    let slen: number[]
    let table: number
    if (!intensityRight) {
      if (sfc < 400) {
        slen = [Math.floor((sfc >> 4) / 5), (sfc >> 4) % 5, (sfc & 15) >> 2, sfc & 3]
        table = 0
      }
      else if (sfc < 500) {
        sfc -= 400
        slen = [Math.floor((sfc >> 2) / 5), (sfc >> 2) % 5, sfc & 3, 0]
        table = 1
      }
      else {
        sfc -= 500
        slen = [Math.floor(sfc / 3), sfc % 3, 0, 0]
        table = 2
        info.preflag = true
      }
    }
    else {
      sfc >>= 1
      if (sfc < 180) {
        slen = [Math.floor(sfc / 36), Math.floor((sfc % 36) / 6), (sfc % 36) % 6, 0]
        table = 3
      }
      else if (sfc < 244) {
        sfc -= 180
        slen = [(sfc & 63) >> 4, (sfc & 15) >> 2, sfc & 3, 0]
        table = 4
      }
      else {
        sfc -= 244
        slen = [Math.floor(sfc / 3), sfc % 3, 0, 0]
        table = 5
      }
    }
    const kind = info.windowSwitching && info.blockType === 2 ? (info.mixed ? 2 : 1) : 0
    const counts = MP3_LSF_PARTITIONS[table][kind]
    sf.long.fill(0)
    sf.short.fill(0)
    sf.illegalLong.fill(0)
    sf.illegalShort.fill(0)
    let entry = 0
    for (let part = 0; part < 4; part++) {
      const bits = slen[part]
      const max = (1 << bits) - 1
      for (let i = 0; i < counts[part]; i++, entry++) {
        const value = reader.read(bits)
        const illegal = value === max ? 1 : 0
        if (kind === 0) {
          sf.long[entry] = value
          sf.illegalLong[entry] = illegal
        }
        else if (kind === 1) {
          sf.short[entry] = value
          sf.illegalShort[entry] = illegal
        }
        else if (entry < 6) {
          sf.long[entry] = value
          sf.illegalLong[entry] = illegal
        }
        else {
          sf.short[entry - 6 + 9] = value
          sf.illegalShort[entry - 6 + 9] = illegal
        }
      }
    }
  }

  private readHuffman(reader: BitReader, info: GranuleChannel, header: Mp3FrameHeader, end: number, ch: number): void {
    const { pairs, quad } = trees()
    const values = this.values[ch]
    values.fill(0)
    const bigEnd = info.bigValues * 2
    let region1: number
    let region2: number
    if (info.windowSwitching) {
      // Region 0 is the first region0Count + 1 bands of the block's own band list; region 1 the rest.
      const bands = granuleBands(info, header)
      region1 = 0
      for (let b = 0; b <= info.region0Count && b < bands.length; b++) region1 += bands[b].end - bands[b].start
      region2 = 576
    }
    else {
      const bands = MP3_LONG_BANDS[header.rateIndex]
      region1 = bands[Math.min(info.region0Count + 1, 22)]
      region2 = bands[Math.min(info.region0Count + info.region1Count + 2, 22)]
    }
    let i = 0
    for (; i < bigEnd; i += 2) {
      const table = info.tableSelect[i < region1 ? 0 : i < region2 ? 1 : 2]
      if (table === 0)
        continue
      const tree = pairs[table]
      if (!tree)
        throw new Mp3DecodeError(`Huffman table ${table} does not exist`)
      const linbits = LINBITS[table]
      const pair = decodeTree(tree, reader)
      let x = pair >> 4
      let y = pair & 15
      if (linbits && x === 15)
        x += reader.read(linbits)
      if (x && reader.bit())
        x = -x
      if (linbits && y === 15)
        y += reader.read(linbits)
      if (y && reader.bit())
        y = -y
      values[i] = x
      values[i + 1] = y
    }
    // The count1 region, four values of -1, 0 or 1 at a time, until the granule's bits run out.
    while (i + 4 <= 576 && reader.pos < end) {
      const quadruple = info.count1Table ? 15 - reader.read(4) : decodeTree(quad, reader)
      let v = 0
      let w = 0
      let x = 0
      let y = 0
      if (quadruple & 8)
        v = reader.bit() ? -1 : 1
      if (quadruple & 4)
        w = reader.bit() ? -1 : 1
      if (quadruple & 2)
        x = reader.bit() ? -1 : 1
      if (quadruple & 1)
        y = reader.bit() ? -1 : 1
      // A codeword that runs past the granule's end is not part of it.
      if (reader.pos > end)
        break
      values[i] = v
      values[i + 1] = w
      values[i + 2] = x
      values[i + 3] = y
      i += 4
    }
    this.counts[ch] = i
  }

  private requantize(info: GranuleChannel, header: Mp3FrameHeader, ch: number): void {
    const { pow43 } = getConstants()
    const values = this.values[ch]
    const xr = this.xr[ch]
    const sf = this.scalefactors[ch]
    const count = this.counts[ch]
    xr.fill(0)
    const multiplier = info.scalefacScale ? 1 : 0.5
    const gain = 0.25 * (info.globalGain - 210)
    const longBands = MP3_LONG_BANDS[header.rateIndex]
    const shortBands = MP3_SHORT_BANDS[header.rateIndex]
    const value = (is: number, exponent: number): number => {
      if (is === 0)
        return 0
      const magnitude = pow43[Math.min(Math.abs(is), 8206)] * 2 ** exponent
      return is < 0 ? -magnitude : magnitude
    }
    const short = info.windowSwitching && info.blockType === 2
    let line = 0
    if (!short || info.mixed) {
      const lastLong = short ? (header.version === 1 ? 8 : 6) : 22
      for (let sfb = 0; sfb < lastLong && line < count; sfb++) {
        const exponent = gain - multiplier * (sf.long[sfb] + (info.preflag ? PRETAB[sfb] : 0))
        for (const end = Math.min(longBands[sfb + 1], count); line < end; line++) xr[line] = value(values[line], exponent)
      }
    }
    if (short) {
      if (info.mixed && header.rateIndex === 8)
        throw new Mp3DecodeError('Mixed blocks at 8 kHz are not supported')
      for (let sfb = info.mixed ? 3 : 0; sfb < 13 && line < count; sfb++) {
        const width = shortBands[sfb + 1] - shortBands[sfb]
        for (let w = 0; w < 3; w++) {
          const exponent = gain - 2 * info.subblockGain[w] - multiplier * sf.short[sfb * 3 + w]
          for (let k = 0; k < width && line < count; k++, line++) xr[line] = value(values[line], exponent)
        }
      }
    }
  }

  /** Joint stereo on one granule, in the bitstream's order of lines. */
  private stereo(granule: GranuleChannel[], header: Mp3FrameHeader): void {
    const [left, right] = this.xr
    const ms = (header.modeExtension & 2) !== 0
    const intensity = (header.modeExtension & 1) !== 0
    const end = Math.max(this.counts[0], this.counts[1])
    if (!intensity) {
      if (ms) {
        for (let i = 0; i < end; i++) {
          const m = left[i]
          const s = right[i]
          left[i] = (m + s) * SQRT1_2
          right[i] = (m - s) * SQRT1_2
        }
      }
      return
    }
    const info = granule[1]
    if (granule[0].blockType !== info.blockType || granule[0].mixed !== info.mixed || granule[0].windowSwitching !== info.windowSwitching)
      throw new Mp3DecodeError('Intensity stereo between channels with different block types')
    // Each band of the right channel in bitstream order: [start, end, scale factor index, short].
    const bands = granuleBands(info, header)
    const intensityBand = new Uint8Array(bands.length)
    const zero = (start: number, stop: number): boolean => {
      for (let i = start; i < stop; i++) {
        if (right[i] !== 0)
          return false
      }
      return true
    }
    const isShort = info.windowSwitching && info.blockType === 2
    if (isShort) {
      // Per window: the bands above the window's last non-zero band.
      for (let w = 0; w < 3; w++) {
        for (let b = bands.length - 1; b >= 0; b--) {
          const band = bands[b]
          if (!band.short || band.window !== w)
            continue
          if (!zero(band.start, band.end))
            break
          intensityBand[b] = 1
        }
      }
      if (info.mixed) {
        // The long part takes part only when the whole short part is silent.
        const shortSilent = bands.every((band, b) => !band.short || intensityBand[b])
        if (shortSilent) {
          for (let b = bands.length - 1; b >= 0; b--) {
            const band = bands[b]
            if (band.short)
              continue
            if (!zero(band.start, band.end))
              break
            intensityBand[b] = 1
          }
        }
      }
    }
    else {
      for (let b = bands.length - 1; b >= 0; b--) {
        if (!zero(bands[b].start, bands[b].end))
          break
        intensityBand[b] = 1
      }
    }
    const sf = this.scalefactors[1]
    const mpeg1 = header.version === 1
    const lsfScale = (info.scalefacCompress & 1) ? SQRT1_2 : 2 ** -0.25
    for (let b = 0; b < bands.length; b++) {
      const band = bands[b]
      let position = -1
      if (intensityBand[b]) {
        if (mpeg1) {
          // The last band carries no position of its own: it takes the one below.
          const index = band.short ? Math.min(band.sfb, 11) * 3 + band.window : Math.min(band.sfb, 20)
          const value = band.short ? sf.short[index] : sf.long[index]
          if (value !== 7)
            position = value
        }
        else {
          const index = band.short ? band.sfb * 3 + band.window : band.sfb
          const illegal = band.short ? sf.illegalShort[index] : sf.illegalLong[index]
          if (!illegal)
            position = band.short ? sf.short[index] : sf.long[index]
        }
      }
      if (position < 0) {
        if (ms) {
          for (let i = band.start; i < band.end; i++) {
            const m = left[i]
            const s = right[i]
            left[i] = (m + s) * SQRT1_2
            right[i] = (m - s) * SQRT1_2
          }
        }
        continue
      }
      let kl: number
      let kr: number
      if (mpeg1) {
        if (position === 6) {
          kl = 1
          kr = 0
        }
        else {
          const ratio = Math.tan(position * Math.PI / 12)
          kl = ratio / (1 + ratio)
          kr = 1 / (1 + ratio)
        }
      }
      else if (position === 0) {
        kl = kr = 1
      }
      else if (position & 1) {
        kl = lsfScale ** ((position + 1) >> 1)
        kr = 1
      }
      else {
        kl = 1
        kr = lsfScale ** (position >> 1)
      }
      for (let i = band.start; i < band.end; i++) {
        const m = left[i]
        left[i] = m * kl
        right[i] = m * kr
      }
    }
    this.counts[0] = this.counts[1] = 576
  }

  /** Reorder, alias reduction, IMDCT, overlap, frequency inversion and synthesis for one granule of a channel. */
  private synthesize(info: GranuleChannel, header: Mp3FrameHeader, ch: number, out: Float32Array, offset: number): void {
    const c = getConstants()
    let xr = this.xr[ch]
    const short = info.windowSwitching && info.blockType === 2
    if (short) {
      // Short bands arrive window by window; the IMDCT wants each line's three windows together.
      const shortBands = MP3_SHORT_BANDS[header.rateIndex]
      const reordered = this.reordered
      const firstShort = info.mixed ? 3 : 0
      const longEnd = info.mixed ? 36 : 0
      reordered.set(xr.subarray(0, longEnd))
      for (let sfb = firstShort; sfb < 13; sfb++) {
        const start = shortBands[sfb]
        const width = shortBands[sfb + 1] - start
        for (let w = 0; w < 3; w++) {
          for (let k = 0; k < width; k++) reordered[3 * (start + k) + w] = xr[3 * start + w * width + k]
        }
      }
      xr = reordered
    }
    // Alias reduction between long-block subbands: all of them, or the first two of a mixed block.
    const aliasLimit = short ? (info.mixed ? 2 : 0) : 32
    for (let sb = 1; sb < aliasLimit; sb++) {
      for (let i = 0; i < 8; i++) {
        const lo = 18 * sb - 1 - i
        const hi = 18 * sb + i
        const a = xr[lo]
        const b = xr[hi]
        xr[lo] = a * c.cs[i] - b * c.ca[i]
        xr[hi] = b * c.cs[i] + a * c.ca[i]
      }
    }
    const overlap = this.overlap[ch]
    const subbands = this.subbands
    const z = this.imdctOut
    for (let sb = 0; sb < 32; sb++) {
      const base = sb * 18
      let silent = true
      for (let k = 0; k < 18; k++) {
        if (xr[base + k] !== 0) {
          silent = false
          break
        }
      }
      const blockType = info.windowSwitching && !(info.mixed && sb < 2) ? info.blockType : 0
      if (silent) {
        z.fill(0)
      }
      else if (blockType === 2) {
        z.fill(0)
        const y = this.shortOut
        const window = c.windows[2]
        for (let w = 0; w < 3; w++) {
          for (let i = 0; i < 12; i++) {
            let sum = 0
            for (let k = 0; k < 6; k++) sum += xr[base + 3 * k + w] * c.cos12[i * 6 + k]
            y[i] = sum * window[i]
          }
          for (let i = 0; i < 12; i++) z[6 + 6 * w + i] += y[i]
        }
      }
      else {
        const window = c.windows[blockType]
        for (let i = 0; i < 36; i++) {
          let sum = 0
          const row = i * 18
          for (let k = 0; k < 18; k++) sum += xr[base + k] * c.cos36[row + k]
          z[i] = sum * window[i]
        }
      }
      for (let i = 0; i < 18; i++) {
        let sample = z[i] + overlap[base + i]
        overlap[base + i] = z[i + 18]
        if (sb & i & 1)
          sample = -sample
        subbands[i * 32 + sb] = sample
      }
    }
    for (let t = 0; t < 18; t++) this.synthesisSlot(ch, subbands, t * 32, out, offset + t * 32)
  }

  /** The polyphase filterbank: 32 subband samples to 32 output samples. */
  private synthesisSlot(ch: number, input: Float64Array, inOffset: number, out: Float32Array, outOffset: number): void {
    const { synthesis } = getConstants()
    const slot = this.slot
    for (let i = 0; i < 32; i++) slot[i] = input[inOffset + i]
    const x = this.dctOut
    this.dct(slot, 0, 32, x, 0)
    const v = this.history[ch]
    const o = this.historyOffset[ch] = (this.historyOffset[ch] - 64) & 1023
    for (let i = 0; i < 16; i++) v[o + i] = x[i + 16]
    v[o + 16] = 0
    for (let i = 17; i < 48; i++) v[o + i] = -x[48 - i]
    for (let i = 48; i < 64; i++) v[o + i] = -x[i - 48]
    for (let j = 0; j < 32; j++) {
      let sum = 0
      for (let m = 0; m < 8; m++) {
        sum += synthesis[j + 64 * m] * v[(o + 128 * m + j) & 1023]
        sum += synthesis[j + 64 * m + 32] * v[(o + 128 * m + 96 + j) & 1023]
      }
      out[outOffset + j] = sum
    }
  }

  /** DCT-II, X[m] = sum x[k] cos((2k + 1) m pi / 2n), by Lee's halving. */
  private dct(x: Float64Array, xo: number, n: number, y: Float64Array, yo: number): void {
    if (n === 1) {
      y[yo] = x[xo]
      return
    }
    const h = n >> 1
    const s = this.dctScratch[n]
    const c = getConstants().dctCoefficients[n]
    for (let k = 0; k < h; k++) {
      const p = x[xo + k]
      const q = x[xo + n - 1 - k]
      s[k] = p + q
      s[h + k] = (p - q) * c[k]
    }
    this.dct(s, 0, h, s, n)
    this.dct(s, h, h, s, n + h)
    for (let m = 0; m < h; m++) y[yo + 2 * m] = s[n + m]
    for (let m = 0; m < h - 1; m++) y[yo + 2 * m + 1] = s[n + h + m] + s[n + h + m + 1]
    y[yo + n - 1] = s[n + n - 1]
  }
}

interface Band {
  start: number
  end: number
  sfb: number
  short: boolean
  window: number
}

const bandLists = new Map<number, Band[]>()

/** The scale factor bands of a granule, in the bitstream's order of lines. */
function granuleBands(info: GranuleChannel, header: Mp3FrameHeader): Band[] {
  const short = info.windowSwitching && info.blockType === 2
  const key = header.rateIndex * 4 + (short ? (info.mixed ? 2 : 1) : 0) + (header.version === 1 ? 0 : 64)
  let bands = bandLists.get(key)
  if (!bands) {
    bands = listBands(short, info.mixed, header)
    bandLists.set(key, bands)
  }
  return bands
}

function listBands(short: boolean, mixed: boolean, header: Mp3FrameHeader): Band[] {
  const longBands = MP3_LONG_BANDS[header.rateIndex]
  const shortBands = MP3_SHORT_BANDS[header.rateIndex]
  const bands: Band[] = []
  if (!short || mixed) {
    const last = short ? (header.version === 1 ? 8 : 6) : 22
    for (let sfb = 0; sfb < last; sfb++) bands.push({ start: longBands[sfb], end: longBands[sfb + 1], sfb, short: false, window: 0 })
  }
  if (short) {
    for (let sfb = mixed ? 3 : 0; sfb < 13; sfb++) {
      const width = shortBands[sfb + 1] - shortBands[sfb]
      for (let w = 0; w < 3; w++) {
        const start = shortBands[sfb] * 3 + w * width
        bands.push({ start, end: start + width, sfb, short: true, window: w })
      }
    }
  }
  return bands
}
