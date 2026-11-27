# @ts-audio/mp3

> MP3 for ts-audio: frames, ID3 tags, and a decoder in TypeScript.

## Install

```bash
bun add @ts-audio/mp3
```

## Usage

```ts
import { decodeMp3File, isMp3 } from '@ts-audio/mp3'

// A whole .mp3 file to planar float samples.
const { sampleRate, channels } = decodeMp3File(bytes)
```

Reading a file handles what real MP3s contain: ID3v1 and ID3v2 tags, junk
between frames, the Xing, Info or VBRI header, and LAME's gapless numbers — so
the samples start and end where the sound does, as Apple's decoder has them. A
damaged frame is heard as a moment of silence, as players do; a stream that is
mostly damage is refused.

MPEG-1, MPEG-2 and MPEG 2.5, Layer III, mono through joint stereo. Layer I and
II are refused by name rather than decoded wrongly.

For a track inside another container, `createMp3Decoder(track)` returns a packet
decoder; a packet may hold one frame or a run of bytes that frames cross.
`@ts-audio/core` loads it for you when a file needs it.

Also here: `Mp3Demuxer`, `Mp3Muxer`, `Mp3InputFormat`, `Mp3OutputFormat`, and the
ID3 types.

## License

MIT. The Huffman and scale factor tables are derived from the PacketVideo MP3
decoder (Apache-2.0); `scripts/mp3-tables/` regenerates them.
