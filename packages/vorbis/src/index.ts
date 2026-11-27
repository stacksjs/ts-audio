/**
 * Vorbis codec package for ts-audio
 *
 * A decoder for Vorbis I (the Xiph codec behind .ogg) in plain TypeScript.
 * The Ogg container it arrives in belongs to @ts-audio/ogg, which this package
 * reads pages with.
 */

export { VorbisBitReader, VorbisDecodeError } from './vorbis-bitstream'
export { VorbisDecoder } from './vorbis-decoder'
export type { VorbisBlock } from './vorbis-decoder'
export { isVorbisIdentification, parseVorbisIdentification, parseVorbisSetup } from './vorbis-setup'
export type {
  VorbisCodebook,
  VorbisFloor1,
  VorbisIdentification,
  VorbisMapping,
  VorbisMode,
  VorbisResidue,
  VorbisSetup,
} from './vorbis-setup'
export { createVorbisDecoder, decodeOggVorbis, isOggVorbis, readOggPackets } from './vorbis-audio'
export type { DecodeVorbisOptions } from './vorbis-audio'
