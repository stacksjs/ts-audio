# Decoding Audio

Decoding is what ts-audio is best at. Five codecs are decoded in TypeScript, and
PCM needs no decoder at all.

## A whole file

```ts
import { decodeAudio } from '@ts-audio/core'

const { sampleRate, channels, duration, codec } = await decodeAudio('song.flac')
```

The result is planar: `channels` holds one `Float32Array` per channel, each
sample between -1 and 1, at the file's own rate. Nothing is resampled or mixed
unless you ask.

MP3, Ogg (Vorbis or Opus) and WAV files are read directly. Everything else goes
through the installed container readers, which are loaded on demand.

### Options

```ts
await decodeAudio(input, {
  maxBytes: 50 * 1024 * 1024,
  maxDurationSeconds: 300,
  signal: controller.signal,
  formats: [new WavInputFormat()], // only these readers
})
```

- `maxBytes` refuses oversized input **before** reading it.
- `maxDurationSeconds` throws `AudioTooLongError` as soon as the decoded part is
  longer, rather than after decoding all of it.
- `signal` is checked between packets.
- `formats` replaces the default reader list.

## For speech-to-text

```ts
import { decodeAudioToWav } from '@ts-audio/core'

const { audio, durationSeconds } = await decodeAudioToWav('voice-note.ogg')
```

16 kHz mono 16-bit WAV by default, which is the shape most transcription
services take. Pass `sampleRate` and `channels` for something else. It mixes
down and resamples with a band-limited filter, so downsampling does not alias.

This is why the Opus decoder matters: voice notes from WhatsApp, Firefox, Chrome
and anything WebRTC arrive as Ogg Opus.

## A track from your own container

If you read the container yourself — as
[ts-videos](https://github.com/stacksjs/ts-videos) does for MP4, WebM, Matroska
and MPEG-TS — hand the packets over:

```ts
import { decodeAudioPackets } from '@ts-audio/core'

const decoded = await decodeAudioPackets(track, packets, { maxDurationSeconds: 300 })
```

`packets` may be an array or an async iterable. The track's `trimStart` and
`trimmedDuration` are honoured, so encoder priming and padding are dropped the
same way `decodeAudio` drops them.

For finer control, take the decoder itself:

```ts
import { createAudioDecoder } from '@ts-audio/core'

const decoder = await createAudioDecoder(track)
const chunk = decoder.decode(packet) // { sampleRate, channels } or null
const tail = decoder.flush?.()
decoder.close?.()
```

A decoder may hold samples back and release them from `flush`, and its output
rate may differ from the container's — HE-AAC decodes its core at half the
stated rate.

### What the track needs to say

A decoder is configured from the track, so these matter:

- `codec` — which decoder is chosen
- `sampleRate`, `channels`, `bitDepth`
- `codecDescription` — the codec's own configuration record: AAC's
  AudioSpecificConfig, Opus's OpusHead, FLAC's STREAMINFO, Vorbis's three
  headers. Some codecs need it; FLAC and MP3 frames mostly describe themselves.

## Teaching it a codec

```ts
import { canDecodeAudioCodec, registerAudioDecoder } from '@ts-audio/core'

const unregister = registerAudioDecoder('alac', track => ({
  decode: packet => ({ sampleRate: track.sampleRate, channels: decodeSomehow(packet) }),
}))
```

A registered decoder takes precedence over a built-in one, and is used by
`decodeAudio`, `decodeAudioPackets` and `createAudioDecoder` alike. The function
returned puts the previous one back. `canDecodeAudioCodec` answers from the
codec's name without loading anything.

## Errors

- `UnsupportedAudioCodecError` — no decoder for that codec, named in the message
- `AudioTooLongError` — past `maxDurationSeconds`
- Each codec package also has its own: `Mp3DecodeError`, `AacDecodeError`,
  `FlacDecodeError`, `VorbisDecodeError`, `OpusDecodeError`

MP3 and AAC treat a damaged frame as a moment of silence, as players do, and
refuse a stream that is mostly damage.
