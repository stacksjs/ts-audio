<p align="center"><img src="https://github.com/stacksjs/audiox/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

# Audio Processing Made Simple

> A TypeScript-based audio processing library & CLI that wraps ffmpeg, helping you optimize audio files in Node.js/Bun environments.

## Features

- **Audio Conversion & Optimization**
  - Convert between various audio formats (WAV, MP3, AAC)
  - Customize bitrate, sample rate, and channels
  - Optimize audio quality for different use cases

- **Stream Processing**
  - Process audio using Node.js/Bun streams
  - Handle large files efficiently
  - Support for buffer-based processing

- **Metadata Management**
  - Read and write ID3 tags and other metadata
  - Support for common metadata fields
  - Batch metadata operations

- **Developer Experience**
  - Fully typed with TypeScript
  - Intuitive CLI interface
  - Comprehensive documentation
  - Easy integration with existing projects

- **Flexible Usage**
  - Use as a CLI tool
  - Import as a library
  - Configure via config file
  - Override settings per operation

## Quick Start

1. Install FFmpeg and audiox:

```bash
# Install FFmpeg
brew install ffmpeg  # macOS
# or
sudo apt install ffmpeg  # Ubuntu/Debian

# Install audiox
npm install -g @stacksjs/audiox
```

2. Convert an audio file:

```bash
# Using CLI
audiox convert input.mp3 output.wav --codec pcm_s16le --channels 1

# Using library
import { audio } from '@stacksjs/audiox'

await audio('input.mp3', 'output.wav', {
  codec: 'pcm_s16le',
  channels: 1,
})
```

## Contributing

Please review the [Contributing Guide](https://github.com/stacksjs/contributing) for details.

## Stargazers

[![Stargazers over time](https://starchart.cc/stacksjs/audiox.svg?variant=adaptive)](https://starchart.cc/stacksjs/audiox)

## Community

For help, discussion about best practices, or any other conversation that would benefit from being searchable:

[Discussions on GitHub](https://github.com/stacksjs/stacks/discussions)

For casual chit-chat with others using this package:

[Join the Stacks Discord Server](https://discord.gg/stacksjs)

## Postcardware

Two things are true: Stacks OSS will always stay open-source, and we do love to receive postcards from wherever Stacks is used! 🌍 _We also publish them on our website. And thank you, Spatie_

Our address: Stacks.js, 12665 Village Ln #2306, Playa Vista, CA 90094

## Sponsors

We would like to extend our thanks to the following sponsors for funding Stacks development. If you are interested in becoming a sponsor, please reach out to us.

- [JetBrains](https://www.jetbrains.com/)
- [The Solana Foundation](https://solana.com/)

## Credits

- [Chris Breuer](https://github.com/chrisbbreuer)
- [All Contributors](https://github.com/stacksjs/audiox/graphs/contributors)

## License

The MIT License (MIT). Please see [LICENSE](https://github.com/stacksjs/stacks/tree/main/LICENSE.md) for more information.

Made with 💙
