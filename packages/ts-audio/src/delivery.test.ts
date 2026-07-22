import { describe, expect, test } from 'bun:test'
import {
  assertAudioPlanExecutable,
  assertPacketCopyConversion,
  buildAudioDeliveryPlan,
  buildWaveform,
  negotiateAudioOutput,
  normalizeTranscript,
  recommendAudioBitrate,
} from './delivery'

const source = {
  codec: 'flac',
  container: 'flac',
  duration: 300,
  sampleRate: 48_000,
  channels: 2,
  bitrate: 1_200_000,
}

describe('audio delivery planning', () => {
  test('chooses profile-aware bounded bitrates', () => {
    expect(recommendAudioBitrate('opus', source, 'speech')).toBe(51_000)
    expect(recommendAudioBitrate('mp3', source, 'music')).toBe(230_000)
    expect(recommendAudioBitrate('aac', { ...source, bitrate: 96_000 }, 'music')).toBe(96_000)
  })

  test('reports codec conversion capability explicitly', () => {
    const plan = buildAudioDeliveryPlan(source)
    expect(plan.outputs.every(output => output.action === 'transcode' && !output.available)).toBe(true)
    expect(() => assertAudioPlanExecutable(plan)).toThrow(/No opus encoder/)
  })

  test('keeps matching source packets copyable without an encoder', () => {
    const plan = buildAudioDeliveryPlan({ ...source, codec: 'mp3', container: 'mp3' }, { formats: ['mp3'] })
    expect(plan.outputs[0]).toMatchObject({ action: 'copy', available: true, mimeType: 'audio/mpeg' })
  })

  test('negotiates q-values and preserves output order for wildcards', () => {
    const plan = buildAudioDeliveryPlan(source, {}, { encoder: true, codecs: ['opus', 'aac', 'mp3'] })
    expect(negotiateAudioOutput(plan.outputs, 'audio/mpeg;q=0.7, audio/ogg;q=1')?.format).toBe('opus')
    expect(negotiateAudioOutput(plan.outputs, 'audio/*')?.format).toBe('opus')
  })

  test('rejects transformations in the packet copy path', () => {
    const track = {
      type: 'audio' as const,
      id: 1,
      index: 0,
      codec: 'flac',
      sampleRate: 48_000,
      channels: 2,
    }
    expect(() => assertPacketCopyConversion(track, { audioCodec: 'aac' })).toThrow(/native decoder and encoder/)
    expect(() => assertPacketCopyConversion(track, {})).not.toThrow()
  })
})

describe('audio delivery metadata', () => {
  test('builds compact normalized waveform peaks', () => {
    const waveform = buildWaveform([new Float32Array([-0.5, 0.25, -1, 0.75])], 4, { samples: 2 })
    expect(waveform).toEqual({
      version: 1,
      channels: 1,
      sampleRate: 4,
      duration: 1,
      samplesPerPeak: 2,
      peaks: [[-0.5, 0.25, -1, 0.75]],
    })
  })

  test('normalizes transcripts and emits WebVTT', () => {
    const transcript = normalizeTranscript({
      language: 'EN-US',
      segments: [{ startTime: 0, endTime: 1.25, text: ' Hello ', confidence: 0.98, speaker: 'Chris' }],
    })
    expect(transcript.language).toBe('en-us')
    expect(transcript.segments[0]).toMatchObject({ id: 1, text: 'Hello' })
    expect(transcript.vtt).toContain('00:00:00.000 --> 00:00:01.250')
    expect(transcript.vtt).toContain('<v Chris>Hello')
  })

  test('rejects overlapping transcript segments', () => {
    expect(() => normalizeTranscript({
      language: 'en',
      segments: [
        { startTime: 0, endTime: 2, text: 'one' },
        { startTime: 1, endTime: 3, text: 'two' },
      ],
    })).toThrow(/overlaps/)
  })
})
