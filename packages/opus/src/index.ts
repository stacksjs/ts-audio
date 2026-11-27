/**
 * Opus codec package for ts-audio
 *
 * A decoder for Opus (RFC 6716) in plain TypeScript: SILK for speech, CELT
 * for music and the hybrid mode between them. The Ogg container it usually
 * arrives in belongs to @ts-audio/ogg, which this package reads pages with.
 */

export { OpusDecodeError, OpusDecoder, opusFrameSamples, parseOpusPacket } from './opus-decoder'
export { createOpusDecoder, decodeOggOpus, isOgg, parseOpusHead, readOggPackets } from './opus-audio'
export type { OpusHead } from './opus-audio'
