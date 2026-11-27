# Derivatives

One source, several outputs — the usual job for a web app that wants Opus for
browsers that take it and AAC for the rest.

```ts
import { buildAudioDeliveryPlan, detectAudioRuntimeCapabilities, generateAudioDerivatives } from '@ts-audio/core'

const capabilities = await detectAudioRuntimeCapabilities()
const plan = buildAudioDeliveryPlan(sourceProfile, { formats: ['opus', 'aac'] }, capabilities)

const derivatives = await generateAudioDerivatives('song.aac', plan)
for (const { output, bytes } of derivatives)
  await Bun.write(`song.${output.extension}`, bytes)
```

Each planned output is produced the cheapest way it can be: an output marked
`copy` goes through `Conversion`, which just repackages the packets, and one
marked `transcode` goes through WebCodecs.

It calls `assertAudioPlanExecutable` first, so a plan containing something this
runtime cannot encode fails before any work is done rather than part-way
through.

## Options

```ts
await generateAudioDerivatives(source, plan, {
  inputFactory: () => createInput(source),
  outputFactory: output => createOutput(output.extension),
  batchSize: 16,
  signal: controller.signal,
})
```

- `inputFactory` is **required for a stream source with more than one output** —
  a stream can only be read once, so each derivative needs its own. Passing one
  for buffer and file sources is optional.
- `outputFactory` lets you target files instead of buffers.
- `signal` is checked between derivatives.

## Encoding with WebCodecs

Transcoding uses the platform's own codecs:

```ts
import { transcodeAudioWithWebCodecs } from '@ts-audio/core/native-transcode'

const result = await transcodeAudioWithWebCodecs(input, output, {
  codec: 'opus', // 'aac', 'mp3' or 'opus'
  bitrate: 128_000,
})
```

It needs `AudioDecoder`, `AudioEncoder` and `EncodedAudioChunk` in the global
scope, and throws a clear error when they are missing or when the runtime says
the configuration is unsupported. Browsers have them; **Bun does not**, so this
path is for browser and Deno deployments rather than a Bun server.

Where the default bitrate is not given it follows the codec: 128 kbit/s for
Opus, 160 for AAC, 192 for MP3, or the source track's own bitrate if it states
one.

## Without an encoder

If you are on a runtime with no WebCodecs and need samples rather than a
re-encoded file, decode instead:

```ts
import { decodeAudioToWav } from '@ts-audio/core'

const { audio } = await decodeAudioToWav('song.aac') // 16 kHz mono WAV
```

Decoding is implemented entirely in TypeScript and has no runtime requirements.
See [Decoding Audio](../features/decoding.md).
