# Features

## [Decoding Audio](./decoding.md)

Five codecs decoded to samples in TypeScript — MP3, AAC, Opus, FLAC and Vorbis
— plus PCM. `decodeAudio` for a whole file, `decodeAudioToWav` for the 16 kHz
mono WAV speech-to-text wants, and `decodeAudioPackets` for a track you read
yourself.

## [Format Support](./format-support.md)

Which containers are read and written, which codecs are decoded, and what is
refused by name rather than guessed at.

## [Conversion](./audio-conversion.md)

Copying packets between containers, trimming by time, and what `Conversion`
refuses because it would need an encoder.

## [Metadata](./metadata-handling.md)

ID3v1 and ID3v2, Vorbis comments, FLAC pictures, and the common shape they are
all read into.

## [CLI](./cli-usage.md)

`ts-audio info`, `metadata`, `extract`, `formats` and `convert`.
