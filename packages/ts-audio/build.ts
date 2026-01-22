import { build } from 'bun'
import dts from 'bun-plugin-dtsx'

await build({
  entrypoints: ['./src/index.ts', './bin/cli.ts'],
  outdir: './dist',
  format: 'esm',
  target: 'node',
  minify: true,
  external: [
    '@ts-audio/mp3',
    '@ts-audio/wav',
    '@ts-audio/aac',
    '@ts-audio/flac',
    '@ts-audio/ogg',
    '@stacksjs/clapp',
  ],
  plugins: [dts()],
})

console.log('Build completed: ts-audio')
