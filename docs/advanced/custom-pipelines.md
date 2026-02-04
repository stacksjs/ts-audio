# Custom Pipelines

Audiox supports building custom audio processing pipelines for complex workflows that require multiple processing steps, conditional logic, or integration with external services.

## Pipeline Architecture

A pipeline consists of multiple processing stages that transform audio data:

```ts
import { audio, audioInfo } from '@stacksjs/audiox'

interface PipelineStage {
  name: string
  process: (input: string, output: string) => Promise<void>
}

interface Pipeline {
  stages: PipelineStage[]
  run: (input: string, finalOutput: string) => Promise<void>
}

function createPipeline(stages: PipelineStage[]): Pipeline {
  return {
    stages,
    async run(input: string, finalOutput: string) {
      let currentInput = input

      for (let i = 0; i < stages.length; i++) {
        const stage = stages[i]
        const isLast = i === stages.length - 1
        const output = isLast ? finalOutput : `/tmp/stage-${i}-${Date.now()}.wav`

        console.log(`Running stage: ${stage.name}`)
        await stage.process(currentInput, output)

        // Clean up intermediate files
        if (i > 0 && currentInput.startsWith('/tmp/')) {
          await Bun.write(currentInput, '') // Clean up
        }

        currentInput = output
      }
    },
  }
}
```

## Basic Pipeline Example

Create a simple multi-stage processing pipeline:

```ts
import { audio } from '@stacksjs/audiox'

const pipeline = createPipeline([
  {
    name: 'Normalize to WAV',
    async process(input, output) {
      await audio(input, output, {
        codec: 'pcm_s16le',
        sampleRate: 44100,
        channels: 2,
      })
    },
  },
  {
    name: 'Convert to Mono',
    async process(input, output) {
      await audio(input, output, {
        codec: 'pcm_s16le',
        channels: 1,
      })
    },
  },
  {
    name: 'Encode to MP3',
    async process(input, output) {
      await audio(input, output, {
        codec: 'mp3',
        bitrate: '192k',
        quality: 2,
      })
    },
  },
])

await pipeline.run('input.flac', 'output.mp3')
```

## Conditional Pipeline

Execute stages based on input file characteristics:

```ts
import { audio, audioInfo } from '@stacksjs/audiox'

interface ConditionalStage {
  name: string
  condition: (info: any) => boolean
  process: (input: string, output: string) => Promise<void>
}

async function runConditionalPipeline(
  input: string,
  output: string,
  stages: ConditionalStage[],
) {
  const info = await audioInfo(input)
  const fileInfo = info[0]

  let currentInput = input
  let stageIndex = 0

  for (const stage of stages) {
    if (!stage.condition(fileInfo)) {
      console.log(`Skipping stage: ${stage.name}`)
      continue
    }

    const isLast = stageIndex === stages.filter(s => s.condition(fileInfo)).length - 1
    const stageOutput = isLast
      ? output
      : `/tmp/conditional-${stageIndex}-${Date.now()}.wav`

    console.log(`Running stage: ${stage.name}`)
    await stage.process(currentInput, stageOutput)
    currentInput = stageOutput
    stageIndex++
  }
}

// Usage
await runConditionalPipeline('input.mp3', 'output.wav', [
  {
    name: 'Downsample High Sample Rate',
    condition: info => Number.parseInt(info.sampleRate) > 48000,
    async process(input, output) {
      await audio(input, output, {
        codec: 'pcm_s16le',
        sampleRate: 48000,
      })
    },
  },
  {
    name: 'Convert Stereo to Mono',
    condition: info => info.channels > 1,
    async process(input, output) {
      await audio(input, output, {
        codec: 'pcm_s16le',
        channels: 1,
      })
    },
  },
  {
    name: 'Final Encoding',
    condition: () => true, // Always run
    async process(input, output) {
      await audio(input, output, {
        codec: 'pcm_s16le',
        sampleRate: 16000,
      })
    },
  },
])
```

## Parallel Processing Pipeline

Process multiple tracks in parallel:

```ts
import { audio } from '@stacksjs/audiox'
import { readdir } from 'node:fs/promises'
import { join, parse } from 'node:path'

interface ParallelPipelineOptions {
  inputDir: string
  outputDir: string
  concurrency: number
  stages: PipelineStage[]
}

async function runParallelPipeline(options: ParallelPipelineOptions) {
  const { inputDir, outputDir, concurrency, stages } = options
  const files = await readdir(inputDir)
  const audioFiles = files.filter(f =>
    ['.mp3', '.wav', '.flac'].some(ext => f.endsWith(ext)),
  )

  const pipeline = createPipeline(stages)

  // Process in batches
  for (let i = 0; i < audioFiles.length; i += concurrency) {
    const batch = audioFiles.slice(i, i + concurrency)

    await Promise.all(
      batch.map(async (file) => {
        const input = join(inputDir, file)
        const output = join(outputDir, `${parse(file).name}.mp3`)
        await pipeline.run(input, output)
        console.log(`Completed: ${file}`)
      }),
    )
  }
}

// Usage
await runParallelPipeline({
  inputDir: './raw-audio',
  outputDir: './processed',
  concurrency: 4,
  stages: [
    {
      name: 'Normalize',
      async process(input, output) {
        await audio(input, output, {
          codec: 'pcm_s16le',
          sampleRate: 44100,
        })
      },
    },
    {
      name: 'Encode MP3',
      async process(input, output) {
        await audio(input, output, {
          codec: 'mp3',
          bitrate: '192k',
        })
      },
    },
  ],
})
```

## Stream-Based Pipeline

Build pipelines using streams for memory efficiency:

```ts
import { audioWithStreamInput, audioWithStreamOut } from '@stacksjs/audiox'

async function streamPipeline(inputPath: string, outputPath: string) {
  const chunks: Uint8Array[] = []

  // Stage 1: Read and process to intermediate format
  const file = Bun.file(inputPath)
  const stream = file.stream()

  await audioWithStreamInput(stream, '/tmp/intermediate.wav', {
    codec: 'pcm_s16le',
    sampleRate: 44100,
    channels: 1,
  })

  // Stage 2: Final encoding with stream output
  await audioWithStreamOut(
    '/tmp/intermediate.wav',
    {
      onProcessDataFlushed: (chunk) => {
        if (chunk)
          chunks.push(chunk)
      },
      onProcessDataEnd: async () => {
        const totalLength = chunks.reduce((acc, c) => acc + c.length, 0)
        const result = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of chunks) {
          result.set(chunk, offset)
          offset += chunk.length
        }
        await Bun.write(outputPath, result)
      },
    },
    {
      codec: 'mp3',
      bitrate: '192k',
    },
  )
}
```

## Pipeline with External Services

Integrate external processing services:

```ts
import { audio, audioInfo } from '@stacksjs/audiox'

interface ExternalServiceConfig {
  apiUrl: string
  apiKey: string
}

async function cloudProcessingPipeline(
  input: string,
  output: string,
  serviceConfig: ExternalServiceConfig,
) {
  // Stage 1: Prepare audio for cloud service
  const preparedPath = `/tmp/prepared-${Date.now()}.wav`
  await audio(input, preparedPath, {
    codec: 'pcm_s16le',
    sampleRate: 16000,
    channels: 1,
  })

  // Stage 2: Send to cloud service (example)
  const audioData = await Bun.file(preparedPath).arrayBuffer()

  const response = await fetch(`${serviceConfig.apiUrl}/process`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceConfig.apiKey}`,
      'Content-Type': 'audio/wav',
    },
    body: audioData,
  })

  if (!response.ok) {
    throw new Error(`Cloud service error: ${response.status}`)
  }

  // Stage 3: Process returned audio
  const processedData = await response.arrayBuffer()
  const processedPath = `/tmp/cloud-processed-${Date.now()}.wav`
  await Bun.write(processedPath, processedData)

  // Stage 4: Final encoding
  await audio(processedPath, output, {
    codec: 'mp3',
    bitrate: '192k',
    metadata: {
      comment: 'Processed with cloud service',
    },
  })
}
```

## Pipeline Builder Pattern

Create a fluent API for building pipelines:

```ts
import { audio } from '@stacksjs/audiox'
import type { AudioxOptions } from '@stacksjs/audiox'

class AudioPipelineBuilder {
  private stages: Array<{
    name: string
    options: AudioxOptions
  }> = []

  normalize(sampleRate: number = 44100): this {
    this.stages.push({
      name: 'normalize',
      options: {
        codec: 'pcm_s16le',
        sampleRate,
        channels: 2,
      },
    })
    return this
  }

  toMono(): this {
    this.stages.push({
      name: 'mono',
      options: {
        codec: 'pcm_s16le',
        channels: 1,
      },
    })
    return this
  }

  resample(sampleRate: number): this {
    this.stages.push({
      name: 'resample',
      options: {
        codec: 'pcm_s16le',
        sampleRate,
      },
    })
    return this
  }

  encodeMP3(bitrate: string = '192k'): this {
    this.stages.push({
      name: 'encode-mp3',
      options: {
        codec: 'mp3',
        bitrate,
      },
    })
    return this
  }

  encodeAAC(bitrate: string = '128k'): this {
    this.stages.push({
      name: 'encode-aac',
      options: {
        codec: 'aac',
        bitrate,
      },
    })
    return this
  }

  withMetadata(metadata: Record<string, string>): this {
    if (this.stages.length > 0) {
      const lastStage = this.stages[this.stages.length - 1]
      lastStage.options.metadata = metadata
    }
    return this
  }

  async run(input: string, output: string): Promise<void> {
    let currentInput = input

    for (let i = 0; i < this.stages.length; i++) {
      const stage = this.stages[i]
      const isLast = i === this.stages.length - 1
      const stageOutput = isLast
        ? output
        : `/tmp/pipeline-${stage.name}-${Date.now()}.wav`

      await audio(currentInput, stageOutput, stage.options)
      currentInput = stageOutput
    }
  }
}

// Usage
const pipeline = new AudioPipelineBuilder()
  .normalize(48000)
  .toMono()
  .resample(16000)
  .encodeMP3('128k')
  .withMetadata({
    title: 'Processed Audio',
    comment: 'Pipeline processed',
  })

await pipeline.run('input.flac', 'output.mp3')
```

## Best Practices

1. **Clean Up Intermediate Files**: Always remove temporary files after processing
2. **Error Handling**: Implement proper error handling at each stage
3. **Progress Reporting**: Provide feedback on pipeline progress
4. **Memory Management**: Use streams for large files
5. **Idempotency**: Design stages to be repeatable without side effects
6. **Logging**: Log each stage for debugging and monitoring
