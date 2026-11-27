import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { decodeAudio } from '@ts-audio/core'
import { decodeFlacFile, readFlacMetadata } from './flac-audio'
import { flacMd5Bytes, parseFlacFrameHeader } from './flac-decoder'
import { encodeFlac, FlacEncodeError } from './flac-encoder'

const fixture = (name: string): string => new URL(`../test/fixtures/voice/${name}`, import.meta.url).pathname
const bytes = async (name: string): Promise<Uint8Array> => new Uint8Array(await Bun.file(fixture(name)).arrayBuffer())
const hex = (data: Uint8Array): string => Buffer.from(data).toString('hex')

function expectSameSamples(actual: Int32Array[], expected: Int32Array[]): void {
  expect(actual).toHaveLength(expected.length)
  for (let c = 0; c < expected.length; c++) {
    expect(actual[c].length).toBe(expected[c].length)
    // A loop rather than toEqual: on a mismatch this says where.
    for (let i = 0; i < expected[c].length; i++) {
      if (actual[c][i] !== expected[c][i])
        throw new Error(`channel ${c} sample ${i}: got ${actual[c][i]}, expected ${expected[c][i]}`)
    }
  }
}

/** A deterministic signal: a voice-like tone with a little noise, so every predictor has work to do. */
function signal(length: number, channels: number, bits: number, seed = 1): Int32Array[] {
  const peak = 2 ** (bits - 1) - 1
  let state = seed
  return Array.from({ length: channels }, (_, c) => Int32Array.from({ length }, (_, i) => {
    state = (state * 1103515245 + 12345) & 0x7FFFFFFF
    const tone = Math.sin(2 * Math.PI * (220 + c * 110) * i / 44100) * 0.6
    const noise = ((state / 0x7FFFFFFF) - 0.5) * 0.02
    return Math.max(-peak - 1, Math.min(peak, Math.round((tone + noise) * peak)))
  }))
}

const FIXTURES = ['mono', 'stereo', 'fast', '24bit', '8bit', 'silence', 'noise'] as const

describe('FLAC encoding', () => {
  // The reference encoder's own files, decoded and encoded again here. The
  // samples have to survive exactly, and so the MD5 this encoder writes has to
  // be the one the reference encoder wrote for the same audio.
  for (const name of FIXTURES) {
    test(`re-encodes ${name} so it decodes to the reference encoder's samples exactly`, async () => {
      const source = decodeFlacFile(await bytes(`voice-flac-${name}.flac`))
      const encoded = encodeFlac(source.channels, { sampleRate: source.sampleRate, bitsPerSample: source.bitsPerSample })
      const decoded = decodeFlacFile(encoded)
      expect(decoded).toMatchObject({ sampleRate: source.sampleRate, bitsPerSample: source.bitsPerSample })
      expectSameSamples(decoded.channels, source.channels)
      expect(hex(decoded.streamInfo.md5)).toBe(hex(source.streamInfo.md5))
      expect(Number(decoded.streamInfo.totalSamples)).toBe(source.channels[0].length)
    })
  }

  test('writes an MD5 that matches the audio, independently computed', () => {
    const channels = signal(10_000, 2, 16)
    const decoded = decodeFlacFile(encodeFlac(channels, { sampleRate: 44100 }))
    const md5 = createHash('md5').update(flacMd5Bytes(channels, 16)).digest('hex')
    expect(hex(decoded.streamInfo.md5)).toBe(md5)
  })

  test('takes floats, scaling them to the stream depth, as decodeAudio gives them back', async () => {
    const floats = [Float32Array.from({ length: 5000 }, (_, i) => Math.sin(i / 20) * 0.5)]
    const encoded = encodeFlac(floats, { sampleRate: 22050, bitsPerSample: 16 })
    const decoded = decodeFlacFile(encoded)
    expect(decoded.channels[0].length).toBe(5000)
    for (let i = 0; i < 5000; i++) expect(decoded.channels[0][i]).toBe(Math.round(floats[0][i] * 32768))
    // The whole path: decodeAudio reads what this wrote.
    const viaCore = await decodeAudio(encoded)
    expect(viaCore).toMatchObject({ codec: 'flac', sampleRate: 22050 })
    for (let i = 0; i < 5000; i += 97) expect(viaCore.channels[0][i]).toBeCloseTo(floats[0][i], 4)
  })

  test('compresses speech to about what the reference encoder does at its default level', async () => {
    // libFLAC -5 makes 66,581 bytes of frames from this audio, and -8 makes
    // 63,240. A regression in prediction or Rice coding shows here first.
    const source = decodeFlacFile(await bytes('voice-flac-mono.flac'))
    const encoded = encodeFlac(source.channels, { sampleRate: source.sampleRate })
    const frames = encoded.length - readFlacMetadata(encoded).audioStart
    expect(frames).toBeLessThan(66_581 * 1.02)
    expect(frames).toBeGreaterThan(63_240 * 0.9)
  })

  test('notices low bits every sample shares, and codes 16-bit audio in a 24-bit stream as cheaply', () => {
    const sixteen = signal(8192, 1, 16)
    const widened = [Int32Array.from(sixteen[0], value => value * 256)]
    const plain = encodeFlac(sixteen, { sampleRate: 44100, bitsPerSample: 16 })
    const wide = encodeFlac(widened, { sampleRate: 44100, bitsPerSample: 24 })
    expectSameSamples(decodeFlacFile(wide).channels, widened)
    // Wasted bits cost a few bits per subframe header, not 8 per sample.
    expect(wide.length).toBeLessThan(plain.length * 1.02)
  })
})

describe('FLAC encoding at the edges', () => {
  const cases: [string, number][] = [
    ['a single sample', 1],
    ['a block shorter than the LPC order', 5],
    ['a short last block', 4096 * 2 + 37],
    ['exactly one block', 4096],
  ]
  for (const [what, length] of cases) {
    test(`round-trips ${what}`, () => {
      const channels = signal(length, 2, 16, length + 1)
      const decoded = decodeFlacFile(encodeFlac(channels, { sampleRate: 44100 }))
      expectSameSamples(decoded.channels, channels)
      expect(Number(decoded.streamInfo.totalSamples)).toBe(length)
    })
  }

  test('refuses an empty stream, as the reference encoder does', () => {
    // STREAMINFO's total of 0 means "unknown", so no samples cannot be said.
    expect(() => encodeFlac([new Int32Array(0)], { sampleRate: 44100 })).toThrow(/at least one sample/)
  })

  test('decodes a valid stream with no frames to nothing, and refuses one that lost them', () => {
    // "fLaC", then STREAMINFO alone. libFLAC accepts this; with a total of 0
    // there is nothing missing.
    const empty = new Uint8Array(42)
    empty.set([0x66, 0x4C, 0x61, 0x43, 0x80, 0, 0, 34])
    const info = empty.subarray(8)
    info.set([0x10, 0x00, 0x10, 0x00]) // block sizes 4096
    info[10] = 0x0A // 44100 Hz: 0x0AC44 across 20 bits
    info[11] = 0xC4
    info[12] = 0x40 | (0 << 1) | (15 >> 4) // mono, 16-bit
    info[13] = (15 & 0x0F) << 4
    const decoded = decodeFlacFile(empty)
    expect(decoded.sampleRate).toBe(44100)
    expect(decoded.channels).toHaveLength(1)
    expect(decoded.channels[0].length).toBe(0)

    // The same header promising samples it no longer has.
    const truncated = new Uint8Array(empty)
    truncated[8 + 17] = 100
    expect(() => decodeFlacFile(truncated)).toThrow(/no frames/)
  })

  test('codes sample rates the frame header has no code for', () => {
    // 7 kHz has a kHz code, 11.025 kHz an Hz one, and 100,003 Hz none at all,
    // which leaves the frame deferring to STREAMINFO.
    for (const sampleRate of [7000, 11025, 100_003]) {
      const channels = signal(3000, 1, 16)
      const encoded = encodeFlac(channels, { sampleRate })
      const decoded = decodeFlacFile(encoded)
      expect(decoded.sampleRate).toBe(sampleRate)
      expectSameSamples(decoded.channels, channels)
    }
  })

  test('carries more than two channels, each coded on its own', () => {
    const channels = signal(6000, 6, 16)
    const encoded = encodeFlac(channels, { sampleRate: 48000 })
    const { audioStart } = readFlacMetadata(encoded)
    // Six independent channels is assignment 5; stereo modes do not apply.
    expect(parseFlacFrameHeader(encoded, audioStart)).toMatchObject({ channels: 6, channelAssignment: 5 })
    expectSameSamples(decodeFlacFile(encoded).channels, channels)
  })

  test('decodes the same with LPC and stereo decorrelation turned off', () => {
    const channels = signal(9000, 2, 16)
    const plain = encodeFlac(channels, { sampleRate: 44100, maxLpcOrder: 0, stereoDecorrelation: false })
    expectSameSamples(decodeFlacFile(plain).channels, channels)
    // And the smarter choices are smaller, or they would not be worth making.
    expect(encodeFlac(channels, { sampleRate: 44100 }).length).toBeLessThan(plain.length)
  })

  test('refuses what FLAC cannot hold, by name', () => {
    const mono = signal(100, 1, 16)
    expect(() => encodeFlac(mono, { sampleRate: 44100, bitsPerSample: 32 })).toThrow(FlacEncodeError)
    expect(() => encodeFlac(mono, { sampleRate: 44100, blockSize: 8 })).toThrow(/block size/)
    expect(() => encodeFlac([], { sampleRate: 44100 })).toThrow(/1 to 8 channels/)
    expect(() => encodeFlac([new Int32Array(10), new Int32Array(11)], { sampleRate: 44100 })).toThrow(/same length/)
    expect(() => encodeFlac([Int32Array.of(40_000)], { sampleRate: 44100, bitsPerSample: 16 })).toThrow(/outside 16-bit range/)
    expect(() => encodeFlac(mono, { sampleRate: 0 })).toThrow(/sample rate/)
  })
})

describe('FLAC encoding, checked by the reference decoder', () => {
  // flac --test decodes the file with libFLAC and checks its MD5. It is not
  // needed to run the suite, so these are skipped where it is not installed.
  const flac = Bun.which('flac')

  test.skipIf(!flac)('produces files libFLAC decodes and whose MD5 it confirms', async () => {
    const dir = (await Bun.$`mktemp -d`.text()).trim()
    try {
      const files: [string, Int32Array[], number, number][] = [
        ['mono16', signal(20_000, 1, 16), 16, 44100],
        ['stereo16', signal(20_000, 2, 16), 16, 44100],
        ['stereo24', signal(20_000, 2, 24), 24, 96000],
        ['mono8', signal(20_000, 1, 8), 8, 8000],
        ['surround', signal(9000, 6, 16), 16, 48000],
        ['odd-rate', signal(9000, 1, 16), 16, 11025],
      ]
      for (const [name, channels, bitsPerSample, sampleRate] of files) {
        const path = `${dir}/${name}.flac`
        await Bun.write(path, encodeFlac(channels, { sampleRate, bitsPerSample }))
        const proc = Bun.spawn([flac!, '--test', '--silent', path], { stderr: 'pipe' })
        const code = await proc.exited
        const complaint = code === 0 ? '' : await new Response(proc.stderr).text()
        expect({ name, code, complaint }).toEqual({ name, code: 0, complaint: '' })
      }
    }
    finally {
      await Bun.$`rm -rf ${dir}`
    }
  })
})
