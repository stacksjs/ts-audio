# Conversion

`Conversion` moves packets from one container to another. It is honest about
what it cannot do: anything needing an encoder is refused with an error saying
so, rather than writing a file that looks converted and is not.

## What it can do

- Copy packets into a different container, where the container can carry the codec
- Trim by time, with `startTime` and `endTime`
- Carry metadata across
- Report progress

```ts
import { convert } from '@ts-audio/core'

await convert('in.wav', 'out.wav', {
  startTime: 10,
  endTime: 20,
})
```

Or with the class, for progress:

```ts
import { Conversion } from '@ts-audio/core'

const conversion = new Conversion({ input, output, options: { startTime: 10 } })
conversion.onProgress(({ percentage, currentTime }) => {
  console.log(`${percentage.toFixed(1)}% (${currentTime}s)`)
})
await conversion.execute()
```

## What it refuses

Every one of these needs a decoder and an encoder, and ts-audio has no
compressing encoder. Asking for any of them throws before anything is written:

```
Packet-copy conversion cannot perform codec pcm to mp3; a native decoder and encoder are required
```

The full list: a codec change, a bitrate change, resampling, a channel count or
layout change, a bit depth or sample format change, normalisation, a volume
adjustment, a fade in or out, and silence trimming.

You can check in advance rather than catching:

```ts
import { assertPacketCopyConversion } from '@ts-audio/core'

assertPacketCopyConversion(track, options) // throws with the same message
```

## Containers are checked too

The guard compares the codec you asked for against the track's. Separately,
every output format declares which codecs its container can carry, and adding a
track the container cannot hold is refused before anything is written:

```
Error: The mp3 container cannot carry pcm audio; it carries mp3
```

So converting a WAV to `out.mp3` fails even without naming a codec — the codec
has not changed, only the container, and an MP3 file holding PCM packets is not
something any player will open.

| Container | Carries |
| --- | --- |
| WAV, RF64 | `pcm` and all its layouts |
| MP3 | `mp3` |
| AAC (ADTS) | `aac` |
| FLAC | `flac` |
| Ogg | `vorbis`, `opus`, `flac` |

You can ask in advance:

```ts
import { assertCodecSupported, codecMatches } from '@ts-audio/core'

assertCodecSupported(outputFormat, track.codec) // throws with the same message
codecMatches('pcm', 'pcm_s16le') // true
```

An `OutputFormat` of your own that declares nothing — `supportedCodecs` returns
an empty list — is not checked, so a format written before this existed keeps
working.

## Encoding with the platform

Where the runtime provides WebCodecs, the platform's own encoder can be used:

```ts
import { transcodeAudioWithWebCodecs } from '@ts-audio/core'

const result = await transcodeAudioWithWebCodecs(input, output, {
  codec: 'opus',
  bitrate: 128_000,
})
```

It throws if `AudioDecoder`, `AudioEncoder` or `EncodedAudioChunk` are missing
from the global scope, or if the runtime does not support the configuration.
Browsers have these; Bun currently does not.

## Decode instead

For most of what people want conversion for — samples to analyse, a WAV to send
to a transcription service — decoding is the better route and has no such
limits:

```ts
import { decodeAudioToWav } from '@ts-audio/core'

const { audio } = await decodeAudioToWav('song.flac') // 16 kHz mono WAV
```

See [Decoding Audio](./decoding.md).
