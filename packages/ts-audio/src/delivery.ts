import type { AudioCodec, AudioTrack, ConversionOptions } from './types'

export type WebAudioFormat = 'opus' | 'aac' | 'mp3'
export type AudioContentProfile = 'speech' | 'music' | 'general'

export interface AudioSourceProfile {
  codec: AudioCodec
  container: string
  duration: number
  sampleRate: number
  channels: number
  bitrate?: number
}

export interface AudioRuntimeCapabilities {
  encoder: boolean
  codecs: WebAudioFormat[]
}

export interface AudioDeliveryOptions {
  formats?: WebAudioFormat[]
  profile?: AudioContentProfile
  maxBitrate?: number
}

export interface PlannedAudioOutput {
  format: WebAudioFormat
  container: 'ogg' | 'aac' | 'mp3'
  mimeType: 'audio/ogg; codecs=opus' | 'audio/aac' | 'audio/mpeg'
  extension: 'ogg' | 'aac' | 'mp3'
  bitrate: number
  action: 'copy' | 'transcode'
  available: boolean
  reason?: string
}

export interface AudioDeliveryPlan {
  source: AudioSourceProfile
  outputs: PlannedAudioOutput[]
}

export interface WaveformOptions {
  samples?: number
  precision?: number
}

export interface SerializedWaveform {
  version: 1
  channels: number
  sampleRate: number
  duration: number
  samplesPerPeak: number
  peaks: number[][]
}

export interface TranscriptSegmentInput {
  startTime: number
  endTime: number
  text: string
  confidence?: number
  speaker?: string
}

export interface TranscriptInput {
  language: string
  segments: TranscriptSegmentInput[]
}

export interface TranscriptSegment extends TranscriptSegmentInput {
  id: number
}

export interface NormalizedTranscript {
  language: string
  segments: TranscriptSegment[]
  vtt: string
}

interface NativeAudioEncoderConfig {
  codec: string
  sampleRate: number
  numberOfChannels: number
  bitrate: number
}

interface NativeAudioEncoderConstructor {
  isConfigSupported: (config: NativeAudioEncoderConfig) => Promise<{ supported?: boolean }>
}

const outputDetails: Record<WebAudioFormat, Pick<PlannedAudioOutput, 'container' | 'mimeType' | 'extension'>> = {
  opus: { container: 'ogg', mimeType: 'audio/ogg; codecs=opus', extension: 'ogg' },
  aac: { container: 'aac', mimeType: 'audio/aac', extension: 'aac' },
  mp3: { container: 'mp3', mimeType: 'audio/mpeg', extension: 'mp3' },
}

function validateSource(source: AudioSourceProfile): void {
  for (const [name, value] of Object.entries({
    duration: source.duration,
    sampleRate: source.sampleRate,
    channels: source.channels,
  })) {
    if (!Number.isFinite(value) || value <= 0) throw new TypeError(`Audio ${name} must be a positive number`)
  }
}

export function recommendAudioBitrate(
  format: WebAudioFormat,
  source: Pick<AudioSourceProfile, 'sampleRate' | 'channels' | 'bitrate'>,
  profile: AudioContentProfile = 'general',
): number {
  const channels = Math.min(2, Math.max(1, source.channels))
  const sampleRateFactor = source.sampleRate <= 24_000 ? 0.75 : source.sampleRate >= 88_200 ? 1.15 : 1
  const base = profile === 'speech'
    ? (channels === 1 ? 48_000 : 64_000)
    : profile === 'music'
      ? (channels === 1 ? 96_000 : 192_000)
      : (channels === 1 ? 64_000 : 128_000)
  const codecFactor = format === 'opus' ? 0.8 : format === 'mp3' ? 1.2 : 1
  const recommended = Math.round(base * sampleRateFactor * codecFactor / 1000) * 1000
  return Math.max(32_000, Math.min(source.bitrate ?? Number.POSITIVE_INFINITY, recommended))
}

export function buildAudioDeliveryPlan(
  source: AudioSourceProfile,
  options: AudioDeliveryOptions = {},
  capabilities: AudioRuntimeCapabilities = { encoder: false, codecs: [] },
): AudioDeliveryPlan {
  validateSource(source)
  const formats: WebAudioFormat[] = [...new Set(options.formats ?? ['opus', 'aac', 'mp3'] as const)]
  if (formats.length === 0) throw new TypeError('Audio delivery plan requires at least one output format')

  const outputs = formats.map((format): PlannedAudioOutput => {
    const details = outputDetails[format]
    const canCopy = source.codec === format
      && (source.container.toLowerCase() === details.container || source.container.toLowerCase() === details.extension)
    const action = canCopy ? 'copy' : 'transcode'
    const available = canCopy || (capabilities.encoder && capabilities.codecs.includes(format))
    const reason = available ? undefined : `No ${format} encoder is available`
    const recommended = recommendAudioBitrate(format, source, options.profile)
    const bitrate = Math.min(options.maxBitrate ?? Number.POSITIVE_INFINITY, recommended)
    return { format, ...details, bitrate, action, available, reason }
  })

  return { source, outputs }
}

export function assertAudioPlanExecutable(plan: AudioDeliveryPlan): void {
  const unavailable = plan.outputs.filter(output => !output.available)
  if (unavailable.length === 0) return
  throw new Error(unavailable.map(output => `${output.format}: ${output.reason}`).join('; '))
}

export async function detectAudioRuntimeCapabilities(): Promise<AudioRuntimeCapabilities> {
  const codecs: WebAudioFormat[] = []
  const configs: Array<[WebAudioFormat, NativeAudioEncoderConfig]> = [
    ['opus', { codec: 'opus', sampleRate: 48_000, numberOfChannels: 2, bitrate: 128_000 }],
    ['aac', { codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 2, bitrate: 160_000 }],
    ['mp3', { codec: 'mp3', sampleRate: 48_000, numberOfChannels: 2, bitrate: 192_000 }],
  ]
  const audioEncoder = (globalThis as { AudioEncoder?: NativeAudioEncoderConstructor }).AudioEncoder
  if (audioEncoder) {
    for (const [codec, config] of configs) {
      const support = await audioEncoder.isConfigSupported(config).catch(() => null)
      if (support?.supported) codecs.push(codec)
    }
  }
  return { encoder: codecs.length > 0, codecs }
}

interface AcceptedMediaRange {
  type: string
  subtype: string
  q: number
  order: number
}

function parseAccept(accept: string): AcceptedMediaRange[] {
  return accept.split(',').map((part, order) => {
    const [mediaRange, ...parameters] = part.trim().toLowerCase().split(';').map(value => value.trim())
    const [type = '*', subtype = '*'] = mediaRange.split('/')
    const qParameter = parameters.find(parameter => parameter.startsWith('q='))
    const q = qParameter ? Number.parseFloat(qParameter.slice(2)) : 1
    return { type, subtype, q: Number.isFinite(q) ? Math.max(0, Math.min(1, q)) : 0, order }
  }).filter(range => range.q > 0)
}

function mimeScore(mimeType: string, ranges: AcceptedMediaRange[]): { q: number, specificity: number, order: number } {
  const [type, subtype] = mimeType.split(';', 1)[0].trim().toLowerCase().split('/')
  let best = { q: 0, specificity: -1, order: Number.POSITIVE_INFINITY }
  for (const range of ranges) {
    const typeMatches = range.type === '*' || range.type === type
    const subtypeMatches = range.subtype === '*' || range.subtype === subtype
    if (!typeMatches || !subtypeMatches) continue
    const specificity = Number(range.type !== '*') + Number(range.subtype !== '*')
    if (specificity > best.specificity || (specificity === best.specificity && range.order < best.order)) {
      best = { q: range.q, specificity, order: range.order }
    }
  }
  return best
}

export function negotiateAudioOutput(
  outputs: readonly PlannedAudioOutput[],
  accept = '*/*',
): PlannedAudioOutput | undefined {
  const ranges = parseAccept(accept || '*/*')
  return outputs
    .filter(output => output.available)
    .map((output, index) => ({ output, index, score: mimeScore(output.mimeType, ranges) }))
    .filter(candidate => candidate.score.q > 0)
    .sort((a, b) => b.score.q - a.score.q
      || b.score.specificity - a.score.specificity
      || a.score.order - b.score.order
      || a.index - b.index)[0]?.output
}

export function buildWaveform(
  channelData: readonly Float32Array[],
  sampleRate: number,
  options: WaveformOptions = {},
): SerializedWaveform {
  if (channelData.length === 0) throw new TypeError('Waveform requires at least one channel')
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new TypeError('Waveform sample rate must be positive')
  const frameCount = channelData[0].length
  if (channelData.some(channel => channel.length !== frameCount)) throw new TypeError('Waveform channels must have equal lengths')
  const sampleCount = Math.max(1, Math.min(frameCount || 1, Math.floor(options.samples ?? 1000)))
  const precision = Math.max(0, Math.min(6, Math.floor(options.precision ?? 4)))
  const samplesPerPeak = Math.max(1, Math.ceil(frameCount / sampleCount))
  let absolutePeak = 0
  const raw = channelData.map((channel) => {
    const peaks: Array<[number, number]> = []
    for (let start = 0; start < frameCount; start += samplesPerPeak) {
      let min = 1
      let max = -1
      const end = Math.min(frameCount, start + samplesPerPeak)
      for (let index = start; index < end; index++) {
        const value = Number.isFinite(channel[index]) ? Math.max(-1, Math.min(1, channel[index])) : 0
        min = Math.min(min, value)
        max = Math.max(max, value)
        absolutePeak = Math.max(absolutePeak, Math.abs(value))
      }
      peaks.push([min, max])
    }
    return peaks
  })
  const divisor = absolutePeak || 1
  const round = (value: number): number => Number((value / divisor).toFixed(precision))
  return {
    version: 1,
    channels: channelData.length,
    sampleRate,
    duration: frameCount / sampleRate,
    samplesPerPeak,
    peaks: raw.map(channel => channel.flatMap(([min, max]) => [round(min), round(max)])),
  }
}

function formatVttTime(seconds: number): string {
  const milliseconds = Math.round(seconds * 1000)
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  const secs = Math.floor((milliseconds % 60_000) / 1000)
  const millis = milliseconds % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

export function normalizeTranscript(input: TranscriptInput): NormalizedTranscript {
  if (!input.language.trim()) throw new TypeError('Transcript language is required')
  let previousEnd = 0
  const segments = input.segments.map((segment, index): TranscriptSegment => {
    if (!Number.isFinite(segment.startTime) || !Number.isFinite(segment.endTime)
      || segment.startTime < 0 || segment.endTime <= segment.startTime) {
      throw new TypeError(`Transcript segment ${index} has invalid timestamps`)
    }
    if (segment.startTime < previousEnd) throw new TypeError(`Transcript segment ${index} overlaps the previous segment`)
    if (!segment.text.trim()) throw new TypeError(`Transcript segment ${index} has no text`)
    if (segment.confidence !== undefined && (segment.confidence < 0 || segment.confidence > 1)) {
      throw new TypeError(`Transcript segment ${index} confidence must be between 0 and 1`)
    }
    previousEnd = segment.endTime
    return { ...segment, text: segment.text.trim(), id: index + 1 }
  })
  const lines = ['WEBVTT', '']
  for (const segment of segments) {
    lines.push(String(segment.id), `${formatVttTime(segment.startTime)} --> ${formatVttTime(segment.endTime)}`)
    lines.push(segment.speaker ? `<v ${segment.speaker}>${segment.text}` : segment.text, '')
  }
  return { language: input.language.trim().toLowerCase(), segments, vtt: lines.join('\n') }
}

export function assertPacketCopyConversion(track: AudioTrack, options: ConversionOptions): void {
  const requestedCodec = options.audioCodec ?? track.codec
  const transformations = [
    requestedCodec !== track.codec && `codec ${track.codec} to ${requestedCodec}`,
    options.audioBitrate !== undefined && options.audioBitrate !== track.bitrate && 'bitrate change',
    options.sampleRate !== undefined && options.sampleRate !== track.sampleRate && 'resampling',
    options.channels !== undefined && options.channels !== track.channels && 'channel conversion',
    options.channelLayout !== undefined && options.channelLayout !== track.channelLayout && 'channel layout conversion',
    options.bitDepth !== undefined && options.bitDepth !== track.bitDepth && 'bit depth conversion',
    options.sampleFormat !== undefined && options.sampleFormat !== track.sampleFormat && 'sample format conversion',
    options.normalize && 'normalization',
    options.volume !== undefined && options.volume !== 1 && 'volume adjustment',
    options.fadeIn !== undefined && options.fadeIn > 0 && 'fade in',
    options.fadeOut !== undefined && options.fadeOut > 0 && 'fade out',
    options.trimSilence && 'silence trimming',
  ].filter((value): value is string => typeof value === 'string')
  if (transformations.length > 0) {
    throw new Error(`Packet-copy conversion cannot perform ${transformations.join(', ')}; a native decoder and encoder are required`)
  }
}
