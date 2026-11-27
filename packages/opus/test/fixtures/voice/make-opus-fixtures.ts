/**
 * Rebuilds the Opus voice fixtures with macOS's own speech synthesiser and
 * Apple's Opus encoder (afconvert, no ffmpeg), packaged as Ogg Opus, the way
 * voice notes arrive (Firefox's recordings, WhatsApp's). The ref-*.wav files
 * are Apple's decodes.
 *
 * At 12 kbit/s the encoder makes SILK frames, at 20 kbit/s hybrid frames and
 * at 64 kbit/s CELT frames: the three Opus modes. ts-videos keeps the same
 * CELT packets in WebM, as Chrome's MediaRecorder writes them; the packets
 * are the same either way, and the container is read elsewhere.
 *
 *   bun test/fixtures/voice/make-opus-fixtures.ts
 */

import { opusFrameSamples, parseOpusPacket } from '../../../src/opus-decoder'

const here = new URL('.', import.meta.url).pathname

async function run(...command: string[]): Promise<void> {
  const proc = Bun.spawn(command, { stdout: 'ignore', stderr: 'pipe' })
  if (await proc.exited !== 0)
    throw new Error(`${command.join(' ')}: ${await new Response(proc.stderr).text()}`)
}

/** The Opus packets of a CAF file, with its priming and length. */
async function readCaf(path: string): Promise<{ channels: number, priming: number, valid: number, packets: Uint8Array[] }> {
  const data = new Uint8Array(await Bun.file(path).arrayBuffer())
  const view = new DataView(data.buffer)
  const chunks = new Map<string, Uint8Array>()
  for (let at = 8; at + 12 <= data.length;) {
    const type = String.fromCharCode(...data.subarray(at, at + 4))
    const size = Number(view.getBigInt64(at + 4))
    const end = size < 0 ? data.length : at + 12 + size
    chunks.set(type, data.subarray(at + 12, end))
    at = end
  }
  const desc = chunks.get('desc')!
  const channels = new DataView(desc.buffer, desc.byteOffset).getUint32(24)
  const pakt = chunks.get('pakt')!
  const pv = new DataView(pakt.buffer, pakt.byteOffset)
  const count = Number(pv.getBigInt64(0))
  const valid = Number(pv.getBigInt64(8))
  const priming = pv.getInt32(16)
  const sizes: number[] = []
  let at = 24
  for (let i = 0; i < count; i++) {
    let value = 0
    let byte: number
    do {
      byte = pakt[at++]
      value = value * 128 + (byte & 0x7F)
    } while (byte & 0x80)
    sizes.push(value)
  }
  const body = chunks.get('data')!.subarray(4)
  const packets: Uint8Array[] = []
  let offset = 0
  for (const size of sizes) {
    packets.push(body.subarray(offset, offset + size))
    offset += size
  }
  return { channels, priming, valid, packets }
}

function opusHead(channels: number, preSkip: number): Uint8Array {
  const head = new Uint8Array(19)
  head.set(new TextEncoder().encode('OpusHead'))
  const view = new DataView(head.buffer)
  head[8] = 1
  head[9] = channels
  view.setUint16(10, preSkip, true)
  view.setUint32(12, 48000, true)
  return head
}

function packetSamples(packet: Uint8Array): number {
  return opusFrameSamples(packet[0]) * parseOpusPacket(packet).frames.length
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let r = i << 24
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04C11DB7 : r << 1
    table[i] = r >>> 0
  }
  return table
})()

function oggPage(packet: Uint8Array, granule: number, sequence: number, headerType: number): Uint8Array {
  const lacing: number[] = []
  let left = packet.length
  while (left >= 255) {
    lacing.push(255)
    left -= 255
  }
  lacing.push(left)
  const page = new Uint8Array(27 + lacing.length + packet.length)
  const view = new DataView(page.buffer)
  page.set(new TextEncoder().encode('OggS'))
  page[5] = headerType
  view.setBigInt64(6, BigInt(granule), true)
  view.setUint32(14, 0x564F4943, true)
  view.setUint32(18, sequence, true)
  page[26] = lacing.length
  page.set(lacing, 27)
  page.set(packet, 27 + lacing.length)
  let crc = 0
  for (const byte of page) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xFF]) >>> 0
  view.setUint32(22, crc, true)
  return page
}

async function writeOgg(name: string, caf: Awaited<ReturnType<typeof readCaf>>): Promise<void> {
  const tags = new Uint8Array([...new TextEncoder().encode('OpusTags'), 8, 0, 0, 0, ...new TextEncoder().encode('ts-audio'), 0, 0, 0, 0])
  const pages = [oggPage(opusHead(caf.channels, caf.priming), 0, 0, 0x02), oggPage(tags, 0, 1, 0)]
  let granule = 0
  caf.packets.forEach((packet, i) => {
    granule += packetSamples(packet)
    const last = i === caf.packets.length - 1
    // The last page's granule position ends the stream where the sound ends.
    pages.push(oggPage(packet, last ? caf.priming + caf.valid : granule, i + 2, last ? 0x04 : 0))
  })
  await Bun.write(here + name, new Blob(pages as Uint8Array<ArrayBuffer>[]))
}

async function main(): Promise<void> {
  const tmp = (await Bun.$`mktemp -d`.text()).trim()
  await run('say', '-o', `${tmp}/speech.aiff`, 'Knee is fine.')
  await run('afconvert', '-f', 'WAVE', '-d', 'LEI16@48000', '-c', '1', `${tmp}/speech.aiff`, `${tmp}/speech.wav`)
  for (const [kind, bitrate] of [['silk', 12000], ['hybrid', 20000], ['celt', 64000]] as const) {
    const caf = `${tmp}/${kind}.caf`
    await run('afconvert', '-f', 'caff', '-d', 'opus', '-b', String(bitrate), `${tmp}/speech.wav`, caf)
    await run('afconvert', '-f', 'WAVE', '-d', 'LEI16', caf, `${here}ref-voice-opus-${kind}.wav`)
    await writeOgg(`voice-opus-${kind}.opus`, await readCaf(caf))
  }
  await run('rm', '-rf', tmp)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
