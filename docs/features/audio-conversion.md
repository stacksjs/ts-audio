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

## A gap worth knowing about

The guard compares the **codec** you asked for against the track's. It does not
yet check that the output *container* can carry that codec. So converting a WAV
to `out.mp3` without naming a codec passes the guard — the codec has not
changed, only the container — and writes PCM packets into an MP3 container,
reporting success. The result is not playable.

Until `OutputFormat` declares which codecs it can carry, keep the container and
the codec consistent: WAV in, WAV out.

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
