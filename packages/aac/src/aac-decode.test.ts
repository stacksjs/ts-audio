import type { EncodedPacket } from '@ts-audio/core'
import { describe, expect, test } from 'bun:test'
import { createSource, decodeAudio, decodeAudioToWav, decodeWav, imdct, Input, resampleAudio } from '@ts-audio/core'
import { AacInputFormat } from './index'
import { AacDecodeError, createAacDecoder } from './aac-decoder'

const fixture = (path: string): string => new URL(`../test/fixtures/voice/${path}`, import.meta.url).pathname

/** Signal to error, in decibels, of `actual` against `expected`, over every channel. */
function snr(expected: Float32Array[], actual: Float32Array[]): number {
  let signal = 0
  let error = 0
  expected.forEach((channel, c) => {
    for (let i = 0; i < channel.length; i++) {
      signal += channel[i] ** 2
      error += (channel[i] - actual[c][i]) ** 2
    }
  })
  return 10 * Math.log10(signal / error)
}

/** How alike two recordings of the same words are, at the shift that lines them up best. */
function bestCorrelation(a: Float32Array, b: Float32Array, maxShift: number): number {
  let best = 0
  for (let shift = -maxShift; shift <= maxShift; shift++) {
    let dot = 0
    let energyA = 0
    let energyB = 0
    for (let i = Math.max(0, -shift); i < Math.min(a.length, b.length - shift); i++) {
      dot += a[i] * b[i + shift]
      energyA += a[i] ** 2
      energyB += b[i + shift] ** 2
    }
    const correlation = dot / Math.sqrt(energyA * energyB)
    if (correlation > best)
      best = correlation
  }
  return best
}

async function reference(name: string): Promise<ReturnType<typeof decodeWav>> {
  return decodeWav(new Uint8Array(await Bun.file(fixture(name)).arrayBuffer()))
}

describe('AAC', () => {
  // The fixtures are Apple's encoder's (test/fixtures/voice/make-aac-fixtures.sh);
  // ref-*.wav are Apple's own decodes of them, written as 16-bit. An ADTS
  // stream marks no priming or padding, so both decoders hand back every
  // frame and the two agree sample for sample.
  test('decodes a phone voice note (mono AAC-LC in ADTS) as Apple does, sample for sample', async () => {
    const [ours, apple] = await Promise.all([decodeAudio(fixture('voice-aac-lc.aac')), reference('ref-voice-aac-lc.wav')])
    expect(ours).toMatchObject({ codec: 'aac', sampleRate: 44100 })
    expect(ours.channels).toHaveLength(1)
    expect(ours.channels[0].length).toBe(apple.channels[0].length)
    expect(snr(apple.channels, ours.channels)).toBeGreaterThan(80)
  })

  test('decodes stereo 48 kHz AAC as Apple does', async () => {
    const [ours, apple] = await Promise.all([decodeAudio(fixture('voice-aac-stereo.aac')), reference('ref-voice-aac-stereo.wav')])
    expect(ours).toMatchObject({ codec: 'aac', sampleRate: 48000 })
    expect(ours.channels).toHaveLength(2)
    expect(ours.channels[0].length).toBe(apple.channels[0].length)
    expect(snr(apple.channels, ours.channels)).toBeGreaterThan(80)
  })

  test('decodes the AAC core of HE-AAC: the voice, at half the rate', async () => {
    const [he, lc] = await Promise.all([decodeAudio(fixture('voice-he-aac.aac')), decodeAudio(fixture('voice-aac-lc.aac'))])
    expect(he.sampleRate).toBe(22050)
    // The same words, decoded at half the rate. ADTS marks no priming or
    // padding and HE-AAC's frames hold twice as many samples, so the stream
    // runs a little past the AAC-LC one rather than ending with it.
    expect(he.duration).toBeGreaterThanOrEqual(lc.duration)
    expect(he.duration).toBeLessThan(lc.duration * 1.15)
    // Two encodings of the same words: below 11 kHz they sound the same. The
    // two encoders prime by different amounts, which ADTS does not mark, so
    // the shift between them is found rather than assumed.
    const [low] = resampleAudio(lc.channels, 44100, 22050)
    expect(bestCorrelation(low, he.channels[0], 2048)).toBeGreaterThan(0.95)
  })

  test('turns a voice note into the 16 kHz mono WAV speech-to-text takes', async () => {
    const wav = await decodeAudioToWav(fixture('voice-aac-stereo.aac'), { maxDurationSeconds: 300 })
    const apple = await reference('ref-voice-aac-stereo.wav')
    expect(wav).toMatchObject({ mimeType: 'audio/wav', sampleRate: 16000, channels: 1 })
    expect(wav.durationSeconds).toBeCloseTo(apple.channels[0].length / 48000, 3)
    expect(decodeWav(wav.audio).channels[0].length).toBe(Math.floor(apple.channels[0].length / 3))
  })

  test('hears a damaged frame as silence and carries on, but refuses a damaged file', async () => {
    const input = new Input({ source: createSource(fixture('voice-aac-lc.aac')), format: new AacInputFormat() })
    const track = (await input.getPrimaryTrack())!
    const packets: EncodedPacket[] = []
    for await (const packet of input.packets(track.id)) packets.push(packet)
    await input.close()

    const decoder = createAacDecoder(track)
    const outputs = packets.map((packet, i) => decoder.decode(i === 10 ? { ...packet, data: new Uint8Array([0x20, 0, 0]) } : packet))
    expect(outputs.every(output => output?.channels[0].length === 1024)).toBe(true)
    expect(Math.max(...outputs[10]!.channels[0])).toBe(0)
    expect(Math.max(...outputs[20]!.channels[0].map(Math.abs))).toBeGreaterThan(0)

    const broken = createAacDecoder(track)
    expect(() => packets.forEach(packet => broken.decode({ ...packet, data: new Uint8Array([0x20, 0, 0]) }))).toThrow(AacDecodeError)
  })

  test('the inverse MDCT matches its definition', () => {
    for (const half of [1024, 128]) {
      const length = half * 2
      const input = new Float32Array(half).map((_, k) => Math.sin(k * 1.7) * 0.5)
      const fast = imdct(input)
      for (const n of [0, 1, half / 2, half - 1, half, length - 1]) {
        let sum = 0
        for (let k = 0; k < half; k++) sum += input[k] * Math.cos(2 * Math.PI / length * (n + (half + 1) / 2) * (k + 0.5))
        expect(fast[n]).toBeCloseTo(sum * 2 / length, 6)
      }
    }
  })
})
