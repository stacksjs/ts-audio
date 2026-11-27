import { describe, expect, test } from 'bun:test'
import { Conversion, createInput, Output } from '@ts-audio/core'
import { decodeFlacFile, readFlacFrames, readFlacMetadata } from './flac-audio'
import { parseFlacFrameHeader } from './flac-decoder'
import { FlacOutputFormat } from './index'

const fixture = (name: string): string => new URL(`../test/fixtures/voice/${name}`, import.meta.url).pathname
const hex = (data: Uint8Array): string => Buffer.from(data).toString('hex')

async function remux(name: string, options: { startTime?: number, endTime?: number } = {}): Promise<Uint8Array> {
  const input = createInput(fixture(name))
  const output = new Output({ format: new FlacOutputFormat() })
  const conversion = await Conversion.init({ input, output, options })
  try {
    return await conversion.execute()
  }
  finally {
    await conversion.close()
  }
}

describe('FLAC remuxing', () => {
  test('counts the samples its frames actually hold, not 4096 per frame', async () => {
    // The muxer used to assume every frame held 4096 samples, so with a short
    // last frame the length came out 102,400 where the frames held 101,842.
    const bytes = await remux('voice-flac-mono.flac')
    const { streamInfo, audioStart } = readFlacMetadata(bytes)
    const frames = readFlacFrames(bytes, audioStart)
    const counted = frames.reduce((n, frame) => n + parseFlacFrameHeader(frame, 0)!.blockSize, 0)
    expect(counted).toBe(101_842)
    expect(Number(streamInfo.totalSamples)).toBe(counted)
    expect(streamInfo.minFrameSize).toBeGreaterThan(0)
    expect(streamInfo.maxFrameSize).toBeGreaterThanOrEqual(streamInfo.minFrameSize)
  })

  test('keeps the source MD5 when every frame comes through, so it can still be checked', async () => {
    const source = decodeFlacFile(new Uint8Array(await Bun.file(fixture('voice-flac-stereo.flac')).arrayBuffer()))
    const remuxed = decodeFlacFile(await remux('voice-flac-stereo.flac'))
    expect(hex(remuxed.streamInfo.md5)).toBe(hex(source.streamInfo.md5))
  })

  test('leaves the MD5 unset when frames were dropped, rather than keep a signature that is no longer true', async () => {
    const trimmed = await remux('voice-flac-mono.flac', { startTime: 0.5, endTime: 1.5 })
    const { streamInfo } = readFlacMetadata(trimmed)
    expect(Number(streamInfo.totalSamples)).toBeLessThan(101_842)
    expect(hex(streamInfo.md5)).toBe('0'.repeat(32))
  })

  test.skipIf(!Bun.which('flac'))('writes files libFLAC accepts, whole or trimmed', async () => {
    // Before the fix, libFLAC refused every remux: "decoded number of samples
    // is smaller than the total number of samples set in the STREAMINFO".
    const dir = (await Bun.$`mktemp -d`.text()).trim()
    try {
      for (const [name, options] of [['whole', {}], ['trimmed', { startTime: 0.5, endTime: 1.5 }]] as const) {
        const path = `${dir}/${name}.flac`
        await Bun.write(path, await remux('voice-flac-mono.flac', options))
        const proc = Bun.spawn([Bun.which('flac')!, '--test', '--silent', path], { stderr: 'pipe' })
        const code = await proc.exited
        const complaint = code === 0 ? '' : await new Response(proc.stderr).text()
        expect({ name, code, complaint }).toEqual({ name, code: 0, complaint: '' })
      }
    }
    finally {
      await Bun.$`rm -rf ${dir}`
    }
  })
})
