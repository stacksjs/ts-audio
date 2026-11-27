/**
 * Rebuilds the FLAC fixtures with macOS's speech synthesiser and the
 * reference encoder (flac 1.4.3, no ffmpeg). Between them they cover every
 * subframe type and stereo mode the decoder has to read:
 *
 *   voice-flac-mono.flac      16-bit 44.1 kHz mono, -8: high LPC orders, Rice2
 *   voice-flac-stereo.flac    16-bit 44.1 kHz stereo, -8: mid/side, left/side, right/side
 *   voice-flac-fast.flac      16-bit mono, -0: fixed predictors, order 2 Rice
 *   voice-flac-24bit.flac     24-bit 48 kHz mono
 *   voice-flac-8bit.flac      8-bit 22.05 kHz mono
 *   voice-flac-silence.flac   silence then speech: constant subframes
 *   voice-flac-noise.flac     white noise: verbatim and escaped partitions
 *
 * Each file states an MD5 of its own unencoded audio in STREAMINFO, so the
 * fixtures check themselves and need no reference decode beside them.
 *
 *   bun test/fixtures/voice/make-flac-fixtures.ts   (needs flac: brew install flac)
 */

import { decodeWav, encodeWav } from '@ts-audio/core'

const here = new URL('.', import.meta.url).pathname

async function run(...command: string[]): Promise<void> {
  const proc = Bun.spawn(command, { stdout: 'ignore', stderr: 'pipe' })
  if (await proc.exited !== 0)
    throw new Error(`${command.join(' ')}: ${await new Response(proc.stderr).text()}`)
}

async function main(): Promise<void> {
  const tmp = (await Bun.$`mktemp -d`.text()).trim()
  await run('say', '-o', `${tmp}/speech.aiff`, 'Felt strong today. Knee is fine.')
  await run('afconvert', '-f', 'WAVE', '-d', 'LEI16@44100', '-c', '1', `${tmp}/speech.aiff`, `${tmp}/mono44.wav`)
  await run('afconvert', '-f', 'WAVE', '-d', 'LEI24@48000', '-c', '1', `${tmp}/speech.aiff`, `${tmp}/mono48-24.wav`)
  await run('afconvert', '-f', 'WAVE', '-d', 'UI8@22050', '-c', '1', `${tmp}/speech.aiff`, `${tmp}/mono22-8.wav`)

  // Stereo whose channels differ, the right one later and quieter, as two
  // microphones hear one voice. Identical channels would only ever give
  // left/side frames; a real difference makes the encoder reach for mid/side.
  const mono = decodeWav(new Uint8Array(await Bun.file(`${tmp}/mono44.wav`).arrayBuffer())).channels[0]
  const right = new Float32Array(mono.length)
  for (let i = 20; i < mono.length; i++) right[i] = mono[i - 20] * 0.8
  await Bun.write(`${tmp}/stereo44.wav`, encodeWav([mono, right], 44100))

  // Silence before the speech, so whole blocks are one repeated value.
  const quiet = new Float32Array(44100)
  const tone = new Float32Array(22050)
  for (let i = 0; i < tone.length; i++) tone[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / 44100)
  const both = new Float32Array(quiet.length + tone.length)
  both.set(tone, quiet.length)
  await Bun.write(`${tmp}/silence.wav`, encodeWav([both], 44100))

  // Noise compresses to nothing, which is what verbatim subframes and escaped
  // Rice partitions are for.
  let seed = 12345
  const noise = new Float32Array(13230)
  for (let i = 0; i < noise.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
    noise[i] = (seed / 0x3FFFFFFF) - 1
  }
  await Bun.write(`${tmp}/noise.wav`, encodeWav([noise], 44100))

  const encodes: [string, string[], string][] = [
    ['voice-flac-mono', ['-8'], `${tmp}/mono44.wav`],
    ['voice-flac-stereo', ['-8'], `${tmp}/stereo44.wav`],
    ['voice-flac-fast', ['-0'], `${tmp}/mono44.wav`],
    ['voice-flac-24bit', ['-5'], `${tmp}/mono48-24.wav`],
    ['voice-flac-8bit', ['-5'], `${tmp}/mono22-8.wav`],
    ['voice-flac-silence', ['-8'], `${tmp}/silence.wav`],
    ['voice-flac-noise', ['-8'], `${tmp}/noise.wav`],
  ]
  for (const [name, flags, input] of encodes)
    await run('flac', '--silent', '--force', ...flags, '-o', `${here}${name}.flac`, input)

  await run('rm', '-rf', tmp)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
