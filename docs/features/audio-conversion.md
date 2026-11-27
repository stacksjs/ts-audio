# Conversion

`Conversion` turns one file into another. It **copies** the packets when it can
and **re-encodes** when it must, and it refuses what it cannot do with an error
saying so, rather than writing a file that looks converted and is not.

```ts
import { convert } from '@ts-audio/core'

await convert('song.mp3', 'song.flac')
await convert('voice.ogg', 'voice.wav', { sampleRate: 16000, channels: 1 })
```

The output's extension says what to write.

## Copy or re-encode

| When | What happens |
| --- | --- |
| Nothing about the audio changes, and the container can carry the codec | the packets are **copied**: lossless, fast, the source's own bitstream |
| The codec, rate, channels, depth or level has to change | the audio is **decoded and encoded again**, to WAV or FLAC |
| The target needs an encoder ts-audio does not have | **refused**, by name |

Copying is preferred whenever it gives the same result, because it keeps the
source exactly as it was. You can see which was chosen:

```ts
import { Conversion, createInput, Output } from '@ts-audio/core'
import { FlacOutputFormat } from '@ts-audio/flac'

const conversion = await Conversion.init({
  input: createInput('in.wav'),
  output: new Output({ format: new FlacOutputFormat() }),
  options: { sampleRate: 16000 },
})
conversion.conversionMode // 'transcode'
const bytes = await conversion.execute()
await conversion.close()
```

## What it writes

| From | To WAV | To FLAC |
| --- | --- | --- |
| WAV, FLAC | every sample kept | every sample kept |
| MP3, AAC, Opus, Vorbis | the decoded audio | the decoded audio |
| — | — | — |
| MP3, AAC, Ogg | only by copying, from a source already in that codec | |

**Lossless to lossless keeps every sample**, at up to 24 bits. Every decoder here
turns an integer into a float by dividing by 2^(bits − 1), and every encoder
multiplies by the same, so the round trip is exact. A 24-bit source stays 24-bit
unless you ask otherwise.

**A lossy source becomes the audio its decoder produced**, stored at the target's
depth. That is the decoded sound kept losslessly from here on — not the original
recording recovered. Gapless MP3, Opus pre-skip and Ogg end trimming are applied
exactly as `decodeAudio` applies them.

There are no lossy encoders, so MP3, AAC, Opus and Vorbis cannot be written from
samples: converting a WAV to `.mp3` is refused.

## What it can change

When re-encoding:

| Option | Effect |
| --- | --- |
| `sampleRate` | resample, with a band-limited filter that does not alias |
| `channels` | mix to mono (the average) or stereo |
| `bitDepth` | 8, 16, 24 or 32 for WAV; 4 to 24 for FLAC |
| `startTime`, `endTime` | trim, **to the sample** |
| `volume` | a linear gain; `0.5` halves it |
| `normalize` | raise the loudest sample to full scale, by one gain for every channel so stereo keeps its balance |
| `fadeIn`, `fadeOut` | seconds |
| `audioCodec` | `pcm` or `flac`, when the extension leaves it open |

When copying, only `startTime` and `endTime` apply, and they cut between
packets — so a copied trim lands on a packet boundary, where a re-encoded one is
exact.

## What it refuses

Each throws before anything is written:

```
ts-audio has no mp3 encoder, so it cannot convert pcm to mp3. It can decode pcm and write WAV or FLAC, ...
A bitrate does not apply to FLAC, which is lossless
Mixing to 6 channels is not supported; to mono or stereo is
Trimming silence is not supported
FLAC is written into a .flac file; writing it into ogg is not supported
```

A container is also checked against what would be written into it: every output
format declares which codecs it carries, so nothing lands in a container that
cannot hold it.

## Known limits

- **Tags are not written**, by copying or by re-encoding. `Conversion` hands the
  input's metadata to the output, but none of the muxers or encoders write it
  yet, so a converted file comes out untagged. Read tags with
  [Metadata](./metadata-handling.md) and carry them yourself for now.
- **A stream source cannot be re-encoded.** Re-encoding reads the source a second
  time, which a stream cannot be read for; read it into a buffer first. Copying
  a stream works.
- **Re-encoding holds the whole file in memory**, as floats, so it is not for
  files of several gigabytes. Copying does not have that limit.
- **Progress is reported once**, at the end, when re-encoding.

## Encoding with the platform

Where the runtime provides WebCodecs, `transcodeAudioWithWebCodecs` uses the
platform's own encoders, which include lossy ones:

```ts
import { transcodeAudioWithWebCodecs } from '@ts-audio/core'

await transcodeAudioWithWebCodecs(input, output, { codec: 'opus', bitrate: 128_000 })
```

It needs `AudioDecoder`, `AudioEncoder` and `EncodedAudioChunk` in the global
scope. Browsers have them; Bun currently does not.
