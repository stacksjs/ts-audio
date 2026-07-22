import { describe, expect, test } from 'bun:test'
import { opusPacketDurationSamples } from './index'

describe('opusPacketDurationSamples', () => {
  test('accounts for one and two frame packet codes', () => {
    expect(opusPacketDurationSamples(new Uint8Array([0b0_1001_000]))).toBe(960)
    expect(opusPacketDurationSamples(new Uint8Array([0b0_1001_001]))).toBe(1920)
    expect(opusPacketDurationSamples(new Uint8Array([0b0_1001_010]))).toBe(1920)
  })

  test('accounts for arbitrary code 3 frame counts', () => {
    expect(opusPacketDurationSamples(new Uint8Array([0b0_1001_011, 3]))).toBe(2880)
  })

  test('rejects malformed or oversized packets', () => {
    expect(() => opusPacketDurationSamples(new Uint8Array())).toThrow(/empty/)
    expect(() => opusPacketDurationSamples(new Uint8Array([0b0_1001_011]))).toThrow(/frame count/)
    expect(() => opusPacketDurationSamples(new Uint8Array([0b0_1001_011, 7]))).toThrow(/120 ms/)
  })
})
