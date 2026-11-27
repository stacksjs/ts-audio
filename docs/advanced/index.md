# Advanced

## [Sources and Targets](./stream-processing.md)

Where audio comes from and goes to — buffers, files, URLs and streams — and the
reader underneath them.

## [Delivery Plans](./custom-pipelines.md)

Working out which formats to serve, at what bitrate, for the runtime you are
on: `buildAudioDeliveryPlan`, content negotiation, HLS bundles, chapters,
waveforms and transcripts.

## [Derivatives](./derivatives.md)

Producing several outputs from one source with `generateAudioDerivatives`, and
the WebCodecs path that encodes them where the runtime allows.

## [Performance](./performance.md)

What costs time and memory, and the options that bound both.
