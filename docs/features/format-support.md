# Format Support

## Containers

Read and written by the format packages. There is no ffmpeg behind any of them.

| Container | Extensions | Read | Written |
| --- | --- | --- | --- |
| MP3 | `.mp3` | yes, with ID3v1 and ID3v2 | yes |
| WAV / RF64 | `.wav` | yes | yes, switching to RF64 past 4 GB |
| AAC (ADTS) | `.aac` | yes | yes |
| FLAC | `.flac` | yes, with Vorbis comments and pictures | yes |
| Ogg | `.ogg`, `.opus` | yes, Vorbis and Opus | yes |

Writing means packaging packets into a container. It does not mean encoding —
see [Conversion](./audio-conversion.md).

### Not here

MP4, MOV, M4A, WebM, Matroska and MPEG-TS are video containers and live in
[ts-videos](https://github.com/stacksjs/ts-videos). It reads them and hands the
audio tracks to ts-audio, so an M4A's AAC or a WebM's Opus still decodes — the
container is just read elsewhere.

## Codecs decoded to samples

| Codec | What is supported | What is not |
| --- | --- | --- |
| MP3 | MPEG-1, 2 and 2.5, Layer III, mono to joint stereo, LAME gapless numbers | Layer I and II, refused by name |
| AAC | AAC-LC; the AAC core of HE-AAC and HE-AAC v2 | Main and LTP prediction, coupling channels, 960-sample frames |
| Opus | SILK, CELT, hybrid; mono and stereo; mapping families 0 and 1 | More than two channels |
| FLAC | 8, 12, 16, 20 and 24-bit; all four stereo modes | 32-bit, refused by name |
| Vorbis | Floor 1, residue types 0, 1 and 2, channel coupling | Floor type 0, refused by name |
| PCM | 8 to 32-bit integer, 32 and 64-bit float, A-law, µ-law | — |

`canDecodeAudioCodec(codec)` answers for any of these without loading a decoder.

### Refused rather than guessed at

Where a stream uses something unimplemented, ts-audio throws an error naming it
instead of returning plausible-sounding noise:

- **ALAC** — no decoder. Register your own with `registerAudioDecoder`.
- **32-bit FLAC** — its side channel needs 33 bits, more than JavaScript's
  bitwise operators carry.
- **Vorbis floor type 0** — codes the envelope as LSP coefficients; no encoder
  has chosen it in twenty years.
- **AAC with 960-sample frames**, main or LTP prediction, coupling channels.
- **MPEG audio Layer I and II** — recognised, and named as mp1 or mp2.

## Codecs encoded from samples

PCM, into WAV or RF64. Nothing else: there are no compressing encoders here.

Where the runtime provides WebCodecs, `transcodeAudioWithWebCodecs` uses the
platform's own encoder for AAC, MP3 or Opus. Browsers have it; Bun currently
does not.

## Sample rates and depths

Whatever the file states. Nothing is resampled unless you ask — `resampleAudio`
and `decodeAudioToWav` do it on request, with a Kaiser-windowed sinc whose
cutoff sits below both rates' Nyquist frequency.
