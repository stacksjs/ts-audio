# Sources and Targets

Everything that reads audio takes a `Source`, and everything that writes takes a
`Target`. Both are plain descriptors, so you can hand ts-audio a buffer, a path,
a URL or a stream without it caring which.

## Sources

```ts
import { bufferSource, createSource, fileSource, streamSource, urlSource } from '@ts-audio/core'

createSource(bytes) // a Uint8Array or ArrayBuffer
createSource('song.mp3') // a path
createSource('https://example.com/song.mp3') // a URL
streamSource(readable) // a ReadableStream<Uint8Array>
```

`createSource` picks for you: a string beginning `http://` or `https://` becomes
a URL source, any other string a file source. The explicit constructors are
there when you want to be sure.

### What a source can tell you

```ts
import { getSourceSize, readSourceBuffer, supportsSeek } from '@ts-audio/core'

await getSourceSize(source) // bytes, or null when unknown
supportsSeek(source) // false for streams
await readSourceBuffer(source) // the whole thing
```

A stream cannot be seeked or sized, which matters for the formats that need to
look ahead. Where a reader needs to seek, give it a buffer, file or URL source.

## Targets

```ts
import { bufferTarget, createTarget, fileTarget, streamTarget, writeToTarget } from '@ts-audio/core'

const target = bufferTarget() // collect in memory
await writeToTarget(fileTarget('out.wav'), bytes)
```

## The reader underneath

`Reader` is what the demuxers use: it caches slices, so reading a header and
then seeking does not re-fetch the file.

```ts
import { Reader } from '@ts-audio/core'

const reader = Reader.fromFile('song.flac')
await reader.init()
const header = await reader.readBytes(4)
reader.position = 0
await reader.close()
```

`Reader.fromBuffer`, `.fromFile` and `.fromUrl` are the shortcuts. For a URL
source it uses a `HEAD` request for the size.

## Bit-level reading and writing

The formats are built on these, and they are exported in case you need them:

```ts
import { BitReader, BitWriter, crc16, crc32, crc8 } from '@ts-audio/core'

const bits = new BitReader(bytes)
bits.readBits(14) // most significant first
```

FLAC's CRCs are `crc8Flac` and `crc16Flac`; MP3's is `crc16Mp3`.

Note that bit order differs by format: most read most-significant-first, while
Vorbis reads least-significant-first and has its own reader in
`@ts-audio/vorbis`.

## Streaming decode

`decodeAudio` buffers what it needs — for MP3, Ogg and WAV it reads the file
whole, up to 256 MB. For a long file where you want samples as they arrive, read
packets and decode them yourself:

```ts
import { createAudioDecoder, createInput } from '@ts-audio/core'

const input = createInput('long.flac')
const track = (await input.getPrimaryTrack())!
const decoder = await createAudioDecoder(track)
for await (const packet of input.packets(track.id)) {
  const chunk = decoder.decode(packet)
  if (chunk)
    handle(chunk.channels, chunk.sampleRate)
}
decoder.flush?.()
decoder.close?.()
await input.close()
```

See [Decoding Audio](../features/decoding.md).
