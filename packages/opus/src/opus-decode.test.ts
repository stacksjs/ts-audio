import { describe, expect, test } from 'bun:test'
import { decodeAudio, decodeAudioToWav, decodeWav } from '@ts-audio/core'
import { readOggPackets } from './opus-audio'
import { OpusDecoder, parseOpusPacket } from './opus-decoder'

const fixture = (path: string): string => new URL(`../test/fixtures/voice/${path}`, import.meta.url).pathname
const bytes = async (path: string): Promise<Uint8Array> => new Uint8Array(await Bun.file(fixture(path)).arrayBuffer())

/** Signal to error of `actual` against `expected`, over `expected`'s length, in dB. */
function snr(expected: Float32Array, actual: Float32Array): number {
  let signal = 0
  let error = 0
  for (let i = 0; i < expected.length; i++) {
    signal += expected[i] ** 2
    error += (expected[i] - (actual[i] ?? 0)) ** 2
  }
  return error === 0 ? Infinity : 10 * Math.log10(signal / error)
}

async function apple(name: string): Promise<Float32Array> {
  return decodeWav(await bytes(`ref-voice-opus-${name}.wav`)).channels[0]
}

describe('Opus', () => {
  // The fixtures are Apple's Opus encoder's (test/fixtures/voice/make-opus-fixtures.ts);
  // ref-voice-opus-*.wav are Apple's own decodes, written as 16-bit.

  test('decodes a SILK voice note in Ogg (WhatsApp-style, 12 kbit/s) exactly as Apple does', async () => {
    const [ours, reference] = await Promise.all([decodeAudio(await bytes('voice-opus-silk.opus')), apple('silk')])
    expect(ours).toMatchObject({ codec: 'opus', sampleRate: 48000 })
    expect(ours.channels).toHaveLength(1)
    // Pre-skip dropped at the start, padding at the end: the same samples, every one.
    expect(ours.channels[0].length).toBe(reference.length)
    expect(snr(reference, ours.channels[0])).toBe(Infinity)
  })

  test('decodes CELT frames, as Chrome records them, as Apple does', async () => {
    const [ours, reference] = await Promise.all([decodeAudio(await bytes('voice-opus-celt.opus')), apple('celt')])
    expect(ours).toMatchObject({ codec: 'opus', sampleRate: 48000 })
    expect(ours.channels[0].length).toBe(reference.length)
    expect(snr(reference, ours.channels[0])).toBeGreaterThan(75)
  })

  test('decodes hybrid frames as Apple does when told to fold bands as decoders before RFC 8251 did', async () => {
    const { packets } = readOggPackets(await bytes('voice-opus-hybrid.opus'))
    const reference = await apple('hybrid')
    const decoder = new OpusDecoder(1, { legacyHybridFolding: true })
    const decoded = packets.slice(2).map(packet => decoder.decode(packet))
    const all = new Float32Array(decoded.reduce((n, pcm) => n + pcm.length, 0))
    decoded.reduce((at, pcm) => (all.set(pcm, at), at + pcm.length), 0)
    expect(snr(reference, all.subarray(312))).toBeGreaterThan(75)
  })

  test('decodes hybrid frames the RFC 8251 way by default: the same sound, a few bands folded differently', async () => {
    const [ours, reference] = await Promise.all([decodeAudio(await bytes('voice-opus-hybrid.opus')), apple('hybrid')])
    expect(ours.channels[0].length).toBe(reference.length)
    expect(snr(reference, ours.channels[0])).toBeGreaterThan(40)
  })

  test('turns an Opus voice note into the 16 kHz mono WAV speech-to-text takes', async () => {
    const wav = await decodeAudioToWav(await bytes('voice-opus-silk.opus'), { maxDurationSeconds: 300 })
    const reference = await apple('silk')
    expect(wav).toMatchObject({ mimeType: 'audio/wav', sampleRate: 16000, channels: 1 })
    expect(wav.durationSeconds).toBeCloseTo(reference.length / 48000, 3)
  })

  test('says plainly that Ogg Vorbis is not Opus', async () => {
    // One Ogg page holding a Vorbis identification header.
    const packet = new Uint8Array([1, ...new TextEncoder().encode('vorbis'), ...new Array(23).fill(0)])
    const page = new Uint8Array(28 + packet.length)
    page.set(new TextEncoder().encode('OggS'))
    page[5] = 2
    page[26] = 1
    page[27] = packet.length
    page.set(packet, 28)
    await expect(decodeAudio(page)).rejects.toThrow('vorbis')
  })
})

describe('Opus packets', () => {
  test('finds the frames of every packing code', () => {
    const toc = 0x78 // hybrid, full band, 20 ms
    expect(parseOpusPacket(new Uint8Array([toc, 1, 2, 3])).frames).toEqual([{ offset: 1, length: 3 }])
    expect(parseOpusPacket(new Uint8Array([toc | 1, 1, 2, 3, 4])).frames).toEqual([{ offset: 1, length: 2 }, { offset: 3, length: 2 }])
    expect(parseOpusPacket(new Uint8Array([toc | 2, 1, 9, 8, 7])).frames).toEqual([{ offset: 2, length: 1 }, { offset: 3, length: 2 }])
    // Code 3, three frames of equal size, with one byte of padding.
    expect(parseOpusPacket(new Uint8Array([toc | 3, 0x43, 1, 5, 5, 6, 6, 7, 7, 0])).frames).toEqual([{ offset: 3, length: 2 }, { offset: 5, length: 2 }, { offset: 7, length: 2 }])
  })

  test('refuses a packet that cannot be split as it says', () => {
    expect(() => parseOpusPacket(new Uint8Array([0x79, 1, 2, 3]))).toThrow()
  })
})
