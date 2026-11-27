/**
 * ts-audio - Zero-dependency TypeScript audio toolkit
 */

// Types
export * from './types'

// Core utilities
export { Reader, FileSlice, createReader } from './reader'
export { Writer, createWriter, BufferTarget } from './writer'
export { BitReader, BitWriter, crc8, crc16, crc32, crc8Flac, crc16Flac, crc16Mp3 } from './bitstream'

// Source/Target abstractions
export {
  createSource,
  bufferSource,
  fileSource,
  urlSource,
  streamSource,
  supportsSeek,
  getSourceSize,
  readSourceBuffer,
  createReadStream,
} from './source'

export {
  createTarget,
  bufferTarget,
  fileTarget,
  streamTarget,
  writeToTarget,
  createWriteStream,
} from './target'

// Demuxer/Muxer
export { Demuxer, InputFormat } from './demuxer'
export { Muxer, OutputFormat, AsyncMutex, assertCodecSupported, codecMatches } from './muxer'

// High-level API
export { Input, createInput, registerInputFormat, getInputFormats, detectFormat } from './input'
export { Output, createOutput, registerOutputFormat, getOutputFormats, getOutputFormat, getOutputFormatByExtension } from './output'
export { Conversion, convert } from './conversion'
export * from './delivery'
export * from './delivery-workflow'
export * from './native-transcode'

// Transforms
export { imdct } from './transform'

// Decoding to samples
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
  pcmPacketDecoder,
  resampleAudio,
} from './audio-samples'
export type { DecodeAudioOptions, DecodeAudioPacketsOptions, DecodeAudioToWavOptions, DecodedWav } from './audio-decode'
export {
  canDecodeAudioCodec,
  createAudioDecoder,
  decodeAudio,
  decodeAudioPackets,
  decodeAudioToWav,
  defaultInputFormats,
  registerAudioDecoder,
} from './audio-decode'

// Format registry
export {
  formats,
  getFormatInfo,
  isInputSupported,
  isOutputSupported,
  getSupportedInputExtensions,
  getSupportedOutputExtensions,
} from './formats'

// Utilities
export {
  formatDuration,
  parseDuration,
  formatFileSize,
  formatBitrate,
  formatSampleRate,
  getChannelLayoutName,
  concatenateBuffers,
  buffersEqual,
  floatToInt16,
  int16ToFloat,
  interleaveChannels,
  deinterleaveChannels,
  calculateRMS,
  calculatePeak,
  dbToLinear,
  linearToDb,
  applyGain,
  mixBuffers,
  normalize,
  fadeIn,
  fadeOut,
  resampleLinear,
  delay,
  memoize,
  memoizeAsync,
} from './utils'
