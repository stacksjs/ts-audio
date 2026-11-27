/**
 * `sideEffects: false` is deliberately absent from package.json.
 *
 * With it, Bun 1.3.14 eliminates modules reached only through re-exports and
 * still emits their names in the export list, so dist/index.js exported 78
 * identifiers that were never declared. The build reported success and the
 * package threw on import -- which is what @ts-audio/core@0.1.1 published.
 * Verified by toggling that flag alone: 78 undeclared with it, 0 without;
 * neither minify nor the extra entrypoints made any difference.
 */

/* eslint-disable no-console, ts/no-top-level-await */
import { build } from 'bun'
import dts from 'bun-plugin-dtsx'

await build({
  entrypoints: ['./src/index.ts', './src/delivery-workflow.ts', './src/native-transcode.ts'],
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
    '@ts-audio/opus',
    '@ts-audio/vorbis',
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
    '@ts-audio/opus',
    '@ts-audio/vorbis',
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
