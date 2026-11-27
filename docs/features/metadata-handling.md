# Metadata

Every container's tags are read into one shape, so the same code works whatever
the file is.

## Reading

```ts
import { createInput } from '@ts-audio/core'

const input = createInput('song.mp3')
const metadata = await input.getMetadata()
await input.close()

console.log(metadata.title, metadata.artist, metadata.album, metadata.year)
```

Or from the CLI:

```bash
ts-audio metadata song.mp3
ts-audio metadata album.flac --json
```

## The shape

`AudioMetadata` covers the fields the formats agree on:

```ts
interface AudioMetadata {
  title?: string
  artist?: string
  album?: string
  albumArtist?: string
  composer?: string
  genre?: string
  year?: number
  trackNumber?: number
  trackTotal?: number
  discNumber?: number
  discTotal?: number
  comment?: string
  lyrics?: string
  copyright?: string
  encodedBy?: string
  encoder?: string
  date?: string
  isrc?: string
  bpm?: number
  replayGain?: {
    trackGain?: number
    trackPeak?: number
    albumGain?: number
    albumPeak?: number
  }
  coverArt?: { data: Uint8Array, mimeType: string, description?: string }[]
  custom?: Record<string, string>
}
```

Anything a format carries that does not map onto a named field lands in
`custom`.

## Where it comes from

| Container | Source |
| --- | --- |
| MP3 | ID3v2 frames, falling back to ID3v1 |
| FLAC | Vorbis comments, plus PICTURE blocks for cover art |
| Ogg | Vorbis comments from the comment header |
| WAV | the `LIST`/`INFO` chunk, where present |

The lower-level pieces are exported too, if you want the raw tags:
`parseVorbisComment` and `vorbisCommentToMetadata` from `@ts-audio/flac` and
`@ts-audio/ogg`, `parsePicture` from `@ts-audio/flac`, and the ID3 types from
`@ts-audio/mp3`.

## Cover art

```ts
const [picture] = metadata.coverArt ?? []
if (picture)
  await Bun.write(`cover.${picture.mimeType.split('/')[1]}`, picture.data)
```

## Writing

`Output.setMetadata(metadata)` hands metadata to the muxer, and `Conversion`
carries the input's metadata across by default. How much of it survives depends
on the container: FLAC and Ogg take Vorbis comments, MP3 takes ID3.
