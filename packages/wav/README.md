# @ts-audio/wav

> WAV and RF64 for ts-audio: RIFF reading and writing, and PCM to samples.

## Install

```bash
bun add @ts-audio/wav
```

## Usage

```ts
import { decodeWav, encodeWav, WavInputFormat } from '@ts-audio/wav'

// One call, no container plumbing.
const { sampleRate, channels } = decodeWav(bytes)
const wav = encodeWav(channels, 16000)

// Or packet by packet, through the demuxer.
const input = new Input({ source, format: new WavInputFormat() })
```

Reads integer PCM at 8 to 32 bits, 32- and 64-bit float, A-law and µ-law, plain
or extensible, RIFF or RF64 — and walks past chunks it does not know, which is
how Apple's own WAV files are laid out.

Writing: `WavMuxer`, `Rf64Muxer` and `AutoWavMuxer`, which picks RF64 once the
samples outgrow RIFF's 4 GB.

## License

MIT
