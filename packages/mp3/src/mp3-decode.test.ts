import { describe, expect, test } from 'bun:test'
import { AudioTooLongError, decodeAudio, decodeAudioToWav, decodeWav, UnsupportedAudioCodecError } from '@ts-audio/core'
import { createMp3Decoder, decodeMp3File, isMp3, readMp3Frames } from './mp3-audio'

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

async function apple(name: string): Promise<Float32Array[]> {
  return decodeWav(await bytes(`ref-voice-mp3-${name}.wav`)).channels
}

describe('MP3', () => {
  // The fixtures are LAME's encodes of macOS speech (test/fixtures/voice/make-mp3-fixtures.ts);
  // ref-voice-mp3-*.wav are Apple's own decodes, written as 16-bit. Against
  // mpg123's float output the decodes agree to about 130 dB; Apple's decoder
  // rounds a little differently, so these allow for 75.

  test('decodes MPEG-1 mono as Apple does, starting and ending where LAME\'s tag says', async () => {
    const [ours, reference] = await Promise.all([decodeAudio(await bytes('voice-mp3-mono.mp3')), apple('mono')])
    expect(ours).toMatchObject({ codec: 'mp3', sampleRate: 44100 })
    expect(ours.channels).toHaveLength(1)
    expect(ours.channels[0].length).toBe(reference[0].length)
    expect(snr(reference[0], ours.channels[0])).toBeGreaterThan(75)
  })

  test('decodes joint stereo (mid/side frames and left/right ones) as Apple does', async () => {
    const [ours, reference] = await Promise.all([decodeAudio(await bytes('voice-mp3-joint.mp3')), apple('joint')])
    expect(ours.channels).toHaveLength(2)
    for (let c = 0; c < 2; c++) {
      expect(ours.channels[c].length).toBe(reference[c].length)
      expect(snr(reference[c], ours.channels[c])).toBeGreaterThan(75)
    }
  })

  test('decodes MPEG-2 at 22.05 kHz and MPEG 2.5 at 8 kHz with CRCs, dropping the filterbank\'s delay', async () => {
    for (const [name, rate] of [['lsf', 22050], ['8k', 8000]] as const) {
      const [ours, reference] = await Promise.all([decodeAudio(await bytes(`voice-mp3-${name}.mp3`)), apple(name)])
      expect(ours.sampleRate).toBe(rate)
      // No gapless tag: every frame but the 529 samples the filterbank delays them by.
      expect(ours.channels[0].length).toBe(reference[0].length - 529)
      expect(snr(reference[0].subarray(0, ours.channels[0].length), ours.channels[0])).toBeGreaterThan(75)
    }
  })

  test('reads a VBR file with ID3v2 and ID3v1 tags from its path', async () => {
    const [ours, reference] = await Promise.all([decodeAudio(fixture('voice-mp3-vbr.mp3')), apple('vbr')])
    expect(ours.codec).toBe('mp3')
    expect(ours.channels[0].length).toBe(reference[0].length)
    expect(snr(reference[0], ours.channels[0])).toBeGreaterThan(75)
  })

  test('turns an MP3 into the 16 kHz mono WAV speech-to-text takes', async () => {
    const wav = await decodeAudioToWav(await bytes('voice-mp3-joint.mp3'), { maxDurationSeconds: 300 })
    const reference = await apple('joint')
    expect(wav).toMatchObject({ mimeType: 'audio/wav', sampleRate: 16000, channels: 1 })
    expect(wav.durationSeconds).toBeCloseTo(reference[0].length / 44100, 3)
  })

  test('refuses audio over the duration limit', async () => {
    await expect(decodeAudio(await bytes('voice-mp3-lsf.mp3'), { maxDurationSeconds: 1 })).rejects.toBeInstanceOf(AudioTooLongError)
  })

  test('finds its way past junk between frames', async () => {
    const clean = await bytes('voice-mp3-mono.mp3')
    const { frames } = readMp3Frames(clean)
    const cut = frames[10].byteOffset - clean.byteOffset
    const junk = new Uint8Array(300).map((_, i) => (i * 37 + 11) & 0xFF)
    const damaged = new Uint8Array([...clean.subarray(0, cut), ...junk, ...clean.subarray(cut)])
    const [a, b] = [decodeMp3File(clean), decodeMp3File(damaged)]
    expect(b.channels[0]).toEqual(a.channels[0])
  })

  test('says plainly that MPEG audio Layer II is not MP3', async () => {
    // Three Layer II frames: MPEG-1, 128 kbit/s, 44.1 kHz, mono, 417 bytes each.
    const frame = new Uint8Array(417)
    frame.set([0xFF, 0xFD, 0x80, 0xC0])
    const stream = new Uint8Array([...frame, ...frame, ...frame])
    expect(isMp3(stream)).toBe(true)
    const error = await decodeAudio(stream).catch(e => e)
    expect(error).toBeInstanceOf(UnsupportedAudioCodecError)
    expect(error.message).toBe('Decoding mp2 audio is not supported')
  })

  test('decodes the frames of an MP3 track handed in packet by packet, as a container reader hands them over', async () => {
    const file = await bytes('voice-mp3-mono.mp3')
    const { frames, header } = readMp3Frames(file)
    const decoder = createMp3Decoder({ type: 'audio', id: 1, index: 0, codec: 'mp3', sampleRate: header.sampleRate, channels: header.channels })
    const chunks = frames.map((frame, i) => decoder.decode({
      data: frame,
      timestamp: i * header.samples / header.sampleRate,
      duration: header.samples / header.sampleRate,
      isKeyframe: true,
      trackId: 1,
    }))
    const decoded: Float32Array = new Float32Array(frames.length * header.samples)
    let at = 0
    for (const chunk of chunks) {
      if (!chunk)
        continue
      expect(chunk.sampleRate).toBe(header.sampleRate)
      decoded.set(chunk.channels[0], at)
      at += chunk.channels[0].length
    }
    // A packet decoder knows no gapless numbers: every sample, the encoder's delay and the filterbank's included.
    expect(at).toBe(frames.length * header.samples)
    const plain = decodeMp3File(file).channels[0]
    expect(decoded.subarray(576 + 529, 576 + 529 + plain.length)).toEqual(plain)
  })
})
