/**
 * Core types for ts-audio
 */

// Audio codec types
export type AudioCodec =
  | 'mp3'
  | 'aac'
  | 'opus'
  | 'vorbis'
  | 'flac'
  | 'pcm'
  | 'alac'
  | 'ac3'
  | 'eac3'
  | 'dts'
  | string

// Sample format types
export type SampleFormat =
  | 'u8'       // unsigned 8-bit
  | 's16'      // signed 16-bit
  | 's24'      // signed 24-bit
  | 's32'      // signed 32-bit
  | 'f32'      // 32-bit float
  | 'f64'      // 64-bit float
  | 's16p'     // planar signed 16-bit
  | 's32p'     // planar signed 32-bit
  | 'f32p'     // planar 32-bit float
  | 'f64p'     // planar 64-bit float

// Channel layout
export type ChannelLayout =
  | 'mono'
  | 'stereo'
  | '2.1'
  | '3.0'
  | '3.1'
  | '4.0'
  | '4.1'
  | '5.0'
  | '5.1'
  | '6.1'
  | '7.1'

// Audio track information
export interface AudioTrack {
  type: 'audio'
  id: number
  index: number
  codec: AudioCodec
  sampleRate: number
  channels: number
  channelLayout?: ChannelLayout
  bitDepth?: number
  sampleFormat?: SampleFormat
  bitrate?: number
  duration?: number
  language?: string
  title?: string
  isDefault?: boolean
  isForced?: boolean
  codecDescription?: Uint8Array
}

// Encoded packet from demuxer
export interface EncodedPacket {
  data: Uint8Array
  timestamp: number
  duration?: number
  isKeyframe: boolean
  trackId: number
  pts?: number
  dts?: number
}

// Decoded audio frame
export interface AudioFrame {
  data: Float32Array[] | Int16Array[] | Uint8Array[]
  sampleRate: number
  channels: number
  sampleFormat: SampleFormat
  timestamp: number
  duration: number
  samples: number
}

// Audio metadata
export interface AudioMetadata {
  title?: string
  artist?: string
  album?: string
  albumArtist?: string
  composer?: string
  genre?: string
  year?: number
  trackNumber?: number
  trackTotal?: number
  discNumber?: number
  discTotal?: number
  comment?: string
  lyrics?: string
  copyright?: string
  encodedBy?: string
  encoder?: string
  date?: string
  isrc?: string
  bpm?: number
  replayGain?: {
    trackGain?: number
    trackPeak?: number
    albumGain?: number
    albumPeak?: number
  }
  coverArt?: {
    data: Uint8Array
    mimeType: string
    description?: string
  }[]
  custom?: Record<string, string>
}

// Track configuration for output
export interface AudioTrackConfig {
  codec: AudioCodec
  sampleRate: number
  channels: number
  channelLayout?: ChannelLayout
  bitDepth?: number
  sampleFormat?: SampleFormat
  bitrate?: number
  codecDescription?: Uint8Array
}

// Output track
export interface OutputAudioTrack {
  id: number
  type: 'audio'
  config: AudioTrackConfig
}

// Conversion options
export interface ConversionOptions {
  audioCodec?: AudioCodec
  audioBitrate?: number
  sampleRate?: number
  channels?: number
  channelLayout?: ChannelLayout
  bitDepth?: number
  sampleFormat?: SampleFormat
  startTime?: number
  endTime?: number
  normalize?: boolean
  volume?: number
  fadeIn?: number
  fadeOut?: number
  trimSilence?: boolean
  trimThreshold?: number
}

// Conversion progress
export interface ConversionProgress {
  percentage: number
  currentTime: number
  totalTime: number
  inputBytes: number
  outputBytes: number
  speed?: number
}

// Source types for input
export type SourceType = 'buffer' | 'file' | 'url' | 'stream'

export interface BufferSource {
  type: 'buffer'
  data: Uint8Array | ArrayBuffer
}

export interface FileSource {
  type: 'file'
  path: string
}

export interface UrlSource {
  type: 'url'
  url: string
  headers?: Record<string, string>
}

export interface StreamSource {
  type: 'stream'
  stream: ReadableStream<Uint8Array>
}

export type Source = BufferSource | FileSource | UrlSource | StreamSource

// Target types for output
export type TargetType = 'buffer' | 'file' | 'stream'

export interface BufferTarget {
  type: 'buffer'
}

export interface FileTarget {
  type: 'file'
  path: string
}

export interface StreamTarget {
  type: 'stream'
  stream: WritableStream<Uint8Array>
}

export type Target = BufferTarget | FileTarget | StreamTarget

// Format detection result
export interface FormatInfo {
  name: string
  mimeType: string
  extension: string
  hasAudio: boolean
}

// Waveform data
export interface WaveformData {
  peaks: Float32Array
  rms: Float32Array
  sampleRate: number
  channels: number
  duration: number
  samplesPerPeak: number
}

// Spectrum data
export interface SpectrumData {
  magnitudes: Float32Array[]
  frequencies: Float32Array
  timeStamps: Float32Array
  sampleRate: number
}

// Audio analysis result
export interface AudioAnalysis {
  duration: number
  sampleRate: number
  channels: number
  bitDepth?: number
  codec: AudioCodec
  bitrate?: number
  peakLevel: number
  rmsLevel: number
  dynamicRange?: number
  loudness?: {
    integrated: number
    range: number
    truePeak: number
  }
}

// ID3 tag types
export interface ID3v1Tag {
  title: string
  artist: string
  album: string
  year: string
  comment: string
  track?: number
  genre: number
}

export interface ID3v2Frame {
  id: string
  data: Uint8Array
  flags?: number
}

export interface ID3v2Tag {
  version: { major: number; minor: number }
  flags: number
  frames: ID3v2Frame[]
}

// Vorbis comment
export interface VorbisComment {
  vendor: string
  comments: Record<string, string[]>
}

// FLAC metadata blocks
export interface FlacStreamInfo {
  minBlockSize: number
  maxBlockSize: number
  minFrameSize: number
  maxFrameSize: number
  sampleRate: number
  channels: number
  bitsPerSample: number
  totalSamples: bigint
  md5: Uint8Array
}

export interface FlacSeekPoint {
  sampleNumber: bigint
  offset: bigint
  samples: number
}

export interface FlacCueSheet {
  catalogNumber: string
  leadInSamples: bigint
  isCD: boolean
  tracks: FlacCueTrack[]
}

export interface FlacCueTrack {
  offset: bigint
  number: number
  isrc: string
  isAudio: boolean
  preEmphasis: boolean
  indices: { offset: bigint; number: number }[]
}

export interface FlacPicture {
  type: number
  mimeType: string
  description: string
  width: number
  height: number
  colorDepth: number
  colorCount: number
  data: Uint8Array
}
