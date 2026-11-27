import type { AudioTrack, EncodedPacket, Source } from './types'
import { describe, expect, it } from 'bun:test'
import { FlacInputFormat } from '@ts-audio/flac'
import { Demuxer } from './demuxer'
import { createSource } from './source'

const fixture = (name: string): string => new URL(`../test/fixtures/${name}`, import.meta.url).pathname

/**
 * A demuxer whose parsing waits on a gate, so a second caller can be made to
 * arrive while the first is still inside init. A flag set before the first
 * await lets that caller straight past; a shared promise does not.
 */
class GatedDemuxer extends Demuxer {
  initCount = 0
  /** Resolves once init has been entered and is waiting on the gate. */
  readonly opened: Promise<void>
  private readonly gate: Promise<void>
  private release!: () => void
  private reachedGate!: () => void

  constructor(source: Source) {
    super(source)
    // Assigned here rather than in field initialisers: a field declared after
    // another's initialiser is defined afterwards, which would overwrite it.
    this.opened = new Promise<void>((resolve) => {
      this.reachedGate = resolve
    })
    this.gate = new Promise<void>((resolve) => {
      this.release = resolve
    })
  }

  get formatName(): string { return 'gated' }
  get mimeType(): string { return 'audio/gated' }

  async init(): Promise<void> {
    return this.initOnce(async () => {
      this.initCount++
      this.reachedGate()
      await this.gate
      this._tracks = [{ type: 'audio', id: 1, index: 0, codec: 'pcm_s16le', sampleRate: 8000, channels: 1 }]
      this._duration = 1
    })
  }

  finish(): void {
    this.release()
  }

  async readPacket(_trackId: number): Promise<EncodedPacket | null> { return null }
  async seek(_time: number): Promise<void> {}
}

describe('a demuxer initialising', () => {
  it('makes a caller arriving mid-init wait for the parsing, not resolve early', async () => {
    const demuxer = new GatedDemuxer(createSource(new Uint8Array(16)))

    const first = demuxer.init()
    // Wait until the first call is inside init and blocked on the gate, then
    // ask again. This is the arrival a Promise.all of getters never produces,
    // because those all queue up before the first await.
    await demuxer.opened

    let resolvedWithNothingParsed = false
    const second = demuxer.init().then(() => {
      resolvedWithNothingParsed = demuxer.tracks.length === 0
    })

    // Give the late caller every chance to resolve on its own. With a flag set
    // before the first await it does, immediately, handing back a demuxer that
    // has read nothing -- which is the bug.
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(resolvedWithNothingParsed).toBe(false)

    demuxer.finish()
    await Promise.all([first, second])

    expect(demuxer.initCount).toBe(1)
    expect(resolvedWithNothingParsed).toBe(false)
    expect(demuxer.tracks).toHaveLength(1)
    expect(demuxer.duration).toBe(1)
  })

  it('keeps failing when the file cannot be parsed, rather than appearing to work', async () => {
    class FailingDemuxer extends Demuxer {
      attempts = 0
      get formatName(): string { return 'failing' }
      get mimeType(): string { return 'audio/failing' }
      async init(): Promise<void> {
        return this.initOnce(async () => {
          this.attempts++
          await Promise.resolve()
          throw new Error('not a valid file')
        })
      }
      async readPacket(): Promise<EncodedPacket | null> { return null }
      async seek(): Promise<void> {}
    }

    const demuxer = new FailingDemuxer(createSource(new Uint8Array(4)))
    await expect(demuxer.init()).rejects.toThrow('not a valid file')
    // The flag used to stay set through a failure, so asking again resolved
    // and handed back a demuxer with nothing in it.
    await expect(demuxer.init()).rejects.toThrow('not a valid file')
    expect(demuxer.attempts).toBe(1)
    expect(demuxer.tracks).toHaveLength(0)
  })

  it('does the same for a real demuxer over a real file', async () => {
    const demuxer = new FlacInputFormat().createDemuxer(createSource(fixture('tone.flac')))
    const [a, b, c] = [demuxer.init(), demuxer.init(), demuxer.init()]
    await Promise.all([a, b, c])
    const tracks = demuxer.tracks satisfies AudioTrack[]
    expect(tracks).toHaveLength(1)
    expect(tracks[0].codec).toBe('flac')
    expect(demuxer.duration).toBeGreaterThan(0)
    await demuxer.close()
  })
})
