/** The errors `decodeAudio` throws on purpose, in a module of their own so every decoder can throw them. */

/** A track whose codec no registered decoder reads. */
export class UnsupportedAudioCodecError extends Error {
  constructor(readonly codec: string) {
    super(`Decoding ${codec} audio is not supported`)
    this.name = 'UnsupportedAudioCodecError'
  }
}

/** Audio longer than the limit allows: refused once the decoded part shows it, not after decoding all of it. */
export class AudioTooLongError extends Error {
  constructor(readonly maxDurationSeconds: number) {
    super(`Audio duration exceeds the ${maxDurationSeconds} second limit`)
    this.name = 'AudioTooLongError'
  }
}
