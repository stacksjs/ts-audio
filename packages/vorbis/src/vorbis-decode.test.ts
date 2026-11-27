import { describe, expect, test } from 'bun:test'
import { AudioTooLongError, canDecodeAudioCodec, decodeAudio, decodeAudioToWav, decodeWav } from '@ts-audio/core'
import { VorbisDecodeError } from './vorbis-bitstream'
import { VorbisDecoder } from './vorbis-decoder'
import { isVorbisIdentification, parseVorbisIdentification, parseVorbisSetup } from './vorbis-setup'
import { createVorbisDecoder, decodeOggVorbis, isOggVorbis, readOggPackets } from './vorbis-audio'

const fixture = (name: string): string => new URL(`../test/fixtures/voice/${name}`, import.meta.url).pathname
const bytes = async (name: string): Promise<Uint8Array> => new Uint8Array(await Bun.file(fixture(name)).arrayBuffer())

/** Signal to error of `actual` against `expected`, over every channel, in dB. */
function snr(expected: Float32Array[], actual: Float32Array[]): number {
  let signal = 0
  let error = 0
  expected.forEach((channel, c) => {
    for (let i = 0; i < channel.length; i++) {
      signal += channel[i] ** 2
      error += (channel[i] - (actual[c][i] ?? 0)) ** 2
    }
  })
  return 10 * Math.log10(signal / error)
}

async function reference(name: string): Promise<Float32Array[]> {
  return decodeWav(await bytes(`ref-voice-vorbis-${name}.wav`)).channels
}

// The fixtures and the references are both libvorbis 1.3.7's, through
// test/fixtures/voice/vorbis-ref.c: it is the reference implementation, and
// macOS ships no Vorbis encoder or decoder to use instead.
//
// The references are 16-bit, so their own quantisation sets the ceiling these
// can be measured to: for speech at this level that is about 81 dB, which is
// what they reach. The threshold is 75.
const FIXTURES = [
  { name: 'mono', rate: 44100, channels: 1, what: '44.1 kHz mono at q4' },
  { name: 'stereo', rate: 44100, channels: 2, what: 'channel coupling in stereo' },
  { name: 'low', rate: 22050, channels: 1, what: '22.05 kHz at q-1, one block size throughout' },
  { name: 'high', rate: 48000, channels: 1, what: '48 kHz at q8' },
] as const

describe('Vorbis', () => {
  for (const { name, rate, channels, what } of FIXTURES) {
    test(`decodes ${what} as libvorbis does`, async () => {
      const [ours, theirs] = await Promise.all([decodeOggVorbis(await bytes(`voice-vorbis-${name}.ogg`)), reference(name)])
      expect(ours.sampleRate).toBe(rate)
      expect(ours.channels).toHaveLength(channels)
      // The last page's granule position says where the sound ends, to the sample.
      expect(ours.channels[0].length).toBe(theirs[0].length)
      expect(snr(theirs, ours.channels)).toBeGreaterThan(75)
    })
  }

  test('reads an Ogg Vorbis file through decodeAudio, not as Opus', async () => {
    const decoded = await decodeAudio(await bytes('voice-vorbis-stereo.ogg'))
    expect(decoded).toMatchObject({ codec: 'vorbis', sampleRate: 44100 })
    expect(decoded.channels).toHaveLength(2)
    expect(snr(await reference('stereo'), decoded.channels)).toBeGreaterThan(75)
  })

  test('is one of the codecs core decodes without being told', () => {
    expect(canDecodeAudioCodec('vorbis')).toBe(true)
  })

  test('turns an Ogg Vorbis file into the 16 kHz mono WAV speech-to-text takes', async () => {
    const wav = await decodeAudioToWav(await bytes('voice-vorbis-mono.ogg'), { maxDurationSeconds: 300 })
    const theirs = await reference('mono')
    expect(wav).toMatchObject({ mimeType: 'audio/wav', sampleRate: 16000, channels: 1 })
    expect(wav.durationSeconds).toBeCloseTo(theirs[0].length / 44100, 3)
  })

  test('refuses audio over the duration limit', async () => {
    const file = await bytes('voice-vorbis-mono.ogg')
    await expect(decodeAudio(file, { maxDurationSeconds: 0.2 })).rejects.toBeInstanceOf(AudioTooLongError)
    await expect(decodeAudio(file, { maxDurationSeconds: 10 })).resolves.toMatchObject({ codec: 'vorbis' })
  })

  test('stops when it is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(decodeAudio(await bytes('voice-vorbis-mono.ogg'), { signal: controller.signal })).rejects.toThrow()
  })

  test('tells an Ogg Vorbis file from anything else', async () => {
    expect(isOggVorbis(await bytes('voice-vorbis-mono.ogg'))).toBe(true)
    // An Ogg file, but an Opus one.
    expect(isOggVorbis(new Uint8Array(await Bun.file(new URL('../../opus/test/fixtures/voice/voice-opus-silk.opus', import.meta.url).pathname).arrayBuffer()))).toBe(false)
    expect(isOggVorbis(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]))).toBe(false)
    expect(isOggVorbis(new Uint8Array(0))).toBe(false)
  })
})

describe('Vorbis headers', () => {
  test('reads what the stream says about itself', async () => {
    const { packets } = readOggPackets(await bytes('voice-vorbis-mono.ogg'))
    expect(isVorbisIdentification(packets[0])).toBe(true)
    expect(isVorbisIdentification(packets[2])).toBe(false)
    const identification = parseVorbisIdentification(packets[0])
    expect(identification).toMatchObject({ channels: 1, sampleRate: 44100, blockSize0: 256, blockSize1: 2048 })
    const setup = parseVorbisSetup(packets[2], identification)
    // What libvorbis writes for mono speech: two block sizes, so two modes.
    expect(setup.modes).toHaveLength(2)
    expect(setup.modes.map(m => m.blockFlag)).toEqual([false, true])
    expect(setup.floors).toHaveLength(2)
    expect(setup.residues.every(r => r.type === 1)).toBe(true)
    expect(setup.codebooks.length).toBeGreaterThan(20)
    // Every codebook has to be a usable prefix code, or building it would have thrown.
    expect(setup.codebooks.every(b => b.tree.length >= 2)).toBe(true)
  })

  test('finds the coupling a stereo stream uses', async () => {
    const { packets } = readOggPackets(await bytes('voice-vorbis-stereo.ogg'))
    const identification = parseVorbisIdentification(packets[0])
    const setup = parseVorbisSetup(packets[2], identification)
    expect(identification.channels).toBe(2)
    // Two channels of one voice are worth coupling, so libvorbis does.
    expect(setup.mappings.some(m => m.couplingMagnitude.length > 0)).toBe(true)
    for (const mapping of setup.mappings) {
      for (let i = 0; i < mapping.couplingMagnitude.length; i++)
        expect(mapping.couplingMagnitude[i]).not.toBe(mapping.couplingAngle[i])
    }
  })

  test('refuses a packet that is not the header it should be', async () => {
    const { packets } = readOggPackets(await bytes('voice-vorbis-mono.ogg'))
    const identification = parseVorbisIdentification(packets[0])
    expect(() => parseVorbisIdentification(packets[2])).toThrow(VorbisDecodeError)
    expect(() => parseVorbisSetup(packets[0], identification)).toThrow(VorbisDecodeError)
    expect(() => parseVorbisIdentification(new Uint8Array([1, 2, 3]))).toThrow(VorbisDecodeError)
  })

  test('refuses a stream with no Vorbis in it', () => {
    const page = new Uint8Array(28)
    page.set(new TextEncoder().encode('OggS'))
    page[26] = 1
    page[27] = 0
    expect(() => decodeOggVorbis(page)).toThrow(VorbisDecodeError)
  })
})

describe('Vorbis packets', () => {
  test('decodes a track handed over packet by packet, as a container reader hands it', async () => {
    const file = await bytes('voice-vorbis-mono.ogg')
    const { packets } = readOggPackets(file)
    const identification = parseVorbisIdentification(packets[0])
    const decoder = createVorbisDecoder({
      type: 'audio',
      id: 1,
      index: 0,
      codec: 'vorbis',
      sampleRate: identification.sampleRate,
      channels: identification.channels,
    })
    // With no description the three headers arrive as the first packets, which
    // is how a stream without CodecPrivate reaches a decoder.
    const collected: Float32Array[] = []
    packets.forEach((data, i) => {
      const chunk = decoder.decode({ data, timestamp: i, duration: 0, isKeyframe: true, trackId: 1 })
      if (chunk)
        collected.push(chunk.channels[0])
    })
    const total = collected.reduce((n, part) => n + part.length, 0)
    const joined = new Float32Array(total)
    collected.reduce((at, part) => (joined.set(part, at), at + part.length), 0)

    const whole = decodeOggVorbis(file).channels[0]
    // The packet path knows no granule positions, so it keeps the tail the
    // file's last page would have trimmed; up to there the two agree exactly.
    expect(total).toBeGreaterThanOrEqual(whole.length)
    expect(Array.from(joined.subarray(0, whole.length))).toEqual(Array.from(whole))
  })

  test('refuses a packet that is not an audio packet', async () => {
    const { packets } = readOggPackets(await bytes('voice-vorbis-mono.ogg'))
    const identification = parseVorbisIdentification(packets[0])
    const decoder = new VorbisDecoder(identification, parseVorbisSetup(packets[2], identification))
    expect(() => decoder.decodePacket(packets[0])).toThrow(VorbisDecodeError)
  })

  test('yields nothing for the first audio packet, which only primes the lap', async () => {
    const { packets } = readOggPackets(await bytes('voice-vorbis-mono.ogg'))
    const identification = parseVorbisIdentification(packets[0])
    const decoder = new VorbisDecoder(identification, parseVorbisSetup(packets[2], identification))
    expect(decoder.decodePacket(packets[3]).channels).toHaveLength(0)
    expect(decoder.decodePacket(packets[4]).channels).toHaveLength(1)
  })
})
