# Advanced Configuration

Audiox offers extensive configuration options for fine-tuning audio processing workflows. This guide covers advanced configuration patterns and customization options.

## Configuration File Structure

Create an `audiox.config.ts` file in your project root:

```ts
import type { AudioxConfig } from '@stacksjs/audiox'

const config: AudioxConfig = {
  // Audio encoding defaults
  codec: 'mp3',
  bitrate: '192k',
  channels: 2,
  sampleRate: 44100,
  quality: 2,

  // Metadata defaults
  metadata: {
    encoded_by: 'My Application',
    copyright: '2024 My Company',
  },

  // Processing options
  verbose: false,

  // Error handling
  onError: (error) => {
    console.error('Audio processing error:', error)
  },
}

export default config
```

## Environment-Specific Configuration

Create different configurations for different environments:

```ts
// audiox.config.ts
import type { AudioxConfig } from '@stacksjs/audiox'

const isDev = process.env.NODE_ENV === 'development'
const isProd = process.env.NODE_ENV === 'production'

const config: AudioxConfig = {
  // Use higher quality in production
  bitrate: isProd ? '320k' : '128k',
  quality: isProd ? 0 : 5,

  // Verbose logging in development
  verbose: isDev,

  // Production-specific settings
  ...(isProd && {
    sampleRate: 48000,
    channels: 2,
  }),
}

export default config
```

## Configuration Presets

Define reusable configuration presets:

```ts
// config/audio-presets.ts
import type { AudioxOptions } from '@stacksjs/audiox'

export const presets = {
  // High-quality music
  music: {
    codec: 'mp3',
    bitrate: '320k',
    sampleRate: 48000,
    channels: 2,
    quality: 0,
  } satisfies AudioxOptions,

  // Podcast audio
  podcast: {
    codec: 'mp3',
    bitrate: '128k',
    sampleRate: 44100,
    channels: 1,
    quality: 3,
  } satisfies AudioxOptions,

  // Voice/speech recognition
  voice: {
    codec: 'pcm_s16le',
    sampleRate: 16000,
    channels: 1,
  } satisfies AudioxOptions,

  // Streaming optimized
  streaming: {
    codec: 'aac',
    bitrate: '128k',
    sampleRate: 44100,
    channels: 2,
  } satisfies AudioxOptions,

  // Telephony/VoIP
  telephony: {
    codec: 'pcm_s16le',
    sampleRate: 8000,
    channels: 1,
  } satisfies AudioxOptions,
}

// Usage
import { audio } from '@stacksjs/audiox'
import { presets } from './config/audio-presets'

await audio('input.wav', 'output.mp3', presets.podcast)
```

## Dynamic Configuration

Generate configuration based on input file characteristics:

```ts
import { audio, audioInfo } from '@stacksjs/audiox'
import type { AudioxOptions } from '@stacksjs/audiox'

async function getOptimalConfig(inputPath: string): Promise<AudioxOptions> {
  const info = await audioInfo(inputPath)
  const { sampleRate, channels, bitrate } = info[0] || {}

  // Don't upsample
  const targetSampleRate = Math.min(
    Number.parseInt(sampleRate || '44100'),
    48000,
  )

  // Preserve channel configuration
  const targetChannels = Number(channels) || 2

  // Set appropriate bitrate based on channel count
  const targetBitrate = targetChannels > 1 ? '256k' : '128k'

  return {
    codec: 'mp3',
    sampleRate: targetSampleRate,
    channels: targetChannels,
    bitrate: targetBitrate,
    quality: 2,
  }
}

// Usage
const config = await getOptimalConfig('input.flac')
await audio('input.flac', 'output.mp3', config)
```

## Configuration Validation

Validate configuration before processing:

```ts
import type { AudioxOptions } from '@stacksjs/audiox'

function validateConfig(config: AudioxOptions): void {
  const validCodecs = ['mp3', 'aac', 'pcm_s16le', 'pcm_s24le']
  const validSampleRates = [8000, 16000, 22050, 44100, 48000, 96000]
  const validChannels = [1, 2, 5.1, 7.1]

  if (config.codec && !validCodecs.includes(config.codec)) {
    throw new Error(`Invalid codec: ${config.codec}`)
  }

  if (config.sampleRate && !validSampleRates.includes(config.sampleRate)) {
    throw new Error(`Invalid sample rate: ${config.sampleRate}`)
  }

  if (config.channels && !validChannels.includes(config.channels)) {
    throw new Error(`Invalid channel count: ${config.channels}`)
  }

  if (config.bitrate) {
    const bitrateNum = Number.parseInt(config.bitrate)
    if (bitrateNum < 32 || bitrateNum > 512) {
      throw new Error(`Bitrate out of range: ${config.bitrate}`)
    }
  }
}

// Usage
const myConfig: AudioxOptions = {
  codec: 'mp3',
  bitrate: '192k',
  sampleRate: 44100,
}

validateConfig(myConfig)
```

## Configuration Merging

Merge multiple configuration sources:

```ts
import type { AudioxOptions } from '@stacksjs/audiox'

function mergeConfigs(...configs: Partial<AudioxOptions>[]): AudioxOptions {
  return configs.reduce((merged, config) => ({
    ...merged,
    ...config,
    // Deep merge metadata
    metadata: {
      ...merged.metadata,
      ...config.metadata,
    },
  }), {} as AudioxOptions)
}

// Usage
const baseConfig: Partial<AudioxOptions> = {
  codec: 'mp3',
  bitrate: '192k',
  metadata: {
    encoded_by: 'My App',
  },
}

const userConfig: Partial<AudioxOptions> = {
  bitrate: '320k',
  metadata: {
    copyright: '2024',
  },
}

const finalConfig = mergeConfigs(baseConfig, userConfig)
// Result: { codec: 'mp3', bitrate: '320k', metadata: { encoded_by: 'My App', copyright: '2024' } }
```

## Configuration Type Reference

Complete TypeScript interface for configuration:

```ts
interface AudioxOptions {
  // Codec settings
  codec?: 'aac' | 'mp3' | 'pcm_s16le' | 'pcm_s24le' | string

  // Audio quality
  bitrate?: string // e.g., '128k', '192k', '320k'
  quality?: number // 0-9, lower is better quality

  // Audio format
  channels?: 1 | 2 | 5.1 | 7.1 | number
  sampleRate?: 8000 | 16000 | 22050 | 44100 | 48000 | 96000 | number

  // Metadata
  metadata?: {
    title?: string
    artist?: string
    album?: string
    album_artist?: string
    year?: string
    track?: string
    disc?: string
    genre?: string
    composer?: string
    publisher?: string
    copyright?: string
    comment?: string
    encoded_by?: string
    [key: string]: string | undefined
  }

  // Processing options
  verbose?: boolean

  // Callbacks
  onError?: (error: unknown) => void
}
```

## Loading Configuration Programmatically

Load and parse configuration files:

```ts
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

async function loadConfig(configPath?: string): Promise<AudioxOptions> {
  const paths = configPath
    ? [configPath]
    : [
        'audiox.config.ts',
        'audiox.config.js',
        'audiox.config.mjs',
      ]

  for (const path of paths) {
    const fullPath = resolve(process.cwd(), path)
    if (existsSync(fullPath)) {
      const module = await import(fullPath)
      return module.default || module
    }
  }

  return {} // Return empty config if no file found
}
```

## Best Practices

1. **Use TypeScript**: Leverage type checking for configuration validation
2. **Environment Variables**: Use environment variables for sensitive or environment-specific values
3. **Presets**: Create reusable presets for common use cases
4. **Validation**: Always validate configuration before processing
5. **Defaults**: Provide sensible defaults that work for most cases
6. **Documentation**: Document custom configuration options for team members
