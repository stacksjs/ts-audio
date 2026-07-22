import { describe, expect, test } from 'bun:test'
import { Input } from '@ts-audio/core'
import { WavInputFormat } from './index'

function wave(formatTag: number, bitsPerSample = 16): Uint8Array {
  const bytes = new Uint8Array(44)
  const view = new DataView(bytes.buffer)
  const fourCc = (offset: number, value: string): void => {
    for (let index = 0; index < 4; index++) bytes[offset + index] = value.charCodeAt(index)
  }
  fourCc(0, 'RIFF')
  view.setUint32(4, 36, true)
  fourCc(8, 'WAVE')
  fourCc(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, formatTag, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 48000, true)
  view.setUint32(28, 48000 * bitsPerSample / 8, true)
  view.setUint16(32, bitsPerSample / 8, true)
  view.setUint16(34, bitsPerSample, true)
  fourCc(36, 'data')
  view.setUint32(40, 0, true)
  return bytes
}

describe('WavDemuxer format validation', () => {
  test('rejects unsupported format tags', async () => {
    const input = new Input({ source: wave(0x0055), format: new WavInputFormat() })
    await expect(input.getTracks()).rejects.toThrow(/0x0055/)
  })

  test('accepts 64-bit IEEE float samples', async () => {
    const input = new Input({ source: wave(0x0003, 64), format: new WavInputFormat() })
    expect(await input.getPrimaryTrack()).toMatchObject({ codec: 'pcm', sampleFormat: 'f64', bitDepth: 64 })
  })
})
