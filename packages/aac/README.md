# @ts-audio/aac

> AAC for ts-audio: ADTS streams, and an AAC-LC decoder in TypeScript.

## Install

```bash
bun add @ts-audio/aac
```

## Usage

```ts
import { decodeAudio } from '@ts-audio/core'

// ADTS .aac files decode through core, which loads this package on demand.
const { sampleRate, channels } = await decodeAudio('voice.aac')
```

Decodes AAC-LC — what phones, Safari and most M4A files carry. HE-AAC and
HE-AAC v2 decode their AAC core: the sound below half the output rate, at half
the rate, which is all of a voice. Main and LTP prediction, coupling channels
and 960-sample frames are refused by name.

For a track from another container, `createAacDecoder(track)` takes the
`AudioSpecificConfig` as the track's `codecDescription` and returns a packet
decoder. An ADTS header on a packet is skipped automatically, so MPEG-TS and
ADTS packets work alongside MP4 and Matroska ones.

Also here: `AacDemuxer`, `AacMuxer`, `AacInputFormat`, `AacOutputFormat`,
`parseAdtsHeader`, `createAdtsHeader`, `parseAacAudioSpecificConfig`.

## License

MIT. The Huffman codebooks and scale factor band tables are derived from the
PacketVideo AAC decoder (Apache-2.0); `scripts/aac-tables/` regenerates them.
