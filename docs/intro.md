# What is ts-audio?

ts-audio reads and writes audio containers, and decodes audio to samples, in
plain TypeScript. There is no ffmpeg behind it, no native module to build and no
binary to ship — it runs wherever Bun or Node does.

It exists because the usual answer to "decode this audio" is to shell out to
ffmpeg, which means a binary to install, a process to manage, and a dependency
that dwarfs the task. For reading tags, inspecting a file, or turning a voice
note into samples, that is a lot of machinery.

## What it decodes

Five codecs are decoded here, in TypeScript:

| Codec | Notes |
| --- | --- |
| MP3 | MPEG-1, 2 and 2.5, Layer III, with ID3 tags and LAME's gapless numbers |
| AAC | AAC-LC, and the AAC core of HE-AAC and HE-AAC v2 |
| Opus | SILK, CELT and the hybrid mode — what voice notes arrive as |
| FLAC | 8, 12, 16, 20 and 24-bit, all four stereo modes |
| Vorbis | Floor 1, residue types 0, 1 and 2, channel coupling |

PCM needs no decoder, so WAV and RF64 come for free.

## What it does not do

Worth knowing before you start:

- **It encodes PCM and FLAC, and nothing lossy.** `encodeWav` writes PCM and
  `encodeFlac` compresses losslessly; there are no MP3, AAC, Opus or Vorbis
  encoders. `Conversion` copies packets when nothing about the audio changes,
  and otherwise decodes and encodes to WAV or FLAC; converting to a lossy codec
  is refused with an error saying so, rather than writing a file that is wrong.
  Where the runtime provides WebCodecs, `transcodeAudioWithWebCodecs` uses the
  platform's own encoder.
- **It does not read video containers.** MP4, MOV, WebM, Matroska and MPEG-TS
  live in [ts-videos](https://github.com/stacksjs/ts-videos), which reads them
  and hands their audio tracks to ts-audio.
- **Some things are refused by name** rather than guessed at: ALAC, 32-bit
  FLAC, Vorbis floor type 0, AAC with 960-sample frames, and MPEG audio
  Layer I and II.

## How it is put together

`@ts-audio/core` holds the container APIs and `decodeAudio`. Each format lives
in its own package, and they are optional peers of core, loaded the first time a
file needs one — so reading a WAV never loads an Opus decoder.

```text
@ts-audio/core     decodeAudio, Input/Output, PCM and WAV samples, resampling
@ts-audio/mp3      MP3 frames, ID3 tags, MP3 decoder
@ts-audio/aac      ADTS streams, AAC-LC decoder
@ts-audio/opus     Opus decoder (SILK, CELT, hybrid)
@ts-audio/flac     FLAC metadata, frames, lossless decoder
@ts-audio/vorbis   Vorbis I decoder
@ts-audio/ogg      The Ogg container, shared by Vorbis and Opus
@ts-audio/wav      WAV and RF64
```

Installing `@ts-audio/core` brings the rest with it.

## How correctness is established

Each decoder is measured against the reference that exists for its format, not
against itself:

- **FLAC** bit-exactly. Every stream carries an MD5 of its own unencoded audio,
  so a decode either matches or it does not.
- **Vorbis** against libvorbis 1.3.7, to within the quantisation noise of a
  16-bit reference, with sample counts matching exactly.
- **AAC** and **MP3** against Apple's own decodes of the same files.
- **Opus** against Apple's decoder; the SILK fixture matches sample for sample.

Fixtures are built with `say`, `afconvert`, `lame`, the reference FLAC encoder
and libvorbis — never ffmpeg. Each package's `test/fixtures/` holds the script
that rebuilds them.

## Next

- [Installation](./install.md)
- [Usage](./usage.md)
- [Decoding Audio](./features/decoding.md)
