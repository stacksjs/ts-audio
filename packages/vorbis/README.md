# @ts-audio/vorbis

> A Vorbis I decoder for ts-audio, in TypeScript.

## Install

```bash
bun add @ts-audio/vorbis
```

## Usage

```ts
import { decodeOggVorbis } from '@ts-audio/vorbis'

const { sampleRate, channels } = decodeOggVorbis(bytes)
```

Vorbis is the codec Ogg files carried before Opus, and still what `.ogg` usually
means. Decodes the identification and setup headers, codebooks, floor 1, residue
types 0, 1 and 2, channel coupling, both block sizes and the lapped windows that
join them.

Floor type 0 is refused by name: it codes the spectral envelope as LSP
coefficients, no encoder has chosen it in twenty years, and guessing at it would
be worse than saying so.

For a track of another container, `createVorbisDecoder(track)` takes the three
headers as the track's `codecDescription` in Matroska's Xiph-laced layout, or
reads them from the first three packets when there is no description.

Measured against libvorbis 1.3.7, the reference implementation, this decodes to
within the quantisation noise of a 16-bit reference — about 81 dB — with sample
counts matching exactly.

The Ogg container belongs to `@ts-audio/ogg`, whose page parser this package
reads with.

## License

MIT. The floor1 inverse dB table is the normative table from the Vorbis I
specification — see THIRD_PARTY_NOTICES.md in the repository.
