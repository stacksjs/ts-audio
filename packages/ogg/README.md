# @ts-audio/ogg

> The Ogg container for ts-audio: pages, packets and the codecs inside them.

## Install

```bash
bun add @ts-audio/ogg
```

## Usage

```ts
import { OggInputFormat, parseOggPage } from '@ts-audio/ogg'

const input = new Input({ source, format: new OggInputFormat() })
```

Reads and writes Ogg pages, reassembles packets across them, and recognises the
codecs an Ogg file carries — Vorbis, Opus and FLAC — along with Vorbis comments
for metadata.

This package is the container only. The codecs live beside it, in
`@ts-audio/vorbis` and `@ts-audio/opus`, and both read their pages through
`parseOggPage` from here rather than walking the container themselves.
`decodeAudio` in `@ts-audio/core` routes an Ogg file to whichever of them it
needs.

Also here: `OggDemuxer`, `OggMuxer`, `OggOutputFormat`, `detectCodec`,
`opusPacketDurationSamples`, `calculateOggCrc`.

## License

MIT
