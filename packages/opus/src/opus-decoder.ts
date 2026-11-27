/**
 * An Opus decoder (RFC 6716) in plain TypeScript: packets to 48 kHz float
 * samples. SILK, CELT and hybrid frames, mode switches with their
 * redundancy frames, and every frame-packing code.
 *
 * Ported from libopus 1.5.2 (src/opus_decoder.c, src/opus.c), BSD 3-clause
 * licence, in THIRD_PARTY_NOTICES.md.
 */

import { CeltDecoder } from './celt-decoder'
import { WINDOW } from './celt-tables'
import { RangeDecoder } from './range-decoder'
import { SilkDecoder } from './silk-decoder'

const MODE_SILK_ONLY = 1000
const MODE_HYBRID = 1001
const MODE_CELT_ONLY = 1002

const BANDWIDTH_NARROWBAND = 0
const BANDWIDTH_MEDIUMBAND = 1
const BANDWIDTH_WIDEBAND = 2
const BANDWIDTH_SUPERWIDEBAND = 3
const BANDWIDTH_FULLBAND = 4

const FS = 48000
const F20 = FS / 50
const F10 = F20 >> 1
const F5 = F10 >> 1
const F2_5 = F5 >> 1

export class OpusDecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpusDecodeError'
  }
}

function packetMode(toc: number): number {
  if (toc & 0x80)
    return MODE_CELT_ONLY
  if ((toc & 0x60) === 0x60)
    return MODE_HYBRID
  return MODE_SILK_ONLY
}

function packetBandwidth(toc: number): number {
  if (toc & 0x80) {
    const bandwidth = BANDWIDTH_MEDIUMBAND + ((toc >> 5) & 0x3)
    return bandwidth === BANDWIDTH_MEDIUMBAND ? BANDWIDTH_NARROWBAND : bandwidth
  }
  if ((toc & 0x60) === 0x60)
    return toc & 0x10 ? BANDWIDTH_FULLBAND : BANDWIDTH_SUPERWIDEBAND
  return BANDWIDTH_NARROWBAND + ((toc >> 5) & 0x3)
}

/** Samples a frame of this packet holds at 48 kHz. */
export function opusFrameSamples(toc: number): number {
  if (toc & 0x80)
    return (FS << ((toc >> 3) & 0x3)) / 400
  if ((toc & 0x60) === 0x60)
    return toc & 0x08 ? FS / 50 : FS / 100
  const size = (toc >> 3) & 0x3
  return size === 3 ? FS * 60 / 1000 : (FS << size) / 100
}

/** The frames in a packet: where each starts and how long it is (RFC 6716 section 3.2). */
export function parseOpusPacket(data: Uint8Array): { toc: number, frames: { offset: number, length: number }[] } {
  if (!data.length)
    throw new OpusDecodeError('Empty Opus packet')
  const toc = data[0]
  const frameSize = opusFrameSamples(toc)
  let pos = 1
  let len = data.length - 1
  const sizes: number[] = []
  let lastSize = len
  let count: number
  const parseSize = (): number => {
    if (len < 1)
      throw new OpusDecodeError('Invalid Opus packet')
    if (data[pos] < 252) {
      len -= 1
      return data[pos++]
    }
    if (len < 2)
      throw new OpusDecodeError('Invalid Opus packet')
    const size = 4 * data[pos + 1] + data[pos]
    pos += 2
    len -= 2
    return size
  }
  switch (toc & 0x3) {
    case 0:
      count = 1
      break
    case 1:
      count = 2
      if (len & 1)
        throw new OpusDecodeError('Invalid Opus packet')
      lastSize = len / 2
      sizes[0] = lastSize
      break
    case 2: {
      count = 2
      const size = parseSize()
      if (size > len)
        throw new OpusDecodeError('Invalid Opus packet')
      sizes[0] = size
      lastSize = len - size
      break
    }
    default: {
      if (len < 1)
        throw new OpusDecodeError('Invalid Opus packet')
      const ch = data[pos++]
      len--
      count = ch & 0x3F
      if (count <= 0 || frameSize * count > 5760)
        throw new OpusDecodeError('Invalid Opus packet')
      if (ch & 0x40) {
        let p: number
        do {
          if (len <= 0)
            throw new OpusDecodeError('Invalid Opus packet')
          p = data[pos++]
          len--
          const tmp = p === 255 ? 254 : p
          len -= tmp
        } while (p === 255)
      }
      if (len < 0)
        throw new OpusDecodeError('Invalid Opus packet')
      const cbr = !(ch & 0x80)
      if (!cbr) {
        lastSize = len
        for (let i = 0; i < count - 1; i++) {
          const before = len
          const size = parseSize()
          if (size > len)
            throw new OpusDecodeError('Invalid Opus packet')
          sizes[i] = size
          lastSize -= before - len + size
        }
        if (lastSize < 0)
          throw new OpusDecodeError('Invalid Opus packet')
      }
      else {
        lastSize = Math.floor(len / count)
        if (lastSize * count !== len)
          throw new OpusDecodeError('Invalid Opus packet')
        for (let i = 0; i < count - 1; i++) sizes[i] = lastSize
      }
    }
  }
  if (lastSize > 1275)
    throw new OpusDecodeError('Invalid Opus packet')
  sizes[count - 1] = lastSize
  const frames: { offset: number, length: number }[] = []
  for (let i = 0; i < count; i++) {
    frames.push({ offset: pos, length: sizes[i] })
    pos += sizes[i]
  }
  return { toc, frames }
}

/** Fades `in1` into `in2` over `overlap` samples per channel, into `out`. */
function smoothFade(in1: Float32Array, in1Offset: number, in2: Float32Array, in2Offset: number, out: Float32Array, outOffset: number, overlap: number, channels: number): void {
  for (let c = 0; c < channels; c++) {
    for (let i = 0; i < overlap; i++) {
      const w = WINDOW[i] * WINDOW[i]
      out[outOffset + i * channels + c] = w * in2[in2Offset + i * channels + c] + (1 - w) * in1[in1Offset + i * channels + c]
    }
  }
}

export class OpusDecoder {
  readonly channels: number
  readonly sampleRate: number = FS
  private readonly celt: CeltDecoder
  private readonly silk: SilkDecoder
  private mode = 0
  private prevMode = 0
  private prevRedundancy = false
  private bandwidth = 0
  private frameSize = F20
  private streamChannels: number

  /** See CeltDecoder for `legacyHybridFolding`: decoding as pre-RFC 8251 decoders (Apple's among them) do. */
  constructor(channels: number, options: { legacyHybridFolding?: boolean } = {}) {
    if (channels !== 1 && channels !== 2)
      throw new OpusDecodeError('Opus decodes one or two channels')
    this.channels = channels
    this.streamChannels = channels
    this.celt = new CeltDecoder(channels, options)
    this.silk = new SilkDecoder(channels)
  }

  /** One packet to interleaved 48 kHz samples in -1 to 1. An empty packet is a missing one, heard as a fade to silence. */
  decode(packet: Uint8Array | null, missingSamples: number = F20): Float32Array {
    if (!packet || packet.length === 0) {
      const pcm = new Float32Array(missingSamples * this.channels)
      let done = 0
      while (done < missingSamples)
        done += this.decodeFrame(null, 0, 0, pcm, done * this.channels, missingSamples - done)
      return pcm
    }
    const { toc, frames } = parseOpusPacket(packet)
    const frameSamples = opusFrameSamples(toc)
    this.mode = packetMode(toc)
    this.bandwidth = packetBandwidth(toc)
    this.frameSize = frameSamples
    this.streamChannels = toc & 0x4 ? 2 : 1
    const pcm = new Float32Array(frames.length * frameSamples * this.channels)
    let samples = 0
    for (const frame of frames) {
      samples += this.decodeFrame(packet, frame.offset, frame.length, pcm, samples * this.channels, frameSamples)
    }
    return pcm
  }

  private decodeFrame(packet: Uint8Array | null, offset: number, lengthIn: number, pcm: Float32Array, pcmOffset: number, frameSizeIn: number): number {
    let len = lengthIn
    let data: Uint8Array | null = packet ? packet.subarray(offset, offset + len) : null
    let frameSize = Math.min(frameSizeIn, FS / 25 * 3)
    if (len <= 1) {
      data = null
      frameSize = Math.min(frameSize, this.frameSize)
    }
    let audiosize: number
    let mode: number
    let bandwidth: number
    let dec: RangeDecoder | null = null
    if (data) {
      audiosize = this.frameSize
      mode = this.mode
      bandwidth = this.bandwidth
      dec = new RangeDecoder(data, len)
    }
    else {
      audiosize = frameSize
      mode = this.prevRedundancy ? MODE_CELT_ONLY : this.prevMode
      bandwidth = 0
      if (mode === 0) {
        pcm.fill(0, pcmOffset, pcmOffset + audiosize * this.channels)
        return audiosize
      }
      if (audiosize > F20) {
        let done = 0
        while (done < audiosize)
          done += this.decodeFrame(null, 0, 0, pcm, pcmOffset + done * this.channels, Math.min(audiosize - done, F20))
        return frameSize
      }
      if (audiosize < F20) {
        if (audiosize > F10)
          audiosize = F10
        else if (mode !== MODE_SILK_ONLY && audiosize > F5 && audiosize < F10)
          audiosize = F5
      }
    }

    let transition = false
    let pcmTransition: Float32Array | null = null
    if (data && this.prevMode > 0 && ((mode === MODE_CELT_ONLY && this.prevMode !== MODE_CELT_ONLY && !this.prevRedundancy) || (mode !== MODE_CELT_ONLY && this.prevMode === MODE_CELT_ONLY)))
      transition = true
    if (transition && mode === MODE_CELT_ONLY) {
      pcmTransition = new Float32Array(F5 * this.channels)
      this.decodeFrame(null, 0, 0, pcmTransition, 0, Math.min(F5, audiosize))
    }
    if (audiosize > frameSize)
      throw new OpusDecodeError('Opus frame larger than its packet allows')
    frameSize = audiosize

    let pcmSilk: Int16Array | null = null
    if (mode !== MODE_CELT_ONLY) {
      pcmSilk = new Int16Array(Math.max(F10, frameSize) * this.channels)
      if (this.prevMode === MODE_CELT_ONLY)
        this.silk.reset()
      const payloadMs = Math.max(10, 1000 * audiosize / FS)
      let internalRate = 16000
      if (data && mode === MODE_SILK_ONLY) {
        if (bandwidth === BANDWIDTH_NARROWBAND)
          internalRate = 8000
        else if (bandwidth === BANDWIDTH_MEDIUMBAND)
          internalRate = 12000
      }
      const lost = data ? 0 : 1
      let decoded = 0
      do {
        const firstFrame = decoded === 0
        const count = this.silk.decode(dec, lost, firstFrame, { channelsInternal: this.streamChannels, internalSampleRate: internalRate, payloadMs }, pcmSilk, decoded * this.channels)
        decoded += count
      } while (decoded < frameSize)
    }

    let startBand = 0
    let redundancy = false
    let redundancyBytes = 0
    let celtToSilk = false
    if (dec && mode !== MODE_CELT_ONLY && dec.tell() + 17 + 20 * (mode === MODE_HYBRID ? 1 : 0) <= 8 * len) {
      redundancy = mode === MODE_HYBRID ? dec.bitLogp(12) === 1 : true
      if (redundancy) {
        celtToSilk = dec.bitLogp(1) === 1
        redundancyBytes = mode === MODE_HYBRID ? dec.uint(256) + 2 : len - ((dec.tell() + 7) >> 3)
        len -= redundancyBytes
        if (len * 8 < dec.tell()) {
          len = 0
          redundancyBytes = 0
          redundancy = false
        }
        dec.storage -= redundancyBytes
      }
    }
    if (mode !== MODE_CELT_ONLY)
      startBand = 17
    if (redundancy)
      transition = false
    if (transition && mode !== MODE_CELT_ONLY) {
      pcmTransition = new Float32Array(F5 * this.channels)
      this.decodeFrame(null, 0, 0, pcmTransition, 0, Math.min(F5, audiosize))
    }

    // A missing frame keeps the last frame's band limit.
    if (data)
      this.celt.end = bandwidth === BANDWIDTH_NARROWBAND ? 13 : bandwidth <= BANDWIDTH_WIDEBAND ? 17 : bandwidth === BANDWIDTH_SUPERWIDEBAND ? 19 : 21
    this.celt.streamChannels = this.streamChannels

    let redundantAudio: Float32Array | null = null
    if (redundancy) {
      redundantAudio = new Float32Array(F5 * this.channels)
      if (celtToSilk) {
        this.celt.start = 0
        this.celt.decode(data!.subarray(len), redundancyBytes, redundantAudio, 0, F5, null)
      }
    }

    this.celt.start = startBand
    if (mode !== MODE_SILK_ONLY) {
      const celtFrameSize = Math.min(F20, frameSize)
      if (mode !== this.prevMode && this.prevMode > 0 && !this.prevRedundancy)
        this.celt.reset()
      this.celt.decode(data, len, pcm, pcmOffset, celtFrameSize, dec)
    }
    else {
      pcm.fill(0, pcmOffset, pcmOffset + frameSize * this.channels)
      if (this.prevMode === MODE_HYBRID && !(redundancy && celtToSilk && this.prevRedundancy)) {
        // Lets the hybrid frame before end cleanly: a silent CELT frame finishes its overlap.
        this.celt.start = 0
        this.celt.decode(new Uint8Array([0xFF, 0xFF]), 2, pcm, pcmOffset, F2_5, null)
      }
    }

    if (mode !== MODE_CELT_ONLY && pcmSilk) {
      for (let i = 0; i < frameSize * this.channels; i++) pcm[pcmOffset + i] += pcmSilk[i] / 32768
    }

    if (redundancy && !celtToSilk && redundantAudio) {
      this.celt.reset()
      this.celt.start = 0
      this.celt.decode(data!.subarray(len), redundancyBytes, redundantAudio, 0, F5, null)
      smoothFade(pcm, pcmOffset + this.channels * (frameSize - F2_5), redundantAudio, this.channels * F2_5, pcm, pcmOffset + this.channels * (frameSize - F2_5), F2_5, this.channels)
    }
    if (redundancy && celtToSilk && redundantAudio && (this.prevMode !== MODE_SILK_ONLY || this.prevRedundancy)) {
      for (let i = 0; i < F2_5 * this.channels; i++) pcm[pcmOffset + i] = redundantAudio[i]
      smoothFade(redundantAudio, this.channels * F2_5, pcm, pcmOffset + this.channels * F2_5, pcm, pcmOffset + this.channels * F2_5, F2_5, this.channels)
    }
    if (transition && pcmTransition) {
      if (audiosize >= F5) {
        for (let i = 0; i < this.channels * F2_5; i++) pcm[pcmOffset + i] = pcmTransition[i]
        smoothFade(pcmTransition, this.channels * F2_5, pcm, pcmOffset + this.channels * F2_5, pcm, pcmOffset + this.channels * F2_5, F2_5, this.channels)
      }
      else {
        smoothFade(pcmTransition, 0, pcm, pcmOffset, pcm, pcmOffset, F2_5, this.channels)
      }
    }

    this.prevMode = mode
    this.prevRedundancy = redundancy && !celtToSilk
    return audiosize
  }
}
