/**
 * The AudioSpecificConfig (ISO/IEC 14496-3 section 1.6) a container carries
 * for an AAC track: MP4's esds, Matroska's CodecPrivate. It says which AAC
 * flavour the packets are, at which sample rate, which is what the decoder
 * needs before it sees a frame. ADTS files carry the same numbers in every
 * frame header instead, so they need none of this.
 */

/** The sampling rates an AudioSpecificConfig can name by index; 15 means the rate is written out in full. */
export const AAC_CONFIG_SAMPLE_RATES: readonly number[] = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]

/** Channels per channelConfiguration; 0 means the program config element says. */
const AAC_CHANNEL_CONFIGS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 8]

/** MPEG-4 audio object types, as far as this parser cares. */
const AAC_MAIN = 1
const AAC_LC = 2
const AAC_SSR = 3
const AAC_LTP = 4
const SBR = 5
const AAC_SCALABLE = 6
const TWINVQ = 7
const ER_AAC_LC = 17
const ER_AAC_LTP = 19
const ER_AAC_SCALABLE = 20
const ER_TWINVQ = 21
const ER_BSAC = 22
const ER_AAC_LD = 23
const PS = 29

/** The object types whose config continues with a GASpecificConfig. */
const GA_SPECIFIC = new Set([AAC_MAIN, AAC_LC, AAC_SSR, AAC_LTP, AAC_SCALABLE, TWINVQ, ER_AAC_LC, ER_AAC_LTP, ER_AAC_SCALABLE, ER_TWINVQ, ER_BSAC, ER_AAC_LD])

export interface AacAudioSpecificConfig {
  /** The core object type: 2 for AAC-LC, the flavour the packets are coded in. */
  audioObjectType: number
  /** Index into `AAC_CONFIG_SAMPLE_RATES`, or 15 when `samplingFrequency` holds the rate itself. */
  samplingFrequencyIndex: number
  /** The core's sample rate: half the output rate for HE-AAC. */
  samplingFrequency: number
  channelConfiguration: number
  channels: number
  /** True for 960-sample frames rather than 1024. */
  frameLengthFlag?: boolean
  dependsOnCoreCoder?: boolean
  extensionFlag?: boolean
  /** Set when the config signals SBR (HE-AAC), explicitly or in its trailing bits. */
  sbrPresentFlag?: boolean
  /** Set when the config signals parametric stereo (HE-AAC v2). */
  psPresentFlag?: boolean
  extensionAudioObjectType?: number
  extensionSamplingFrequencyIndex?: number
  /** The rate SBR reconstructs at: twice the core's. */
  extensionSamplingFrequency?: number
  extensionChannelConfiguration?: number
}

class ConfigBitReader {
  private position = 0

  constructor(private readonly data: Uint8Array) {}

  get bitsRemaining(): number {
    return this.data.length * 8 - this.position
  }

  readBits(count: number): number {
    let value = 0
    for (let i = 0; i < count; i++) {
      const bit = this.position < this.data.length * 8
        ? (this.data[this.position >> 3] >> (7 - (this.position & 7))) & 1
        : 0
      value = value * 2 + bit
      this.position++
    }
    return value
  }
}

/** The object type, written as 5 bits or as an escape plus 6 more. */
function readObjectType(reader: ConfigBitReader): number {
  const value = reader.readBits(5)
  return value === 31 ? 32 + reader.readBits(6) : value
}

/** The sampling rate, by index or written out in full. */
function readSamplingFrequency(reader: ConfigBitReader): { index: number, frequency: number } {
  const index = reader.readBits(4)
  return { index, frequency: index === 15 ? reader.readBits(24) : AAC_CONFIG_SAMPLE_RATES[index] ?? 0 }
}

/** Reads an AudioSpecificConfig far enough to configure a decoder. */
export function parseAacAudioSpecificConfig(data: Uint8Array): AacAudioSpecificConfig {
  const reader = new ConfigBitReader(data)

  let audioObjectType = readObjectType(reader)
  const { index: samplingFrequencyIndex, frequency: samplingFrequency } = readSamplingFrequency(reader)
  const channelConfiguration = reader.readBits(4)

  const config: AacAudioSpecificConfig = {
    audioObjectType,
    samplingFrequencyIndex,
    samplingFrequency,
    channelConfiguration,
    channels: AAC_CHANNEL_CONFIGS[channelConfiguration] ?? channelConfiguration,
  }

  // HE-AAC signalled the explicit way: the extension's rate, then the core object type.
  if (audioObjectType === SBR || audioObjectType === PS) {
    config.extensionAudioObjectType = audioObjectType
    config.sbrPresentFlag = true
    if (audioObjectType === PS)
      config.psPresentFlag = true
    const extension = readSamplingFrequency(reader)
    config.extensionSamplingFrequencyIndex = extension.index
    config.extensionSamplingFrequency = extension.frequency
    audioObjectType = readObjectType(reader)
    config.audioObjectType = audioObjectType
    if (audioObjectType === ER_BSAC)
      config.extensionChannelConfiguration = reader.readBits(4)
  }

  if (GA_SPECIFIC.has(audioObjectType)) {
    config.frameLengthFlag = reader.readBits(1) === 1
    config.dependsOnCoreCoder = reader.readBits(1) === 1
    if (config.dependsOnCoreCoder)
      reader.readBits(14) // coreCoderDelay
    config.extensionFlag = reader.readBits(1) === 1
  }

  // HE-AAC signalled the implicit way: a sync word in the bits left over.
  if (reader.bitsRemaining >= 11 && reader.readBits(11) === 0x2B7) {
    const extensionType = readObjectType(reader)
    config.extensionAudioObjectType = extensionType
    if (extensionType === SBR || extensionType === PS) {
      config.sbrPresentFlag = reader.readBits(1) === 1
      if (config.sbrPresentFlag) {
        const extension = readSamplingFrequency(reader)
        config.extensionSamplingFrequencyIndex = extension.index
        config.extensionSamplingFrequency = extension.frequency
      }
      if (extensionType === PS)
        config.psPresentFlag = reader.readBits(1) === 1
      else if (config.sbrPresentFlag && reader.bitsRemaining >= 12 && reader.readBits(11) === 0x548)
        config.psPresentFlag = reader.readBits(1) === 1
    }
  }

  return config
}
