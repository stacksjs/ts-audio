/**
 * Base demuxer class for audio formats
 */

import type { Source, AudioTrack, EncodedPacket, AudioMetadata } from './types'
import { Reader, createReader } from './reader'

/**
 * Base abstract class for all audio demuxers
 */
export abstract class Demuxer {
  protected reader: Reader
  protected _tracks: AudioTrack[] = []
  protected _duration = 0
  protected _metadata: AudioMetadata = {}

  constructor(source: Source | Reader) {
    this.reader = source instanceof Reader ? source : createReader(source)
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
   * Initialize the demuxer by parsing headers
   */
  abstract init(): Promise<void>

  /**
   * Read the next packet for a given track
   */
  abstract readPacket(trackId: number): Promise<EncodedPacket | null>

  /**
   * Seek to a position in seconds
   */
  abstract seek(timeInSeconds: number): Promise<void>

  /**
   * Get all tracks in the file
   */
  get tracks(): AudioTrack[] {
    return this._tracks
  }

  /**
   * Get total duration in seconds
   */
  get duration(): number {
    return this._duration
  }

  /**
   * Get file metadata
   */
  get metadata(): AudioMetadata {
    return this._metadata
  }

  /**
   * Get a specific track by ID
   */
  getTrack(trackId: number): AudioTrack | undefined {
    return this._tracks.find(t => t.id === trackId)
  }

  /**
   * Get the primary audio track
   */
  getPrimaryTrack(): AudioTrack | undefined {
    return this._tracks.find(t => t.isDefault) || this._tracks[0]
  }

  /**
   * Iterate over all packets for a track
   */
  async *packets(trackId: number): AsyncGenerator<EncodedPacket> {
    while (true) {
      const packet = await this.readPacket(trackId)
      if (!packet) break
      yield packet
    }
  }

  /**
   * Read all packets into an array
   */
  async readAllPackets(trackId: number): Promise<EncodedPacket[]> {
    const packets: EncodedPacket[] = []
    for await (const packet of this.packets(trackId)) {
      packets.push(packet)
    }
    return packets
  }

  /**
   * Close the demuxer and release resources
   */
  async close(): Promise<void> {
    await this.reader.close()
  }
}

/**
 * InputFormat describes an audio format that can be read
 */
export abstract class InputFormat {
  /**
   * Format name
   */
  abstract get name(): string

  /**
   * MIME type
   */
  abstract get mimeType(): string

  /**
   * File extensions associated with this format
   */
  abstract get extensions(): string[]

  /**
   * Check if this format can read the given source
   */
  abstract canRead(source: Source): Promise<boolean>

  /**
   * Create a demuxer for this format
   */
  abstract createDemuxer(source: Source): Demuxer
}
