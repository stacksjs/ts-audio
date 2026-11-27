# Delivery Plans

Serving audio to browsers means deciding which formats to offer, at what
bitrate, and whether this runtime can even produce them. `@ts-audio/core` has
the planning pieces for that, separately from the decoding.

## Planning outputs

```ts
import { buildAudioDeliveryPlan, detectAudioRuntimeCapabilities } from '@ts-audio/core'

const capabilities = await detectAudioRuntimeCapabilities()
const plan = buildAudioDeliveryPlan(
  { codec: 'aac', container: 'aac', duration: 180, sampleRate: 44100, channels: 2 },
  { formats: ['opus', 'aac', 'mp3'], profile: 'music', maxBitrate: 192_000 },
  capabilities,
)
```

Each planned output says what it would take:

```ts
{
  format: 'opus',
  container: 'ogg',
  mimeType: 'audio/ogg; codecs=opus',
  extension: 'ogg',
  bitrate: 128000,
  action: 'transcode',   // or 'copy', when the source already matches
  available: false,      // whether this runtime can do it
  reason: 'No opus encoder is available',
}
```

`action` is `copy` when the source codec and container already match the output,
which needs no encoder at all. Otherwise it is `transcode`, and `available`
depends on what `detectAudioRuntimeCapabilities` found — it asks the platform's
WebCodecs `AudioEncoder` which codecs it supports, and reports none where there
is no `AudioEncoder`, as in Bun today.

To fail early rather than part-way through:

```ts
import { assertAudioPlanExecutable } from '@ts-audio/core'

assertAudioPlanExecutable(plan) // throws naming each unavailable format
```

## Bitrates

```ts
import { recommendAudioBitrate } from '@ts-audio/core'

recommendAudioBitrate('opus', source, 'speech')
```

The `profile` is `'speech'`, `'music'` or `'general'`, and the recommendation
accounts for the codec and the source's channel count. `maxBitrate` on the plan
caps it.

## Content negotiation

Given a plan and an `Accept` header, pick what to serve:

```ts
import { negotiateAudioOutput } from '@ts-audio/core'

const chosen = negotiateAudioOutput(plan.outputs, request.headers.get('accept') ?? '*/*')
```

It honours quality values and prefers more specific media ranges, and only ever
returns an output marked `available`.

## HLS bundles

Given segments you have already produced, `createAudioDeliveryBundle` writes the
playlist and collects the files:

```ts
import { createAudioDeliveryBundle } from '@ts-audio/core/delivery-workflow'

const bundle = await createAudioDeliveryBundle(plan, segments, {
  playlistPath: 'hls/audio.m3u8',
})
// bundle.playlist is the m3u8; bundle.files maps paths to contents
```

Two kinds of protection are supported, and they are mutually exclusive:

- `hlsAes128` encrypts each segment and writes `#EXT-X-KEY:METHOD=AES-128`.
  The key, key URI and IV may each be a value or a function of the segment
  index.
- `drm` writes a `SAMPLE-AES` or `SAMPLE-AES-CTR` key line for FairPlay,
  PlayReady or Widevine. The segments must already be encrypted —
  `segmentsEncrypted` has to be `true`, and clear-key is rejected in favour of
  native AES-128.

## Chapters

```ts
import { normalizeAudioChapters } from '@ts-audio/core/delivery-workflow'

const chapters = normalizeAudioChapters(
  [{ title: 'Intro', startTime: 0 }, { title: 'Verse', startTime: 32 }],
  duration,
)
```

Each chapter's end defaults to the next one's start, or the duration. Overlaps,
empty titles and out-of-range times throw rather than being silently adjusted.

## Waveforms

```ts
import { buildWaveform, decodeAudio } from '@ts-audio/core'

const { channels, sampleRate } = await decodeAudio('song.flac')
const waveform = buildWaveform(channels, sampleRate, { samples: 1000, precision: 4 })
```

The result is a serialisable min/max peak pair per bucket per channel,
normalised against the absolute peak, which is the shape a waveform display
wants. `samples` caps the bucket count and `precision` the decimal places.

## Transcripts

```ts
import { normalizeTranscript } from '@ts-audio/core'

const { language, segments, vtt } = normalizeTranscript({
  language: 'en',
  segments: [{ startTime: 0, endTime: 2.5, text: 'Knee is fine.' }],
})
```

It validates the timing — no overlaps, no empty text, confidence between 0 and 1
— numbers the segments, and renders WebVTT, with `<v speaker>` where a segment
names one.

To avoid paying a provider twice for the same audio:

```ts
import { MemoryTranscriptCache, transcribeWithCache } from '@ts-audio/core/delivery-workflow'

const { transcript, cacheHit } = await transcribeWithCache(
  { audio: bytes, language: 'en' },
  myProvider,
  new MemoryTranscriptCache(),
)
```

The cache key is a SHA-256 of the audio with the provider's name and version, so
a different provider or a new version misses rather than returning a stale
result. Supply your own `TranscriptCache` to persist it.
