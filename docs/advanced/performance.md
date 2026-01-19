# Performance Optimization

Optimizing audiox performance is essential for processing large audio files, handling batch operations, and building responsive applications. This guide covers strategies for maximizing throughput and minimizing resource usage.

## Memory Management

### Stream Processing for Large Files

Use streams to process large files without loading them entirely into memory:

```ts
import { audioWithStreamInput, audioWithStreamOut } from '@stacksjs/audiox'

// Process large file with stream input
async function processLargeFile(inputPath: string, outputPath: string) {
  const file = Bun.file(inputPath)
  const stream = file.stream()

  await audioWithStreamInput(stream, outputPath, {
    codec: 'mp3',
    bitrate: '192k',
    channels: 2,
    sampleRate: 44100,
  })
}

// Stream output for memory-efficient processing
async function streamProcess(inputPath: string, outputPath: string) {
  const chunks: Uint8Array[] = []

  await audioWithStreamOut(
    inputPath,
    {
      onProcessDataFlushed: (chunk) => {
        if (chunk) {
          chunks.push(chunk)
        }
      },
      onProcessDataEnd: async (data) => {
        if (data) {
          await Bun.write(outputPath, data)
        }
      },
    },
    {
      codec: 'mp3',
      bitrate: '192k',
    },
  )
}
```

### Buffer Size Optimization

Control memory usage by processing in appropriately sized chunks:

```ts
import { audioWithStreamOut } from '@stacksjs/audiox'

async function processWithChunking(
  inputPath: string,
  outputPath: string,
  chunkSize: number = 1024 * 1024, // 1MB chunks
) {
  const outputFile = Bun.file(outputPath)
  const writer = outputFile.writer()

  await audioWithStreamOut(
    inputPath,
    {
      onProcessDataFlushed: async (chunk) => {
        if (chunk && chunk.length > 0) {
          writer.write(chunk)
          // Flush periodically to manage memory
          if (chunk.length >= chunkSize) {
            await writer.flush()
          }
        }
      },
      onProcessDataEnd: async () => {
        await writer.end()
      },
    },
    {
      codec: 'mp3',
      bitrate: '192k',
    },
  )
}
```

## Parallel Processing

### Concurrent File Processing

Process multiple files simultaneously:

```ts
import { audio } from '@stacksjs/audiox'
import { readdir } from 'node:fs/promises'
import { join, parse } from 'node:path'
import { cpus } from 'node:os'

interface ParallelOptions {
  inputDir: string
  outputDir: string
  concurrency?: number
}

async function parallelProcess(options: ParallelOptions) {
  const { inputDir, outputDir, concurrency = cpus().length } = options

  const files = await readdir(inputDir)
  const audioFiles = files.filter(f =>
    ['.mp3', '.wav', '.flac'].some(ext => f.endsWith(ext)),
  )

  // Process in batches based on CPU count
  const results: Array<{ file: string, success: boolean, time: number }> = []

  for (let i = 0; i < audioFiles.length; i += concurrency) {
    const batch = audioFiles.slice(i, i + concurrency)
    const batchStart = Date.now()

    const batchResults = await Promise.all(
      batch.map(async (file) => {
        const start = Date.now()
        const inputPath = join(inputDir, file)
        const outputPath = join(outputDir, `${parse(file).name}.mp3`)

        try {
          await audio(inputPath, outputPath, {
            codec: 'mp3',
            bitrate: '192k',
          })
          return { file, success: true, time: Date.now() - start }
        }
        catch (error) {
          return { file, success: false, time: Date.now() - start }
        }
      }),
    )

    results.push(...batchResults)
    console.log(`Batch completed in ${Date.now() - batchStart}ms`)
  }

  return results
}
```

### Worker Pool Pattern

Implement a worker pool for sustained parallel processing:

```ts
import { audio } from '@stacksjs/audiox'

interface WorkerTask {
  input: string
  output: string
  options: any
}

class AudioWorkerPool {
  private queue: WorkerTask[] = []
  private activeWorkers = 0
  private maxWorkers: number

  constructor(maxWorkers: number = 4) {
    this.maxWorkers = maxWorkers
  }

  async addTask(task: WorkerTask): Promise<void> {
    this.queue.push(task)
    this.processQueue()
  }

  private async processQueue(): Promise<void> {
    while (this.queue.length > 0 && this.activeWorkers < this.maxWorkers) {
      const task = this.queue.shift()
      if (!task)
        continue

      this.activeWorkers++

      // Process without awaiting to allow parallel execution
      this.processTask(task).finally(() => {
        this.activeWorkers--
        this.processQueue()
      })
    }
  }

  private async processTask(task: WorkerTask): Promise<void> {
    await audio(task.input, task.output, task.options)
  }

  async drain(): Promise<void> {
    // Wait for all tasks to complete
    while (this.queue.length > 0 || this.activeWorkers > 0) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
}

// Usage
const pool = new AudioWorkerPool(4)

for (const file of audioFiles) {
  await pool.addTask({
    input: file,
    output: file.replace('.wav', '.mp3'),
    options: { codec: 'mp3', bitrate: '192k' },
  })
}

await pool.drain()
```

## Codec and Quality Optimization

### Choosing Optimal Codec Settings

Balance quality and performance:

```ts
import { audio } from '@stacksjs/audiox'

// Fast encoding (lower quality)
const fastOptions = {
  codec: 'mp3',
  bitrate: '128k',
  quality: 9, // Fastest encoding
}

// Balanced encoding
const balancedOptions = {
  codec: 'mp3',
  bitrate: '192k',
  quality: 5,
}

// High quality encoding (slower)
const qualityOptions = {
  codec: 'mp3',
  bitrate: '320k',
  quality: 0, // Best quality, slowest
}
```

### Sample Rate Optimization

Avoid unnecessary upsampling:

```ts
import { audio, audioInfo } from '@stacksjs/audiox'

async function optimizedConvert(input: string, output: string) {
  const info = await audioInfo(input)
  const sourceSampleRate = Number.parseInt(info[0]?.sampleRate || '44100')

  // Don't upsample - use source rate or lower
  const targetSampleRate = Math.min(sourceSampleRate, 44100)

  await audio(input, output, {
    codec: 'mp3',
    sampleRate: targetSampleRate,
    bitrate: '192k',
  })
}
```

## Caching Strategies

### Result Caching

Cache processed files to avoid redundant processing:

```ts
import { audio, audioInfo } from '@stacksjs/audiox'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

async function getFileHash(path: string): Promise<string> {
  const content = await readFile(path)
  return createHash('md5').update(content).digest('hex')
}

async function cachedProcess(
  input: string,
  cacheDir: string,
  options: any,
): Promise<string> {
  const hash = await getFileHash(input)
  const optionsHash = createHash('md5')
    .update(JSON.stringify(options))
    .digest('hex')
  const cacheKey = `${hash}-${optionsHash}`
  const cachedPath = `${cacheDir}/${cacheKey}.mp3`

  if (existsSync(cachedPath)) {
    console.log('Cache hit:', cachedPath)
    return cachedPath
  }

  console.log('Cache miss, processing:', input)
  await audio(input, cachedPath, options)
  return cachedPath
}
```

### Metadata Caching

Cache audio file information:

```ts
import { audioInfo } from '@stacksjs/audiox'

const infoCache = new Map<string, any>()

async function getCachedInfo(path: string): Promise<any> {
  if (infoCache.has(path)) {
    return infoCache.get(path)
  }

  const info = await audioInfo(path)
  infoCache.set(path, info)
  return info
}

// Clear cache when needed
function clearInfoCache(): void {
  infoCache.clear()
}
```

## Benchmarking

### Performance Measurement

Measure processing performance:

```ts
import { audio } from '@stacksjs/audiox'

interface BenchmarkResult {
  file: string
  duration: number
  inputSize: number
  outputSize: number
  throughput: number // bytes per second
}

async function benchmark(
  input: string,
  output: string,
  options: any,
): Promise<BenchmarkResult> {
  const inputFile = Bun.file(input)
  const inputSize = inputFile.size

  const start = performance.now()
  await audio(input, output, options)
  const duration = performance.now() - start

  const outputFile = Bun.file(output)
  const outputSize = outputFile.size

  return {
    file: input,
    duration,
    inputSize,
    outputSize,
    throughput: inputSize / (duration / 1000),
  }
}

// Usage
const result = await benchmark('large-file.wav', 'output.mp3', {
  codec: 'mp3',
  bitrate: '192k',
})

console.log(`
  Duration: ${result.duration.toFixed(2)}ms
  Input: ${(result.inputSize / 1024 / 1024).toFixed(2)}MB
  Output: ${(result.outputSize / 1024 / 1024).toFixed(2)}MB
  Throughput: ${(result.throughput / 1024 / 1024).toFixed(2)}MB/s
`)
```

## Resource Monitoring

### Monitor System Resources

Track resource usage during processing:

```ts
import { audio } from '@stacksjs/audiox'
import { cpus, freemem, totalmem } from 'node:os'

function getSystemStats() {
  const cpuUsage = cpus().map(cpu => ({
    model: cpu.model,
    speed: cpu.speed,
    times: cpu.times,
  }))

  return {
    cpuCount: cpus().length,
    freeMemory: freemem(),
    totalMemory: totalmem(),
    memoryUsage: 1 - freemem() / totalmem(),
  }
}

async function monitoredProcess(input: string, output: string, options: any) {
  const beforeStats = getSystemStats()
  console.log('Before:', beforeStats)

  await audio(input, output, options)

  const afterStats = getSystemStats()
  console.log('After:', afterStats)

  console.log(`Memory change: ${(
    (afterStats.memoryUsage - beforeStats.memoryUsage) * 100
  ).toFixed(2)}%`)
}
```

## Best Practices

1. **Use Streams for Large Files**: Avoid loading entire files into memory
2. **Optimize Concurrency**: Match parallel workers to CPU cores
3. **Cache Results**: Avoid reprocessing unchanged files
4. **Profile First**: Measure before optimizing
5. **Choose Appropriate Quality**: Higher quality means slower processing
6. **Avoid Upsampling**: Never increase sample rate unnecessarily
7. **Clean Up Resources**: Release file handles and clear caches
8. **Monitor Memory**: Watch for memory leaks in long-running processes
