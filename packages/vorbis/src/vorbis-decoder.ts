/**
 * A Vorbis I decoder in plain TypeScript: the codec Ogg files have carried
 * since before Opus existed, and still the one behind .ogg.
 *
 * A packet names a mode, which fixes the block size and the window; the floor
 * gives the spectral envelope, the residue the detail; coupled channels are
 * uncoupled, the two are multiplied, and an inverse MDCT and a lapped window
 * turn the result back into samples. The transform is core's, the same one
 * AAC ends its frames with.
 */

import type { VorbisCodebook, VorbisFloor1, VorbisIdentification, VorbisResidue, VorbisSetup } from './vorbis-setup'
import { imdct } from '@ts-audio/core'
import { ilog, VorbisBitReader, VorbisDecodeError } from './vorbis-bitstream'
import { FLOOR1_INVERSE_DB } from './vorbis-floor-table'

export { VorbisDecodeError } from './vorbis-bitstream'

/** The amplitude range a floor's multiplier chooses between. */
const FLOOR1_RANGES = [256, 128, 86, 64]

/** sin(π/2 · sin²((j + ½)/M · π)), the slope both of a window's edges is cut from. */
const slopes = new Map<number, Float32Array>()

function slopeTable(size: number): Float32Array {
  let table = slopes.get(size)
  if (table)
    return table
  table = new Float32Array(size)
  for (let j = 0; j < size; j++) {
    const inner = Math.sin(((j + 0.5) / size) * Math.PI)
    table[j] = Math.sin((Math.PI / 2) * inner * inner)
  }
  slopes.set(size, table)
  return table
}

/** One entry of a codebook, read through its tree. */
function readEntry(reader: VorbisBitReader, tree: Int32Array): number {
  let node = 0
  for (;;) {
    const value = tree[2 * node + reader.readBit()]
    if (value < 0)
      return -value - 1
    if (value === 0 || reader.endOfPacket)
      return -1
    node = value
  }
}

interface WindowShape {
  window: Float32Array
  leftBegin: number
  leftEnd: number
  rightBegin: number
  rightEnd: number
}

const windows = new Map<string, WindowShape>()

/**
 * The window for a block: full-width slopes unless this packet sits next to a
 * short one, in which case the slope on that side narrows to the short block's
 * width so the two laps match.
 */
function windowShape(n: number, leftSize: number, rightSize: number): WindowShape {
  const key = `${n}:${leftSize}:${rightSize}`
  let shape = windows.get(key)
  if (shape)
    return shape
  const leftBegin = n / 4 - leftSize / 4
  const leftEnd = n / 4 + leftSize / 4
  const rightBegin = (3 * n) / 4 - rightSize / 4
  const rightEnd = (3 * n) / 4 + rightSize / 4
  const left = slopeTable(leftSize)
  const right = slopeTable(rightSize)
  const window = new Float32Array(n)
  // Vorbis's inverse transform is the plain cosine sum, where core's imdct --
  // written for AAC -- normalises by 2/N. The N/2 that undoes that is folded
  // into the window, which is built once per block shape and costs nothing.
  const scale = n / 2
  for (let i = leftBegin; i < leftEnd; i++) window[i] = left[i - leftBegin] * scale
  window.fill(scale, leftEnd, rightBegin)
  for (let i = rightBegin; i < rightEnd; i++) window[i] = right[rightSize / 2 + i - rightBegin] * scale
  shape = { window, leftBegin, leftEnd, rightBegin, rightEnd }
  windows.set(key, shape)
  return shape
}

/** What one packet contributed, once the previous packet's tail has been added in. */
export interface VorbisBlock {
  /** One Float32Array per channel; empty for the first packet, which only primes the lap. */
  channels: Float32Array[]
}

export class VorbisDecoder {
  private readonly identification: VorbisIdentification
  private readonly setup: VorbisSetup
  /** The previous packet's windowed samples from its right slope on, per channel. */
  private tail: Float32Array[]
  private tailLength = 0
  private started = false

  constructor(identification: VorbisIdentification, setup: VorbisSetup) {
    this.identification = identification
    this.setup = setup
    if (!setup.modes.length)
      throw new VorbisDecodeError('The Vorbis stream declares no modes')
    this.tail = Array.from({ length: identification.channels }, () => new Float32Array(identification.blockSize1 / 2))
  }

  /** The samples one audio packet completes. */
  decodePacket(packet: Uint8Array): VorbisBlock {
    const reader = new VorbisBitReader(packet)
    if (reader.readBit() !== 0)
      throw new VorbisDecodeError('That Vorbis packet is not an audio packet')

    const { channels, blockSize0, blockSize1 } = this.identification
    const modeNumber = reader.read(ilog(this.setup.modes.length - 1))
    const mode = this.setup.modes[modeNumber]
    if (!mode)
      throw new VorbisDecodeError(`The Vorbis packet names mode ${modeNumber}, which the stream does not define`)

    const n = mode.blockFlag ? blockSize1 : blockSize0
    let leftSize = n
    let rightSize = n
    if (mode.blockFlag) {
      const previousWindow = reader.readBit()
      const nextWindow = reader.readBit()
      if (!previousWindow)
        leftSize = blockSize0
      if (!nextWindow)
        rightSize = blockSize0
    }
    const half = n / 2
    const mapping = this.setup.mappings[mode.mapping]

    // The floor per channel. A channel whose floor is unused is silent unless
    // it is coupled to one that is not.
    const floors: (Float32Array | null)[] = []
    const noResidue: boolean[] = []
    for (let ch = 0; ch < channels; ch++) {
      const floor = this.setup.floors[mapping.submapFloor[mapping.mux[ch]]]
      const curve = decodeFloor1(reader, floor, half, this.setup.codebooks)
      floors.push(curve)
      noResidue.push(curve === null)
    }
    for (let i = 0; i < mapping.couplingMagnitude.length; i++) {
      const a = mapping.couplingMagnitude[i]
      const b = mapping.couplingAngle[i]
      if (!noResidue[a] || !noResidue[b]) {
        noResidue[a] = false
        noResidue[b] = false
      }
    }

    // The residue, by submap, into the spectral vectors.
    const spectrum = Array.from({ length: channels }, () => new Float32Array(half))
    const submaps = mapping.submapFloor.length
    for (let s = 0; s < submaps; s++) {
      const members: number[] = []
      for (let ch = 0; ch < channels; ch++) {
        if (mapping.mux[ch] === s)
          members.push(ch)
      }
      if (!members.length)
        continue
      const residue = this.setup.residues[mapping.submapResidue[s]]
      this.decodeResidue(reader, residue, members.map(ch => spectrum[ch]), members.map(ch => noResidue[ch]), half)
    }

    // Coupled channels hold a magnitude and an angle; this puts the two back.
    for (let i = mapping.couplingMagnitude.length - 1; i >= 0; i--) {
      const magnitude = spectrum[mapping.couplingMagnitude[i]]
      const angle = spectrum[mapping.couplingAngle[i]]
      for (let j = 0; j < half; j++) {
        const m = magnitude[j]
        const a = angle[j]
        let newM = m
        let newA = m
        if (m > 0) {
          if (a > 0) {
            newA = m - a
          }
          else {
            newA = m
            newM = m + a
          }
        }
        else {
          if (a > 0) {
            newA = m + a
          }
          else {
            newA = m
            newM = m - a
          }
        }
        magnitude[j] = newM
        angle[j] = newA
      }
    }

    const shape = windowShape(n, leftSize, rightSize)
    const emitted = shape.rightBegin - shape.leftBegin
    const output: Float32Array[] = []
    const nextTailLength = rightSize / 2

    for (let ch = 0; ch < channels; ch++) {
      const floor = floors[ch]
      const bins = spectrum[ch]
      if (floor) {
        for (let i = 0; i < half; i++) bins[i] *= floor[i]
      }
      else {
        bins.fill(0)
      }
      const samples = imdct(bins)
      const { window, leftBegin, rightBegin } = shape

      if (this.started) {
        const emit = new Float32Array(emitted)
        const tail = this.tail[ch]
        for (let i = 0; i < emitted; i++) {
          const windowed = samples[leftBegin + i] * window[leftBegin + i]
          emit[i] = i < this.tailLength ? windowed + tail[i] : windowed
        }
        output.push(emit)
      }

      const tail = this.tail[ch]
      for (let j = 0; j < nextTailLength; j++) tail[j] = samples[rightBegin + j] * window[rightBegin + j]
    }

    this.tailLength = nextTailLength
    this.started = true
    return { channels: output }
  }

  /** Residue types 0 and 1 go channel by channel; type 2 reads one interleaved vector. */
  private decodeResidue(reader: VorbisBitReader, residue: VorbisResidue, vectors: Float32Array[], skip: boolean[], half: number): void {
    if (residue.type === 2) {
      if (skip.every(Boolean))
        return
      const channels = vectors.length
      const interleaved = new Float32Array(channels * half)
      this.decodePartitions(reader, residue, [interleaved], [false], channels * half)
      for (let i = 0; i < half; i++) {
        for (let ch = 0; ch < channels; ch++) vectors[ch][i] = interleaved[i * channels + ch]
      }
      return
    }
    this.decodePartitions(reader, residue, vectors, skip, half)
  }

  /**
   * The partition loop every residue type shares: eight passes over the
   * vectors, the first also reading each partition's class.
   */
  private decodePartitions(reader: VorbisBitReader, residue: VorbisResidue, vectors: Float32Array[], skip: boolean[], limit: number): void {
    const classbook = this.setup.codebooks[residue.classbook]
    const end = Math.min(residue.end, limit)
    const toRead = end - residue.begin
    if (toRead <= 0)
      return
    const partitions = Math.floor(toRead / residue.partitionSize)
    if (partitions <= 0)
      return
    const classwords = classbook.dimensions
    const classifications = vectors.map(() => new Int32Array(partitions + classwords))

    for (let pass = 0; pass < 8; pass++) {
      let partition = 0
      while (partition < partitions) {
        if (pass === 0) {
          for (let v = 0; v < vectors.length; v++) {
            if (skip[v])
              continue
            let temp = readEntry(reader, classbook.tree)
            if (temp < 0)
              return
            for (let i = classwords - 1; i >= 0; i--) {
              classifications[v][partition + i] = temp % residue.classifications
              temp = Math.floor(temp / residue.classifications)
            }
          }
        }
        for (let word = 0; word < classwords && partition < partitions; word++, partition++) {
          for (let v = 0; v < vectors.length; v++) {
            if (skip[v])
              continue
            const book = residue.books[classifications[v][partition]][pass]
            if (book < 0)
              continue
            const offset = residue.begin + partition * residue.partitionSize
            if (!this.readPartition(reader, this.setup.codebooks[book], residue.type, vectors[v], offset, residue.partitionSize))
              return
          }
        }
      }
    }
  }

  /** One partition's worth of vectors from a codebook, added to what is there. */
  private readPartition(reader: VorbisBitReader, book: { dimensions: number, tree: Int32Array, vectors: Float32Array | null }, type: number, into: Float32Array, offset: number, size: number): boolean {
    const vq = book.vectors
    if (!vq)
      throw new VorbisDecodeError('A Vorbis residue reads a codebook that holds no vectors')
    if (type === 0) {
      const step = Math.floor(size / book.dimensions)
      for (let i = 0; i < step; i++) {
        const entry = readEntry(reader, book.tree)
        if (entry < 0)
          return false
        for (let j = 0; j < book.dimensions; j++) into[offset + i + j * step] += vq[entry * book.dimensions + j]
      }
      return true
    }
    // Types 1 and 2 lay each vector down in order.
    let i = 0
    while (i < size) {
      const entry = readEntry(reader, book.tree)
      if (entry < 0)
        return false
      for (let j = 0; j < book.dimensions && i < size; j++, i++) into[offset + i] += vq[entry * book.dimensions + j]
    }
    return true
  }
}

/**
 * A floor 1 curve, or null where the packet says this channel is silent. The
 * breakpoints are read, each predicted from its neighbours and corrected, then
 * the curve is drawn between them and looked up as an amplitude.
 */
function decodeFloor1(reader: VorbisBitReader, floor: VorbisFloor1, half: number, codebooks: VorbisCodebook[]): Float32Array | null {
  if (!reader.readBit())
    return null
  const range = FLOOR1_RANGES[floor.multiplier - 1]
  const values = floor.xList.length
  const y = new Int32Array(values)
  y[0] = reader.read(ilog(range - 1))
  y[1] = reader.read(ilog(range - 1))

  let offset = 2
  for (let i = 0; i < floor.partitionClasses.length; i++) {
    const cls = floor.partitionClasses[i]
    const dimensions = floor.classDimensions[cls]
    const bits = floor.classSubclasses[cls]
    const mask = (1 << bits) - 1
    let classValue = 0
    if (bits > 0) {
      const masterbook = codebooks[floor.classMasterbooks[cls]]
      if (!masterbook)
        throw new VorbisDecodeError('A Vorbis floor names a masterbook that does not exist')
      classValue = readEntry(reader, masterbook.tree)
      if (classValue < 0)
        return null
    }
    for (let j = 0; j < dimensions; j++) {
      const book = floor.subclassBooks[cls][classValue & mask]
      classValue >>= bits
      if (book >= 0) {
        const subclassBook = codebooks[book]
        if (!subclassBook)
          throw new VorbisDecodeError('A Vorbis floor names a codebook that does not exist')
        const entry = readEntry(reader, subclassBook.tree)
        y[offset + j] = entry < 0 ? 0 : entry
      }
      else {
        y[offset + j] = 0
      }
    }
    offset += dimensions
  }
  if (reader.endOfPacket)
    return null

  // Each point is predicted from the nearest points either side of it that are
  // already known, and the coded value is the correction to that prediction.
  const finalY = new Int32Array(values)
  const used = new Uint8Array(values)
  used[0] = 1
  used[1] = 1
  finalY[0] = y[0]
  finalY[1] = y[1]
  for (let i = 2; i < values; i++) {
    const low = floor.lowNeighbour[i]
    const high = floor.highNeighbour[i]
    const predicted = renderPoint(floor.xList[low], finalY[low], floor.xList[high], finalY[high], floor.xList[i])
    const highRoom = range - predicted
    const lowRoom = predicted
    const room = Math.min(highRoom, lowRoom) * 2
    const value = y[i]
    if (value) {
      used[low] = 1
      used[high] = 1
      used[i] = 1
      if (value >= room) {
        finalY[i] = highRoom > lowRoom ? value - lowRoom + predicted : predicted - value + highRoom - 1
      }
      else {
        finalY[i] = value & 1 ? predicted - ((value + 1) >> 1) : predicted + (value >> 1)
      }
    }
    else {
      used[i] = 0
      finalY[i] = predicted
    }
  }

  const curve = new Float32Array(half)
  let lastX = 0
  let lastY = finalY[0] * floor.multiplier
  let highX = 0
  let highY = lastY
  for (let i = 1; i < values; i++) {
    const point = floor.sortedOrder[i]
    if (!used[point])
      continue
    highX = floor.xList[point]
    highY = finalY[point] * floor.multiplier
    if (lastX < half)
      renderLine(lastX, lastY, Math.min(highX, half), highY, curve, half)
    lastX = highX
    lastY = highY
    if (lastX >= half)
      break
  }
  if (lastX < half) {
    // Past the last point the curve holds its value to the end.
    const level = FLOOR1_INVERSE_DB[clampAmplitude(lastY)]
    for (let x = lastX; x < half; x++) curve[x] = level
  }
  return curve
}

/** Floor amplitudes are looked up in a 256-entry table, so the index is held inside it. */
function clampAmplitude(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value
}

/** Where a straight line between two points passes at x, in integer steps. */
function renderPoint(x0: number, y0: number, x1: number, y1: number, x: number): number {
  const dy = y1 - y0
  const adx = x1 - x0
  const ady = Math.abs(dy)
  const offset = Math.floor((ady * (x - x0)) / adx)
  return dy < 0 ? y0 - offset : y0 + offset
}

/** Draws the line from (x0, y0) to (x1, y1) into the curve, as amplitudes. */
function renderLine(x0: number, y0: number, x1: number, y1: number, curve: Float32Array, half: number): void {
  const dy = y1 - y0
  const adx = x1 - x0
  if (adx <= 0)
    return
  let ady = Math.abs(dy)
  const base = Math.trunc(dy / adx)
  const sy = dy < 0 ? base - 1 : base + 1
  ady -= Math.abs(base) * adx
  let y = y0
  let error = 0
  if (x0 < half)
    curve[x0] = FLOOR1_INVERSE_DB[clampAmplitude(y)]
  for (let x = x0 + 1; x < x1 && x < half; x++) {
    error += ady
    if (error >= adx) {
      error -= adx
      y += sy
    }
    else {
      y += base
    }
    curve[x] = FLOOR1_INVERSE_DB[clampAmplitude(y)]
  }
}
