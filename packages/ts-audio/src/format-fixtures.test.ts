import { describe, expect, it } from 'bun:test'
import { AacInputFormat, AacOutputFormat } from '@ts-audio/aac'
import { FlacInputFormat, FlacOutputFormat } from '@ts-audio/flac'
import { Mp3InputFormat, Mp3OutputFormat } from '@ts-audio/mp3'
import { OggInputFormat, OggOutputFormat } from '@ts-audio/ogg'
import { WavInputFormat, WavOutputFormat } from '@ts-audio/wav'
import type { InputFormat } from './demuxer'
import type { OutputFormat } from './muxer'
import { Conversion } from './conversion'
import { Input } from './input'
import { createSource } from './source'
import { Output } from './output'

interface Fixture {
  name: string
  filename: string
  input: () => InputFormat
  output: () => OutputFormat
}

const fixtures: Fixture[] = [
  { name: 'WAV PCM', filename: 'tone.wav', input: () => new WavInputFormat(), output: () => new WavOutputFormat() },
  { name: 'AAC ADTS', filename: 'tone.aac', input: () => new AacInputFormat(), output: () => new AacOutputFormat() },
  { name: 'FLAC', filename: 'tone.flac', input: () => new FlacInputFormat(), output: () => new FlacOutputFormat() },
  { name: 'MP3', filename: 'tone.mp3', input: () => new Mp3InputFormat(), output: () => new Mp3OutputFormat() },
  { name: 'Ogg Vorbis', filename: 'tone.ogg', input: () => new OggInputFormat(), output: () => new OggOutputFormat() },
  { name: 'Ogg Opus', filename: 'tone.opus', input: () => new OggInputFormat(), output: () => new OggOutputFormat() },
]

function path(filename: string): string {
  return new URL(`../test/fixtures/${filename}`, import.meta.url).pathname
}

describe('committed audio format fixtures', () => {
  for (const fixture of fixtures) {
    it(`demuxes and remuxes ${fixture.name}`, async () => {
      const inspected = new Input({ source: path(fixture.filename), format: fixture.input() })
      const track = await inspected.getPrimaryTrack()
      expect(track).toBeDefined()
      expect(await inspected.getDuration()).toBeGreaterThan(0)
      let sourcePackets = 0
      for await (const packet of inspected.packets(track!.id)) {
        expect(packet.data.byteLength).toBeGreaterThan(0)
        sourcePackets++
      }
      expect(sourcePackets).toBeGreaterThan(0)
      await inspected.close()

      const input = new Input({ source: path(fixture.filename), format: fixture.input() })
      const conversion = await Conversion.init({ input, output: new Output({ format: fixture.output() }) })
      const bytes = await conversion.execute()
      await conversion.close()
      expect(bytes.byteLength).toBeGreaterThan(0)

      const roundTrip = new Input({ source: bytes, format: fixture.input() })
      const roundTripTrack = await roundTrip.getPrimaryTrack()
      expect(roundTripTrack?.codec).toBe(track?.codec)
      let roundTripPackets = 0
      for await (const packet of roundTrip.packets(roundTripTrack!.id)) {
        expect(packet.data.byteLength).toBeGreaterThan(0)
        roundTripPackets++
      }
      expect(roundTripPackets).toBeGreaterThan(0)
      await roundTrip.close()
    })
  }
})

describe('reading a file without registering anything', () => {
  // The shipped readers are optional peers, so core cannot import them up
  // front. Detection falls back to loading them, and without that an Input
  // given no format could only read what a caller had registered by hand --
  // which left the ts-audio CLI unable to open any file at all.
  const shipped = [
    { filename: 'tone.wav', format: 'wav' },
    { filename: 'tone.mp3', format: 'mp3' },
    { filename: 'tone.aac', format: 'aac' },
    { filename: 'tone.flac', format: 'flac' },
    { filename: 'tone.ogg', format: 'ogg' },
    { filename: 'tone.opus', format: 'ogg' },
  ]

  for (const { filename, format } of shipped) {
    it(`detects ${filename} with an empty registry`, async () => {
      const input = new Input({ source: createSource(path(filename)) })
      try {
        expect(await input.getFormatName()).toBe(format)
        const tracks = await input.getTracks()
        expect(tracks.length).toBeGreaterThan(0)
        expect(tracks[0].sampleRate).toBeGreaterThan(0)
      }
      finally {
        await input.close()
      }
    })
  }

  it('gives the same answers whether its getters are awaited together or in turn', async () => {
    // ensureInit is memoised, not flag-guarded: four concurrent getters used
    // to race, each building its own demuxer over the same source, and the
    // file came back with no tracks and no duration.
    const together = new Input({ source: createSource(path('tone.flac')) })
    const [tracks, metadata, duration, format] = await Promise.all([
      together.getTracks(),
      together.getMetadata(),
      together.getDuration(),
      together.getFormatName(),
    ])
    await together.close()

    const sequential = new Input({ source: createSource(path('tone.flac')) })
    const expectedFormat = await sequential.getFormatName()
    const expectedDuration = await sequential.getDuration()
    const expectedTracks = await sequential.getTracks()
    await sequential.close()

    expect(format).toBe(expectedFormat)
    expect(duration).toBe(expectedDuration)
    expect(duration).toBeGreaterThan(0)
    expect(tracks).toHaveLength(expectedTracks.length)
    expect(tracks).toHaveLength(1)
    expect(metadata).toBeDefined()
  })
})
