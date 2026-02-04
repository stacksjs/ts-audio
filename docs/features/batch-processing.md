# Batch Processing

Audiox supports batch processing of multiple audio files, enabling efficient workflows for converting, optimizing, or transforming large collections of audio files.

## Basic Batch Conversion

Process multiple files using loops or array methods:

```ts
import { audio } from '@stacksjs/audiox'
import { readdir } from 'node:fs/promises'
import { join, parse } from 'node:path'

// Convert all MP3 files in a directory to WAV
async function batchConvert(inputDir: string, outputDir: string) {
  const files = await readdir(inputDir)
  const mp3Files = files.filter(f => f.endsWith('.mp3'))

  for (const file of mp3Files) {
    const inputPath = join(inputDir, file)
    const outputPath = join(outputDir, `${parse(file).name}.wav`)

    await audio(inputPath, outputPath, {
      codec: 'pcm_s16le',
      channels: 1,
      sampleRate: 16000,
    })

    console.log(`Converted: ${file}`)
  }
}

await batchConvert('./input', './output')
```

## Parallel Processing

Process multiple files concurrently for faster throughput:

```ts
import { audio } from '@stacksjs/audiox'
import { readdir } from 'node:fs/promises'
import { join, parse } from 'node:path'

async function parallelBatchConvert(
  inputDir: string,
  outputDir: string,
  concurrency: number = 4,
) {
  const files = await readdir(inputDir)
  const audioFiles = files.filter(f =>
    ['.mp3', '.wav', '.flac', '.aac'].some(ext => f.endsWith(ext)),
  )

  // Process in batches
  for (let i = 0; i < audioFiles.length; i += concurrency) {
    const batch = audioFiles.slice(i, i + concurrency)

    await Promise.all(
      batch.map(async (file) => {
        const inputPath = join(inputDir, file)
        const outputPath = join(outputDir, `${parse(file).name}.mp3`)

        await audio(inputPath, outputPath, {
          codec: 'mp3',
          bitrate: '192k',
        })

        console.log(`Converted: ${file}`)
      }),
    )
  }
}

await parallelBatchConvert('./input', './output', 4)
```

## Batch Processing with Options

Apply different settings based on file characteristics:

```ts
import { audio, audioInfo } from '@stacksjs/audiox'
import { readdir, stat } from 'node:fs/promises'
import { join, parse } from 'node:path'

interface BatchOptions {
  inputDir: string
  outputDir: string
  format: 'mp3' | 'wav' | 'aac'
  quality: 'high' | 'medium' | 'low'
}

async function smartBatchConvert(options: BatchOptions) {
  const { inputDir, outputDir, format, quality } = options

  const qualitySettings = {
    high: { bitrate: '320k', sampleRate: 48000 },
    medium: { bitrate: '192k', sampleRate: 44100 },
    low: { bitrate: '128k', sampleRate: 44100 },
  }

  const codecMap = {
    mp3: 'mp3',
    wav: 'pcm_s16le',
    aac: 'aac',
  }

  const files = await readdir(inputDir)

  for (const file of files) {
    const inputPath = join(inputDir, file)
    const fileStat = await stat(inputPath)

    if (!fileStat.isFile())
      continue

    // Get input file info
    const info = await audioInfo(inputPath)
    const outputPath = join(outputDir, `${parse(file).name}.${format}`)

    await audio(inputPath, outputPath, {
      codec: codecMap[format],
      ...qualitySettings[quality],
      // Preserve original channel count if stereo
      channels: info[0]?.channels || 2,
    })

    console.log(`Converted: ${file} -> ${parse(outputPath).base}`)
  }
}

await smartBatchConvert({
  inputDir: './music',
  outputDir: './converted',
  format: 'mp3',
  quality: 'high',
})
```

## CLI Batch Processing

Use shell commands for batch operations:

```bash
# Convert all MP3 files to WAV using a loop
for file in ./input/*.mp3; do
  audiox convert "$file" "./output/$(basename "${file%.mp3}.wav")" \
    --codec pcm_s16le \
    --channels 1 \
    --sample-rate 16000
done

# Using find for recursive processing
find ./input -name "*.mp3" -exec audiox convert {} ./output/{}.wav \
  --codec pcm_s16le \;
```

## Progress Tracking

Track progress during batch operations:

```ts
import { audio } from '@stacksjs/audiox'
import { readdir } from 'node:fs/promises'
import { join, parse } from 'node:path'

async function batchConvertWithProgress(inputDir: string, outputDir: string) {
  const files = await readdir(inputDir)
  const audioFiles = files.filter(f => f.endsWith('.mp3'))
  const total = audioFiles.length
  let completed = 0

  console.log(`Starting batch conversion of ${total} files...`)

  for (const file of audioFiles) {
    const inputPath = join(inputDir, file)
    const outputPath = join(outputDir, `${parse(file).name}.wav`)

    try {
      await audio(inputPath, outputPath, {
        codec: 'pcm_s16le',
        verbose: false,
      })
      completed++
      const percent = Math.round((completed / total) * 100)
      console.log(`[${percent}%] Converted: ${file}`)
    }
    catch (error) {
      console.error(`Failed to convert ${file}:`, error)
    }
  }

  console.log(`\nCompleted: ${completed}/${total} files`)
}

await batchConvertWithProgress('./input', './output')
```

## Error Handling in Batch Operations

Handle errors gracefully to continue processing:

```ts
import { audio } from '@stacksjs/audiox'
import { readdir } from 'node:fs/promises'
import { join, parse } from 'node:path'

interface BatchResult {
  success: string[]
  failed: Array<{ file: string, error: string }>
}

async function safeBatchConvert(
  inputDir: string,
  outputDir: string,
): Promise<BatchResult> {
  const result: BatchResult = { success: [], failed: [] }
  const files = await readdir(inputDir)
  const audioFiles = files.filter(f => f.endsWith('.mp3'))

  for (const file of audioFiles) {
    const inputPath = join(inputDir, file)
    const outputPath = join(outputDir, `${parse(file).name}.wav`)

    try {
      await audio(inputPath, outputPath, {
        codec: 'pcm_s16le',
        onError: (err) => {
          throw err
        },
      })
      result.success.push(file)
    }
    catch (error) {
      result.failed.push({
        file,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return result
}

const result = await safeBatchConvert('./input', './output')
console.log(`Success: ${result.success.length}`)
console.log(`Failed: ${result.failed.length}`)
result.failed.forEach(f => console.log(`  - ${f.file}: ${f.error}`))
```

## Batch Metadata Application

Apply metadata to multiple files:

```ts
import { audio } from '@stacksjs/audiox'
import { readdir } from 'node:fs/promises'
import { join, parse } from 'node:path'

interface AlbumMetadata {
  artist: string
  album: string
  year: string
}

async function batchApplyMetadata(
  inputDir: string,
  outputDir: string,
  albumMeta: AlbumMetadata,
) {
  const files = await readdir(inputDir)
  const audioFiles = files.filter(f => f.endsWith('.mp3')).sort()

  for (let i = 0; i < audioFiles.length; i++) {
    const file = audioFiles[i]
    const inputPath = join(inputDir, file)
    const outputPath = join(outputDir, file)
    const trackName = parse(file).name

    await audio(inputPath, outputPath, {
      codec: 'mp3',
      bitrate: '320k',
      metadata: {
        ...albumMeta,
        title: trackName,
        track: String(i + 1),
      },
    })

    console.log(`Tagged: ${file}`)
  }
}

await batchApplyMetadata('./album', './tagged', {
  artist: 'Artist Name',
  album: 'Album Title',
  year: '2024',
})
```

## Best Practices

1. **Use Parallel Processing Wisely**: Too many concurrent conversions can overwhelm system resources
2. **Implement Error Recovery**: Continue processing even when individual files fail
3. **Track Progress**: Provide feedback for long-running batch operations
4. **Validate Input Files**: Check file existence and format before processing
5. **Clean Up on Failure**: Remove partial outputs when conversions fail
6. **Consider Memory Usage**: Use streaming for very large files in batch operations
