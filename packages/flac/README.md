# @ts-audio/flac

> FLAC for ts-audio: metadata, frames, and a lossless decoder in TypeScript.

## Install

```bash
bun add @ts-audio/flac
```

## Usage

```ts
import { decodeFlacFile } from '@ts-audio/flac'

// Lossless, so the integers the encoder was given come back.
const { sampleRate, bitsPerSample, channels, streamInfo } = decodeFlacFile(bytes)
```

Decodes constant, verbatim, fixed and LPC subframes, Rice-partitioned residuals
in both parameter widths including escaped partitions, all four channel
assignments, and wasted bits — checking the CRC-16 each frame ends with. 8, 12,
16, 20 and 24-bit streams. 32-bit is refused by name: its side channel needs 33
bits, more than JavaScript's bitwise operators carry.

Because FLAC is lossless, a decode can check itself. Every stream states an MD5
of its own unencoded audio, and `flacMd5Bytes` packs samples the way that MD5
was taken:

```ts
import { createHash } from 'node:crypto'
import { decodeFlacFile, flacMd5Bytes } from '@ts-audio/flac'

const decoded = decodeFlacFile(bytes)
const md5 = createHash('md5').update(flacMd5Bytes(decoded.channels, decoded.bitsPerSample)).digest('hex')
// md5 === Buffer.from(decoded.streamInfo.md5).toString('hex')
```

`createFlacDecoder(track)` is the packet decoder for a FLAC track of another
container. It reads STREAMINFO from a track's `codecDescription` in any of the
shapes one arrives in: `"fLaC"` then the metadata blocks (WebCodecs' shape and
Matroska's CodecPrivate), the blocks alone (MP4's `dfLa`), or a bare STREAMINFO
block.

Also here: `FlacDemuxer`, `FlacMuxer`, `FlacInputFormat`, `FlacOutputFormat`,
Vorbis comments and pictures.

## License

MIT
