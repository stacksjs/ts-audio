/**
 * Rebuilds the Vorbis fixtures and the reference decodes they are checked
 * against, both from libvorbis 1.3.7 -- the reference implementation -- via
 * vorbis-ref.c beside this file.
 *
 * Vorbis is lossy, so a decode cannot check itself the way FLAC's can. macOS
 * ships no Vorbis encoder or decoder (afconvert has none) and ffmpeg is not an
 * option, so libvorbis is both the encoder that makes the fixtures and the
 * decoder they are measured against.
 *
 *   voice-vorbis-mono.ogg     44.1 kHz mono, q4: the ordinary case
 *   voice-vorbis-stereo.ogg   44.1 kHz stereo, q4: channel coupling
 *   voice-vorbis-low.ogg      22.05 kHz mono, q-1: the smallest codebooks
 *   voice-vorbis-high.ogg     48 kHz mono, q8: the largest blocks
 *
 * Needs libvorbis and a C compiler (brew install libvorbis):
 *
 *   bun test/fixtures/voice/make-vorbis-fixtures.ts
 */

import { decodeWav } from '@ts-audio/core'

const here = new URL('.', import.meta.url).pathname

async function run(...command: string[]): Promise<string> {
  const proc = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0)
    throw new Error(`${command.join(' ')}: ${err || out}`)
  return out
}

/** Interleaved signed 16-bit little-endian, which is what vorbis-ref reads. */
function toRaw(channels: Float32Array[]): Uint8Array {
  const frames = channels[0].length
  const raw = new Uint8Array(frames * channels.length * 2)
  const view = new DataView(raw.buffer)
  let at = 0
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) {
      view.setInt16(at, Math.max(-32768, Math.min(32767, Math.round(channel[i] * 32768))), true)
      at += 2
    }
  }
  return raw
}

/**
 * A 16-bit WAV around raw samples. The header is written by hand rather than
 * going through encodeWav so that the reference decode is stored exactly as
 * libvorbis produced it, without a float round trip rounding it by an LSB.
 */
function wrapWav(raw: Uint8Array, channels: number, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + raw.length)
  const view = new DataView(bytes.buffer)
  const text = (at: number, value: string): void => {
    for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i)
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + raw.length, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, raw.length, true)
  bytes.set(raw, 44)
  return bytes
}

async function main(): Promise<void> {
  const tmp = (await Bun.$`mktemp -d`.text()).trim()
  const ref = `${tmp}/vorbis-ref`

  // libvorbis is the oracle, so it is compiled here rather than trusted to be
  // installed as a command line tool; vorbis-tools is not on this machine.
  await run('clang', '-O2', '-o', ref, `${here}vorbis-ref.c`, '-I/opt/homebrew/include', '-L/opt/homebrew/lib', '-lvorbisfile', '-lvorbisenc', '-lvorbis', '-logg', '-lm')

  await run('say', '-o', `${tmp}/speech.aiff`, 'Knee is fine.')

  const encodes = [
    { name: 'voice-vorbis-mono', rate: 44100, channels: 1, quality: 0.4 },
    { name: 'voice-vorbis-stereo', rate: 44100, channels: 2, quality: 0.4 },
    { name: 'voice-vorbis-low', rate: 22050, channels: 1, quality: -0.1 },
    { name: 'voice-vorbis-high', rate: 48000, channels: 1, quality: 0.8 },
  ]

  for (const { name, rate, channels, quality } of encodes) {
    const wav = `${tmp}/${name}.wav`
    await run('afconvert', '-f', 'WAVE', '-d', `LEI16@${rate}`, '-c', String(channels), `${tmp}/speech.aiff`, wav)
    const decoded = decodeWav(new Uint8Array(await Bun.file(wav).arrayBuffer()))
    // Stereo from one voice is two identical channels, which coupling would
    // have nothing to do with; the right one is delayed and quieter, as two
    // microphones in a room hear it.
    const source = channels === 2
      ? [decoded.channels[0], decoded.channels[0].map((_, i) => (i >= 20 ? decoded.channels[0][i - 20] * 0.8 : 0))]
      : decoded.channels
    await Bun.write(`${tmp}/${name}.raw`, toRaw(source))
    await run(ref, 'encode', `${tmp}/${name}.raw`, `${here}${name}.ogg`, String(channels), String(rate), String(quality))

    const out = await run(ref, 'decode', `${here}${name}.ogg`, `${tmp}/${name}-ref.raw`)
    const [refChannels, refRate] = out.trim().split(/\s+/).map(Number)
    if (refChannels !== channels || refRate !== rate)
      throw new Error(`${name}: libvorbis read back ${refChannels} channels at ${refRate} Hz, not ${channels} at ${rate}`)
    const raw = new Uint8Array(await Bun.file(`${tmp}/${name}-ref.raw`).arrayBuffer())
    await Bun.write(`${here}ref-${name}.wav`, wrapWav(raw, channels, rate))
  }

  await run('rm', '-rf', tmp)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
