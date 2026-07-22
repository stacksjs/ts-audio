import { describe, expect, it } from 'bun:test'
import { buildAudioDeliveryPlan } from './delivery'
import { createAudioDeliveryBundle, MemoryTranscriptCache, normalizeAudioChapters, transcribeWithCache } from './delivery-workflow'

const plan = buildAudioDeliveryPlan({ codec: 'aac', container: 'aac', duration: 8, sampleRate: 48_000, channels: 2 }, { formats: ['aac'] })

describe('audio delivery workflow', () => {
  it('builds an encrypted audio HLS playlist', async () => {
    const original = new Uint8Array([1, 2, 3])
    const bundle = await createAudioDeliveryBundle(plan, [
      { uri: 'one.m4s', duration: 4, data: original, initialization: { uri: 'init.mp4', data: new Uint8Array([0]) } },
      { uri: 'two.m4s', duration: 4, data: original },
    ], { hlsAes128: { key: new Uint8Array(16).fill(7), keyUri: '/media/keys/audio' } })
    expect(bundle.playlist).toContain('#EXT-X-KEY:METHOD=AES-128')
    expect(bundle.playlist).toContain('#EXT-X-MAP:URI="init.mp4"')
    expect(bundle.files['hls/one.m4s']).not.toEqual(original)
    expect(bundle.encrypted).toBe(true)
  })

  it('refuses DRM metadata for clear audio segments', async () => {
    await expect(createAudioDeliveryBundle(plan, [{ uri: 'one.m4s', duration: 4, data: new Uint8Array([1]) }], {
      drm: { descriptor: { system: 'widevine', keyId: 'key', licenseUrl: '/license' }, segmentsEncrypted: false },
    })).rejects.toThrow('pre-encrypted')
  })

  it('normalizes inferred chapter endings', () => {
    expect(normalizeAudioChapters([{ title: 'Intro', startTime: 0 }, { title: 'Topic', startTime: 5 }], 10)).toEqual([
      { title: 'Intro', startTime: 0, endTime: 5, id: 1 },
      { title: 'Topic', startTime: 5, endTime: 10, id: 2 },
    ])
  })

  it('rejects overlapping chapters', () => {
    expect(() => normalizeAudioChapters([
      { title: 'Intro', startTime: 0, endTime: 6 },
      { title: 'Topic', startTime: 5 },
    ], 10)).toThrow('cannot overlap')
  })

  it('deduplicates transcription by content and provider version', async () => {
    const cache = new MemoryTranscriptCache()
    let calls = 0
    const provider = {
      name: 'test',
      version: '2',
      transcribe: async () => {
        calls++
        return { language: 'en', segments: [{ startTime: 0, endTime: 1, text: 'Hello' }] }
      },
    }
    const input = { audio: new Uint8Array([1, 2, 3]), language: 'en' }
    expect((await transcribeWithCache(input, provider, cache)).cacheHit).toBe(false)
    expect((await transcribeWithCache(input, provider, cache)).cacheHit).toBe(true)
    expect(calls).toBe(1)
  })
})
