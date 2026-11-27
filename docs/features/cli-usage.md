# CLI

Installing `@ts-audio/core` globally puts a `ts-audio` command on your path.

```bash
bun add -g @ts-audio/core
ts-audio --help
```

Or without installing: `bunx @ts-audio/core <command>`.

## info

What a file is, and what is in it.

```bash
ts-audio info song.flac
```

```
Format: flac
Duration: 00:02.309

Tracks (1):
  Audio #1: flac
    Sample rate: 44.1 kHz
    Channels: 1 (mono)
    Bit depth: 16-bit
```

| Option | Meaning |
| --- | --- |
| `--json` | the same, as JSON |
| `--verbose` | include metadata |

## metadata

Tags and cover art.

```bash
ts-audio metadata song.mp3
ts-audio metadata album.flac --json
```

## extract

Pull the audio data out of a container.

```bash
ts-audio extract song.ogg --output raw.opus --raw
```

| Option | Meaning |
| --- | --- |
| `--output <file>` | where to write |
| `--raw` | the packets alone, with no container |

## formats

What is read, written, decoded and encoded. Worth running before assuming
something works:

```bash
ts-audio formats
```

## convert

Converts between containers and codecs. It copies the packets when it can, and
decodes and encodes again when it must.

```bash
ts-audio convert song.mp3 song.flac                  # any input, to lossless
ts-audio convert voice.ogg voice.wav --sample-rate 16000 --channels 1
ts-audio convert in.flac out.wav                     # every sample kept
ts-audio convert in.wav out.wav --start 00:00:10 --end 00:00:20
```

| Option | Meaning |
| --- | --- |
| `--start <time>` | seconds, or `HH:MM:SS` |
| `--end <time>` | seconds, or `HH:MM:SS` |
| `--sample-rate <rate>` | resample to this rate |
| `--channels <n>` | mix to mono or stereo |
| `--normalize` | raise the loudest sample to full scale |
| `--codec <codec>` | `pcm` or `flac`, if not what the extension implies |
| `--verbose` | show progress |

The output's extension says what to write. WAV and FLAC can be written from
anything ts-audio decodes; MP3, AAC and Ogg can only be copied into, from a
source already in that codec.

What it refuses, and says so:

```
Error: ts-audio has no mp3 encoder, so it cannot convert pcm to mp3. ...
Error: A bitrate does not apply to FLAC, which is lossless
Error: Mixing to 6 channels is not supported; to mono or stereo is
```

See [Conversion](./audio-conversion.md) for when it copies and when it
re-encodes.
