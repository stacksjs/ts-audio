import type { AudioCodec, EncodedPacket, Source } from './types'
import type { AudioDeliveryPlan, PlannedAudioOutput } from './delivery'
import type { Input } from './input'
import type { Output } from './output'
import { assertAudioPlanExecutable } from './delivery'
import { Conversion } from './conversion'
import { createInput, getInputFormats, registerInputFormat } from './input'
import { createOutput, getOutputFormats, registerOutputFormat } from './output'

export type NativeAudioCodec = 'aac' | 'mp3' | 'opus'

export interface NativeAudioTranscodeOptions {
  codec: NativeAudioCodec
  bitrate?: number
  batchSize?: number
  signal?: AbortSignal
}

export interface NativeAudioTranscodeResult {
  bytes: Uint8Array
  codec: NativeAudioCodec
  packets: number
  inputBytes: number
  outputBytes: number
}

export interface AudioDerivative {
  output: PlannedAudioOutput
  bytes: Uint8Array
}

export interface AudioDerivativeOptions {
  inputFactory?: () => Input
  outputFactory?: (_output: PlannedAudioOutput) => Output
  batchSize?: number
  signal?: AbortSignal
}

interface NativeAudioData {
  timestamp: number
  duration?: number | null
  close: () => void
}

interface NativeAudioChunk {
  timestamp: number
  duration?: number | null
  byteLength: number
  copyTo: (_destination: Uint8Array) => void
}

interface NativeAudioDecoderConfig {
  codec: string
  sampleRate: number
  numberOfChannels: number
  description?: Uint8Array
}

interface NativeAudioEncoderConfig {
  codec: string
  sampleRate: number
  numberOfChannels: number
  bitrate: number
}

interface NativeAudioDecoderInstance {
  configure: (_config: NativeAudioDecoderConfig) => void
  decode: (_chunk: unknown) => void
  flush: () => Promise<void>
  close: () => void
}

interface NativeAudioEncoderInstance {
  configure: (_config: NativeAudioEncoderConfig) => void
  encode: (_data: NativeAudioData) => void
  flush: () => Promise<void>
  close: () => void
}

interface NativeAudioDecoderConstructor {
  new (_init: { output: (_data: NativeAudioData) => void, error: (_error: Error) => void }): NativeAudioDecoderInstance
  isConfigSupported: (_config: NativeAudioDecoderConfig) => Promise<{ supported?: boolean }>
}

interface NativeAudioEncoderConstructor {
  new (_init: { output: (_chunk: NativeAudioChunk, _metadata?: { decoderConfig?: { description?: ArrayBuffer | ArrayBufferView } }) => void, error: (_error: Error) => void }): NativeAudioEncoderInstance
  isConfigSupported: (_config: NativeAudioEncoderConfig) => Promise<{ supported?: boolean }>
}

interface NativeEncodedAudioChunkConstructor {
  new (_init: { type: 'key', timestamp: number, duration?: number, data: Uint8Array }): unknown
}

function decoderCodec(codec: AudioCodec): string {
  if (codec === 'aac') return 'mp4a.40.2'
  if (codec === 'opus') return 'opus'
  if (codec === 'mp3') return 'mp3'
  if (codec === 'flac') return 'flac'
  throw new TypeError(`Native audio decoding is not configured for ${codec}`)
}

function encoderCodec(codec: NativeAudioCodec): string {
  return codec === 'aac' ? 'mp4a.40.2' : codec
}

async function ensureDefaultFormats(inputs: boolean, outputs: boolean): Promise<void> {
  const [mp3, aac, ogg, flac, wav] = await Promise.all([
    import('@ts-audio/mp3'),
    import('@ts-audio/aac'),
    import('@ts-audio/ogg'),
    import('@ts-audio/flac'),
    import('@ts-audio/wav'),
  ])
  if (inputs) {
    const names = new Set(getInputFormats().map(format => format.name))
    for (const format of [new mp3.Mp3InputFormat(), new aac.AacInputFormat(), new ogg.OggInputFormat(), new flac.FlacInputFormat(), new wav.WavInputFormat()]) {
      if (!names.has(format.name)) registerInputFormat(format)
    }
  }
  if (outputs) {
    const names = new Set(getOutputFormats().map(format => format.name))
    for (const format of [new mp3.Mp3OutputFormat(), new aac.AacOutputFormat(), new ogg.OggOutputFormat()]) {
      if (!names.has(format.name)) registerOutputFormat(format)
    }
  }
}

function descriptionBytes(value?: ArrayBuffer | ArrayBufferView): Uint8Array | undefined {
  if (!value) return undefined
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0))
  return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
}

/**
 * Decode and encode one audio track through native WebCodecs, streaming the
 * resulting packets directly into the selected ts-audio muxer.
 */
export async function transcodeAudioWithWebCodecs(
  input: Input,
  output: Output,
  options: NativeAudioTranscodeOptions,
): Promise<NativeAudioTranscodeResult> {
  const globals = globalThis as typeof globalThis & {
    AudioDecoder?: NativeAudioDecoderConstructor
    AudioEncoder?: NativeAudioEncoderConstructor
    EncodedAudioChunk?: NativeEncodedAudioChunkConstructor
  }
  if (!globals.AudioDecoder || !globals.AudioEncoder || !globals.EncodedAudioChunk) {
    throw new Error('Native WebCodecs AudioDecoder and AudioEncoder are required')
  }
  const track = await input.getPrimaryTrack()
  if (!track) throw new Error('No audio track found in input')
  const bitrate = options.bitrate ?? track.bitrate ?? (options.codec === 'opus' ? 128_000 : options.codec === 'aac' ? 160_000 : 192_000)
  const decoderConfig: NativeAudioDecoderConfig = {
    codec: decoderCodec(track.codec),
    sampleRate: track.sampleRate,
    numberOfChannels: track.channels,
    description: track.codecDescription,
  }
  const encoderConfig: NativeAudioEncoderConfig = {
    codec: encoderCodec(options.codec),
    sampleRate: track.sampleRate,
    numberOfChannels: track.channels,
    bitrate,
  }
  const [decoderSupport, encoderSupport] = await Promise.all([
    globals.AudioDecoder.isConfigSupported(decoderConfig),
    globals.AudioEncoder.isConfigSupported(encoderConfig),
  ])
  if (!decoderSupport.supported) throw new Error(`Native ${track.codec} audio decoding is unavailable`)
  if (!encoderSupport.supported) throw new Error(`Native ${options.codec} audio encoding is unavailable`)

  output.setMetadata(await input.getMetadata())
  let outputTrackId: number | undefined
  let fatalError: Error | undefined
  let packets = 0
  let inputBytes = 0
  let outputBytes = 0
  let writes = Promise.resolve()
  const encoder = new globals.AudioEncoder({
    output: (chunk, metadata) => {
      if (outputTrackId === undefined) {
        outputTrackId = output.addAudioTrack({
          codec: options.codec,
          sampleRate: track.sampleRate,
          channels: track.channels,
          bitrate,
          codecDescription: descriptionBytes(metadata?.decoderConfig?.description),
        }).id
      }
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      const packet: EncodedPacket = {
        data,
        timestamp: chunk.timestamp / 1_000_000,
        duration: chunk.duration === undefined || chunk.duration === null ? undefined : chunk.duration / 1_000_000,
        isKeyframe: true,
        trackId: outputTrackId,
      }
      packets++
      outputBytes += data.byteLength
      writes = writes.then(() => output.writePacket(outputTrackId!, packet))
    },
    error: error => { fatalError = error },
  })
  const decoder = new globals.AudioDecoder({
    output: (data) => {
      try {
        encoder.encode(data)
      }
      finally {
        data.close()
      }
    },
    error: error => { fatalError = error },
  })
  const batchSize = Math.max(1, Math.min(256, Math.floor(options.batchSize ?? 32)))

  try {
    decoder.configure(decoderConfig)
    encoder.configure(encoderConfig)
    let queued = 0
    for await (const packet of input.packets(track.id)) {
      if (options.signal?.aborted) throw options.signal.reason ?? new Error('Audio transcode aborted')
      inputBytes += packet.data.byteLength
      decoder.decode(new globals.EncodedAudioChunk({
        type: 'key',
        timestamp: Math.round(packet.timestamp * 1_000_000),
        duration: packet.duration === undefined ? undefined : Math.round(packet.duration * 1_000_000),
        data: packet.data,
      }))
      queued++
      if (queued >= batchSize) {
        await decoder.flush()
        await encoder.flush()
        await writes
        if (fatalError) throw fatalError
        queued = 0
      }
    }
    await decoder.flush()
    await encoder.flush()
    await writes
    if (fatalError) throw fatalError
    if (outputTrackId === undefined || packets === 0) throw new Error('Native audio encoder produced no packets')
    const bytes = await output.finalize()
    return { bytes, codec: options.codec, packets, inputBytes, outputBytes }
  }
  finally {
    decoder.close()
    encoder.close()
    await input.close()
  }
}

/** Execute every output in a delivery plan from one reusable source. */
export async function generateAudioDerivatives(
  source: Source | string | Uint8Array | ArrayBuffer,
  plan: AudioDeliveryPlan,
  options: AudioDerivativeOptions = {},
): Promise<AudioDerivative[]> {
  assertAudioPlanExecutable(plan)
  if (!options.inputFactory || !options.outputFactory) {
    await ensureDefaultFormats(!options.inputFactory, !options.outputFactory)
  }
  if (!options.inputFactory && typeof source === 'object' && 'type' in source && source.type === 'stream' && plan.outputs.length > 1) {
    throw new TypeError('Multiple audio derivatives from a stream require an inputFactory')
  }
  const derivatives: AudioDerivative[] = []
  for (const planned of plan.outputs) {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('Audio derivative generation aborted')
    const input = options.inputFactory?.() ?? createInput(source)
    const output = options.outputFactory?.(planned) ?? createOutput(planned.extension)
    if (planned.action === 'copy') {
      const conversion = await Conversion.init({ input, output })
      try {
        derivatives.push({ output: planned, bytes: await conversion.execute() })
      }
      finally {
        await conversion.close()
      }
      continue
    }
    const result = await transcodeAudioWithWebCodecs(input, output, {
      codec: planned.format,
      bitrate: planned.bitrate,
      batchSize: options.batchSize,
      signal: options.signal,
    })
    derivatives.push({ output: planned, bytes: result.bytes })
  }
  return derivatives
}
