## Code Style Guidelines

**Scope:** All files matching `**/*.{ts,tsx}`

**Purpose:** Code Style & Structure specifics

### Code Style

- Write concise, functional code with proper types

  ```ts
  // Good
  function mergeConfigs<T>(base: T, override: Partial<T>): T {
    return { ...base, ...override }
  }

  // Avoid
  class ConfigMerger {
    merge(base: any, override: any) {
      return Object.assign({}, base, override)
    }
  }
  ```

- Use Bun native modules when available

  ```ts
  // Good
  import { file } from 'bun'

  // Avoid
  import { readFile } from 'node:fs/promises'
  const config = await file('config.json').json()
  const config = JSON.parse(await readFile('config.json', 'utf-8'))
  ```

- Use descriptive variable names with proper prefixes

  ```ts
  // Good
  const isConfigValid = validateConfig(config)
  const hasCustomOptions = Boolean(options.custom)
  const shouldUseDefaults = !configExists || isConfigEmpty

  // Avoid
  const valid = check(cfg)
  const custom = !!options.custom
  const defaults = !exists || empty
  ```

- Write proper JSDoc comments for public APIs

  ```ts
  /**
   * Loads configuration from a file or remote endpoint
   * @param options - Configuration options
   * @param options.name - Name of the config file
   * @param options.cwd - Working directory (default: process.cwd())
   * @returns Resolved configuration object
   * @throws {ConfigError} When config loading fails
   * @example
   * ```ts
   * const config = await loadConfig({
   *   name: 'myapp',
   *   defaultConfig: { port: 3000 }
   * })
   * ```
   */
  async function loadConfig<T>(options: Config<T>): Promise<T>
  ```

- Use proper module organization

  ```ts
  export { ConfigError } from './errors'
  // config.ts
  export { loadConfig } from './loader'
  export type { Config, ConfigOptions } from './types'
  ```

- Follow consistent error handling patterns

  ```ts
  // Good
  const result = await loadConfig(options).catch((error) => {
    console.error('Config loading failed:', error)
    return options.defaultConfig
  })

  // Avoid
  try {
    const result = await loadConfig(options)
  }
  catch (e) {
    console.log('Error:', e)
  }
  ```

- Use proper type assertions

  ```ts
  // Good
  const config = result as Config
  if (!isValidConfig(config))
    throw new Error('Invalid config')

  // Avoid
  const config = result as any
  ```

## Documentation Guidelines

**Scope:** All files matching `**/*.{ts,tsx,md}`

**Purpose:** Documentation specific rules

### API Documentation

- Document all public APIs thoroughly
- Include TypeScript type information
- Provide clear function signatures
- Document config options and defaults
- Include return type information
- Document async behavior

### Configuration Examples

- Provide basic usage examples
- Include complex configuration examples
- Document all supported config formats
- Show browser usage examples
- Include TypeScript configuration examples
- Document config merging behavior

### Type Documentation

- Document generic type parameters
- Explain type constraints
- Document interface properties
- Include type union explanations
- Document type generation features
- Provide type utility examples

### Error Documentation

- Document common error scenarios
- Include error handling examples
- Document error recovery options
- Explain validation errors
- Document browser-specific errors
- Include troubleshooting guides

### Code Examples

- Include runnable code examples
- Provide TypeScript examples
- Show error handling patterns
- Include browser environment examples
- Document testing approaches
- Include CLI usage examples

### Best Practices

- Keep documentation up to date
- Use consistent formatting
- Include inline code comments
- Document breaking changes
- Maintain a changelog
- Include version information

### File Structure

- Maintain clear docs organization
- Use proper markdown formatting
- Include table of contents
- Organize by topic
- Keep related docs together
- Use proper headings

### Documentation Standards

- Use clear and concise language
- Include proper code blocks
- Document all parameters
- Provide return value descriptions
- Include usage notes
- Document dependencies
- Keep examples current

## Error Handling Guidelines

**Scope:** All files matching `**/*.{ts,tsx}`

**Purpose:** Error Handling and Validation specifics

### Error Handling

- Use early returns and guard clauses for validation

  ```ts
  function loadConfig<T>(options: Config<T>) {
    if (!options.name)
      throw new Error('Config name is required')

    if (!isObject(options.defaultConfig))
      throw new Error('Default config must be an object')

    // Continue with valid input
  }
  ```

- Implement proper error types

  ```ts
  class ConfigError extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly details?: unknown
    ) {
      super(message)
      this.name = 'ConfigError'
    }
  }
  ```

- Use descriptive error messages

  ```ts
  throw new ConfigError(
    `Failed to load config file: ${filePath}`,
    'CONFIG_LOAD_ERROR',
    { cause: error }
  )
  ```

- Handle async errors properly

  ```ts
  async function loadConfigFile(path: string) {
    try {
      const content = await Bun.file(path).text()
      return JSON.parse(content)
    }
    catch (error) {
      if (error instanceof SyntaxError)
        throw new ConfigError('Invalid JSON in config file', 'PARSE_ERROR')
      throw new ConfigError('Failed to read config file', 'READ_ERROR')
    }
  }
  ```

- Implement proper error logging

  ```ts
  function handleError(error: unknown) {
    if (error instanceof ConfigError) {
      console.error(`[${error.code}] ${error.message}`)
      if (error.details)
        console.debug('Error details:', error.details)
    }
    else {
      console.error('Unexpected error:', error)
    }
  }
  ```

- Use error boundaries for unexpected errors

  ```ts
  try {
    await loadConfig(options)
  }
  catch (error) {
    handleError(error)
    return options.defaultConfig ?? {}
  }
  ```

- Ensure errors are typed when using Result types

  ```ts
  import { err, ok, Result } from 'neverthrow'

  function validateConfig(config: unknown): Result<Config, ConfigError> {
    if (!isValidConfig(config))
      return err(new ConfigError('Invalid config format', 'VALIDATION_ERROR'))
    return ok(config)
  }
  ```

## Key Conventions

**Scope:** All files matching `**/*.{ts,tsx}`

**Purpose:** Key Conventions specifics

### Conventions

- Prefer browser-compatible implementations when possible

  ```ts
  // Good - Browser compatible
  const config = await fetch('/api/config').then(r => r.json())

  // Avoid - Node.js specific
  const config = require('./config')
  ```

- Aim for comprehensive test coverage

  ```ts
  // Test both success and failure cases
  describe('loadConfig', () => {
    it('success case - load config', async () => {})
    it('failure case - handle errors', async () => {})
    it('edge case - malformed config', async () => {})
  })
  ```

- Use proper TypeScript types instead of `any`

  ```ts
  // Good
  function loadConfig<T extends Record<string, unknown>>(options: Config<T>): Promise<T>

  // Avoid
  function loadConfig(options: any): Promise<any>
  ```

- Use consistent error handling and logging

  ```ts
  // Good
  console.error('Failed to load config:', error)
  return options.defaultConfig

  // Avoid
  console.log('Error:', e)
  throw e
  ```

- Follow file naming conventions

  ```text
  config.ts           // Core functionality
  config.test.ts      // Test files
  config.types.ts     // Type definitions
  .{name}.config.ts   // Config files
  ```

- Use proper exports and imports

  ```ts
  // Good
  export { loadConfig } from './loader'
  export type { Config } from './types'

  // Avoid
  export default {
    loadConfig,
    Config,
  }
  ```

- Maintain consistent directory structure

  ```text
  src/           // Source code
  ├─ index.ts    // Main exports
  ├─ types.ts    // Type definitions
  ├─ config.ts   // Configuration
  ├─ merge.ts    // Deep merge
  └─ utils/      // Utilities
  ```

- Follow ESLint rules and maintain consistent style

  ```ts
  // Good - Follow ESLint config
  const config = {
    name: 'app',
    port: 3000,
  }

  // Avoid - Inconsistent style
  const config = { name: 'app', port: 3000 }
  ```

### Project Structure

**Scope:** All files matching `**/*`

**Purpose:** Project Structure specifics

### Root Directory

```text
├─ package.json        # Package configuration
├─ tsconfig.json       # TypeScript configuration
├─ eslint.config.ts    # ESLint configuration
├─ bunfig.toml        # Bun configuration
├─ README.md          # Project documentation
├─ CHANGELOG.md       # Version history
└─ LICENSE.md         # License information
```

### Source Code

```text
src/
├─ index.ts           # Main entry point
├─ types.ts           # Type definitions
├─ config.ts          # Configuration loading
├─ merge.ts           # Deep merge implementation
├─ utils/             # Utility functions
└─ generated/         # Generated type files
```

### Test Files

```text
test/
├─ bunfig.test.ts     # Main test suite
├─ cli.test.ts        # CLI tests
├─ tmp/               # Temporary test files
│  ├─ config/         # Test config files
│  └─ generated/      # Test generated files
└─ fixtures/          # Test fixtures
```

### Documentation

```text
docs/
├─ intro.md           # Introduction guide
├─ usage.md           # Usage documentation
├─ api/               # API documentation
├─ .vitepress/        # VitePress configuration
└─ public/            # Static assets
```

### Development

```text
.vscode/             # VS Code configuration
.github/             # GitHub configuration
├─ workflows/        # CI/CD workflows
└─ FUNDING.yml       # Funding information
.cursor/             # Cursor IDE configuration
└─ rules/           # Project rules
```

### Build Output

```text
dist/
├─ index.js          # Main bundle
├─ index.d.ts        # Type definitions
└─ cli.js           # CLI bundle
```

### Structure Conventions

- Keep related files together
- Use consistent file naming
- Follow module organization patterns
- Maintain clear separation of concerns
- Document directory purposes
- Keep directory structure flat when possible

## Syntax & Formatting Guidelines

- Use consistent indentation (2 spaces)

  ```ts
  // Good
  function loadConfig<T>(options: Config<T>) {
    if (!options.name)
      throw new Error('Config name is required')

    return options.defaultConfig
  }

  // Avoid
  function loadConfig<T>(options: Config<T>) {
    if (!options.name)
      throw new Error('Config name is required')

    return options.defaultConfig
  }
  ```

- Use concise syntax for simple conditionals

  ```ts
  // Good
  if (!options.name)
    throw new Error('Config name is required')

  // Avoid
  if (!options.name) {
    throw new Error('Config name is required')
  }
  ```

- Format function declarations consistently

  ```ts
  // Good
  async function loadConfig<T>(
    options: Config<T>,
    context?: Context
  ): Promise<T> {
    // Implementation
  }

  // Avoid
  async function loadConfig<T>(options: Config<T>, context?: Context): Promise<T> {
    // Implementation
  }
  ```

- Format type definitions clearly

  ```ts
  // Good
  interface Config<T = Record<string, any>> {
    name: string
    cwd?: string
    defaultConfig?: T
    endpoint?: string
  }

  // Avoid
  interface Config<T = Record<string, any>> { name: string, cwd?: string, defaultConfig?: T, endpoint?: string }
  ```

- Use proper spacing in object literals

  ```ts
  // Good
  const config = {
    name: 'app',
    options: {
      port: 3000,
      host: 'localhost',
    },
  }

  // Avoid
  const config = { name: 'app', options: { port: 3000, host: 'localhost' } }
  ```

- Format imports consistently

  ```text
  // Good
  import { describe, expect, it } from 'bun:test'
  // Avoid
  import { describe, expect, it } from 'bun:test'
  import { existsSync, readFileSync } from 'node:fs'

  import { resolve } from 'node:path'
  ```

- Use proper JSDoc formatting

  ```ts
  // Good
  /**
   * Loads configuration from a file
   * @param options - Configuration options
   * @returns Resolved configuration
   */
  function loadConfig(options: Config): Promise<unknown>

  // Avoid
  /**
   * Loads configuration from a file
   * @param options Configuration options
   * @returns Resolved configuration
   */
  function loadConfig(options: Config): Promise<unknown>
  ```

- Format test cases consistently

  ```ts
  // Good
  describe('loadConfig', () => {
    it('should load default config', async () => {
      const result = await loadConfig(options)
      expect(result).toEqual(expected)
    })
  })

  // Avoid
  describe('loadConfig', () => {
    it('should load default config', async () => {
      const result = await loadConfig(options)
      expect(result).toEqual(expected)
    })
  })
  ```

## Testing Guidelines

- Write tests for all public APIs and utilities

  ```ts
  describe('loadConfig', () => {
    it('should load default config when no file exists', async () => {
      const result = await loadConfig({
        name: 'test',
        defaultConfig: { port: 3000 }
      })
      expect(result).toEqual({ port: 3000 })
    })
  })
  ```

- Use proper test organization with describe blocks

  ```ts
  describe('bunfig', () => {
    describe('loadConfig', () => {
      // Config loading tests
    })

    describe('deepMerge', () => {
      // Merge function tests
    })
  })
  ```

- Test edge cases and error scenarios

  ```ts
  it('should handle malformed config files', async () => {
    const result = await loadConfig({
      name: 'invalid',
      defaultConfig: { fallback: true }
    })
    expect(result).toEqual({ fallback: true })
  })
  ```

- Use proper cleanup in tests

  ```ts
  beforeEach(() => {
    // Setup test environment
    if (existsSync(testConfigDir))
      rmSync(testConfigDir, { recursive: true })
    mkdirSync(testConfigDir, { recursive: true })
  })

  afterEach(() => {
    // Cleanup test files
    if (existsSync(testConfigDir))
      rmSync(testConfigDir, { recursive: true })
  })
  ```

- Use Bun's native test modules

  ```ts
  import { describe, expect, it, mock } from 'bun:test'
  ```

- Mock external dependencies properly

  ```ts
  const mockFetch = mock(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ config: 'value' })
    })
  )
  globalThis.fetch = mockFetch
  ```

- Test both success and failure paths

  ```ts
  it('should handle network errors', async () => {
    mockFetch.mockImplementation(() =>
      Promise.reject(new Error('Network error'))
    )
    // Test error handling
  })
  ```

  ## TypeScript Usage

- Use interfaces for configuration objects and public APIs

  ```ts
  // Good
  interface Config<T = Record<string, any>> {
    name: string
    cwd?: string
    defaultConfig?: T
    endpoint?: string
  }

  // Avoid
  interface Config {
    name: string
    // ...
  }
  ```

- Use `as const` for fixed values instead of enums

  ```ts
  // Good
  const CONFIG_EXTENSIONS = ['.ts', '.js', '.mjs', '.cjs', '.json'] as const

  // Avoid
  enum ConfigExtensions {
    TS = '.ts',
    JS = '.js'
  }
  ```

- Use proper generic constraints for type safety

  ```ts
  // Good
  function loadConfig<T extends Record<string, unknown>>(options: Config<T>): Promise<T>

  // Avoid
  function loadConfig<T>(options: Config<T>): Promise<T>
  ```

- Implement strict type checking for config merging

  ```ts
  // Good
  function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T

  // Avoid
  function deepMerge(target: any, source: any): any
  ```

- Use type guards for runtime type checking

  ```ts
  // Good
  function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
  }
  ```

- Export types explicitly for public APIs

  ```ts
  // Good
  export type { Config, ConfigOptions }
  export interface DeepMergeOptions {
    // ...
  }
  ```

## audiox Documentation

**Scope:** General information based on the latest ./README.md content

**Purpose:** Documentation for the audiox package

> A TypeScript-based audio processing library & CLI that wraps ffmpeg, helping you optimize audio files in Node.js/Bun environments.

## Features

- Audio optimizations and conversions
- Stream-based processing support
- Metadata handling
- Multiple output formats _(WAV, MP3, AAC)_
- Configurable audio properties _(bitrate, channels, sample rate)_
- Error handling and detailed logging
- Fully typed with TypeScript

## Install

```bash
bun install @stacksjs/audiox
```

## Get Started

There are two ways of using this tool: as a library or as a CLI.

### Library Usage

Given the npm package is installed:

```ts
import { audio, audioInfo } from '@stacksjs/audiox'

// Basic audio conversion
await audio('input.mp3', 'output.wav', {
  codec: 'pcm_s16le',
  channels: 1,
  sampleRate: 16000,
  bitrate: '160k',
})

// Get audio file information
const info = await audioInfo('audio.mp3')
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

// Convert with metadata
await audio('input.mp3', 'output.mp3', {
  codec: 'mp3',
  bitrate: '192k',
  channels: 2,
  sampleRate: 44100,
  metadata: {
    title: 'My Track',
    artist: 'Artist Name',
    album: 'Album Name',
    year: '2024',
  },
})

// Stream processing
const file = Bun.file('input.mp3')
const stream = file.stream()

await audioWithStreamInput(stream, 'output.wav', {
  codec: 'pcm_s16le',
  bitrate: '128k',
  channels: 1,
  sampleRate: 16000,
})

// Buffer processing
const arrayBuffer = await Bun.file('input.mp3').arrayBuffer()
const wavData = await audioWav(new Uint8Array(arrayBuffer))
await Bun.write('output.wav', wavData)
```

### CLI Usage

Once installed globally or locally in your project, you can use audiox from the command line:

```bash
# Global installation
npm install -g @stacksjs/audiox

# Using npx with local installation
npx audiox [command] [options]

# Using bun
bunx audiox [command] [options]
```

#### Basic Commands

Convert audio files with default settings:

```bash
audiox convert input.mp3 output.wav
```

Get audio file information:

```bash
audiox info input.mp3
```

#### Convert Command Options

```bash
audiox convert <input> <output> [options]

Options:
  --codec <codec>           Audio codec (aac, mp3, pcm_s16le)
  --bitrate <bitrate>       Audio bitrate (e.g., "192k")
  --channels <number>       Number of channels (1, 2, 5.1, 7.1)
  --sample-rate <rate>      Sample rate (8000, 16000, 44100, 48000)
  --quality <number>        Audio quality setting
  -m, --metadata <data>     Set metadata (format: key=value)
  -v, --verbose            Enable verbose output
```

#### Examples

Convert to WAV with specific settings:

```bash
audiox convert input.mp3 output.wav --codec pcm_s16le --channels 1 --sample-rate 16000 --bitrate 128k
```

Convert to MP3 with metadata:

```bash
audiox convert input.wav output.mp3 --codec mp3 --bitrate 192k \
  --metadata title="My Song" \
  --metadata artist="Artist Name" \
  --metadata year=2024
```

Get detailed audio information including metadata:

```bash
audiox info input.mp3 --metadata title,artist,album,year
```

#### Configuration

You can create a `audiox.config.js` or `audiox.config.ts` file in your project root to set default options:

```ts
import type { AudioxOptions } from './src/types'

const config: AudioxOptions = {
  codec: 'mp3',
  bitrate: '192k',
  channels: 2,
  sampleRate: 44100,
  verbose: true
}

export default config
```

The CLI will automatically use these defaults unless overridden by command-line options.

### Advanced Usage

#### Stream Processing with Custom Handlers

```ts
// Process audio with stream output handling
await audioWithStreamOut(
  'input.mp3',
  {
    onProcessDataFlushed: (chunk) => {
      // Handle each chunk of processed audio
      console.log('Processing chunk:', chunk?.length)
    },
    onProcessDataEnd: async (data) => {
      // Handle completed audio data
      await Bun.write('output.wav', data!)
    },
  },
  {
    codec: 'pcm_s16le',
    bitrate: '128k',
    channels: 1,
    sampleRate: 16000,
  },
)
```

#### Detailed Audio Information

```ts
// Get audio information including metadata
const audioInfo = await audioInfo('music.mp3', {
  metadataTags: ['title', 'artist', 'album', 'track', 'genre', 'year'],
})

// Example response:
// [
//   {
//     codec: 'mp3',
//     channels: 2,
//     sampleRate: '44100',
//     bitrate: '192000',
//     duration: '180.5',
//     metadata: {
//       title: 'Song Title',
//       artist: 'Artist Name',
//       album: 'Album Name',
//       track: '1',
//       genre: 'Pop',
//       year: '2024'
//     }
//   }
// ]
```

## Configuration

Audiox can be configured using a `audiox.config.ts` (or `audiox.config.js`) file:

```ts
import type { AudioxConfig } from '@stacksjs/audiox'

const config: AudioxConfig = {
  verbose: true, // Enable detailed logging
  // Default audio settings
  codec: 'mp3',
  bitrate: '192k',
  channels: 2,
  sampleRate: 44100,
}

export default config
```

### Available Options

```ts
interface AudioxOptions {
  codec?: 'aac' | 'mp3' | 'pcm_s16le' | string
  bitrate?: string // e.g., "192k"
  channels?: 1 | 2 | 5.1 | 7.1 | number
  sampleRate?: 8000 | 16000 | 44100 | 48000 | number
  quality?: number
  metadata?: {
    [key: string]: string
  }
  onError?: (error: unknown) => void
  verbose: boolean
}
```
