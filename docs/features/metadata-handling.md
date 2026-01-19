# Metadata Handling

Audiox provides comprehensive metadata handling capabilities, allowing you to read, write, and modify audio file metadata including ID3 tags, artist information, album art references, and more.

## Reading Metadata

### Basic Metadata Retrieval

Get audio file information including basic metadata:

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

### Extended Metadata

Request specific metadata tags:

```ts
import { audioInfo } from '@stacksjs/audiox'

const info = await audioInfo('music.mp3', {
  metadataTags: ['title', 'artist', 'album', 'track', 'genre', 'year'],
})

console.log(info)
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

### CLI Metadata Reading

```bash
# Get basic info
audiox info music.mp3

# Get specific metadata fields
audiox info music.mp3 --metadata title,artist,album,year

# Verbose output with all available metadata
audiox info music.mp3 --verbose
```

## Writing Metadata

### Embedding Metadata During Conversion

Add metadata when converting audio files:

```ts
import { audio } from '@stacksjs/audiox'

await audio('input.wav', 'output.mp3', {
  codec: 'mp3',
  bitrate: '320k',
  metadata: {
    title: 'My Song',
    artist: 'Artist Name',
    album: 'Album Title',
    year: '2024',
    track: '1',
    genre: 'Electronic',
  },
})
```

### CLI Metadata Writing

```bash
# Add metadata during conversion
audiox convert input.wav output.mp3 \
  --codec mp3 \
  --bitrate 320k \
  --metadata "title=My Song" \
  --metadata "artist=Artist Name" \
  --metadata "album=Album Title" \
  --metadata "year=2024"

# Alternative format
audiox convert input.wav output.mp3 \
  --codec mp3 \
  --metadata title="My Song",artist="Artist Name",year=2024
```

## Common Metadata Fields

### Standard Tags

| Field | Description | Example |
|-------|-------------|---------|
| `title` | Track title | "Bohemian Rhapsody" |
| `artist` | Performing artist | "Queen" |
| `album` | Album name | "A Night at the Opera" |
| `album_artist` | Album artist | "Queen" |
| `year` | Release year | "1975" |
| `track` | Track number | "11" |
| `disc` | Disc number | "1" |
| `genre` | Music genre | "Rock" |
| `composer` | Composer | "Freddie Mercury" |
| `comment` | Additional comments | "Remastered 2011" |

### Extended Tags

```ts
await audio('input.wav', 'output.mp3', {
  codec: 'mp3',
  metadata: {
    title: 'Track Title',
    artist: 'Artist Name',
    album: 'Album Name',
    album_artist: 'Album Artist',
    year: '2024',
    track: '5',
    disc: '1',
    genre: 'Electronic',
    composer: 'Composer Name',
    publisher: 'Record Label',
    copyright: '2024 Record Label',
    comment: 'Encoded with audiox',
    encoded_by: 'audiox',
  },
})
```

## Batch Metadata Operations

### Apply Consistent Metadata to Multiple Files

```ts
import { audio } from '@stacksjs/audiox'
import { readdir } from 'node:fs/promises'
import { join, parse } from 'node:path'

async function tagAlbum(
  inputDir: string,
  outputDir: string,
  albumInfo: {
    artist: string
    album: string
    year: string
    genre: string
  },
) {
  const files = await readdir(inputDir)
  const audioFiles = files.filter(f => f.endsWith('.mp3')).sort()

  for (let i = 0; i < audioFiles.length; i++) {
    const file = audioFiles[i]
    const inputPath = join(inputDir, file)
    const outputPath = join(outputDir, file)

    // Use filename as track title
    const trackTitle = parse(file).name
      .replace(/^\d+[-_.\s]*/, '') // Remove leading track numbers
      .replace(/[-_]/g, ' ') // Replace separators with spaces
      .trim()

    await audio(inputPath, outputPath, {
      codec: 'mp3',
      bitrate: '320k',
      metadata: {
        ...albumInfo,
        title: trackTitle,
        track: String(i + 1),
      },
    })

    console.log(`Tagged: ${file}`)
  }
}

await tagAlbum('./raw-tracks', './tagged-album', {
  artist: 'The Band',
  album: 'Greatest Hits',
  year: '2024',
  genre: 'Rock',
})
```

### Reading Metadata from Multiple Files

```ts
import { audioInfo } from '@stacksjs/audiox'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

async function scanLibrary(directory: string) {
  const files = await readdir(directory)
  const audioFiles = files.filter(f =>
    ['.mp3', '.flac', '.m4a'].some(ext => f.endsWith(ext)),
  )

  const library = []

  for (const file of audioFiles) {
    const filePath = join(directory, file)
    const info = await audioInfo(filePath, {
      metadataTags: ['title', 'artist', 'album', 'year', 'genre'],
    })

    library.push({
      file,
      ...info[0],
    })
  }

  return library
}

const tracks = await scanLibrary('./music')
console.table(tracks.map(t => ({
  File: t.file,
  Title: t.metadata?.title,
  Artist: t.metadata?.artist,
  Album: t.metadata?.album,
})))
```

## Metadata Preservation

### Preserving Metadata During Conversion

When converting between formats, preserve existing metadata:

```ts
import { audio, audioInfo } from '@stacksjs/audiox'

async function convertWithMetadata(input: string, output: string) {
  // Read existing metadata
  const info = await audioInfo(input, {
    metadataTags: ['title', 'artist', 'album', 'year', 'track', 'genre'],
  })

  const existingMetadata = info[0]?.metadata || {}

  // Convert with preserved metadata
  await audio(input, output, {
    codec: 'mp3',
    bitrate: '320k',
    metadata: existingMetadata,
  })
}

await convertWithMetadata('original.flac', 'converted.mp3')
```

## Configuration Default Metadata

Set default metadata in your configuration file:

```ts
// audiox.config.ts
import type { AudioxOptions } from '@stacksjs/audiox'

const config: AudioxOptions = {
  codec: 'mp3',
  bitrate: '192k',
  metadata: {
    encoded_by: 'My Studio',
    copyright: '2024 My Label',
  },
}

export default config
```

## Best Practices

1. **Consistent Formatting**: Use consistent formatting for metadata fields across your library
2. **Character Encoding**: Ensure proper UTF-8 encoding for international characters
3. **Backup Original Files**: Keep backups before batch metadata operations
4. **Validate Metadata**: Verify metadata was written correctly after conversion
5. **Use Standard Fields**: Stick to standard metadata fields for better compatibility
6. **Handle Missing Data**: Gracefully handle files with missing or incomplete metadata
