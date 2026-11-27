import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { crc16Flac, crc8Flac, decodeAudio, decodeAudioPackets } from '@ts-audio/core'
import { FlacDecodeError, FlacDecoder, flacMd5Bytes, parseFlacFrameHeader, parseFlacStreamInfo } from './flac-decoder'
import { createFlacDecoder, decodeFlacFile, isFlac, readFlacFrames, readFlacMetadata, streamInfoFromDescription } from './flac-audio'

const fixture = (name: string): string => new URL(`../test/fixtures/voice/${name}`, import.meta.url).pathname
const bytes = async (name: string): Promise<Uint8Array> => new Uint8Array(await Bun.file(fixture(name)).arrayBuffer())

/** Every FLAC stream states an MD5 of its own unencoded audio; this is that check. */
function md5Of(channels: Int32Array[], bitsPerSample: number): string {
  return createHash('md5').update(flacMd5Bytes(channels, bitsPerSample)).digest('hex')
}

const hex = (data: Uint8Array): string => Buffer.from(data).toString('hex')

// The fixtures are the reference encoder's (test/fixtures/voice/make-flac-fixtures.ts),
// chosen to cover every subframe type and stereo mode between them.
const FIXTURES = [
  { name: 'voice-flac-mono.flac', bits: 16, rate: 44100, channels: 1, what: 'high LPC orders at -8' },
  { name: 'voice-flac-stereo.flac', bits: 16, rate: 44100, channels: 2, what: 'mid/side and independent stereo' },
  { name: 'voice-flac-fast.flac', bits: 16, rate: 44100, channels: 1, what: 'fixed predictors at -0' },
  { name: 'voice-flac-24bit.flac', bits: 24, rate: 48000, channels: 1, what: '24-bit' },
  { name: 'voice-flac-8bit.flac', bits: 8, rate: 22050, channels: 1, what: '8-bit' },
  { name: 'voice-flac-silence.flac', bits: 16, rate: 44100, channels: 1, what: 'constant subframes' },
  { name: 'voice-flac-noise.flac', bits: 16, rate: 44100, channels: 1, what: 'verbatim and escaped partitions' },
] as const

describe('FLAC', () => {
  // Lossless, so there is nothing to judge in decibels: the samples are the
  // encoder's input or they are not.
  for (const { name, bits, rate, channels, what } of FIXTURES) {
    test(`decodes ${what} to the exact samples the encoder was given`, async () => {
      const decoded = decodeFlacFile(await bytes(name))
      expect(decoded).toMatchObject({ sampleRate: rate, bitsPerSample: bits })
      expect(decoded.channels).toHaveLength(channels)
      // Every sample the stream says it holds, and not one more.
      expect(decoded.channels[0].length).toBe(Number(decoded.streamInfo.totalSamples))
      expect(md5Of(decoded.channels, decoded.bitsPerSample)).toBe(hex(decoded.streamInfo.md5))
    })
  }

  test('reads a .flac file through decodeAudio, as the samples it decoded itself', async () => {
    const file = await bytes('voice-flac-stereo.flac')
    const [floats, integers] = [await decodeAudio(file), decodeFlacFile(file)]
    expect(floats).toMatchObject({ codec: 'flac', sampleRate: 44100 })
    expect(floats.channels).toHaveLength(2)
    expect(floats.channels[0].length).toBe(integers.channels[0].length)
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < integers.channels[c].length; i += 97)
        expect(floats.channels[c][i]).toBeCloseTo(integers.channels[c][i] / 32768, 9)
    }
  })

  test('decodes a FLAC track handed over packet by packet, as a container reader hands it', async () => {
    const file = await bytes('voice-flac-mono.flac')
    const { streamInfo, audioStart } = readFlacMetadata(file)
    const frames = readFlacFrames(file, audioStart)
    const decoded = await decodeAudioPackets(
      {
        type: 'audio',
        id: 1,
        index: 0,
        codec: 'flac',
        sampleRate: streamInfo.sampleRate,
        channels: streamInfo.channels,
        bitDepth: streamInfo.bitsPerSample,
      },
      frames.map((data, i) => ({ data, timestamp: i, duration: 0, isKeyframe: true, trackId: 1 })),
    )
    expect(decoded.codec).toBe('flac')
    expect(decoded.sampleRate).toBe(44100)
    const integers = decodeFlacFile(file)
    expect(decoded.channels[0].length).toBe(integers.channels[0].length)
    for (let i = 0; i < integers.channels[0].length; i += 97)
      expect(decoded.channels[0][i]).toBeCloseTo(integers.channels[0][i] / 32768, 9)
  })

  test('configures itself from the STREAMINFO a track carries as its description', async () => {
    const file = await bytes('voice-flac-24bit.flac')
    const { streamInfo, audioStart } = readFlacMetadata(file)
    expect(streamInfo.bitsPerSample).toBe(24)
    // The track itself says nothing, so the description has to supply the
    // sample rate and the bit depth, as it does for a Matroska FLAC track.
    const decoder = createFlacDecoder({
      type: 'audio',
      id: 1,
      index: 0,
      codec: 'flac',
      sampleRate: 0,
      channels: 0,
      codecDescription: rawStreamInfo(file),
    })
    const frame = readFlacFrames(file, audioStart)[0]
    const chunk = decoder.decode({ data: frame, timestamp: 0, duration: 0, isKeyframe: true, trackId: 1 })!
    expect(chunk.sampleRate).toBe(48000)
    expect(chunk.channels).toHaveLength(1)
    // Scaled by 2^23 rather than 2^15, so a real voice stays well inside range.
    expect(Math.max(...chunk.channels[0].map(Math.abs))).toBeLessThanOrEqual(1)
    expect(Math.max(...chunk.channels[0].map(Math.abs))).toBeGreaterThan(0)
  })

  test('says what it is and is not', async () => {
    expect(isFlac(await bytes('voice-flac-mono.flac'))).toBe(true)
    expect(isFlac(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBe(false)
    expect(isFlac(new Uint8Array([0x66]))).toBe(false)
  })
})

/** The STREAMINFO block body of a FLAC file: "fLaC", then a 4-byte block header. */
function rawStreamInfo(file: Uint8Array): Uint8Array {
  return file.subarray(8, 8 + 34)
}

// ---------------------------------------------------------------------------
// Frames built here, to reach what an encoder will not choose on its own

/** Writes bits big-endian, as FLAC orders them. */
class BitWriter {
  private readonly bits: number[] = []

  write(value: number, count: number): void {
    for (let i = count - 1; i >= 0; i--) this.bits.push(Math.floor(value / 2 ** i) & 1)
  }

  /** A two's complement value of `count` bits. */
  writeSigned(value: number, count: number): void {
    this.write(value < 0 ? value + 2 ** count : value, count)
  }

  alignToByte(): void {
    while (this.bits.length % 8) this.bits.push(0)
  }

  toBytes(): Uint8Array {
    this.alignToByte()
    const bytes = new Uint8Array(this.bits.length / 8)
    this.bits.forEach((bit, i) => {
      if (bit)
        bytes[i >> 3] |= 1 << (7 - (i & 7))
    })
    return bytes
  }
}

/**
 * A real FLAC frame, every channel a verbatim subframe: 44.1 kHz, 16-bit,
 * fixed block size. The reference encoder picks the stereo mode that codes
 * smallest, and never picks right/side for the signals it is easy to
 * synthesise, so the modes are reached here instead.
 */
function verbatimFrame(channelAssignment: number, channels: number[][]): Uint8Array {
  const blockSize = channels[0].length
  const header = new BitWriter()
  header.write(0x3FFE, 14)
  header.write(0, 1) // reserved
  header.write(0, 1) // fixed block size, so the number below is a frame number
  header.write(7, 4) // block size follows the header, as 16 bits
  header.write(9, 4) // 44100 Hz
  header.write(channelAssignment, 4)
  header.write(4, 3) // 16 bits per sample
  header.write(0, 1) // reserved
  header.write(0, 8) // frame number 0, in UTF-8's one-byte form
  header.write(blockSize - 1, 16)
  const headerBytes = header.toBytes()

  const body = new BitWriter()
  channels.forEach((samples, c) => {
    const side = (channelAssignment === 8 && c === 1) || (channelAssignment === 9 && c === 0) || (channelAssignment === 10 && c === 1)
    const bits = 16 + (side ? 1 : 0)
    body.write(0, 1) // subframe padding
    body.write(1, 6) // verbatim
    body.write(0, 1) // no wasted bits
    for (const sample of samples) body.writeSigned(sample, bits)
  })
  const bodyBytes = body.toBytes()

  const withoutCrc = new Uint8Array(headerBytes.length + 1 + bodyBytes.length)
  withoutCrc.set(headerBytes)
  withoutCrc[headerBytes.length] = crc8Flac(headerBytes)
  withoutCrc.set(bodyBytes, headerBytes.length + 1)

  const frame = new Uint8Array(withoutCrc.length + 2)
  frame.set(withoutCrc)
  const crc = crc16Flac(withoutCrc)
  frame[withoutCrc.length] = (crc >> 8) & 0xFF
  frame[withoutCrc.length + 1] = crc & 0xFF
  return frame
}

describe('FLAC stereo modes', () => {
  const left = [0, 1000, -1000, 32767, -32768, 12345, -6789, 4096]
  const right = [0, -500, 1500, 32000, -32000, 11111, -1234, -4096]
  const side = left.map((value, i) => value - right[i])
  const mid = left.map((value, i) => (value + right[i]) >> 1)

  // Each mode stores a different pair, and the decoder has to put left and
  // right back. Getting these the wrong way round is silent: it still sounds
  // like music, with the channels swapped or the difference played as audio.
  const cases = [
    { assignment: 1, name: 'independent stereo', stored: [left, right] },
    { assignment: 8, name: 'left/side', stored: [left, side] },
    { assignment: 9, name: 'right/side', stored: [side, right] },
    { assignment: 10, name: 'mid/side', stored: [mid, side] },
  ] as const

  for (const { assignment, name, stored } of cases) {
    test(`puts left and right back from ${name}`, () => {
      const decoded = new FlacDecoder().decodeFrame(verbatimFrame(assignment, stored.map(channel => [...channel])))
      expect(decoded).toMatchObject({ sampleRate: 44100, bitsPerSample: 16 })
      expect(Array.from(decoded.channels[0])).toEqual(left)
      expect(Array.from(decoded.channels[1])).toEqual(right)
    })
  }

  test('refuses a frame whose CRC-16 does not match its bytes', () => {
    const frame = verbatimFrame(10, [mid.slice(), side.slice()])
    const damaged = new Uint8Array(frame)
    damaged[damaged.length - 1] ^= 0xFF
    expect(() => new FlacDecoder().decodeFrame(damaged)).toThrow(FlacDecodeError)
  })

  test('reads a frame whose header states its own block size', () => {
    const header = parseFlacFrameHeader(verbatimFrame(1, [left.slice(), right.slice()]), 0)!
    expect(header).toMatchObject({ blockSize: 8, sampleRate: 44100, bitsPerSample: 16, channels: 2, channelAssignment: 1 })
  })
})

describe('FLAC frame boundaries', () => {
  test('rejects a sync word that fails its CRC-8, so residual data cannot split a frame', async () => {
    const file = await bytes('voice-flac-noise.flac')
    const { audioStart } = readFlacMetadata(file)
    const frames = readFlacFrames(file, audioStart)
    // Noise is where a 0x3FFE turns up inside the residuals most often. Every
    // frame found has to be a real one, and together they must cover the audio.
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.every(frame => parseFlacFrameHeader(frame, 0) !== null)).toBe(true)
    expect(frames.reduce((n, frame) => n + frame.length, 0)).toBe(file.length - audioStart)
    const decoded = decodeFlacFile(file)
    expect(md5Of(decoded.channels, decoded.bitsPerSample)).toBe(hex(decoded.streamInfo.md5))
  })

  test('counts the whole stream in blocks of the size its frames state', async () => {
    const file = await bytes('voice-flac-fast.flac')
    const { streamInfo, audioStart } = readFlacMetadata(file)
    const frames = readFlacFrames(file, audioStart)
    const total = frames.reduce((n, frame) => n + parseFlacFrameHeader(frame, 0)!.blockSize, 0)
    // The last block is short, so the blocks sum to a little over the total.
    expect(total).toBeGreaterThanOrEqual(Number(streamInfo.totalSamples))
    expect(total - Number(streamInfo.totalSamples)).toBeLessThan(streamInfo.maxBlockSize)
  })
})

describe('FLAC stream info', () => {
  test('reads the bit depth as one five-bit field', async () => {
    const file = await bytes('voice-flac-24bit.flac')
    expect(parseFlacStreamInfo(rawStreamInfo(file)).bitsPerSample).toBe(24)

    // 32-bit streams put all five bits to use, which is where splitting the
    // field across the `|` used to report them as 16-bit.
    const block = new Uint8Array(rawStreamInfo(file))
    block[12] = (block[12] & 0xFE) | 0x01
    block[13] = (block[13] & 0x0F) | 0xF0
    expect(parseFlacStreamInfo(block).bitsPerSample).toBe(32)
  })

  test('refuses 32-bit audio by name rather than decoding it wrongly', async () => {
    const file = await bytes('voice-flac-mono.flac')
    const { audioStart } = readFlacMetadata(file)
    const frame = readFlacFrames(file, audioStart)[0]
    const decoder = new FlacDecoder({ sampleRate: 44100, channels: 1, bitsPerSample: 32 })
    // With the frame deferring its bit depth, the stream's 32 is what counts.
    expect(() => decoder.decodeFrame(thirtyTwoBitFrame(frame))).toThrow(/32-bit FLAC is not supported/)
  })
})

/** The same frame, with its header asking the stream for the bit depth. */
function thirtyTwoBitFrame(frame: Uint8Array): Uint8Array {
  const copy = new Uint8Array(frame)
  // Sample size code 0 means "ask STREAMINFO"; byte 3 holds it in bits 1 to 3.
  copy[3] = copy[3] & 0xF1
  // The CRC-8 ends the header, whose length depends on the frame number and
  // the fields that follow it, so it is not at a fixed offset. Clearing the
  // sample size code does not change that length.
  const { length } = parseFlacFrameHeader(frame, 0)!
  copy[length - 1] = crc8Flac(copy.subarray(0, length - 1))
  return copy
}

// ---------------------------------------------------------------------------
// Track descriptions, as each container hands them over

/** The metadata block list of a FLAC file: "fLaC" then every block. */
function blockList(file: Uint8Array): Uint8Array {
  const { audioStart } = readFlacMetadata(file)
  return file.subarray(4, audioStart)
}

describe('FLAC track descriptions', () => {
  test('reads STREAMINFO from every shape a container gives it', async () => {
    const file = await bytes('voice-flac-24bit.flac')
    const bare = rawStreamInfo(file)
    const blocks = blockList(file)
    const withMarker = file.subarray(0, 4 + blocks.length)

    // "fLaC" then the blocks: the WebCodecs shape, and Matroska's CodecPrivate.
    // The blocks alone: MP4's dfLa box past its FullBox header.
    // A bare STREAMINFO block: what this package's own demuxer carries.
    const forms = { 'fLaC and blocks': withMarker, 'blocks alone': blocks, 'bare STREAMINFO': bare }
    for (const [name, description] of Object.entries(forms)) {
      const streamInfo = streamInfoFromDescription(description)
      expect(streamInfo, name).not.toBeNull()
      expect(streamInfo!.sampleRate, name).toBe(48000)
      expect(streamInfo!.bitsPerSample, name).toBe(24)
      expect(streamInfo!.channels, name).toBe(1)
    }
  })

  test('configures a decoder the same way from each of them', async () => {
    const file = await bytes('voice-flac-24bit.flac')
    const { audioStart } = readFlacMetadata(file)
    const frame = readFlacFrames(file, audioStart)[0]
    const packet = { data: frame, timestamp: 0, duration: 0, isKeyframe: true, trackId: 1 }
    const outputs = [file.subarray(0, 4 + blockList(file).length), blockList(file), rawStreamInfo(file)].map((codecDescription) => {
      const decoder = createFlacDecoder({ type: 'audio', id: 1, index: 0, codec: 'flac', sampleRate: 0, channels: 0, codecDescription })
      return decoder.decode(packet)!
    })
    for (const output of outputs) {
      expect(output.sampleRate).toBe(48000)
      expect(Array.from(output.channels[0].subarray(0, 24))).toEqual(Array.from(outputs[0].channels[0].subarray(0, 24)))
    }
  })

  test('is not fooled by a description it cannot read', () => {
    // A "fLaC" marker with no blocks after it, and plain rubbish of the same length.
    expect(streamInfoFromDescription(new Uint8Array([0x66, 0x4C, 0x61, 0x43, ...new Array(34).fill(0)]))).toBeNull()
    expect(streamInfoFromDescription(new Uint8Array(8))).toBeNull()
    expect(streamInfoFromDescription(new Uint8Array(0))).toBeNull()
  })

  test('refuses a frame that defers to a STREAMINFO it was never given', async () => {
    const file = await bytes('voice-flac-mono.flac')
    const { audioStart } = readFlacMetadata(file)
    const frame = deferringFrame(readFlacFrames(file, audioStart)[0])

    // Nothing to defer to: named, not guessed.
    const bare = createFlacDecoder({ type: 'audio', id: 1, index: 0, codec: 'flac', sampleRate: 0, channels: 0 })
    expect(() => bare.decode({ data: frame, timestamp: 0, duration: 0, isKeyframe: true, trackId: 1 })).toThrow(FlacDecodeError)
    expect(() => bare.decode({ data: frame, timestamp: 0, duration: 0, isKeyframe: true, trackId: 1 })).toThrow(/sample rate/)

    // The track's own numbers are enough, even with no description at all.
    const fromTrack = createFlacDecoder({ type: 'audio', id: 1, index: 0, codec: 'flac', sampleRate: 44100, channels: 1, bitDepth: 16 })
    const chunk = fromTrack.decode({ data: frame, timestamp: 0, duration: 0, isKeyframe: true, trackId: 1 })!
    expect(chunk.sampleRate).toBe(44100)
    expect(chunk.channels[0].length).toBeGreaterThan(0)
  })
})

/** The same frame, with its header asking the stream for the sample rate and bit depth. */
function deferringFrame(frame: Uint8Array): Uint8Array {
  const copy = new Uint8Array(frame)
  // Byte 2 holds the block size code then the sample rate code; byte 3 the
  // channel assignment, then the sample size code in bits 1 to 3. Zeroing the
  // two codes means "ask STREAMINFO" and leaves the header the same length.
  copy[2] = copy[2] & 0xF0
  copy[3] = copy[3] & 0xF1
  const { length } = parseFlacFrameHeader(frame, 0)!
  copy[length - 1] = crc8Flac(copy.subarray(0, length - 1))
  // The frame's own CRC-16, its last two bytes, covers the header too.
  const crc = crc16Flac(copy.subarray(0, copy.length - 2))
  copy[copy.length - 2] = (crc >> 8) & 0xFF
  copy[copy.length - 1] = crc & 0xFF
  return copy
}
