# Format Support

Audiox supports a wide range of audio formats through its FFmpeg backend, making it versatile for various audio processing needs.

## Supported Formats

### Input Formats

Audiox can read from virtually any audio format that FFmpeg supports:

| Format | Extension | Description |
|--------|-----------|-------------|
| MP3 | `.mp3` | MPEG Audio Layer III |
| WAV | `.wav` | Waveform Audio File |
| AAC | `.aac`, `.m4a` | Advanced Audio Coding |
| FLAC | `.flac` | Free Lossless Audio Codec |
| OGG | `.ogg` | Ogg Vorbis |
| WMA | `.wma` | Windows Media Audio |
| AIFF | `.aiff`, `.aif` | Audio Interchange File Format |
| OPUS | `.opus` | Opus Interactive Audio Codec |

### Output Formats

Primary output formats with full codec support:

```ts
// MP3 Output
await audio('input.wav', 'output.mp3', {
  codec: 'mp3',
  bitrate: '192k',
})

// WAV Output (Lossless)
await audio('input.mp3', 'output.wav', {
  codec: 'pcm_s16le',
})

// AAC Output
await audio('input.wav', 'output.aac', {
  codec: 'aac',
  bitrate: '128k',
})
```

## Format-Specific Options

### MP3 Format

MP3 is the most widely supported audio format:

```ts
// High-quality MP3
await audio('input.wav', 'output.mp3', {
  codec: 'mp3',
  bitrate: '320k',
  sampleRate: 44100,
  channels: 2,
})

// Voice-optimized MP3
await audio('voice.wav', 'voice.mp3', {
  codec: 'mp3',
  bitrate: '64k',
  sampleRate: 22050,
  channels: 1,
})

// Podcast MP3
await audio('podcast.wav', 'podcast.mp3', {
  codec: 'mp3',
  bitrate: '128k',
  sampleRate: 44100,
  channels: 1,
})
```

### WAV Format

WAV provides lossless, uncompressed audio:

```ts
// CD Quality WAV
await audio('input.mp3', 'output.wav', {
  codec: 'pcm_s16le',
  sampleRate: 44100,
  channels: 2,
})

// Speech Recognition WAV
await audio('voice.mp3', 'voice.wav', {
  codec: 'pcm_s16le',
  sampleRate: 16000,
  channels: 1,
})

// High-Resolution WAV
await audio('master.flac', 'master.wav', {
  codec: 'pcm_s24le',
  sampleRate: 48000,
  channels: 2,
})
```

### AAC Format

AAC offers better quality than MP3 at similar bitrates:

```ts
// Streaming AAC
await audio('input.wav', 'output.aac', {
  codec: 'aac',
  bitrate: '128k',
  sampleRate: 44100,
  channels: 2,
})

// High-Quality AAC
await audio('input.wav', 'output.aac', {
  codec: 'aac',
  bitrate: '256k',
  sampleRate: 48000,
  channels: 2,
})
```

## CLI Format Commands

Use the CLI for quick format conversions:

```bash
# Convert to MP3
audiox convert song.wav song.mp3 --codec mp3 --bitrate 192k

# Convert to WAV
audiox convert song.mp3 song.wav --codec pcm_s16le

# Convert to AAC
audiox convert song.wav song.aac --codec aac --bitrate 128k

# Convert FLAC to MP3
audiox convert album.flac album.mp3 --codec mp3 --bitrate 320k
```

## Getting File Information

Retrieve format information from any audio file:

```ts
import { audioInfo } from '@stacksjs/audiox'

const info = await audioInfo('music.mp3')
console.log(info)
// [
//   {
//     codec: 'mp3',
//     channels: 2,
//     sampleRate: '44100',
//     bitrate: '192000',
//     duration: '180.5',
//   }
// ]
```

```bash
# CLI info command
audiox info music.mp3
```

## Format Detection

Audiox automatically detects the input format:

```ts
// Format is auto-detected from the file
await audio('unknown.audio', 'output.mp3', {
  codec: 'mp3',
})
```

## Cross-Format Conversion Matrix

Common conversion scenarios:

| From | To | Use Case |
|------|-----|----------|
| WAV | MP3 | Compress recordings for sharing |
| MP3 | WAV | Prepare for editing in DAWs |
| FLAC | MP3 | Create portable copies |
| WAV | AAC | Prepare for streaming |
| Any | WAV (16kHz mono) | Speech recognition preprocessing |

## Best Practices for Format Selection

### For Music Distribution
```ts
// High-quality MP3 for downloads
await audio('master.wav', 'release.mp3', {
  codec: 'mp3',
  bitrate: '320k',
  sampleRate: 44100,
  channels: 2,
})
```

### For Podcasts
```ts
// Podcast-optimized audio
await audio('episode.wav', 'episode.mp3', {
  codec: 'mp3',
  bitrate: '128k',
  sampleRate: 44100,
  channels: 1,
})
```

### For Voice Assistants
```ts
// Voice recognition format
await audio('command.mp3', 'command.wav', {
  codec: 'pcm_s16le',
  sampleRate: 16000,
  channels: 1,
})
```

### For Web Streaming
```ts
// Web-optimized AAC
await audio('track.wav', 'track.aac', {
  codec: 'aac',
  bitrate: '128k',
  sampleRate: 44100,
  channels: 2,
})
```
