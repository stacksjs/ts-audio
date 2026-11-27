<p align="center"><img src="https://github.com/stacksjs/ts-audio/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

[![npm version][npm-version-src]][npm-version-href]
[![GitHub Actions][github-actions-src]][github-actions-href]
[![Commitizen friendly][commitizen-friendly]][commitizen-href]
<!-- [![npm downloads][npm-downloads-src]][npm-downloads-href] -->
<!-- [![Codecov][codecov-src]][codecov-href] -->

# ts-audio

> Reading, writing and decoding audio in TypeScript. No native dependencies, no ffmpeg.

ts-audio reads and writes the containers audio arrives in, and decodes five
codecs to samples in plain TypeScript — MP3, AAC, Opus, FLAC and Vorbis, plus
PCM, which needs no codec. It runs wherever Bun or Node does, with nothing to
compile and no binary to ship.

## Packages

| Package | What it is |
| --- | --- |
| [`@ts-audio/core`][pkg-core] | `decodeAudio`, the container APIs, PCM and WAV samples, resampling. The one to install |
| [`@ts-audio/mp3`][pkg-mp3] | MP3 frames, ID3 tags, and an MP3 decoder |
| [`@ts-audio/aac`][pkg-aac] | ADTS streams and an AAC-LC decoder |
| [`@ts-audio/opus`][pkg-opus] | An Opus decoder: SILK, CELT and the hybrid mode |
| [`@ts-audio/flac`][pkg-flac] | FLAC metadata, frames, and a lossless decoder |
| [`@ts-audio/vorbis`][pkg-vorbis] | A Vorbis I decoder |
| [`@ts-audio/ogg`][pkg-ogg] | The Ogg container, shared by Vorbis and Opus |
| [`@ts-audio/wav`][pkg-wav] | WAV and RF64 |

The codec packages are optional peers of core, loaded the first time a file
needs one. Reading a WAV never loads an Opus decoder.

## Install

```bash
bun add @ts-audio/core
```

## Library usage

### Decode audio to samples

```ts
import { decodeAudio, decodeAudioToWav } from '@ts-audio/core'

// Planar float samples, at the file's own rate and channel count.
const { sampleRate, channels, duration, codec } = await decodeAudio('voice-note.ogg')

// Or the 16 kHz mono WAV a speech-to-text service takes.
const { audio, durationSeconds } = await decodeAudioToWav('voice-note.ogg', {
  maxDurationSeconds: 300,
})
```

`decodeAudio` takes a path, a `Uint8Array`, an `ArrayBuffer`, a `Blob` or a
`Source`. MP3, Ogg and WAV files are read directly; anything else goes through
the container readers. `maxBytes` and `maxDurationSeconds` refuse oversized
input before decoding it, and an `AbortSignal` cancels mid-file.

### Read a file's tracks and metadata

```ts
import { createInput } from '@ts-audio/core'

const input = createInput('album/01.flac')
const [tracks, metadata, duration] = await Promise.all([
  input.getTracks(),
  input.getMetadata(),
  input.getDuration(),
])
await input.close()
```

### Decode a track you read yourself

If you have your own container reader, hand it the packets:

```ts
import { decodeAudioPackets, registerAudioDecoder } from '@ts-audio/core'

const decoded = await decodeAudioPackets(track, packets, { maxDurationSeconds: 300 })

// Teach it a codec of your own, which every decode path then uses.
const unregister = registerAudioDecoder('alac', track => myAlacDecoder(track))
```

This is how [ts-videos][ts-videos] uses ts-audio: it
keeps the video containers — MP4, MOV, WebM, Matroska, MPEG-TS — and hands their
audio tracks here.

## CLI usage

```bash
bun add -g @ts-audio/core
```

```bash
ts-audio info song.flac              # format, duration, tracks
ts-audio info song.flac --json
ts-audio metadata song.mp3           # tags, cover art
ts-audio extract song.ogg --output raw.opus --raw
ts-audio formats                     # what is read, written and decoded
ts-audio convert input.wav out.wav --start 00:00:10 --end 00:00:20
```

## What it does, and what it does not

Being clear about the edges, since they are easy to hit:

- **Decoding is the strong suit.** MP3, AAC, Opus, FLAC, Vorbis and PCM all
  decode to samples, verified against reference decoders.
- **Encoding: PCM and FLAC.** `encodeWav` writes PCM, and `encodeFlac` compresses
  losslessly — within a couple of percent of libFLAC's default level, and every
  file it writes passes `flac --test`. There are no lossy encoders, so MP3, AAC,
  Opus and Vorbis cannot be written from samples.
- **`convert` copies when it can and re-encodes when it must.** If nothing
  about the audio changes and the container can carry the codec, the packets go
  across untouched. Otherwise it decodes and encodes again — so any input it can
  read becomes WAV or FLAC, and resampling, mixing to mono or stereo, a bit
  depth, a time range to the sample, volume, normalising and fades all work.
  Lossless to lossless keeps every sample. Converting to a lossy codec is
  refused by name, since there is no lossy encoder here: "ts-audio has no mp3
  encoder". So is a container that cannot carry what would be written into it.
- **Tags are read, not written.** Every container's tags come back through
  `getMetadata`, but no muxer or encoder writes them yet, so a converted file
  comes out untagged.
- **No MP4, MOV, WebM or Matroska.** Those are containers, and they live in
  [ts-videos][ts-videos]; feed their packets here.
- **Refused rather than guessed at:** ALAC (no decoder), 32-bit FLAC, Vorbis
  floor type 0, AAC with 960-sample frames, MPEG audio Layer I and II.

## How correctness is established

Each decoder is measured against the reference that exists for its format,
rather than against itself:

- **FLAC** is checked bit-exactly. Every stream carries an MD5 of its own
  unencoded audio, so a decode either matches or does not.
- **Vorbis** against libvorbis 1.3.7, to within the quantisation noise of a
  16-bit reference, with sample counts matching exactly.
- **AAC** and **MP3** against Apple's own decodes of the same files, and MP3
  also against LAME's gapless numbers.
- **Opus** against Apple's decoder; the SILK fixture matches sample for sample.

The fixtures are built by `say`, `afconvert`, `lame`, the reference FLAC encoder
and libvorbis — never ffmpeg. Each package's `test/fixtures/` holds the script
that rebuilds them.

## Documentation

Full documentation is at [ts-audio.stacksjs.org][docs-site], or in [`docs/`][docs-dir].

## Testing

```bash
bun test
```

## Changelog

Please see our [releases][releases] page for more information on what has changed recently.

## Contributing

Please review the [Contributing Guide][contributing-guide] for details.

## Community

For help, discussion about best practices, or any other conversation that would benefit from being searchable:

[Discussions on GitHub][discussions-on-github]

For casual chit-chat with others using this package:

[Join the Stacks Discord Server][join-the-stacks-discord-server]

## Postcardware

“Software that is free, but hopes for a postcard.” We love receiving postcards from around the world showing where `ts-audio` is being used! We showcase them on our website too.

Our address: Stacks.js, 12665 Village Ln #2306, Playa Vista, CA 90094 🌎

## Sponsors

We would like to extend our thanks to the following sponsors for funding Stacks development. If you are interested in becoming a sponsor, please reach out to us.

- [JetBrains][jetbrains]
- [The Solana Foundation][the-solana-foundation]

## Credits

- [Chris Breuer][chris-breuer]
- [All Contributors][all-contributors]

Parts of ts-audio are derived from other work — the AAC and MP3 tables from the
PacketVideo decoders, the Opus decoder from libopus, the Vorbis floor table from
the Vorbis I specification. See [THIRD_PARTY_NOTICES.md][third-party-notices].

## License

The MIT License (MIT). Please see [LICENSE][license] for more information.

Made with 💙

[docs-site]: https://ts-audio.stacksjs.org
[docs-dir]: ./docs
[pkg-core]: ./packages/ts-audio
[pkg-mp3]: ./packages/mp3
[pkg-aac]: ./packages/aac
[pkg-opus]: ./packages/opus
[pkg-flac]: ./packages/flac
[pkg-vorbis]: ./packages/vorbis
[pkg-ogg]: ./packages/ogg
[pkg-wav]: ./packages/wav
[ts-videos]: https://github.com/stacksjs/ts-videos
[third-party-notices]: ./THIRD_PARTY_NOTICES.md

<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/@ts-audio/core?style=flat-square
[npm-version-href]: https://npmjs.com/package/@ts-audio/core
[github-actions-src]: https://img.shields.io/github/actions/workflow/status/stacksjs/ts-audio/ci.yml?style=flat-square&branch=main
[github-actions-href]: https://github.com/stacksjs/ts-audio/actions?query=workflow%3Aci

<!-- [codecov-src]: https://img.shields.io/codecov/c/gh/stacksjs/ts-audio/main?style=flat-square
[codecov-href]: https://codecov.io/gh/stacksjs/ts-audio -->
[commitizen-friendly]: https://img.shields.io/badge/commitizen-friendly-brightgreen.svg
[releases]: https://github.com/stacksjs/ts-audio/releases
[contributing-guide]: https://github.com/stacksjs/contributing
[discussions-on-github]: https://github.com/stacksjs/ts-audio/discussions
[join-the-stacks-discord-server]: https://stacksjs.com/discord
[jetbrains]: https://www.jetbrains.com/
[the-solana-foundation]: https://solana.com/
[chris-breuer]: https://github.com/chrisbbreuer
[all-contributors]: ../../contributors
[license]: https://github.com/stacksjs/ts-audio/tree/main/LICENSE.md
[commitizen-href]: http://commitizen.github.io/cz-cli/
