import type { Target } from './types'
import { describe, expect, it } from 'bun:test'
import { AacOutputFormat } from '@ts-audio/aac'
import { FlacOutputFormat } from '@ts-audio/flac'
import { Mp3OutputFormat } from '@ts-audio/mp3'
import { OggOutputFormat } from '@ts-audio/ogg'
import { AutoWavOutputFormat, Rf64OutputFormat, WavOutputFormat } from '@ts-audio/wav'
import { assertCodecSupported, codecMatches, Muxer, OutputFormat } from './muxer'
import { Output } from './output'

describe('what a container can carry', () => {
  it('declares the codecs of every shipped format', () => {
    expect(new WavOutputFormat().supportedCodecs).toEqual(['pcm'])
    expect(new Rf64OutputFormat().supportedCodecs).toEqual(['pcm'])
    expect(new AutoWavOutputFormat().supportedCodecs).toEqual(['pcm'])
    expect(new Mp3OutputFormat().supportedCodecs).toEqual(['mp3'])
    expect(new AacOutputFormat().supportedCodecs).toEqual(['aac'])
    expect(new FlacOutputFormat().supportedCodecs).toEqual(['flac'])
    expect(new OggOutputFormat().supportedCodecs).toEqual(['vorbis', 'opus', 'flac'])
  })

  it('takes any PCM layout where a format says pcm', () => {
    // A demuxer calls a WAV track 'pcm'; decodeWav names the layout. Both have
    // to be writable to a WAV.
    for (const codec of ['pcm', 'pcm_s16le', 'pcm_s24le', 'pcm_f32le', 'pcm_alaw', 'pcm_mulaw'])
      expect(codecMatches('pcm', codec)).toBe(true)
    expect(codecMatches('pcm', 'mp3')).toBe(false)
    expect(codecMatches('mp3', 'mp3')).toBe(true)
    expect(codecMatches('mp3', 'pcm')).toBe(false)
  })

  it('accepts what each format carries and refuses the rest', () => {
    expect(() => assertCodecSupported(new WavOutputFormat(), 'pcm_s16le')).not.toThrow()
    expect(() => assertCodecSupported(new Mp3OutputFormat(), 'mp3')).not.toThrow()
    expect(() => assertCodecSupported(new FlacOutputFormat(), 'flac')).not.toThrow()
    for (const codec of ['vorbis', 'opus', 'flac'])
      expect(() => assertCodecSupported(new OggOutputFormat(), codec)).not.toThrow()

    expect(() => assertCodecSupported(new Mp3OutputFormat(), 'pcm')).toThrow(/mp3 container cannot carry pcm/)
    expect(() => assertCodecSupported(new WavOutputFormat(), 'mp3')).toThrow(/wav container cannot carry mp3/)
    expect(() => assertCodecSupported(new OggOutputFormat(), 'aac')).toThrow(/ogg container cannot carry aac/)
    expect(() => assertCodecSupported(new FlacOutputFormat(), 'opus')).toThrow(/it carries flac/)
  })

  it('leaves a format that declares nothing unchecked', () => {
    // Adding this capability must not break an OutputFormat written before it.
    class SilentFormat extends OutputFormat {
      get name(): string { return 'silent' }
      get mimeType(): string { return 'audio/silent' }
      get extension(): string { return 'silent' }
      createMuxer(_target: Target): Muxer { throw new Error('not needed for this test') }
    }
    const format = new SilentFormat()
    expect(format.supportedCodecs).toEqual([])
    expect(() => assertCodecSupported(format, 'anything-at-all')).not.toThrow()
  })
})

describe('adding a track to an output', () => {
  const config = { codec: 'pcm_s16le', sampleRate: 22050, channels: 1 }

  it('refuses a codec the container cannot carry, before anything is written', () => {
    const output = new Output({ format: new Mp3OutputFormat() })
    // This is what used to succeed: PCM packets into an MP3 container, and a
    // file reported as converted that no player would open.
    expect(() => output.addAudioTrack(config)).toThrow(/mp3 container cannot carry pcm_s16le/)
  })

  it('still adds a track the container can carry', () => {
    const output = new Output({ format: new WavOutputFormat() })
    const track = output.addAudioTrack(config)
    expect(track).toMatchObject({ type: 'audio', config })
    expect(track.id).toBeGreaterThan(0)
  })
})
