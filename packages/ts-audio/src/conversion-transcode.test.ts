import type { ConversionOptions } from './types'
import { describe, expect, test } from 'bun:test'
import { FlacOutputFormat } from '@ts-audio/flac'
import { Mp3OutputFormat } from '@ts-audio/mp3'
import { OggOutputFormat } from '@ts-audio/ogg'
import { WavOutputFormat } from '@ts-audio/wav'
import { decodeAudio } from './audio-decode'
import { decodeWav, encodeWav } from './audio-samples'
import { Conversion, convert } from './conversion'
import { createInput } from './input'
import { Output } from './output'

const root = new URL('../../', import.meta.url).pathname
const voice = {
  wav: `${root}ts-audio/test/fixtures/voice/speech-s16-22k-mono.wav`,
  mp3: `${root}mp3/test/fixtures/voice/voice-mp3-joint.mp3`,
  aac: `${root}aac/test/fixtures/voice/voice-aac-lc.aac`,
  flac: `${root}flac/test/fixtures/voice/voice-flac-mono.flac`,
  flacStereo: `${root}flac/test/fixtures/voice/voice-flac-stereo.flac`,
  flac24: `${root}flac/test/fixtures/voice/voice-flac-24bit.flac`,
  vorbis: `${root}vorbis/test/fixtures/voice/voice-vorbis-stereo.ogg`,
  opus: `${root}opus/test/fixtures/voice/voice-opus-silk.opus`,
}

async function run(path: string, format: WavOutputFormat | FlacOutputFormat | Mp3OutputFormat | OggOutputFormat, options: ConversionOptions = {}): Promise<{ bytes: Uint8Array, mode: string }> {
  const conversion = await Conversion.init({ input: createInput(path), output: new Output({ format }), options })
  try {
    const mode = conversion.conversionMode
    return { bytes: await conversion.execute(), mode }
  }
  finally {
    await conversion.close()
  }
}

function expectIdentical(actual: Float32Array[], expected: Float32Array[]): void {
  expect(actual).toHaveLength(expected.length)
  for (let c = 0; c < expected.length; c++) {
    expect(actual[c].length).toBe(expected[c].length)
    for (let i = 0; i < expected[c].length; i++) {
      if (actual[c][i] !== expected[c][i])
        throw new Error(`channel ${c} sample ${i}: ${actual[c][i]}, expected ${expected[c][i]}`)
    }
  }
}

describe('choosing to copy or to re-encode', () => {
  test('copies the packets when nothing about the audio changes', async () => {
    // Copying keeps the source's own bitstream, so it is preferred.
    expect((await run(voice.flac, new FlacOutputFormat())).mode).toBe('copy')
    expect((await run(voice.wav, new WavOutputFormat(), { startTime: 0.5 })).mode).toBe('copy')
  })

  test('re-encodes when the codec has to change', async () => {
    expect((await run(voice.wav, new FlacOutputFormat())).mode).toBe('transcode')
    expect((await run(voice.mp3, new WavOutputFormat())).mode).toBe('transcode')
  })

  test('re-encodes when the audio itself has to change, even into the same codec', async () => {
    expect((await run(voice.flac, new FlacOutputFormat(), { sampleRate: 16000 })).mode).toBe('transcode')
  })
})

describe('lossless conversion', () => {
  // Every decoder turns an integer into a float by dividing by 2^(bits - 1),
  // and every encoder here multiplies by the same, so a lossless conversion at
  // 24 bits or fewer comes back with the very same samples.
  const pairs: [string, string, WavOutputFormat | FlacOutputFormat][] = [
    ['WAV to FLAC', voice.wav, new FlacOutputFormat()],
    ['FLAC to WAV', voice.flac, new WavOutputFormat()],
    ['stereo FLAC to WAV', voice.flacStereo, new WavOutputFormat()],
    ['24-bit FLAC to WAV', voice.flac24, new WavOutputFormat()],
  ]
  for (const [what, path, format] of pairs) {
    test(`${what} keeps every sample`, async () => {
      const [source, { bytes }] = await Promise.all([decodeAudio(path), run(path, format)])
      expectIdentical((await decodeAudio(bytes)).channels, source.channels)
    })
  }

  test('keeps a 24-bit source at 24 bits, rather than cutting it to 16', async () => {
    const { bytes } = await run(voice.flac24, new WavOutputFormat())
    expect(new DataView(bytes.buffer, bytes.byteOffset).getUint16(34, true)).toBe(24)
  })
})

describe('lossy sources', () => {
  for (const name of ['mp3', 'aac', 'vorbis', 'opus'] as const) {
    test(`${name} to WAV and FLAC keeps the decoded audio, to within half a 16-bit step`, async () => {
      const source = await decodeAudio(voice[name])
      for (const format of [new WavOutputFormat(), new FlacOutputFormat()]) {
        const converted = await decodeAudio((await run(voice[name], format)).bytes)
        expect(converted.sampleRate).toBe(source.sampleRate)
        expect(converted.channels).toHaveLength(source.channels.length)
        // Gapless and pre-skip trimmed exactly as decodeAudio trims them.
        expect(converted.channels[0].length).toBe(source.channels[0].length)
        let worst = 0
        for (let c = 0; c < source.channels.length; c++) {
          for (let i = 0; i < source.channels[c].length; i++)
            worst = Math.max(worst, Math.abs(converted.channels[c][i] - source.channels[c][i]))
        }
        // Storing arbitrary floats at 16 bits rounds each to the nearest step,
        // and nothing more than that may change.
        expect(worst).toBeLessThanOrEqual(0.5 / 32768 + 1e-9)
      }
    })
  }
})

describe('changing the audio on the way', () => {
  test('resamples, keeping the duration', async () => {
    const decoded = await decodeAudio((await run(voice.flacStereo, new WavOutputFormat(), { sampleRate: 16000 })).bytes)
    expect(decoded.sampleRate).toBe(16000)
    expect(decoded.duration).toBeCloseTo(101_842 / 44100, 2)
  })

  test('mixes to mono and up to stereo', async () => {
    expect((await decodeAudio((await run(voice.flacStereo, new FlacOutputFormat(), { channels: 1 })).bytes)).channels).toHaveLength(1)
    expect((await decodeAudio((await run(voice.flac, new FlacOutputFormat(), { channels: 2 })).bytes)).channels).toHaveLength(2)
  })

  test('trims to the sample, which copying between packets cannot', async () => {
    const decoded = await decodeAudio((await run(voice.wav, new FlacOutputFormat(), { startTime: 0.5, endTime: 1.5 })).bytes)
    expect(decoded.channels[0].length).toBe(22050)
    const full = await decodeAudio(voice.wav)
    // And they are the right samples, not just the right number of them.
    expectIdentical(decoded.channels, [full.channels[0].subarray(11025, 33075)])
  })

  test('normalises with one gain for every channel, so stereo keeps its balance', async () => {
    const decoded = await decodeAudio((await run(voice.flacStereo, new FlacOutputFormat(), { normalize: true })).bytes)
    let peak = 0
    for (const channel of decoded.channels) {
      for (const sample of channel) peak = Math.max(peak, Math.abs(sample))
    }
    expect(peak).toBeGreaterThan(0.999)
    const source = await decodeAudio(voice.flacStereo)
    const ratio = (c: Float32Array[]): number => c[0].reduce((n, v) => n + Math.abs(v), 0) / c[1].reduce((n, v) => n + Math.abs(v), 0)
    expect(ratio(decoded.channels)).toBeCloseTo(ratio(source.channels), 3)
  })

  test('applies a volume change', async () => {
    const [source, quieter] = await Promise.all([
      decodeAudio(voice.flac),
      run(voice.flac, new WavOutputFormat(), { volume: 0.5 }).then(r => decodeAudio(r.bytes)),
    ])
    for (let i = 1000; i < 2000; i++) expect(quieter.channels[0][i]).toBeCloseTo(source.channels[0][i] * 0.5, 4)
  })

  test('writes the bit depth asked for', async () => {
    const { bytes } = await run(voice.flac, new FlacOutputFormat(), { bitDepth: 24 })
    expect((await decodeAudio(bytes)).codec).toBe('flac')
    const { bytes: wav } = await run(voice.flac, new WavOutputFormat(), { bitDepth: 8 })
    expect(new DataView(wav.buffer, wav.byteOffset).getUint16(34, true)).toBe(8)
  })
})

describe('what a conversion refuses, by name', () => {
  test('a codec ts-audio cannot encode', async () => {
    await expect(run(voice.wav, new Mp3OutputFormat())).rejects.toThrow(/no mp3 encoder/)
  })

  test('a bitrate for a lossless target', async () => {
    await expect(run(voice.wav, new FlacOutputFormat(), { audioBitrate: 320_000 })).rejects.toThrow(/lossless/)
  })

  test('mixing to a channel count other than mono or stereo', async () => {
    await expect(run(voice.wav, new WavOutputFormat(), { channels: 6 })).rejects.toThrow(/mono or stereo/)
  })

  test('silence trimming', async () => {
    await expect(run(voice.wav, new FlacOutputFormat(), { trimSilence: true })).rejects.toThrow(/silence/i)
  })

  test('FLAC into an Ogg container', async () => {
    await expect(run(voice.wav, new OggOutputFormat(), { audioCodec: 'flac' })).rejects.toThrow(/\.flac file/)
  })
})

describe('the convert() shortcut', () => {
  test('finds the output format from the extension with nothing registered', async () => {
    // It used to look only at the registry, which nothing fills, so it failed
    // for every file, WAV to WAV included.
    const dir = (await Bun.$`mktemp -d`.text()).trim()
    try {
      await convert(voice.wav, `${dir}/out.flac`)
      const decoded = await decodeAudio(`${dir}/out.flac`)
      expect(decoded.codec).toBe('flac')
      expectIdentical(decoded.channels, (await decodeAudio(voice.wav)).channels)
    }
    finally {
      await Bun.$`rm -rf ${dir}`
    }
  })
})

describe('encodeWav', () => {
  test('is the exact inverse of decoding, at every depth', () => {
    // Scaling positive samples by 32767, as it once did, moved about one in
    // two hundred by a step.
    for (const bitDepth of [8, 16, 24] as const) {
      const steps = 2 ** (bitDepth - 1)
      const samples = Float32Array.from({ length: 4000 }, (_, i) => (((i * 7919) % (2 * steps)) - steps) / steps)
      const back = decodeWav(encodeWav([samples], 44100, { bitDepth })).channels[0]
      expectIdentical([back], [samples])
    }
  })

  test('refuses a depth WAV is not written at', () => {
    expect(() => encodeWav([new Float32Array(4)], 44100, { bitDepth: 12 as 16 })).toThrow(/8, 16, 24 or 32/)
  })
})
