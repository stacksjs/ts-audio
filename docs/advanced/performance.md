# Performance

## Codec packages load on demand

The format packages are optional peers of core, imported the first time a file
needs one. Reading a WAV never loads an Opus decoder, and a deployment that only
handles MP3 never pays for the rest.

`canDecodeAudioCodec(codec)` answers from the codec's name without loading
anything, so you can reject an unsupported upload before touching a decoder.

## Bound what you accept

Decoding is proportional to the audio's length, and the samples are held in
memory — a Float32Array per channel. An hour of 48 kHz stereo is about 1.4 GB of
floats, so for input you did not create, say what you will take:

```ts
await decodeAudio(upload, {
  maxBytes: 50 * 1024 * 1024,
  maxDurationSeconds: 300,
})
```

`maxBytes` is checked before the file is read. `maxDurationSeconds` throws
`AudioTooLongError` as soon as the decoded part exceeds it, not after decoding
the rest — so a long file costs only the part decoded before the limit.

## Decode in pieces where you can

`decodeAudio` returns the whole file's samples. If you are computing something
streaming — a waveform, a level meter, a checksum — read packets and decode them
one at a time instead, and you never hold more than a block:

```ts
const decoder = await createAudioDecoder(track)
for await (const packet of input.packets(track.id)) {
  const chunk = decoder.decode(packet)
  if (chunk) accumulate(chunk)
}
```

See [Sources and Targets](./stream-processing.md) for the full shape.

## What the decoders cost

Rough ordering, slowest first, for the same audio: Vorbis and Opus do the most
work per sample (both run an inverse MDCT over large blocks, and Opus runs two
decoders for hybrid frames), AAC is similar but with smaller frames, MP3 less,
FLAC less again — it is integer-only, with no transform at all — and PCM is a
copy with a scale.

If you control the format and want decode speed, FLAC is the cheapest lossless
choice and MP3 the cheapest lossy one.

## Resampling

`resampleAudio` uses a Kaiser-windowed sinc. Where the two rates have a small
ratio — 44.1 kHz to 16 kHz is 441 to 160 — it builds one filter per output phase
and each sample is a single dot product. Rates with no small ratio fall back to
an interpolated filter table, which is slower. Common rate pairs take the fast
path.

Resampling to 16 kHz mono, as `decodeAudioToWav` does by default, is much
cheaper than resampling up.

## Reading is cached, not re-fetched

`Reader` caches 64 KB slices, so a demuxer reading a header and then seeking
does not re-read the file. For a URL source that matters most — it uses a `HEAD`
request for the size and ranged reads for the rest.

## Avoid conversion for transformations

`Conversion` copies packets; it cannot resample, change channels or re-encode,
and it refuses rather than trying. There is no performance decision to make
here, only a correctness one — see [Conversion](../features/audio-conversion.md).
