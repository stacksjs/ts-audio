# @ts-audio/core

> Reading, writing and decoding audio in TypeScript, with no native dependencies and no ffmpeg.

The core of ts-audio: the container plumbing every format package builds on, and
`decodeAudio`, which turns a file into samples. The codec packages are optional
peers, loaded only when a file actually needs one — reading a WAV never loads an
Opus decoder.

## Install

```bash
bun add @ts-audio/core
```

## Decoding audio to samples

```ts
import { decodeAudio, decodeAudioToWav } from '@ts-audio/core'

// Planar float samples at the file's own rate and channel count.
const { sampleRate, channels, duration, codec } = await decodeAudio('voice-note.ogg')

// Or the 16 kHz mono WAV a speech-to-text service takes.
const { audio, durationSeconds } = await decodeAudioToWav('voice-note.ogg', {
  maxDurationSeconds: 300,
})
```

MP3, Ogg (Vorbis or Opus) and WAV files are read directly; everything else goes
through the installed container readers. The codecs decoded in TypeScript are
**MP3, AAC, Opus, FLAC and Vorbis**, plus PCM, which needs no decoder.

## Decoding a track you read yourself

If you have your own container reader, hand it the packets:

```ts
import { createAudioDecoder, decodeAudioPackets } from '@ts-audio/core'

const decoded = await decodeAudioPackets(track, packets, { maxDurationSeconds: 300 })
const decoder = await createAudioDecoder(track) // or drive it packet by packet
```

Both honour `registerAudioDecoder`, so a codec you register is used by every
path rather than only your own.

## Also here

- `Input`, `Output`, `Conversion` — the high-level file APIs
- `Demuxer`, `Muxer`, `InputFormat`, `OutputFormat` — what a format package implements
- `Reader`, `Writer`, `BitReader`, `BitWriter`, and the CRCs the formats use
- `decodeWav`, `encodeWav`, `isWav`, `deinterleavePcm` — PCM and WAV without a codec
- `mixChannels`, `resampleAudio` — band-limited resampling and channel mixing
- `imdct` — the inverse MDCT shared by the AAC and Vorbis decoders
- `UnsupportedAudioCodecError`, `AudioTooLongError`

A `ts-audio` CLI ships with it: `info`, `convert`, `extract`, `formats`, `metadata`.

## License

MIT. Parts are derived from other works — see THIRD_PARTY_NOTICES.md in the repository.
