# CI/CD Integration

Integrate audiox into your continuous integration and deployment pipelines for automated audio processing, testing, and deployment workflows.

## GitHub Actions

### Basic Audio Processing Workflow

```yaml
name: Audio Processing

on:
  push:
    paths:
      - 'audio/**'
  workflow_dispatch:

jobs:
  process-audio:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Install FFmpeg
        run: |
          sudo apt-get update
          sudo apt-get install -y ffmpeg

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Install audiox
        run: bun add -g @stacksjs/audiox

      - name: Process audio files
        run: |
          mkdir -p processed
          for file in audio/*.wav; do
            audiox convert "$file" "processed/$(basename "${file%.wav}.mp3")" \
              --codec mp3 \
              --bitrate 192k
          done

      - name: Upload processed audio
        uses: actions/upload-artifact@v4
        with:
          name: processed-audio
          path: processed/
```

### Audio Validation Workflow

```yaml
name: Validate Audio Files

on:
  pull_request:
    paths:
      - 'assets/audio/**'

jobs:
  validate:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Install FFmpeg
        run: sudo apt-get install -y ffmpeg

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: bun install

      - name: Validate audio files
        run: |
          bun run << 'EOF'
          import { audioInfo } from '@stacksjs/audiox'
          import { readdir } from 'node:fs/promises'
          import { join } from 'node:path'

          const audioDir = './assets/audio'
          const files = await readdir(audioDir)
          const audioFiles = files.filter(f => f.endsWith('.mp3'))

          let hasErrors = false

          for (const file of audioFiles) {
            const info = await audioInfo(join(audioDir, file))
            const { sampleRate, bitrate, channels } = info[0] || {}

            // Validate requirements
            if (parseInt(sampleRate) < 44100) {
              console.error(`${file}: Sample rate too low (${sampleRate})`)
              hasErrors = true
            }

            if (parseInt(bitrate) < 128000) {
              console.error(`${file}: Bitrate too low (${bitrate})`)
              hasErrors = true
            }
          }

          if (hasErrors) {
            process.exit(1)
          }

          console.log('All audio files validated successfully')
          EOF
```

### Batch Processing with Matrix

```yaml
name: Batch Audio Processing

on:
  workflow_dispatch:
    inputs:
      quality:
        description: 'Output quality'
        required: true
        default: 'medium'
        type: choice
        options:
          - low
          - medium
          - high

jobs:
  process:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        format: [mp3, aac]

    steps:
      - uses: actions/checkout@v4

      - name: Install FFmpeg
        run: sudo apt-get install -y ffmpeg

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1

      - name: Install audiox
        run: bun add -g @stacksjs/audiox

      - name: Set quality settings
        id: quality
        run: |
          case "${{ github.event.inputs.quality }}" in
            low)
              echo "bitrate=128k" >> $GITHUB_OUTPUT
              ;;
            medium)
              echo "bitrate=192k" >> $GITHUB_OUTPUT
              ;;
            high)
              echo "bitrate=320k" >> $GITHUB_OUTPUT
              ;;
          esac

      - name: Process audio
        run: |
          mkdir -p output/${{ matrix.format }}
          for file in input/*.wav; do
            audiox convert "$file" \
              "output/${{ matrix.format }}/$(basename "${file%.wav}.${{ matrix.format }}")" \
              --codec ${{ matrix.format }} \
              --bitrate ${{ steps.quality.outputs.bitrate }}
          done

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: audio-${{ matrix.format }}
          path: output/${{ matrix.format }}/
```

## GitLab CI

### Basic Pipeline

```yaml
# .gitlab-ci.yml
stages:
  - validate
  - process
  - deploy

variables:
  AUDIO_INPUT_DIR: './audio/raw'
  AUDIO_OUTPUT_DIR: './audio/processed'

validate-audio:
  stage: validate
  image: node:20
  before_script:
    - apt-get update && apt-get install -y ffmpeg
    - npm install -g bun
    - bun add -g @stacksjs/audiox
  script:
    - |
      for file in $AUDIO_INPUT_DIR/*.wav; do
        audiox info "$file"
      done

process-audio:
  stage: process
  image: node:20
  before_script:
    - apt-get update && apt-get install -y ffmpeg
    - npm install -g bun
    - bun add -g @stacksjs/audiox
  script:
    - mkdir -p $AUDIO_OUTPUT_DIR
    - |
      for file in $AUDIO_INPUT_DIR/*.wav; do
        audiox convert "$file" "$AUDIO_OUTPUT_DIR/$(basename "${file%.wav}.mp3")" \
          --codec mp3 \
          --bitrate 192k
      done
  artifacts:
    paths:
      - $AUDIO_OUTPUT_DIR/
    expire_in: 1 week

deploy-audio:
  stage: deploy
  image: node:20
  needs: ['process-audio']
  script:
    - echo "Deploying processed audio files..."
    # Add your deployment commands here
  only:
    - main
```

## Docker Integration

### Dockerfile for Audio Processing

```dockerfile
# Dockerfile
FROM oven/bun:latest

# Install FFmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Install audiox globally
RUN bun add -g @stacksjs/audiox

# Set working directory
WORKDIR /app

# Copy application files
COPY . .

# Install dependencies
RUN bun install

# Default command
CMD ["bun", "run", "process-audio.ts"]
```

### Docker Compose for Processing Pipeline

```yaml
# docker-compose.yml
version: '3.8'

services:
  audio-processor:
    build: .
    volumes:
      - ./input:/app/input
      - ./output:/app/output
    environment:
      - AUDIO_QUALITY=high
      - OUTPUT_FORMAT=mp3

  audio-validator:
    build: .
    volumes:
      - ./output:/app/audio:ro
    command: bun run validate-audio.ts
    depends_on:
      - audio-processor
```

### Processing Script for Docker

```ts
// process-audio.ts
import { audio } from '@stacksjs/audiox'
import { readdir, mkdir } from 'node:fs/promises'
import { join, parse } from 'node:path'
import { existsSync } from 'node:fs'

const inputDir = '/app/input'
const outputDir = '/app/output'
const quality = process.env.AUDIO_QUALITY || 'medium'
const format = process.env.OUTPUT_FORMAT || 'mp3'

const qualitySettings = {
  low: { bitrate: '128k', quality: 7 },
  medium: { bitrate: '192k', quality: 4 },
  high: { bitrate: '320k', quality: 0 },
}

async function main() {
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true })
  }

  const files = await readdir(inputDir)
  const audioFiles = files.filter(f =>
    ['.wav', '.flac', '.mp3'].some(ext => f.endsWith(ext)),
  )

  console.log(`Processing ${audioFiles.length} files...`)

  for (const file of audioFiles) {
    const inputPath = join(inputDir, file)
    const outputPath = join(outputDir, `${parse(file).name}.${format}`)

    await audio(inputPath, outputPath, {
      codec: format,
      ...qualitySettings[quality as keyof typeof qualitySettings],
    })

    console.log(`Processed: ${file}`)
  }

  console.log('Done!')
}

main().catch(console.error)
```

## Pre-commit Hooks

### Validate Audio Before Commit

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: validate-audio
        name: Validate Audio Files
        entry: bash -c 'for f in $(git diff --cached --name-only | grep -E "\.(mp3|wav|flac)$"); do audiox info "$f" || exit 1; done'
        language: system
        types: [file]
        files: \.(mp3|wav|flac)$
```

### Husky Hook

```json
// package.json
{
  "scripts": {
    "precommit": "bun run validate-audio"
  },
  "husky": {
    "hooks": {
      "pre-commit": "npm run precommit"
    }
  }
}
```

## Automated Release Pipeline

### Release with Processed Audio

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build-and-release:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Install dependencies
        run: |
          sudo apt-get install -y ffmpeg
          npm install -g bun
          bun add -g @stacksjs/audiox

      - name: Process audio for release
        run: |
          mkdir -p dist/audio
          for file in assets/audio/*.wav; do
            audiox convert "$file" "dist/audio/$(basename "${file%.wav}.mp3")" \
              --codec mp3 \
              --bitrate 320k \
              --metadata "version=${GITHUB_REF_NAME}"
          done

      - name: Create release
        uses: softprops/action-gh-release@v1
        with:
          files: dist/audio/*
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Best Practices

1. **Cache Dependencies**: Cache FFmpeg and node modules for faster builds
2. **Use Matrix Builds**: Process different formats in parallel
3. **Validate Early**: Check audio files before processing
4. **Artifact Management**: Store processed files appropriately
5. **Environment Variables**: Use environment variables for configuration
6. **Error Handling**: Fail fast on processing errors
7. **Resource Limits**: Set appropriate resource limits in containers
8. **Logging**: Include detailed logging for debugging
