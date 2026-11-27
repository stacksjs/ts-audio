# @ts-audio/opus

> An Opus decoder for ts-audio, in TypeScript: SILK, CELT and the hybrid mode.

## Install

```bash
bun add @ts-audio/opus
```

## Usage

```ts
import { decodeOggOpus } from '@ts-audio/opus'

// 48 kHz planar samples, pre-skip and padding already handled.
const { sampleRate, channels } = decodeOggOpus(bytes)
```

Opus (RFC 6716) is what voice notes actually arrive as — WhatsApp's, Firefox's
and Chrome's recordings, Discord, anything WebRTC — which is why
`decodeAudioToWav` in `@ts-audio/core` exists. Reading an Ogg Opus file drops the
pre-skip its OpusHead declares and ends where the last page's granule position
says the sound does, so the samples match a reference decoder's.

For a track of another container, `createOpusDecoder(track)` takes the OpusHead
as the track's `codecDescription` and returns a packet decoder. Mono and stereo,
mapping families 0 and 1.

The Ogg container belongs to `@ts-audio/ogg`, whose page parser this package
reads with. Also here: `OpusDecoder`, `parseOpusPacket`, `opusFrameSamples`,
`parseOpusHead`, `readOggPackets`.

## License

MIT. Ported from libopus 1.5.2 (BSD-3-Clause) — see THIRD_PARTY_NOTICES.md in
the repository.
