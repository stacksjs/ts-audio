# Usage

Two ways in: the library, and the `ts-audio` command.

## Library usage

### Decode a file to samples

```ts
import { decodeAudio } from '@ts-audio/core'

const { sampleRate, channels, duration, codec } = await decodeAudio('voice-note.ogg')

// channels is one Float32Array per channel, each sample between -1 and 1.
console.log(`${codec} at ${sampleRate} Hz, ${channels.length} channel(s), ${duration}s`)
```

`decodeAudio` accepts a path, a `Uint8Array`, an `ArrayBuffer`, a `Blob` or a
`Source`. MP3, Ogg and WAV files are read directly; anything else goes through
the container readers.

Guard rails, for input you did not create:

```ts
const decoded = await decodeAudio(upload, {
  maxBytes: 50 * 1024 * 1024, // refused before reading
  maxDurationSeconds: 300, // refused as soon as the decoded part is longer
  signal: controller.signal,
})
```

`maxDurationSeconds` throws `AudioTooLongError`; a codec with no decoder throws
`UnsupportedAudioCodecError`.

### Decode to a WAV for speech-to-text

```ts
import { decodeAudioToWav } from '@ts-audio/core'

const { audio, mimeType, durationSeconds, sampleRate, channels } = await decodeAudioToWav(
  'voice-note.ogg',
  { maxDurationSeconds: 300 },
)
// 16 kHz mono 16-bit WAV by default; pass sampleRate and channels to change it.
```

### Inspect a file

```ts
import { createInput } from '@ts-audio/core'

const input = createInput('album/01.flac')
const [format, tracks, metadata, duration] = await Promise.all([
  input.getFormatName(),
  input.getTracks(),
  input.getMetadata(),
  input.getDuration(),
])
await input.close()
```

### Read packets yourself

```ts
import { createInput } from '@ts-audio/core'

const input = createInput('song.mp3')
const track = await input.getPrimaryTrack()
for await (const packet of input.packets(track!.id)) {
  // packet.data, packet.timestamp, packet.duration
}
await input.close()
```

### Decode a track from your own container

```ts
import { createAudioDecoder, decodeAudioPackets } from '@ts-audio/core'

// The whole track at once.
const decoded = await decodeAudioPackets(track, packets, { maxDurationSeconds: 300 })

// Or packet by packet.
const decoder = await createAudioDecoder(track)
const chunk = decoder.decode(packet)
```

Both pick the decoder the same way `decodeAudio` does, so a codec registered
with `registerAudioDecoder` is used by every path:

```ts
import { canDecodeAudioCodec, registerAudioDecoder } from '@ts-audio/core'

const unregister = registerAudioDecoder('alac', track => myAlacDecoder(track))
canDecodeAudioCodec('alac') // true
unregister()
```

### Samples without a codec

```ts
import { decodeWav, encodeWav, mixChannels, resampleAudio } from '@ts-audio/core'

const { channels, sampleRate } = decodeWav(bytes)
const mono = mixChannels(channels, 1)
const at16k = resampleAudio(mono, sampleRate, 16000)
const wav = encodeWav(at16k, 16000)
```

`resampleAudio` is a Kaiser-windowed sinc with its cutoff below both rates'
Nyquist frequency, so downsampling does not alias.

## CLI usage

```bash
ts-audio info song.flac              # format, duration, tracks
ts-audio info song.flac --json
ts-audio metadata song.mp3           # tags and cover art
ts-audio extract song.ogg --output raw.opus --raw
ts-audio formats                     # what is read, written, decoded, encoded
ts-audio convert in.wav out.wav --start 00:00:10 --end 00:00:20
```

See [CLI](./features/cli-usage.md) for each command in full.

## Next

- [Decoding Audio](./features/decoding.md)
- [Format Support](./features/format-support.md)
- [Conversion](./features/audio-conversion.md)
