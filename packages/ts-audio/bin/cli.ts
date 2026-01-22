import { CLI } from '@stacksjs/clapp'
import { version } from '../../../package.json'
import { Input, Output, Conversion, createSource, BufferTarget, formatDuration, formatFileSize, formatBitrate, formatSampleRate, getChannelLayoutName } from '../src'

const cli = new CLI('ts-audio')

cli
  .command('info <input>', 'Display information about an audio file')
  .option('--json', 'Output as JSON', { default: false })
  .option('--verbose', 'Show detailed information', { default: false })
  .example('ts-audio info audio.mp3')
  .example('ts-audio info song.flac --json')
  .action(async (input: string, options: { json?: boolean, verbose?: boolean }) => {
    try {
      const source = createSource(input)
      const inputFile = new Input({ source })

      const [tracks, metadata, duration, format] = await Promise.all([
        inputFile.getTracks(),
        inputFile.getMetadata(),
        inputFile.getDuration(),
        inputFile.getFormatName(),
      ])

      if (options.json) {
        console.log(JSON.stringify({ format, duration, tracks, metadata }, null, 2))
      }
      else {
        console.log(`Format: ${format}`)
        console.log(`Duration: ${formatDuration(duration)}`)
        console.log(`\nTracks (${tracks.length}):`)

        for (const track of tracks) {
          console.log(`  Audio #${track.id}: ${track.codec}`)
          console.log(`    Sample rate: ${formatSampleRate(track.sampleRate)}`)
          console.log(`    Channels: ${track.channels} (${getChannelLayoutName(track.channels)})`)
          if (track.bitDepth) console.log(`    Bit depth: ${track.bitDepth}-bit`)
          if (track.bitrate) console.log(`    Bitrate: ${formatBitrate(track.bitrate)}`)
        }

        if (options.verbose && Object.keys(metadata).length > 0) {
          console.log('\nMetadata:')
          for (const [key, value] of Object.entries(metadata)) {
            if (value !== undefined && key !== 'coverArt') {
              console.log(`  ${key}: ${value}`)
            }
          }

          if (metadata.coverArt && metadata.coverArt.length > 0) {
            console.log(`  Cover Art: ${metadata.coverArt.length} image(s)`)
            for (const art of metadata.coverArt) {
              console.log(`    - ${art.mimeType} (${formatFileSize(art.data.length)})`)
            }
          }
        }
      }

      await inputFile.close()
    }
    catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  })

cli
  .command('convert <input> <output>', 'Convert an audio file to another format')
  .option('--codec <codec>', 'Audio codec (mp3, aac, opus, vorbis, flac, pcm)')
  .option('--bitrate <bitrate>', 'Audio bitrate in kbps')
  .option('--sample-rate <rate>', 'Sample rate in Hz')
  .option('--channels <channels>', 'Number of channels')
  .option('--start <time>', 'Start time (seconds or HH:MM:SS)')
  .option('--end <time>', 'End time (seconds or HH:MM:SS)')
  .option('--normalize', 'Normalize audio levels', { default: false })
  .option('--verbose', 'Show progress', { default: false })
  .example('ts-audio convert input.mp3 output.wav')
  .example('ts-audio convert input.flac output.mp3 --bitrate 320')
  .example('ts-audio convert input.wav output.aac --sample-rate 48000')
  .action(async (input: string, output: string, options: Record<string, unknown>) => {
    try {
      console.log(`Converting ${input} to ${output}...`)

      const inputSource = createSource(input)
      const inputFile = new Input({ source: inputSource })

      const outputExt = output.split('.').pop()?.toLowerCase() ?? 'wav'

      let outputFormat
      switch (outputExt) {
        case 'mp3':
          const { Mp3OutputFormat } = await import('@ts-audio/mp3')
          outputFormat = new Mp3OutputFormat()
          break
        case 'wav':
        case 'wave':
          const { WavOutputFormat } = await import('@ts-audio/wav')
          outputFormat = new WavOutputFormat()
          break
        case 'aac':
        case 'adts':
          const { AacOutputFormat } = await import('@ts-audio/aac')
          outputFormat = new AacOutputFormat()
          break
        case 'flac':
          const { FlacOutputFormat } = await import('@ts-audio/flac')
          outputFormat = new FlacOutputFormat()
          break
        case 'ogg':
        case 'oga':
        case 'opus':
          const { OggOutputFormat } = await import('@ts-audio/ogg')
          outputFormat = new OggOutputFormat()
          break
        default:
          throw new Error(`Unsupported output format: ${outputExt}`)
      }

      const outputFile = new Output({ format: outputFormat })

      const conversionOptions: Record<string, unknown> = {}
      if (options.codec) conversionOptions.audioCodec = options.codec
      if (options.bitrate) conversionOptions.audioBitrate = Number(options.bitrate) * 1000
      if (options.sampleRate) conversionOptions.sampleRate = Number(options.sampleRate)
      if (options.channels) conversionOptions.channels = Number(options.channels)
      if (options.start) conversionOptions.startTime = parseTime(String(options.start))
      if (options.end) conversionOptions.endTime = parseTime(String(options.end))
      if (options.normalize) conversionOptions.normalize = true

      const conversion = await Conversion.init({
        input: inputFile,
        output: outputFile,
        options: conversionOptions,
      })

      if (options.verbose) {
        conversion.onProgress((progress) => {
          const percent = progress.percentage.toFixed(1)
          const time = formatDuration(progress.currentTime)
          const speed = progress.speed ? `(${progress.speed.toFixed(1)}x)` : ''
          process.stdout.write(`\rProgress: ${percent}% (${time}) ${speed}`)
        })
      }

      const result = await conversion.execute()

      const fs = await import('node:fs/promises')
      await fs.writeFile(output, result)

      if (options.verbose) {
        console.log('')
      }
      console.log(`Successfully converted to ${output} (${formatFileSize(result.byteLength)})`)

      await conversion.close()
    }
    catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  })

cli
  .command('extract <input>', 'Extract audio data from a file')
  .option('--output <file>', 'Output file')
  .option('--raw', 'Extract raw audio data without container', { default: false })
  .example('ts-audio extract video.mp4 --output audio.aac')
  .example('ts-audio extract song.ogg --output raw.opus --raw')
  .action(async (input: string, options: { output?: string, raw?: boolean }) => {
    try {
      const source = createSource(input)
      const inputFile = new Input({ source })

      const tracks = await inputFile.getTracks()

      if (tracks.length === 0) {
        throw new Error('No audio tracks found')
      }

      const track = tracks[0]
      console.log(`Extracting ${track.codec} audio from ${input}...`)

      const packets: Uint8Array[] = []
      for await (const packet of inputFile.packets(track.id)) {
        packets.push(packet.data)
      }

      // Concatenate all packets
      const totalLength = packets.reduce((sum, p) => sum + p.length, 0)
      const data = new Uint8Array(totalLength)
      let offset = 0
      for (const packet of packets) {
        data.set(packet, offset)
        offset += packet.length
      }

      const outputPath = options.output ?? `${input.split('.')[0]}.${track.codec}`
      const fs = await import('node:fs/promises')
      await fs.writeFile(outputPath, data)

      console.log(`Extracted ${formatFileSize(data.length)} to ${outputPath}`)

      await inputFile.close()
    }
    catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  })

cli
  .command('formats', 'List supported audio formats')
  .action(() => {
    console.log('Supported Input Formats:')
    console.log('  Audio: mp3, wav, aac, flac, ogg (vorbis/opus)')
    console.log('')
    console.log('Supported Output Formats:')
    console.log('  Audio: mp3, wav, aac, flac, ogg')
    console.log('')
    console.log('Supported Audio Codecs:')
    console.log('  Lossy: mp3, aac, opus, vorbis')
    console.log('  Lossless: flac, wav (pcm), alac')
    console.log('')
    console.log('Sample Rates:')
    console.log('  8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000 Hz')
    console.log('')
    console.log('Bit Depths:')
    console.log('  8-bit, 16-bit, 24-bit, 32-bit (integer)')
    console.log('  32-bit, 64-bit (float)')
  })

cli
  .command('metadata <input>', 'Display audio file metadata')
  .option('--json', 'Output as JSON', { default: false })
  .example('ts-audio metadata song.mp3')
  .example('ts-audio metadata album.flac --json')
  .action(async (input: string, options: { json?: boolean }) => {
    try {
      const source = createSource(input)
      const inputFile = new Input({ source })

      const metadata = await inputFile.getMetadata()

      if (options.json) {
        // Convert coverArt to base64 for JSON output
        const jsonMetadata = { ...metadata }
        if (jsonMetadata.coverArt) {
          jsonMetadata.coverArt = jsonMetadata.coverArt.map(art => ({
            ...art,
            data: `base64:${Buffer.from(art.data).toString('base64').substring(0, 100)}...`,
          })) as typeof jsonMetadata.coverArt
        }
        console.log(JSON.stringify(jsonMetadata, null, 2))
      }
      else {
        if (Object.keys(metadata).length === 0) {
          console.log('No metadata found')
        }
        else {
          for (const [key, value] of Object.entries(metadata)) {
            if (value !== undefined && key !== 'coverArt') {
              console.log(`${formatKey(key)}: ${value}`)
            }
          }

          if (metadata.coverArt && metadata.coverArt.length > 0) {
            console.log(`\nCover Art: ${metadata.coverArt.length} image(s)`)
            for (const art of metadata.coverArt) {
              console.log(`  - ${art.description || 'Unknown'}: ${art.mimeType} (${formatFileSize(art.data.length)})`)
            }
          }
        }
      }

      await inputFile.close()
    }
    catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  })

cli.command('version', 'Show the version').action(() => {
  console.log(version)
})

cli.version(version)
cli.help()
cli.parse()

function parseTime(time: string): number {
  if (time.includes(':')) {
    const parts = time.split(':').map(Number)
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2]
    }
    else if (parts.length === 2) {
      return parts[0] * 60 + parts[1]
    }
  }
  return Number.parseFloat(time)
}

function formatKey(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())
}
