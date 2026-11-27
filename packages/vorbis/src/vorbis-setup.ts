/**
 * The two Vorbis headers a decoder has to understand: the identification
 * header, which gives the rate, channels and block sizes, and the setup
 * header, which carries the codebooks, floors, residues, mappings and modes
 * every audio packet is decoded against.
 *
 * Floor type 0 is refused. It codes the spectral envelope as LSP
 * coefficients, no encoder has chosen it since the format was young, and
 * guessing at it would be worse than saying so.
 */

import { ilog, lookup1Values, unpackFloat32, VorbisBitReader, VorbisDecodeError } from './vorbis-bitstream'

/** The bytes that follow the packet type in every header packet. */
const SIGNATURE = [0x76, 0x6F, 0x72, 0x62, 0x69, 0x73] // "vorbis"

export interface VorbisIdentification {
  channels: number
  sampleRate: number
  bitrateMaximum: number
  bitrateNominal: number
  bitrateMinimum: number
  blockSize0: number
  blockSize1: number
}

/** A codebook: its Huffman tree, and the vectors its entries stand for. */
export interface VorbisCodebook {
  dimensions: number
  entries: number
  /** Node pairs: a negative value is -(entry + 1), a positive one the next node. */
  tree: Int32Array
  /** entries * dimensions values for a lookup codebook, else null. */
  vectors: Float32Array | null
}

export interface VorbisFloor1 {
  partitionClasses: Uint8Array
  classDimensions: Uint8Array
  classSubclasses: Uint8Array
  classMasterbooks: Int32Array
  subclassBooks: Int32Array[]
  multiplier: number
  /** The x coordinates of the floor's breakpoints, in the order they are coded. */
  xList: Int32Array
  /** xList sorted, as indices into xList. */
  sortedOrder: Int32Array
  /** For each point, the earlier point just below and just above it in x. */
  lowNeighbour: Int32Array
  highNeighbour: Int32Array
}

export interface VorbisResidue {
  type: number
  begin: number
  end: number
  partitionSize: number
  classifications: number
  classbook: number
  books: Int32Array[]
}

export interface VorbisMapping {
  couplingMagnitude: Int32Array
  couplingAngle: Int32Array
  mux: Uint8Array
  submapFloor: Int32Array
  submapResidue: Int32Array
}

export interface VorbisMode {
  blockFlag: boolean
  mapping: number
}

export interface VorbisSetup {
  codebooks: VorbisCodebook[]
  floors: VorbisFloor1[]
  residues: VorbisResidue[]
  mappings: VorbisMapping[]
  modes: VorbisMode[]
}

/** Checks a header packet's type byte and signature, and returns a reader past them. */
function headerReader(packet: Uint8Array, type: number, what: string): VorbisBitReader {
  if (packet.length < 7 || packet[0] !== type || SIGNATURE.some((byte, i) => packet[i + 1] !== byte))
    throw new VorbisDecodeError(`Not a Vorbis ${what} header`)
  return new VorbisBitReader(packet.subarray(7))
}

/** Whether a packet is the Vorbis identification header, which starts a stream. */
export function isVorbisIdentification(packet: Uint8Array): boolean {
  return packet.length >= 7 && packet[0] === 1 && SIGNATURE.every((byte, i) => packet[i + 1] === byte)
}

export function parseVorbisIdentification(packet: Uint8Array): VorbisIdentification {
  const reader = headerReader(packet, 1, 'identification')
  const version = reader.read(32)
  if (version !== 0)
    throw new VorbisDecodeError(`Vorbis version ${version} is not supported`)
  const channels = reader.read(8)
  const sampleRate = reader.read(32)
  const bitrateMaximum = reader.readSigned32()
  const bitrateNominal = reader.readSigned32()
  const bitrateMinimum = reader.readSigned32()
  const blockSize0 = 1 << reader.read(4)
  const blockSize1 = 1 << reader.read(4)
  const framing = reader.readBit()
  reader.requireWithin('identification')
  if (!channels || !sampleRate)
    throw new VorbisDecodeError('The Vorbis stream states no channels or sample rate')
  if (blockSize0 < 64 || blockSize1 > 8192 || blockSize0 > blockSize1)
    throw new VorbisDecodeError(`Vorbis block sizes ${blockSize0} and ${blockSize1} are out of range`)
  if (!framing)
    throw new VorbisDecodeError('The Vorbis identification header is not framed')
  return { channels, sampleRate, bitrateMaximum, bitrateNominal, bitrateMinimum, blockSize0, blockSize1 }
}

// ---------------------------------------------------------------------------
// Codebooks

/**
 * Vorbis codeword assignment, which is not the canonical Huffman order that
 * sorts by length. Entries take the lowest free node at their own depth in
 * entry order, and a node taken at a shallower depth frees its siblings
 * further down. For a complete code the two agree; Vorbis codebooks are
 * routinely incomplete, and there they do not.
 *
 * Codewords are held left-aligned in 32 bits, as the reference decoder does,
 * so 0 can mean "nothing free at this depth": the all-zero codeword belongs to
 * the first entry and is handed out before the table is used.
 */
function buildCodebookTree(lengths: Int32Array): Int32Array {
  const nodes: number[] = [0, 0]

  const assign = (entry: number, codeword: number, length: number): void => {
    let node = 0
    for (let bit = length - 1; bit >= 0; bit--) {
      const slot = 2 * node + (Math.floor(codeword / 2 ** bit) & 1)
      if (bit === 0) {
        if (nodes[slot])
          throw new VorbisDecodeError('A Vorbis codebook is not a prefix code')
        nodes[slot] = -(entry + 1)
        return
      }
      let child = nodes[slot]
      if (!child) {
        child = nodes.length / 2
        nodes.push(0, 0)
        nodes[slot] = child
      }
      else if (child < 0) {
        throw new VorbisDecodeError('A Vorbis codebook is not a prefix code')
      }
      node = child
    }
  }

  let first = -1
  for (let entry = 0; entry < lengths.length; entry++) {
    if (lengths[entry] > 0) {
      first = entry
      break
    }
  }
  if (first < 0)
    throw new VorbisDecodeError('A Vorbis codebook has no entries')

  // The first entry takes all zeros, and frees one node at every depth above it.
  assign(first, 0, lengths[first])
  const available = new Float64Array(33)
  for (let depth = 1; depth <= lengths[first]; depth++) available[depth] = 2 ** (32 - depth)

  for (let entry = first + 1; entry < lengths.length; entry++) {
    const length = lengths[entry]
    if (length <= 0)
      continue
    let depth = length
    while (depth > 0 && !available[depth]) depth--
    if (depth === 0)
      throw new VorbisDecodeError('A Vorbis codebook is overpopulated')
    const free = available[depth]
    available[depth] = 0
    assign(entry, Math.floor(free / 2 ** (32 - length)), length)
    // Taking a node above its own depth leaves its siblings below it free.
    for (let y = length; y > depth; y--) available[y] = free + 2 ** (32 - y)
  }

  return Int32Array.from(nodes)
}

/** The widest VQ table this will build, so a malformed header cannot ask for gigabytes. */
const MAX_VQ_VALUES = 4_000_000

function readCodebook(reader: VorbisBitReader): VorbisCodebook {
  if (reader.read(24) !== 0x564342)
    throw new VorbisDecodeError('A Vorbis codebook is missing its sync pattern')
  const dimensions = reader.read(16)
  const entries = reader.read(24)
  if (!dimensions || !entries)
    throw new VorbisDecodeError('A Vorbis codebook states no dimensions or entries')

  const lengths = new Int32Array(entries)
  if (reader.readBit()) {
    // Lengths in runs, which is how an encoder writes a book it built in order.
    let current = reader.read(5) + 1
    let entry = 0
    while (entry < entries) {
      const number = reader.read(ilog(entries - entry))
      if (entry + number > entries)
        throw new VorbisDecodeError('A Vorbis codebook states more entries than it has')
      lengths.fill(current, entry, entry + number)
      entry += number
      current++
      if (reader.endOfPacket)
        break
    }
  }
  else {
    const sparse = reader.readBit() === 1
    for (let entry = 0; entry < entries; entry++)
      lengths[entry] = sparse && !reader.readBit() ? 0 : reader.read(5) + 1
  }
  reader.requireWithin('codebook')

  const lookupType = reader.read(4)
  if (lookupType > 2)
    throw new VorbisDecodeError(`Vorbis codebook lookup type ${lookupType} is reserved`)

  let vectors: Float32Array | null = null
  if (lookupType !== 0) {
    const minimum = unpackFloat32(reader.read(32))
    const delta = unpackFloat32(reader.read(32))
    const valueBits = reader.read(4) + 1
    const sequenceP = reader.readBit() === 1
    const count = lookupType === 1 ? lookup1Values(entries, dimensions) : entries * dimensions
    if (count > MAX_VQ_VALUES)
      throw new VorbisDecodeError('A Vorbis codebook asks for an unreasonable lookup table')
    const multiplicands = new Float64Array(count)
    for (let i = 0; i < count; i++) multiplicands[i] = reader.read(valueBits)
    reader.requireWithin('codebook')

    if (entries * dimensions > MAX_VQ_VALUES)
      throw new VorbisDecodeError('A Vorbis codebook asks for an unreasonable lookup table')
    vectors = new Float32Array(entries * dimensions)
    if (lookupType === 1) {
      for (let entry = 0; entry < entries; entry++) {
        let last = 0
        let divisor = 1
        for (let j = 0; j < dimensions; j++) {
          const offset = Math.floor(entry / divisor) % count
          const value = multiplicands[offset] * delta + minimum + last
          vectors[entry * dimensions + j] = value
          if (sequenceP)
            last = value
          divisor *= count
        }
      }
    }
    else {
      for (let entry = 0; entry < entries; entry++) {
        let last = 0
        for (let j = 0; j < dimensions; j++) {
          const value = multiplicands[entry * dimensions + j] * delta + minimum + last
          vectors[entry * dimensions + j] = value
          if (sequenceP)
            last = value
        }
      }
    }
  }

  return { dimensions, entries, tree: buildCodebookTree(lengths), vectors }
}

// ---------------------------------------------------------------------------
// Floors

/** The point just below `i` in x among the points before it, and the one just above. */
function neighbours(xList: Int32Array): { low: Int32Array, high: Int32Array } {
  const low = new Int32Array(xList.length)
  const high = new Int32Array(xList.length)
  for (let i = 2; i < xList.length; i++) {
    let lowIndex = 0
    let highIndex = 1
    for (let j = 0; j < i; j++) {
      if (xList[j] < xList[i] && xList[j] > xList[lowIndex])
        lowIndex = j
      if (xList[j] > xList[i] && xList[j] < xList[highIndex])
        highIndex = j
    }
    low[i] = lowIndex
    high[i] = highIndex
  }
  return { low, high }
}

function readFloor(reader: VorbisBitReader): VorbisFloor1 {
  const type = reader.read(16)
  if (type === 0)
    throw new VorbisDecodeError('Vorbis floor type 0 is not supported')
  if (type !== 1)
    throw new VorbisDecodeError(`Vorbis floor type ${type} is reserved`)

  const partitions = reader.read(5)
  const partitionClasses = new Uint8Array(partitions)
  let maximumClass = -1
  for (let i = 0; i < partitions; i++) {
    partitionClasses[i] = reader.read(4)
    maximumClass = Math.max(maximumClass, partitionClasses[i])
  }

  const classDimensions = new Uint8Array(maximumClass + 1)
  const classSubclasses = new Uint8Array(maximumClass + 1)
  const classMasterbooks = new Int32Array(maximumClass + 1).fill(-1)
  const subclassBooks: Int32Array[] = []
  for (let c = 0; c <= maximumClass; c++) {
    classDimensions[c] = reader.read(3) + 1
    classSubclasses[c] = reader.read(2)
    if (classSubclasses[c] > 0)
      classMasterbooks[c] = reader.read(8)
    const books = new Int32Array(1 << classSubclasses[c])
    for (let j = 0; j < books.length; j++) books[j] = reader.read(8) - 1
    subclassBooks.push(books)
  }

  const multiplier = reader.read(2) + 1
  const rangeBits = reader.read(4)
  const xs: number[] = [0, 1 << rangeBits]
  for (let i = 0; i < partitions; i++) {
    for (let j = 0; j < classDimensions[partitionClasses[i]]; j++) xs.push(reader.read(rangeBits))
  }
  reader.requireWithin('floor')
  if (xs.length > 65)
    throw new VorbisDecodeError('A Vorbis floor states more points than the format allows')

  const xList = Int32Array.from(xs)
  const sortedOrder = Int32Array.from(xs.keys()).sort((a, b) => xList[a] - xList[b])
  for (let i = 1; i < sortedOrder.length; i++) {
    if (xList[sortedOrder[i]] === xList[sortedOrder[i - 1]])
      throw new VorbisDecodeError('A Vorbis floor repeats one of its points')
  }
  const { low, high } = neighbours(xList)
  return {
    partitionClasses,
    classDimensions,
    classSubclasses,
    classMasterbooks,
    subclassBooks,
    multiplier,
    xList,
    sortedOrder,
    lowNeighbour: low,
    highNeighbour: high,
  }
}

// ---------------------------------------------------------------------------
// Residues, mappings and modes

function readResidue(reader: VorbisBitReader, codebooks: number): VorbisResidue {
  const type = reader.read(16)
  if (type > 2)
    throw new VorbisDecodeError(`Vorbis residue type ${type} is reserved`)
  const begin = reader.read(24)
  const end = reader.read(24)
  const partitionSize = reader.read(24) + 1
  const classifications = reader.read(6) + 1
  const classbook = reader.read(8)
  const cascade = new Int32Array(classifications)
  for (let i = 0; i < classifications; i++) {
    const low = reader.read(3)
    const high = reader.readBit() ? reader.read(5) : 0
    cascade[i] = high * 8 + low
  }
  const books: Int32Array[] = []
  for (let i = 0; i < classifications; i++) {
    const row = new Int32Array(8).fill(-1)
    for (let j = 0; j < 8; j++) {
      if (cascade[i] & (1 << j)) {
        row[j] = reader.read(8)
        if (row[j] >= codebooks)
          throw new VorbisDecodeError('A Vorbis residue names a codebook that does not exist')
      }
    }
    books.push(row)
  }
  reader.requireWithin('residue')
  if (classbook >= codebooks)
    throw new VorbisDecodeError('A Vorbis residue names a classbook that does not exist')
  if (end < begin)
    throw new VorbisDecodeError('A Vorbis residue ends before it begins')
  return { type, begin, end, partitionSize, classifications, classbook, books }
}

function readMapping(reader: VorbisBitReader, channels: number, floors: number, residues: number): VorbisMapping {
  const type = reader.read(16)
  if (type !== 0)
    throw new VorbisDecodeError(`Vorbis mapping type ${type} is reserved`)
  const submaps = reader.readBit() ? reader.read(4) + 1 : 1
  let couplingSteps = 0
  if (reader.readBit())
    couplingSteps = reader.read(8) + 1
  const couplingMagnitude = new Int32Array(couplingSteps)
  const couplingAngle = new Int32Array(couplingSteps)
  const channelBits = ilog(channels - 1)
  for (let i = 0; i < couplingSteps; i++) {
    couplingMagnitude[i] = reader.read(channelBits)
    couplingAngle[i] = reader.read(channelBits)
    if (couplingMagnitude[i] === couplingAngle[i] || couplingMagnitude[i] >= channels || couplingAngle[i] >= channels)
      throw new VorbisDecodeError('A Vorbis coupling step names channels it cannot couple')
  }
  if (reader.read(2) !== 0)
    throw new VorbisDecodeError('A Vorbis mapping sets bits the format reserves')
  const mux = new Uint8Array(channels)
  if (submaps > 1) {
    for (let ch = 0; ch < channels; ch++) {
      mux[ch] = reader.read(4)
      if (mux[ch] >= submaps)
        throw new VorbisDecodeError('A Vorbis mapping puts a channel in a submap that does not exist')
    }
  }
  const submapFloor = new Int32Array(submaps)
  const submapResidue = new Int32Array(submaps)
  for (let s = 0; s < submaps; s++) {
    reader.read(8) // The time configuration, which the format never gave a meaning.
    submapFloor[s] = reader.read(8)
    submapResidue[s] = reader.read(8)
    if (submapFloor[s] >= floors || submapResidue[s] >= residues)
      throw new VorbisDecodeError('A Vorbis mapping names a floor or residue that does not exist')
  }
  reader.requireWithin('mapping')
  return { couplingMagnitude, couplingAngle, mux, submapFloor, submapResidue }
}

export function parseVorbisSetup(packet: Uint8Array, identification: VorbisIdentification): VorbisSetup {
  const reader = headerReader(packet, 5, 'setup')

  const codebooks: VorbisCodebook[] = []
  const codebookCount = reader.read(8) + 1
  for (let i = 0; i < codebookCount; i++) codebooks.push(readCodebook(reader))

  // The time domain transforms are a placeholder the format never used.
  const timeCount = reader.read(6) + 1
  for (let i = 0; i < timeCount; i++) {
    if (reader.read(16) !== 0)
      throw new VorbisDecodeError('A Vorbis time domain transform is not the one the format defines')
  }

  const floors: VorbisFloor1[] = []
  const floorCount = reader.read(6) + 1
  for (let i = 0; i < floorCount; i++) floors.push(readFloor(reader))

  const residues: VorbisResidue[] = []
  const residueCount = reader.read(6) + 1
  for (let i = 0; i < residueCount; i++) residues.push(readResidue(reader, codebooks.length))

  const mappings: VorbisMapping[] = []
  const mappingCount = reader.read(6) + 1
  for (let i = 0; i < mappingCount; i++) mappings.push(readMapping(reader, identification.channels, floors.length, residues.length))

  const modes: VorbisMode[] = []
  const modeCount = reader.read(6) + 1
  for (let i = 0; i < modeCount; i++) {
    const blockFlag = reader.readBit() === 1
    const windowType = reader.read(16)
    const transformType = reader.read(16)
    const mapping = reader.read(8)
    if (windowType !== 0 || transformType !== 0)
      throw new VorbisDecodeError('A Vorbis mode names a window or transform the format does not define')
    if (mapping >= mappings.length)
      throw new VorbisDecodeError('A Vorbis mode names a mapping that does not exist')
    modes.push({ blockFlag, mapping })
  }

  if (!reader.readBit())
    throw new VorbisDecodeError('The Vorbis setup header is not framed')
  reader.requireWithin('setup')
  return { codebooks, floors, residues, mappings, modes }
}
