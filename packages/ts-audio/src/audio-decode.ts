/**
 * Decoding audio to samples, on the server or anywhere else, without ffmpeg.
 *
 * `decodeAudio` reads a file's first audio track into planar float samples;
 * `decodeAudioToWav` also resamples, mixes down and writes a 16-bit WAV, the
 * shape a speech-to-text service takes (16 kHz mono by default).
 *
 * WAV, Ogg (Vorbis or Opus) and MP3 files are read here directly. Every other container
 * goes through the input formats (ADTS AAC from @ts-audio/aac, FLAC from
 * @ts-audio/flac, Ogg from @ts-audio/ogg, and whatever else is registered).
 * AAC, Opus and MP3 are decoded in TypeScript by the codec packages, which
 * are loaded only when a file needs them; other codecs plug in with
 * `registerAudioDecoder`. PCM needs no decoder.
 */

import type { InputFormat } from './demuxer'
import type { AudioDecoderFactory, AudioPacketDecoder, DecodedAudio, DecodedAudioChunk } from './audio-samples'
import type { AudioCodec, AudioTrack, EncodedPacket, Source } from './types'
import { AudioTooLongError, UnsupportedAudioCodecError } from './audio-errors'
import { decodeWav, encodeWav, isWav, mixChannels, pcmPacketDecoder, resampleAudio } from './audio-samples'
import { Input } from './input'
import { Reader } from './reader'
import { createSource, getSourceSize, readSourceBuffer } from './source'

export { AudioTooLongError, UnsupportedAudioCodecError } from './audio-errors'
export type {
  AudioDecoderFactory,
  AudioPacketDecoder,
  DecodedAudio,
  DecodedAudioChunk,
  PcmEncoding,
} from './audio-samples'
export {
  decodeWav,
  deinterleavePcm,
  encodeWav,
  isWav,
  mixChannels,
  resampleAudio,
} from './audio-samples'

const decoders = new Map<string, AudioDecoderFactory>()

/**
 * The codecs ts-audio decodes itself, each in its own package so that a
 * consumer who never meets the codec never loads it. A registered decoder for
 * the same codec takes precedence.
 */
const builtInDecoders: Record<string, () => Promise<AudioDecoderFactory>> = {
  aac: async () => (await import('@ts-audio/aac')).createAacDecoder,
  flac: async () => (await import('@ts-audio/flac')).createFlacDecoder,
  mp3: async () => (await import('@ts-audio/mp3')).createMp3Decoder,
  opus: async () => (await import('@ts-audio/opus')).createOpusDecoder,
  vorbis: async () => (await import('@ts-audio/vorbis')).createVorbisDecoder,
}

/**
 * Teach `decodeAudio` a compressed codec. A later registration for the same
 * codec replaces the earlier one; the function returned puts the earlier one
 * back.
 */
export function registerAudioDecoder(codec: AudioCodec, factory: AudioDecoderFactory): () => void {
  const previous = decoders.get(codec)
  decoders.set(codec, factory)
  return () => {
    if (decoders.get(codec) !== factory)
      return
    if (previous)
      decoders.set(codec, previous)
    else
      decoders.delete(codec)
  }
}

/** Whether `decodeAudio` can read this codec: PCM always, anything else once a decoder is registered. */
export function canDecodeAudioCodec(codec: AudioCodec): boolean {
  return codec.startsWith('pcm_') || decoders.has(codec) || codec in builtInDecoders
}

/** A sibling package, or null when it is not installed. */
async function optional<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load()
  }
  catch {
    return null
  }
}

/**
 * The container readers that are installed, strong magic numbers first so
 * that a frame-sniffing reader never claims a file another one owns. The
 * packages are optional, so a missing one is skipped.
 */
export async function defaultInputFormats(): Promise<InputFormat[]> {
  const formats: InputFormat[] = []
  const wav = await optional(() => import('@ts-audio/wav'))
  if (wav)
    formats.push(new wav.WavInputFormat())
  const flac = await optional(() => import('@ts-audio/flac'))
  if (flac)
    formats.push(new flac.FlacInputFormat())
  const ogg = await optional(() => import('@ts-audio/ogg'))
  if (ogg)
    formats.push(new ogg.OggInputFormat())
  const mp3 = await optional(() => import('@ts-audio/mp3'))
  if (mp3)
    formats.push(new mp3.Mp3InputFormat())
  const aac = await optional(() => import('@ts-audio/aac'))
  if (aac)
    formats.push(new aac.AacInputFormat())
  return formats
}

export interface DecodeAudioOptions {
  /** Refuse input larger than this many bytes before reading it. */
  maxBytes?: number
  /** Refuse audio longer than this many seconds, as soon as the decoded part is longer. */
  maxDurationSeconds?: number
  /** The container readers to try; the installed defaults otherwise. */
  formats?: InputFormat[]
  signal?: AbortSignal
}

type AudioInput = Uint8Array | ArrayBuffer | Blob | string | Source

/** Decodes the first audio track of a file to planar float samples at its own rate and channel count. */
export async function decodeAudio(input: AudioInput, options: DecodeAudioOptions = {}): Promise<DecodedAudio> {
  options.signal?.throwIfAborted()
  let bytes: Uint8Array | string | Source = input instanceof ArrayBuffer ? new Uint8Array(input) : input as Uint8Array | string | Source
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    // A Blob is already in memory, so its size is known without reading it.
    if (options.maxBytes !== undefined && (input.size === 0 || input.size > options.maxBytes))
      throw new Error('Audio size exceeds the upload limit or is empty')
    bytes = new Uint8Array(await input.arrayBuffer())
  }
  if (options.maxBytes !== undefined && bytes instanceof Uint8Array && (bytes.length === 0 || bytes.length > options.maxBytes))
    throw new Error('Audio size exceeds the upload limit or is empty')
  if (!(bytes instanceof Uint8Array))
    bytes = await readWholeWhenDirect(bytes, options.maxBytes) ?? bytes

  if (bytes instanceof Uint8Array) {
    const direct = await decodeDirect(bytes, options)
    if (direct)
      return direct
  }

  const source = isSource(bytes) ? bytes : createSource(bytes as Uint8Array | string)
  const formats = options.formats ?? await defaultInputFormats()
  const media = new Input({ source, format: await detectAmong(formats, source) })
  try {
    const track = await media.getPrimaryTrack()
    if (!track)
      throw new Error('No audio track found')
    return await decodeAudioPackets(track, media.packets(track.id), options)
  }
  finally {
    await media.close()
  }
}

/** The first reader of `formats` that recognises the source. */
async function detectAmong(formats: InputFormat[], source: Source): Promise<InputFormat> {
  for (const format of formats) {
    if (await format.canRead(source))
      return format
  }
  throw new Error('Could not detect audio format')
}

export interface DecodeAudioToWavOptions extends DecodeAudioOptions {
  /** Default 16000, what speech-to-text services take. */
  sampleRate?: number
  /** 1 (mono, the default) or 2. */
  channels?: 1 | 2
}

export interface DecodedWav {
  audio: Uint8Array
  mimeType: 'audio/wav'
  durationSeconds: number
  sampleRate: number
  channels: number
}

/**
 * Decodes any supported file to a 16-bit WAV at the given rate and channel
 * count: 16 kHz mono unless asked otherwise, ready for speech-to-text.
 */
export async function decodeAudioToWav(input: AudioInput, options: DecodeAudioToWavOptions = {}): Promise<DecodedWav> {
  const decoded = await decodeAudio(input, options)
  const sampleRate = options.sampleRate ?? 16000
  const channelCount = options.channels ?? 1
  const mixed = mixChannels(decoded.channels, channelCount)
  const samples = resampleAudio(mixed, decoded.sampleRate, sampleRate)
  const durationSeconds = (samples[0]?.length ?? 0) / sampleRate
  if (durationSeconds <= 0)
    throw new Error('Audio duration exceeds the recording limit or is empty')
  return { audio: encodeWav(samples, sampleRate), mimeType: 'audio/wav', durationSeconds, sampleRate, channels: channelCount }
}

/** WAV, Ogg Opus and MP3: files read here rather than through a container reader. */
async function decodeDirect(bytes: Uint8Array, options: DecodeAudioOptions): Promise<DecodedAudio | null> {
  const limit = options.maxDurationSeconds
  let decoded: { sampleRate: number, channels: Float32Array[] }
  let codec: AudioCodec
  const opus = await optional(() => import('@ts-audio/opus'))
  const mp3 = await optional(() => import('@ts-audio/mp3'))
  const vorbis = await optional(() => import('@ts-audio/vorbis'))
  // An Ogg file may hold either codec, so the more specific test comes first;
  // anything else in an Ogg container is named by decodeOggOpus's error.
  if (vorbis?.isOggVorbis(bytes)) {
    decoded = vorbis.decodeOggVorbis(bytes, { signal: options.signal, maxDurationSeconds: limit })
    codec = 'vorbis'
  }
  else if (opus?.isOgg(bytes)) {
    decoded = opus.decodeOggOpus(bytes, options.signal)
    codec = 'opus'
  }
  else if (isWav(bytes)) {
    const wav = decodeWav(bytes)
    decoded = wav
    codec = wav.codec
  }
  else if (mp3?.isMp3(bytes)) {
    decoded = mp3.decodeMp3File(bytes, { signal: options.signal, maxDurationSeconds: limit })
    codec = 'mp3'
  }
  else {
    return null
  }
  const duration = (decoded.channels[0]?.length ?? 0) / decoded.sampleRate
  if (limit !== undefined && duration > limit)
    throw new AudioTooLongError(limit)
  return { sampleRate: decoded.sampleRate, channels: decoded.channels, duration, codec }
}

/** The largest file read whole to look for WAV, Ogg or MP3 in it; anything bigger goes to the container readers. */
const DIRECT_LIMIT = 256 * 1024 * 1024

/**
 * A path, URL or source whose first bytes look like WAV, Ogg or MP3, read
 * whole; null for anything else, which the container readers take.
 */
async function readWholeWhenDirect(input: string | Source, maxBytes?: number): Promise<Uint8Array | null> {
  const source = isSource(input) ? input : createSource(input)
  const size = await getSourceSize(source)
  if (maxBytes !== undefined && size !== null && (size === 0 || size > maxBytes))
    throw new Error('Audio size exceeds the upload limit or is empty')
  if (size === null || size === 0 || size > DIRECT_LIMIT)
    return null
  const reader = new Reader(source)
  let head: Uint8Array | null
  try {
    await reader.init()
    head = await reader.readBytes(Math.min(size, 12))
  }
  finally {
    await reader.close()
  }
  if (!head || !(isOggMagic(head) || startsWithText(head, 'RIFF') || startsWithText(head, 'RF64') || startsWithText(head, 'ID3') || (head[0] === 0xFF && (head[1] & 0xE0) === 0xE0)))
    return null
  return readSourceBuffer(source)
}

/** Ogg starts every page with "OggS"; the sniff is needed before @ts-audio/opus is loaded. */
function isOggMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53
}

function startsWithText(bytes: Uint8Array, text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (bytes[i] !== text.charCodeAt(i))
      return false
  }
  return true
}

const SOURCE_TYPES = ['buffer', 'file', 'url', 'stream']

function isSource(value: unknown): value is Source {
  return typeof value === 'object' && value !== null && SOURCE_TYPES.includes((value as Source).type)
}

/**
 * The decoder for a track: one registered with `registerAudioDecoder` first,
 * then the built-in codec package, loaded on demand; PCM needs no codec, and
 * anything else is refused by name.
 *
 * Reach for this when you read the container yourself -- ts-videos reads MP4,
 * WebM, Matroska and MPEG-TS -- and want the decoder ts-audio would have
 * picked, registry and all. `decodeAudioPackets` is usually what you want
 * instead; this is for driving the decoder packet by packet.
 */
export async function createAudioDecoder(track: AudioTrack): Promise<AudioPacketDecoder> {
  if (track.codec.startsWith('pcm_'))
    return pcmPacketDecoder(track)
  const registered = decoders.get(track.codec)
  if (registered)
    return registered(track)
  const load = builtInDecoders[track.codec]
  const factory = load ? await optional(load) : null
  if (!factory)
    throw new UnsupportedAudioCodecError(track.codec)
  return factory(track)
}

export interface DecodeAudioPacketsOptions {
  /** Refuse audio longer than this many seconds, as soon as the decoded part is longer. */
  maxDurationSeconds?: number
  signal?: AbortSignal
}

/**
 * One track's packets to samples: the same decoding `decodeAudio` does, for a
 * track a caller read out of its own container. The packets may be a plain
 * iterable or an async one, and the track's `trimStart` and `trimmedDuration`
 * are applied, so the encoder's priming and padding go as they would here.
 */
export async function decodeAudioPackets(
  track: AudioTrack,
  packets: AsyncIterable<EncodedPacket> | Iterable<EncodedPacket>,
  options: DecodeAudioPacketsOptions = {},
): Promise<DecodedAudio> {
  options.signal?.throwIfAborted()
  const decoder = await createAudioDecoder(track)
  const collector = new SampleCollector(options.maxDurationSeconds)
  try {
    for await (const packet of packets) {
      options.signal?.throwIfAborted()
      collector.add(decoder.decode(packet))
    }
    collector.add(decoder.flush?.() ?? null)
  }
  finally {
    decoder.close?.()
  }
  return collector.result(track)
}

/** Joins decoded chunks, keeps to one rate and layout, and stops at the duration limit. */
class SampleCollector {
  private chunks: Float32Array[][] = []
  private frames = 0
  private sampleRate = 0
  private channelCount = 0

  constructor(private readonly maxDurationSeconds?: number) {}

  add(chunk: DecodedAudioChunk | null): void {
    if (!chunk || !chunk.channels.length || !chunk.channels[0].length)
      return
    if (!this.sampleRate) {
      this.sampleRate = chunk.sampleRate
      this.channelCount = chunk.channels.length
    }
    if (chunk.sampleRate !== this.sampleRate)
      throw new Error('The audio changes sample rate partway through')
    this.chunks.push(mixChannels(chunk.channels, this.channelCount))
    this.frames += chunk.channels[0].length
    if (this.maxDurationSeconds !== undefined && this.frames / this.sampleRate > this.maxDurationSeconds)
      throw new AudioTooLongError(this.maxDurationSeconds)
  }

  /** The samples joined, without the encoder's priming and padding when the container marks them. */
  result(track: AudioTrack): DecodedAudio {
    const sampleRate = this.sampleRate || track.sampleRate
    const start = Math.min(this.frames, Math.round((track.trimStart ?? 0) * sampleRate))
    const end = track.trimmedDuration ? Math.min(this.frames, start + Math.round(track.trimmedDuration * sampleRate)) : this.frames
    const length = Math.max(0, end - start)
    const channels = Array.from({ length: this.channelCount }, () => new Float32Array(length))
    let offset = 0
    for (const chunk of this.chunks) {
      const chunkLength = chunk[0].length
      const from = Math.max(start, offset)
      const to = Math.min(end, offset + chunkLength)
      if (to > from) {
        for (let c = 0; c < this.channelCount; c++)
          channels[c].set(chunk[c].subarray(from - offset, to - offset), from - start)
      }
      offset += chunkLength
    }
    return { sampleRate, channels, duration: length / sampleRate, codec: track.codec }
  }
}
