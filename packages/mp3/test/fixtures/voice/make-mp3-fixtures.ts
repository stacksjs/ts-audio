/**
 * Rebuilds the MP3 voice fixtures: macOS's speech synthesiser, LAME's
 * encoder (no ffmpeg), and Apple's own decodes as the ref-*.wav files the
 * MP3 decoder is checked against. Apple reads LAME's gapless tag, so its
 * decodes start and end where the sound does.
 *
 *   MPEG-1 44.1 kHz mono, 64 kbit/s          voice-mp3-mono.mp3
 *   MPEG-1 44.1 kHz joint stereo, 128 kbit/s voice-mp3-joint.mp3
 *   MPEG-2 22.05 kHz mono, 32 kbit/s         voice-mp3-lsf.mp3
 *   MPEG 2.5 8 kHz mono, 16 kbit/s, CRC      voice-mp3-8k.mp3
 *   MPEG-1 VBR with ID3v2 and ID3v1 tags     voice-mp3-vbr.mp3
 *
 *   bun test/fixtures/voice/make-mp3-fixtures.ts   (needs lame: brew install lame)
 *
 * The files checked in are the ones the decoder was written against, so the
 * ID3 artist still reads ts-videos, where it was built; leave it alone and the
 * script reproduces them.
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
  await run('say', '-o', `${tmp}/long.aiff`, 'Felt strong today. Knee is fine.')
  await run('say', '-o', `${tmp}/short.aiff`, 'Knee is fine.')
  await run('afconvert', '-f', 'WAVE', '-d', 'LEI16@44100', '-c', '1', `${tmp}/short.aiff`, `${tmp}/short44.wav`)
  await run('afconvert', '-f', 'WAVE', '-d', 'LEI16@22050', '-c', '1', `${tmp}/long.aiff`, `${tmp}/long22.wav`)
  await run('afconvert', '-f', 'WAVE', '-d', 'LEI16@8000', '-c', '1', `${tmp}/long.aiff`, `${tmp}/long8.wav`)
  // Stereo whose channels differ: the right one a little later and quieter, as two microphones hear one voice.
  const mono = decodeWav(new Uint8Array(await Bun.file(`${tmp}/short44.wav`).arrayBuffer())).channels[0]
  const right = new Float32Array(mono.length)
  for (let i = 20; i < mono.length; i++) right[i] = mono[i - 20] * 0.8
  await Bun.write(`${tmp}/stereo44.wav`, encodeWav([mono, right], 44100))

  const encodes: [string, string[]][] = [
    ['voice-mp3-mono', ['-m', 'm', '-b', '64', `${tmp}/short44.wav`]],
    ['voice-mp3-joint', ['-m', 'j', '-b', '128', `${tmp}/stereo44.wav`]],
    ['voice-mp3-lsf', ['-m', 'm', '-b', '32', `${tmp}/long22.wav`]],
    ['voice-mp3-8k', ['-m', 'm', '-b', '16', '-p', `${tmp}/long8.wav`]],
    ['voice-mp3-vbr', ['-m', 'm', '-V', '5', '--add-id3v2', '--tt', 'Voice note', '--ta', 'ts-videos', `${tmp}/short44.wav`]],
  ]
  for (const [name, args] of encodes) {
    await run('lame', '--quiet', ...args, `${here}${name}.mp3`)
    await run('afconvert', '-f', 'WAVE', '-d', 'LEI16', `${here}${name}.mp3`, `${here}ref-${name}.wav`)
  }
  await run('rm', '-rf', tmp)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
