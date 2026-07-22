import { describe, expect, it } from 'bun:test'
import type { Input } from './input'
import type { Output } from './output'
import { generateAudioDerivatives, transcodeAudioWithWebCodecs } from './native-transcode'

describe('native audio transcoding', () => {
  it('streams native encoder packets into the selected muxer', async () => {
    const originals = {
      AudioDecoder: (globalThis as Record<string, unknown>).AudioDecoder,
      AudioEncoder: (globalThis as Record<string, unknown>).AudioEncoder,
      EncodedAudioChunk: (globalThis as Record<string, unknown>).EncodedAudioChunk,
    }
    class FakeChunk {
      type: string
      timestamp: number
      duration?: number
      data: Uint8Array
      constructor(init: { type: string, timestamp: number, duration?: number, data: Uint8Array }) { Object.assign(this, init); this.type = init.type; this.timestamp = init.timestamp; this.data = init.data }
    }
    class FakeDecoder {
      static async isConfigSupported(): Promise<{ supported: boolean }> { return { supported: true } }
      constructor(private init: { output: (_data: { timestamp: number, duration?: number, close: () => void }) => void }) {}
      configure(): void {}
      decode(chunk: FakeChunk): void { this.init.output({ timestamp: chunk.timestamp, duration: chunk.duration, close: () => {} }) }
      async flush(): Promise<void> {}
      close(): void {}
    }
    class FakeEncoder {
      static async isConfigSupported(): Promise<{ supported: boolean }> { return { supported: true } }
      constructor(private init: { output: (_chunk: { timestamp: number, duration?: number, byteLength: number, copyTo: (_destination: Uint8Array) => void }, _metadata?: unknown) => void }) {}
      configure(): void {}
      encode(data: { timestamp: number, duration?: number }): void {
        const encoded = new Uint8Array([7, 8, 9])
        this.init.output({ timestamp: data.timestamp, duration: data.duration, byteLength: encoded.byteLength, copyTo: destination => destination.set(encoded) }, { decoderConfig: { description: new Uint8Array([1, 2]) } })
      }
      async flush(): Promise<void> {}
      close(): void {}
    }
    Object.assign(globalThis, { AudioDecoder: FakeDecoder, AudioEncoder: FakeEncoder, EncodedAudioChunk: FakeChunk })

    const written: Array<{ data: Uint8Array, timestamp: number }> = []
    const input = {
      getPrimaryTrack: async () => ({ id: 1, index: 0, type: 'audio', codec: 'flac', sampleRate: 48_000, channels: 2 }),
      getMetadata: async () => ({ title: 'Episode' }),
      packets: async function* () { yield { data: new Uint8Array([1, 2]), timestamp: 0, duration: 0.02, isKeyframe: true, trackId: 1 } },
      close: async () => {},
    } as unknown as Input
    const output = {
      setMetadata: () => {},
      addAudioTrack: (config: { codec: string, codecDescription?: Uint8Array }) => { expect(config).toMatchObject({ codec: 'opus', codecDescription: new Uint8Array([1, 2]) }); return { id: 4 } },
      writePacket: async (_trackId: number, packet: { data: Uint8Array, timestamp: number }) => { written.push(packet) },
      finalize: async () => new Uint8Array([4, 5, 6]),
    } as unknown as Output

    try {
      const result = await transcodeAudioWithWebCodecs(input, output, { codec: 'opus', batchSize: 1 })
      expect(result).toMatchObject({ codec: 'opus', packets: 1, inputBytes: 2, outputBytes: 3 })
      expect(written).toHaveLength(1)
      expect(written[0]).toMatchObject({ data: new Uint8Array([7, 8, 9]), timestamp: 0 })
      const derivatives = await generateAudioDerivatives(new Uint8Array([1]), {
        source: { codec: 'flac', container: 'flac', duration: 1, sampleRate: 48_000, channels: 2 },
        outputs: [{ format: 'opus', container: 'ogg', mimeType: 'audio/ogg; codecs=opus', extension: 'ogg', bitrate: 128_000, action: 'transcode', available: true }],
      }, { inputFactory: () => input, outputFactory: () => output })
      expect(derivatives).toHaveLength(1)
      expect(derivatives[0].bytes).toEqual(new Uint8Array([4, 5, 6]))
    }
    finally {
      Object.assign(globalThis, originals)
    }
  })
})
