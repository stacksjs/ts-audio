const sampleRate = 48_000
const channels = 2
const duration = 0.25
const frames = Math.round(sampleRate * duration)
const dataBytes = frames * channels * 2
const bytes = new Uint8Array(44 + dataBytes)
const view = new DataView(bytes.buffer)

function text(offset: number, value: string): void {
  for (const [index, character] of [...value].entries()) bytes[offset + index] = character.charCodeAt(0)
}

text(0, 'RIFF')
view.setUint32(4, 36 + dataBytes, true)
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
view.setUint32(40, dataBytes, true)

for (let frame = 0; frame < frames; frame++) {
  const value = Math.round(Math.sin(2 * Math.PI * 440 * frame / sampleRate) * 10_000)
  for (let channel = 0; channel < channels; channel++) {
    view.setInt16(44 + (frame * channels + channel) * 2, value, true)
  }
}

async function generate(): Promise<void> {
  await Bun.write(new URL('tone.wav', import.meta.url), bytes)
}

generate().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
