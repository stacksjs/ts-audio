# Audio Conversion

Audiox provides powerful audio conversion capabilities powered by FFmpeg, allowing you to transform audio files between formats while maintaining quality and control over the output.

## Basic Conversion

Convert audio files using the simple `audio()` function:

```ts
import { audio } from '@stacksjs/audiox'

// Basic MP3 to WAV conversion
await audio('input.mp3', 'output.wav')

// With custom options
await audio('input.mp3', 'output.wav', {
  codec: 'pcm_s16le',
  channels: 1,
  sampleRate: 16000,
  bitrate: '160k',
})
```

## CLI Conversion

Use the command line for quick conversions:

```bash
# Basic conversion
audiox convert input.mp3 output.wav

# With options
audiox convert input.mp3 output.wav \
  --codec pcm_s16le \
  --channels 1 \
  --sample-rate 16000

# High-quality MP3 conversion
audiox convert podcast.wav podcast.mp3 \
  --codec mp3 \
  --bitrate 320k \
  --sample-rate 48000

# Quality settings
audiox convert input.mp3 output.mp3 --bitrate 320k

# Channel and sample rate
audiox convert input.mp3 output.wav --channels 1 --sample-rate 16000

# Batch conversion
audiox convert *.mp3 --output-format wav
```

## Conversion Options

### Codec Selection

Choose the appropriate codec for your output format:

```ts
// MP3 encoding
await audio('input.wav', 'output.mp3', {
  codec: 'mp3',
  bitrate: '192k',
})

// AAC encoding (great for streaming)
await audio('input.wav', 'output.aac', {
  codec: 'aac',
  bitrate: '128k',
})

// Lossless WAV
await audio('input.mp3', 'output.wav', {
  codec: 'pcm_s16le',
})
```

### Bitrate Control

Control the bitrate for lossy formats:

```ts
// High quality (320kbps)
await audio('input.wav', 'output.mp3', {
  codec: 'mp3',
  bitrate: '320k',
})

// Medium quality (192kbps)
await audio('input.wav', 'output.mp3', {
  codec: 'mp3',
  bitrate: '192k',
})

// Low bandwidth (64kbps)
await audio('input.wav', 'output.mp3', {
  codec: 'mp3',
  bitrate: '64k',
})
```

### Sample Rate Adjustment

Adjust the sample rate for different use cases:

```ts
// CD quality (44.1kHz)
await audio('input.mp3', 'output.wav', {
  sampleRate: 44100,
})

// Professional audio (48kHz)
await audio('input.mp3', 'output.wav', {
  sampleRate: 48000,
})

// Voice/telephony (16kHz)
await audio('input.mp3', 'output.wav', {
  sampleRate: 16000,
})

// Low bandwidth (8kHz)
await audio('input.mp3', 'output.wav', {
  sampleRate: 8000,
})
```

### Channel Configuration

Configure audio channels for mono or stereo output:

```ts
// Convert to mono (for voice/speech)
await audio('input.mp3', 'output.wav', {
  channels: 1,
})

// Stereo output
await audio('input.mp3', 'output.wav', {
  channels: 2,
})

// Surround sound (if supported)
await audio('input.mp3', 'output.wav', {
  channels: 5.1,
})
```

## Stream-Based Conversion

For processing large files or real-time audio:

```ts
import { audioWithStreamInput, audioWithStreamOut } from '@stacksjs/audiox'

// Input from stream
const file = Bun.file('large-file.mp3')
const stream = file.stream()

await audioWithStreamInput(stream, 'output.wav', {
  codec: 'pcm_s16le',
  channels: 1,
  sampleRate: 16000,
})

// Output to stream with callbacks
await audioWithStreamOut(
  'input.mp3',
  {
    onProcessDataFlushed: (chunk) => {
      console.log(`Processing chunk: ${chunk?.length} bytes`)
    },
    onProcessDataEnd: async (data) => {
      await Bun.write('output.wav', data!)
    },
  },
  {
    codec: 'pcm_s16le',
    channels: 1,
    sampleRate: 16000,
  },
)
```

## Buffer-Based Conversion

Convert audio directly from buffers:

```ts
import { audioWav } from '@stacksjs/audiox'

// Read file as buffer
const arrayBuffer = await Bun.file('input.mp3').arrayBuffer()

// Convert to WAV
const wavData = await audioWav(new Uint8Array(arrayBuffer))

// Write output
await Bun.write('output.wav', wavData)
```

## Quality Settings

Fine-tune quality for variable bitrate encoding:

```ts
// Highest quality (0)
await audio('input.wav', 'output.mp3', {
  codec: 'mp3',
  quality: 0,
})

// Balanced quality (5)
await audio('input.wav', 'output.mp3', {
  codec: 'mp3',
  quality: 5,
})

// Smaller file size (9)
await audio('input.wav', 'output.mp3', {
  codec: 'mp3',
  quality: 9,
})
```

## Error Handling

Handle conversion errors gracefully:

```ts
import { audio } from '@stacksjs/audiox'

try {
  await audio('input.mp3', 'output.wav', {
    codec: 'pcm_s16le',
    onError: (error) => {
      console.error('Conversion error:', error)
    },
  })
}
catch (error) {
  console.error('Failed to convert audio:', error)
}
```

## Best Practices

1. **Choose the Right Codec**: Use MP3 for compatibility, AAC for streaming, and WAV for lossless quality
2. **Match Sample Rates**: Avoid upsampling when possible to prevent artifacts
3. **Consider Mono for Speech**: Voice recordings often work well in mono, reducing file size
4. **Use Streams for Large Files**: Stream processing is more memory-efficient
5. **Set Appropriate Bitrates**: Higher bitrates mean better quality but larger files
6. **Format Selection**
   - Use WAV for lossless quality
   - Use MP3 for size efficiency
   - Use AAC for modern compatibility
7. **Quality Optimization**
   - Match sample rate to content type
   - Choose appropriate bitrates
   - Consider target platform requirements
8. **Performance**
   - Use batch processing for multiple files
   - Monitor system resources
   - Implement proper error handling
