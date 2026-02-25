/* eslint-disable no-console, ts/no-top-level-await */
import { build } from 'bun'
import dts from 'bun-plugin-dtsx'

await build({
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  format: 'esm',
  target: 'node',
  minify: true,
  root: './src',
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

await build({
  entrypoints: ['./bin/cli.ts'],
  outdir: './dist/bin',
  format: 'esm',
  target: 'node',
  minify: true,
  root: './bin',
  external: [
    '@ts-audio/mp3',
    '@ts-audio/wav',
    '@ts-audio/aac',
    '@ts-audio/flac',
    '@ts-audio/ogg',
    '@stacksjs/clapp',
  ],
})

// Add shebang to CLI
const cliPath = './dist/bin/cli.js'
const cliContent = await Bun.file(cliPath).text()
if (!cliContent.startsWith('#!')) {
  await Bun.write(cliPath, `#!/usr/bin/env bun
${cliContent}`)
}

console.log('Build completed: ts-audio')
