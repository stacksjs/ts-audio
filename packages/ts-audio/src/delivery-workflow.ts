import type { AudioDeliveryPlan, NormalizedTranscript, TranscriptInput } from './delivery'
import { normalizeTranscript } from './delivery'

export type AudioDrmSystem = 'clear-key' | 'fairplay' | 'playready' | 'widevine'

export interface AudioDrmDescriptor {
  system: AudioDrmSystem
  keyId: string
  licenseUrl: string
  keyFormatVersions?: string
}

export interface AudioSegmentInput {
  uri: string
  duration: number
  data: Uint8Array
  initialization?: { uri: string, data: Uint8Array }
}

export interface AudioHlsProtection {
  key: Uint8Array | ((_segmentIndex: number) => Uint8Array | Promise<Uint8Array>)
  keyUri: string | ((_segmentIndex: number) => string)
  iv?: Uint8Array | ((_segmentIndex: number) => Uint8Array)
}

export interface AudioDeliveryBundleOptions {
  playlistPath?: string
  hlsAes128?: AudioHlsProtection
  drm?: { descriptor: AudioDrmDescriptor, segmentsEncrypted: boolean }
}

export interface AudioDeliveryBundle {
  files: Record<string, string | Uint8Array>
  playlist: string
  encrypted: boolean
}

export interface AudioChapterInput {
  title: string
  startTime: number
  endTime?: number
  url?: string
}

export interface AudioChapter extends AudioChapterInput {
  id: number
  endTime: number
}

export interface TranscriptProviderInput {
  audio: Uint8Array
  language?: string
  mimeType?: string
}

export interface TranscriptProvider {
  name: string
  version?: string
  transcribe: (_input: TranscriptProviderInput) => Promise<TranscriptInput>
}

export interface TranscriptCache {
  get: (_key: string) => Promise<NormalizedTranscript | null>
  set: (_key: string, _value: NormalizedTranscript) => Promise<void>
}

export class MemoryTranscriptCache implements TranscriptCache {
  private values = new Map<string, NormalizedTranscript>()

  async get(key: string): Promise<NormalizedTranscript | null> {
    return this.values.get(key) ?? null
  }

  async set(key: string, value: NormalizedTranscript): Promise<void> {
    this.values.set(key, value)
  }
}

const drmKeyFormats: Record<Exclude<AudioDrmSystem, 'clear-key'>, string> = {
  fairplay: 'com.apple.streamingkeydelivery',
  playready: 'com.microsoft.playready',
  widevine: 'urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed',
}

function basename(path: string): string {
  const value = path.split(/[?#]/, 1)[0].split('/').at(-1)
  if (!value || value === '.' || value === '..') throw new TypeError('Audio segment URI must include a filename')
  return value
}

function hlsIv(sequence: number): Uint8Array {
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new TypeError('HLS sequence must be a non-negative integer')
  const value = new Uint8Array(16)
  new DataView(value.buffer).setBigUint64(8, BigInt(sequence))
  return value
}

function hex(value: Uint8Array): string {
  return [...value].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function encryptSegment(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Promise<Uint8Array> {
  if (key.byteLength !== 16) throw new TypeError('Audio HLS AES-128 key must contain exactly 16 bytes')
  if (iv.byteLength !== 16) throw new TypeError('Audio HLS AES-128 IV must contain exactly 16 bytes')
  const keyBytes = Uint8Array.from(key)
  const ivBytes = Uint8Array.from(iv)
  const dataBytes = Uint8Array.from(data)
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes.buffer, { name: 'AES-CBC' }, false, ['encrypt'])
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: ivBytes.buffer }, cryptoKey, dataBytes.buffer))
}

function quote(value: string): string {
  if (/[\r\n"]/.test(value)) throw new TypeError('HLS attribute contains an unsafe character')
  return `"${value}"`
}

export async function createAudioDeliveryBundle(
  plan: AudioDeliveryPlan,
  segments: AudioSegmentInput[],
  options: AudioDeliveryBundleOptions = {},
): Promise<AudioDeliveryBundle> {
  if (segments.length === 0) throw new TypeError('Audio delivery requires at least one segment')
  if (options.drm && !options.drm.segmentsEncrypted) throw new TypeError('Audio DRM manifests require pre-encrypted SAMPLE-AES segments')
  if (options.hlsAes128 && options.drm) throw new TypeError('Native AES-128 and SAMPLE-AES DRM cannot protect the same playlist')
  const output = plan.outputs.find(item => item.available) ?? plan.outputs[0]
  if (!output) throw new TypeError('Audio delivery plan has no output')
  const path = options.playlistPath ?? 'hls/audio.m3u8'
  const prefix = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
  const files: Record<string, string | Uint8Array> = {}
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    `#EXT-X-TARGETDURATION:${Math.ceil(Math.max(...segments.map(segment => segment.duration)))}`,
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-INDEPENDENT-SEGMENTS',
  ]

  let currentInitialization = ''
  for (const [index, segment] of segments.entries()) {
    if (!Number.isFinite(segment.duration) || segment.duration <= 0) throw new TypeError('Audio segment duration must be positive')
    const name = basename(segment.uri)
    if (segment.initialization) {
      const initialization = basename(segment.initialization.uri)
      files[`${prefix}${initialization}`] = segment.initialization.data
      if (initialization !== currentInitialization) {
        lines.push(`#EXT-X-MAP:URI=${quote(initialization)}`)
        currentInitialization = initialization
      }
    }
    let data = segment.data
    if (options.hlsAes128) {
      const key = typeof options.hlsAes128.key === 'function' ? await options.hlsAes128.key(index) : options.hlsAes128.key
      const keyUri = typeof options.hlsAes128.keyUri === 'function' ? options.hlsAes128.keyUri(index) : options.hlsAes128.keyUri
      const iv = typeof options.hlsAes128.iv === 'function' ? options.hlsAes128.iv(index) : options.hlsAes128.iv ?? hlsIv(index)
      data = await encryptSegment(data, key, iv)
      lines.push(`#EXT-X-KEY:METHOD=AES-128,URI=${quote(keyUri)},IV=0x${hex(iv)}`)
    }
    else if (options.drm) {
      const descriptor = options.drm.descriptor
      if (descriptor.system === 'clear-key') throw new TypeError('Clear-key audio should use native HLS AES-128 protection')
      lines.push(`#EXT-X-KEY:METHOD=${descriptor.system === 'fairplay' ? 'SAMPLE-AES' : 'SAMPLE-AES-CTR'},URI=${quote(descriptor.licenseUrl)},KEYFORMAT=${quote(drmKeyFormats[descriptor.system])},KEYFORMATVERSIONS=${quote(descriptor.keyFormatVersions ?? '1')}`)
    }
    lines.push(`#EXTINF:${segment.duration.toFixed(6)},`, name)
    files[`${prefix}${name}`] = data
  }
  lines.push('#EXT-X-ENDLIST', '')
  const playlist = lines.join('\n')
  files[path] = playlist
  return { files, playlist, encrypted: !!options.hlsAes128 || !!options.drm }
}

export function normalizeAudioChapters(chapters: AudioChapterInput[], duration: number): AudioChapter[] {
  if (!Number.isFinite(duration) || duration <= 0) throw new TypeError('Audio duration must be positive')
  let previousEnd = 0
  return chapters.map((chapter, index) => {
    const endTime = chapter.endTime ?? chapters[index + 1]?.startTime ?? duration
    if (!chapter.title.trim()) throw new TypeError(`Audio chapter ${index} requires a title`)
    if (!Number.isFinite(chapter.startTime) || chapter.startTime < 0 || endTime <= chapter.startTime || endTime > duration) {
      throw new TypeError(`Audio chapter ${index} has invalid timestamps`)
    }
    if (chapter.startTime < previousEnd) throw new TypeError('Audio chapters cannot overlap')
    previousEnd = endTime
    return { ...chapter, title: chapter.title.trim(), id: index + 1, endTime }
  })
}

async function transcriptCacheKey(input: TranscriptProviderInput, provider: TranscriptProvider): Promise<string> {
  const data = Uint8Array.from(input.audio)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data.buffer))
  return ['transcript-v1', provider.name, provider.version ?? '1', input.language ?? '', input.mimeType ?? '', hex(digest)].join(':')
}

export async function transcribeWithCache(
  input: TranscriptProviderInput,
  provider: TranscriptProvider,
  cache: TranscriptCache = new MemoryTranscriptCache(),
): Promise<{ transcript: NormalizedTranscript, cacheHit: boolean, key: string }> {
  if (input.audio.byteLength === 0) throw new TypeError('Transcription requires audio bytes')
  if (!provider.name.trim()) throw new TypeError('Transcript provider requires a name')
  const key = await transcriptCacheKey(input, provider)
  const existing = await cache.get(key)
  if (existing) return { transcript: existing, cacheHit: true, key }
  const transcript = normalizeTranscript(await provider.transcribe(input))
  await cache.set(key, transcript)
  return { transcript, cacheHit: false, key }
}
