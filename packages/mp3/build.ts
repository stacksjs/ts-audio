import { build } from 'bun'
import dts from 'bun-plugin-dtsx'

await build({
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  format: 'esm',
  target: 'node',
  minify: true,
  external: ['ts-audio'],
  plugins: [dts()],
})

console.log('Build completed: @ts-audio/mp3')
