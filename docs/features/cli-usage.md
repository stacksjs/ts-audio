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

Copies packets into another container, and trims.

```bash
ts-audio convert in.wav out.wav --start 00:00:10 --end 00:00:20
```

| Option | Meaning |
| --- | --- |
| `--start <time>` | seconds, or `HH:MM:SS` |
| `--end <time>` | seconds, or `HH:MM:SS` |
| `--verbose` | show progress |

The options below are accepted and then **refused**, because each needs an
encoder: `--codec`, `--bitrate`, `--sample-rate`, `--channels`, `--normalize`.
The error names what it cannot do:

```
Error: Packet-copy conversion cannot perform codec pcm to mp3; a native decoder and encoder are required
```

A container that cannot carry the source codec is refused the same way, so
`convert in.wav out.mp3` fails rather than writing an MP3 full of PCM. See
[Conversion](./audio-conversion.md).
