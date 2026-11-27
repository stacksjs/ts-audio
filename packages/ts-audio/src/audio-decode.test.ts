import { describe, expect, test } from 'bun:test'
import type { AudioTrack, EncodedPacket } from './types'
import {
  AudioTooLongError,
  canDecodeAudioCodec,
  createAudioDecoder,
  decodeAudio,
  decodeAudioPackets,
  decodeAudioToWav,
  decodeWav,
  encodeWav,
  mixChannels,
  registerAudioDecoder,
  resampleAudio,
  UnsupportedAudioCodecError,
} from './audio-decode'

const fixture = (path: string): string => new URL(`../test/fixtures/${path}`, import.meta.url).pathname

function sine(frequency: number, sampleRate: number, seconds: number, amplitude = 0.5): Float32Array {
  const samples = new Float32Array(Math.round(sampleRate * seconds))
  for (let i = 0; i < samples.length; i++) samples[i] = amplitude * Math.sin(2 * Math.PI * frequency * i / sampleRate)
  return samples
}

function rms(samples: Float32Array, from = 0, to = samples.length): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / (to - from))
}

/** Rising zero crossings a second: the frequency of a clean tone. */
function frequencyOf(samples: Float32Array, sampleRate: number): number {
  let crossings = 0
  for (let i = 1; i < samples.length; i++) {
    if (samples[i - 1] < 0 && samples[i] >= 0) crossings++
  }
  return crossings / (samples.length / sampleRate)
}

/** A WAV of any sample layout, written by hand so the reader is checked against more than its own writer. */
function wav(options: { tag: number, bits: number, channels: number, sampleRate: number, data: Uint8Array, extensible?: boolean, extra?: [string, number][] }): Uint8Array {
  const fmtSize = options.extensible ? 40 : 16
  const extra = options.extra ?? []
  const extraSize = extra.reduce((total, [, size]) => total + 8 + size + (size % 2), 0)
  const size = 12 + 8 + fmtSize + extraSize + 8 + options.data.length
  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)
  const write = (offset: number, text: string): void => {
    for (let i = 0; i < 4; i++) bytes[offset + i] = text.charCodeAt(i)
  }
  write(0, 'RIFF')
  view.setUint32(4, size - 8, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, fmtSize, true)
  view.setUint16(20, options.extensible ? 0xFFFE : options.tag, true)
  view.setUint16(22, options.channels, true)
  view.setUint32(24, options.sampleRate, true)
  view.setUint32(28, options.sampleRate * options.channels * options.bits / 8, true)
  view.setUint16(32, options.channels * options.bits / 8, true)
  view.setUint16(34, options.bits, true)
  if (options.extensible) {
    view.setUint16(36, 22, true)
    view.setUint16(38, options.bits, true)
    view.setUint32(40, 0, true)
    view.setUint16(44, options.tag, true)
  }
  let offset = 20 + fmtSize
  for (const [id, chunkSize] of extra) {
    write(offset, id)
    view.setUint32(offset + 4, chunkSize, true)
    offset += 8 + chunkSize + (chunkSize % 2)
  }
  write(offset, 'data')
  view.setUint32(offset + 4, options.data.length, true)
  bytes.set(options.data, offset + 8)
  return bytes
}

describe('WAV', () => {
  test('reads 16-bit PCM back as it was written', () => {
    const tone = sine(440, 8000, 0.25)
    const decoded = decodeWav(encodeWav([tone], 8000))
    expect(decoded).toMatchObject({ sampleRate: 8000, codec: 'pcm_s16le' })
    expect(decoded.channels).toHaveLength(1)
    expect(decoded.channels[0].length).toBe(tone.length)
    for (let i = 0; i < tone.length; i++) expect(Math.abs(decoded.channels[0][i] - tone[i])).toBeLessThan(1 / 16384)
  })

  test('reads interleaved float stereo into two channels, past a chunk it does not know', () => {
    const left = sine(440, 48000, 0.1, 0.25)
    const right = sine(880, 48000, 0.1, -0.5)
    const data = new Uint8Array(left.length * 8)
    const view = new DataView(data.buffer)
    for (let i = 0; i < left.length; i++) {
      view.setFloat32(i * 8, left[i], true)
      view.setFloat32(i * 8 + 4, right[i], true)
    }
    const decoded = decodeWav(wav({ tag: 3, bits: 32, channels: 2, sampleRate: 48000, data, extra: [['LIST', 7]] }))
    expect(decoded).toMatchObject({ sampleRate: 48000, codec: 'pcm_f32le' })
    expect(Array.from(decoded.channels[0].subarray(0, 50))).toEqual(Array.from(left.subarray(0, 50)))
    expect(Array.from(decoded.channels[1].subarray(0, 50))).toEqual(Array.from(right.subarray(0, 50)))
  })

  test('reads 24-bit PCM in an extensible header, negative values included', () => {
    const values = [0, 1, -1, 8388607, -8388608, 4194304]
    const data = new Uint8Array(values.length * 3)
    values.forEach((value, i) => {
      data[i * 3] = value & 0xFF
      data[i * 3 + 1] = (value >> 8) & 0xFF
      data[i * 3 + 2] = (value >> 16) & 0xFF
    })
    const decoded = decodeWav(wav({ tag: 1, bits: 24, channels: 1, sampleRate: 44100, data, extensible: true }))
    expect(decoded.codec).toBe('pcm_s24le')
    expect(Array.from(decoded.channels[0])).toEqual(values.map(value => value / 8388608))
  })

  test('reads µ-law and A-law telephone audio', () => {
    // 0xFF and 0xD5 are silence in µ-law and A-law; 0x80 and 0xAA their loudest positive codes.
    const mulaw = decodeWav(wav({ tag: 7, bits: 8, channels: 1, sampleRate: 8000, data: new Uint8Array([0xFF, 0x80]) }))
    const alaw = decodeWav(wav({ tag: 6, bits: 8, channels: 1, sampleRate: 8000, data: new Uint8Array([0xD5, 0xAA]) }))
    expect(mulaw.channels[0][0]).toBe(0)
    expect(mulaw.channels[0][1]).toBeCloseTo(32124 / 32768, 4)
    expect(Math.abs(alaw.channels[0][0])).toBeLessThan(0.001)
    expect(alaw.channels[0][1]).toBeCloseTo(32256 / 32768, 4)
  })

  test('reads a WAV as Apple writes it, with a padding chunk before the samples', async () => {
    const decoded = await decodeAudio(new Uint8Array(await Bun.file(fixture('voice/speech-s16-22k-mono.wav')).arrayBuffer()))
    expect(decoded).toMatchObject({ sampleRate: 22050, codec: 'pcm_s16le' })
    expect(decoded.channels).toHaveLength(1)
    expect(decoded.duration).toBeCloseTo(101842 / 2 / 22050, 3)
    expect(rms(decoded.channels[0])).toBeGreaterThan(0.01)
  })
})

describe('resampling', () => {
  test('keeps a tone at its frequency and loudness, 48 kHz to 16 kHz', () => {
    const [out] = resampleAudio([sine(1000, 48000, 1)], 48000, 16000)
    expect(out.length).toBe(16000)
    expect(frequencyOf(out, 16000)).toBeCloseTo(1000, -1)
    expect(rms(out, 1000, 15000)).toBeCloseTo(0.5 / Math.SQRT2, 2)
  })

  test('keeps a tone at an uneven ratio, 44.1 kHz to 16 kHz', () => {
    const [out] = resampleAudio([sine(440, 44100, 1)], 44100, 16000)
    expect(out.length).toBe(16000)
    expect(frequencyOf(out, 16000)).toBeCloseTo(440, -1)
    expect(rms(out, 1000, 15000)).toBeCloseTo(0.5 / Math.SQRT2, 2)
  })

  test('removes a tone above the new Nyquist frequency instead of folding it down', () => {
    // 12 kHz cannot exist at 16 kHz; without a filter it would come back as 4 kHz.
    const [out] = resampleAudio([sine(12000, 48000, 1)], 48000, 16000)
    expect(rms(out, 1000, 15000)).toBeLessThan(0.001)
  })

  test('handles rates with no small ratio between them', () => {
    // 16001 shares no factor with 44100 worth a filter per phase: the interpolated table is used.
    const [out] = resampleAudio([sine(440, 44100, 1)], 44100, 16001)
    expect(out.length).toBe(16001)
    expect(frequencyOf(out, 16001)).toBeCloseTo(440, -1)
    expect(rms(out, 1000, 15000)).toBeCloseTo(0.5 / Math.SQRT2, 2)
  })

  test('goes up as well as down', () => {
    const [out] = resampleAudio([sine(300, 8000, 1)], 8000, 16000)
    expect(out.length).toBe(16000)
    expect(frequencyOf(out, 16000)).toBeCloseTo(300, -1)
    expect(rms(out, 1000, 15000)).toBeCloseTo(0.5 / Math.SQRT2, 2)
  })
})

describe('mixing', () => {
  test('mono is the average of the channels', () => {
    const [mono] = mixChannels([new Float32Array([1, 0.5]), new Float32Array([0, -0.5])], 1)
    expect(Array.from(mono)).toEqual([0.5, 0])
  })
})

describe('decodeAudioToWav', () => {
  test('makes a 16 kHz mono WAV of a 48 kHz stereo file', async () => {
    const left = sine(500, 48000, 2, 0.4)
    const data = new Uint8Array(left.length * 4)
    const view = new DataView(data.buffer)
    for (let i = 0; i < left.length; i++) {
      view.setInt16(i * 4, Math.round(left[i] * 32767), true)
      view.setInt16(i * 4 + 2, Math.round(left[i] * 32767), true)
    }
    const result = await decodeAudioToWav(wav({ tag: 1, bits: 16, channels: 2, sampleRate: 48000, data }))
    expect(result).toMatchObject({ mimeType: 'audio/wav', sampleRate: 16000, channels: 1 })
    expect(result.durationSeconds).toBeCloseTo(2, 3)
    const back = decodeWav(result.audio)
    expect(back).toMatchObject({ sampleRate: 16000, codec: 'pcm_s16le' })
    expect(back.channels).toHaveLength(1)
    expect(frequencyOf(back.channels[0], 16000)).toBeCloseTo(500, -1)
    expect(rms(back.channels[0], 1000, 31000)).toBeCloseTo(0.4 / Math.SQRT2, 2)
  })

  test('refuses audio over the duration limit', async () => {
    const long = encodeWav([sine(440, 8000, 3)], 8000)
    await expect(decodeAudioToWav(long, { maxDurationSeconds: 2 })).rejects.toBeInstanceOf(AudioTooLongError)
    await expect(decodeAudioToWav(long, { maxDurationSeconds: 5 })).resolves.toMatchObject({ channels: 1 })
  })

  test('refuses input over the size limit before reading it', async () => {
    await expect(decodeAudioToWav(encodeWav([sine(440, 8000, 1)], 8000), { maxBytes: 1000 })).rejects.toThrow('size')
  })

  test('stops when it is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(decodeAudio(encodeWav([sine(440, 8000, 1)], 8000), { signal: controller.signal })).rejects.toThrow()
  })
})

describe('compressed codecs', () => {
  test('names the codec it has no decoder for', async () => {
    // Format 0x55 is MP3 inside a WAV: no PCM, and no decoder for it there.
    const error = await decodeAudio(wav({ tag: 0x55, bits: 0, channels: 1, sampleRate: 22050, data: new Uint8Array(64) })).catch(caught => caught)
    expect(error).toBeInstanceOf(UnsupportedAudioCodecError)
  })

  test('a registered decoder takes the place of the built-in one, and unregistering puts it back', async () => {
    let packets = 0
    const unregister = registerAudioDecoder('aac', () => ({
      decode: () => {
        packets++
        return { sampleRate: 32000, channels: [new Float32Array(1024)] }
      },
    }))
    try {
      const decoded = await decodeAudio(fixture('tone.aac'))
      expect(packets).toBeGreaterThan(0)
      expect(Math.max(...decoded.channels[0])).toBe(0)
    }
    finally {
      unregister()
    }
    const real = await decodeAudio(fixture('tone.aac'))
    expect(Math.max(...real.channels[0])).toBeGreaterThan(0.01)
  })

  test('says which codecs it can read without loading a decoder for them', () => {
    expect(canDecodeAudioCodec('pcm_s16le')).toBe(true)
    expect(canDecodeAudioCodec('aac')).toBe(true)
    expect(canDecodeAudioCodec('flac')).toBe(true)
    expect(canDecodeAudioCodec('mp3')).toBe(true)
    expect(canDecodeAudioCodec('opus')).toBe(true)
    expect(canDecodeAudioCodec('vorbis')).toBe(false)
    const unregister = registerAudioDecoder('vorbis', () => ({ decode: () => null }))
    expect(canDecodeAudioCodec('vorbis')).toBe(true)
    unregister()
    expect(canDecodeAudioCodec('vorbis')).toBe(false)
  })
})

describe('decodeAudioPackets', () => {
  // What a caller with its own container reader does: ts-videos reads MP4,
  // WebM, Matroska and MPEG-TS, then hands each track's packets over here.
  const sampleRate = 8000
  const frames = 4000
  const tone = sine(440, sampleRate, frames / sampleRate)

  /** The tone as four packets of interleaved 16-bit PCM, as a container would carry it. */
  function pcmPackets(): EncodedPacket[] {
    const perPacket = frames / 4
    return Array.from({ length: 4 }, (_, p) => {
      const data = new Uint8Array(perPacket * 2)
      const view = new DataView(data.buffer)
      for (let i = 0; i < perPacket; i++) view.setInt16(i * 2, Math.round(tone[p * perPacket + i] * 32767), true)
      return { data, timestamp: p * perPacket / sampleRate, duration: perPacket / sampleRate, isKeyframe: true, trackId: 1 }
    })
  }

  const pcmTrack = (extra: Partial<AudioTrack> = {}): AudioTrack => ({
    type: 'audio',
    id: 1,
    index: 0,
    codec: 'pcm_s16le',
    sampleRate,
    channels: 1,
    ...extra,
  })

  test('decodes a track a caller read out of its own container', async () => {
    const decoded = await decodeAudioPackets(pcmTrack(), pcmPackets())
    expect(decoded).toMatchObject({ sampleRate, codec: 'pcm_s16le' })
    expect(decoded.channels).toHaveLength(1)
    expect(decoded.channels[0].length).toBe(frames)
    expect(decoded.duration).toBeCloseTo(frames / sampleRate, 6)
    for (let i = 0; i < frames; i++) expect(Math.abs(decoded.channels[0][i] - tone[i])).toBeLessThan(1 / 16384)
  })

  test('takes a plain iterable of packets as well as an async one', async () => {
    async function* streamed(): AsyncGenerator<EncodedPacket> {
      for (const packet of pcmPackets()) yield packet
    }
    const [sync, async] = await Promise.all([decodeAudioPackets(pcmTrack(), pcmPackets()), decodeAudioPackets(pcmTrack(), streamed())])
    expect(async.channels[0]).toEqual(sync.channels[0])
  })

  test('drops the priming and padding the container marks', async () => {
    const decoded = await decodeAudioPackets(pcmTrack({ trimStart: 0.1, trimmedDuration: 0.2 }), pcmPackets())
    expect(decoded.channels[0].length).toBe(1600)
    expect(decoded.duration).toBeCloseTo(0.2, 6)
    // The samples kept start 800 frames in, where trimStart says the sound does.
    for (let i = 0; i < 1600; i++) expect(Math.abs(decoded.channels[0][i] - tone[800 + i])).toBeLessThan(1 / 16384)
  })

  test('refuses audio over the duration limit', async () => {
    await expect(decodeAudioPackets(pcmTrack(), pcmPackets(), { maxDurationSeconds: 0.3 })).rejects.toBeInstanceOf(AudioTooLongError)
    await expect(decodeAudioPackets(pcmTrack(), pcmPackets(), { maxDurationSeconds: 1 })).resolves.toMatchObject({ sampleRate })
  })

  test('stops when it is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(decodeAudioPackets(pcmTrack(), pcmPackets(), { signal: controller.signal })).rejects.toThrow()
  })

  test('uses the registered decoder, so one registry serves both ways in', async () => {
    let packets = 0
    const unregister = registerAudioDecoder('vorbis', track => ({
      decode: () => {
        packets++
        return { sampleRate: track.sampleRate, channels: [new Float32Array(512)] }
      },
    }))
    try {
      const decoded = await decodeAudioPackets(pcmTrack({ codec: 'vorbis' }), pcmPackets())
      expect(packets).toBe(4)
      expect(decoded.codec).toBe('vorbis')
      expect(decoded.channels[0].length).toBe(4 * 512)
    }
    finally {
      unregister()
    }
  })

  test('names the codec it has no decoder for', async () => {
    await expect(createAudioDecoder(pcmTrack({ codec: 'vorbis' }))).rejects.toBeInstanceOf(UnsupportedAudioCodecError)
    await expect(decodeAudioPackets(pcmTrack({ codec: 'vorbis' }), pcmPackets())).rejects.toBeInstanceOf(UnsupportedAudioCodecError)
  })

  test('loads the built-in codec package for a compressed track', async () => {
    const { readMp3Frames } = await import('@ts-audio/mp3')
    const file = new Uint8Array(await Bun.file(fixture('tone.mp3')).arrayBuffer())
    const { frames: mp3Frames, header } = readMp3Frames(file)
    const decoded = await decodeAudioPackets(
      { type: 'audio', id: 1, index: 0, codec: 'mp3', sampleRate: header.sampleRate, channels: header.channels },
      mp3Frames.map((data, i) => ({ data, timestamp: i * header.samples / header.sampleRate, duration: header.samples / header.sampleRate, isKeyframe: true, trackId: 1 })),
    )
    expect(decoded.codec).toBe('mp3')
    expect(decoded.sampleRate).toBe(header.sampleRate)
    expect(decoded.channels[0].length).toBe(mp3Frames.length * header.samples)
    expect(Math.max(...decoded.channels[0].map(Math.abs))).toBeGreaterThan(0.01)
  })
})
