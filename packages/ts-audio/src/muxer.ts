/**
 * Base muxer class for audio formats
 */

import type { Target, AudioTrackConfig, OutputAudioTrack, EncodedPacket, AudioMetadata, AudioCodec } from './types'
import { Writer, createWriter } from './writer'

/**
 * AsyncMutex for thread-safe writing
 */
export class AsyncMutex {
  private locked = false
  private queue: (() => void)[] = []

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true
      return
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve)
    })
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!
      next()
    }
    else {
      this.locked = false
    }
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    }
    finally {
      this.release()
    }
  }
}

/**
 * Base abstract class for all audio muxers
 */
export abstract class Muxer {
  protected writer: Writer
  protected tracks: OutputAudioTrack[] = []
  protected metadata: AudioMetadata = {}
  protected mutex: AsyncMutex = new AsyncMutex()
  private nextTrackId = 1
  private headerWritten = false
  private finalized = false

  constructor(target: Target | Writer) {
    this.writer = target instanceof Writer ? target : createWriter(target)
  }

  /**
   * Format name (e.g., 'mp3', 'wav', 'flac')
   */
  abstract get formatName(): string

  /**
   * MIME type for this format
   */
  abstract get mimeType(): string

  /**
   * Write format-specific header
   */
  protected abstract writeHeader(): Promise<void>

  /**
   * Write an audio packet
   */
  protected abstract writeAudioPacket(track: OutputAudioTrack, packet: EncodedPacket): Promise<void>

  /**
   * Write format-specific trailer
   */
  protected abstract writeTrailer(): Promise<void>

  /**
   * Called when a track is added (for subclass processing)
   */
  protected onTrackAdded(_track: OutputAudioTrack): void {}

  /**
   * Add an audio track to the output
   */
  addAudioTrack(config: AudioTrackConfig): OutputAudioTrack {
    const track: OutputAudioTrack = {
      id: this.nextTrackId++,
      type: 'audio',
      config,
    }

    this.tracks.push(track)
    this.onTrackAdded(track)

    return track
  }

  /**
   * Set metadata for the output file
   */
  setMetadata(metadata: AudioMetadata): void {
    this.metadata = { ...this.metadata, ...metadata }
  }

  /**
   * Write a packet to the output
   */
  async writePacket(trackId: number, packet: EncodedPacket): Promise<void> {
    await this.mutex.withLock(async () => {
      if (!this.headerWritten) {
        await this.writeHeader()
        this.headerWritten = true
      }

      const track = this.tracks.find(t => t.id === trackId)
      if (!track) {
        throw new Error(`Track ${trackId} not found`)
      }

      await this.writeAudioPacket(track, packet)
    })
  }

  /**
   * Finalize the output and return the buffer
   */
  async finalize(): Promise<Uint8Array> {
    return this.mutex.withLock(async () => {
      if (this.finalized) {
        throw new Error('Muxer already finalized')
      }

      if (!this.headerWritten) {
        await this.writeHeader()
        this.headerWritten = true
      }

      await this.writeTrailer()
      this.finalized = true

      return this.writer.close()
    })
  }

  /**
   * Get current output size
   */
  get size(): number {
    return this.writer.position
  }
}

/**
 * OutputFormat describes an audio format that can be written
 */
export abstract class OutputFormat {
  /**
   * Format name
   */
  abstract get name(): string

  /**
   * MIME type
   */
  abstract get mimeType(): string

  /**
   * Default file extension
   */
  abstract get extension(): string

  /**
   * Create a muxer for this format
   */
  abstract createMuxer(target: Target): Muxer

  /**
   * The codecs this container can carry.
   *
   * An empty list means the format has not said, and nothing is checked --
   * which is what a format written before this existed reports, so adding this
   * breaks no one. The formats that ship with ts-audio all declare theirs.
   */
  get supportedCodecs(): AudioCodec[] {
    return []
  }
}

/**
 * Whether a container that carries `supported` can carry `codec`.
 *
 * Exact names match, and a format that says `pcm` takes any of PCM's layouts:
 * a demuxer reports a WAV track as `pcm` while `decodeWav` names the layout,
 * `pcm_s16le` and the rest, and both have to be writable to a WAV.
 */
export function codecMatches(supported: AudioCodec, codec: AudioCodec): boolean {
  return supported === codec || (supported === 'pcm' && codec.startsWith('pcm'))
}

/**
 * Refuses a codec the container cannot carry, before anything is written.
 *
 * Without this, writing PCM packets into an MP3 container succeeded and
 * produced a file no player would open: `Conversion` only compared the codec
 * asked for against the track's, so changing the container alone passed every
 * check it had.
 */
export function assertCodecSupported(format: OutputFormat, codec: AudioCodec): void {
  const supported = format.supportedCodecs
  if (supported.length === 0)
    return
  if (supported.some(candidate => codecMatches(candidate, codec)))
    return
  throw new Error(`The ${format.name} container cannot carry ${codec} audio; it carries ${supported.join(', ')}`)
}
