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
