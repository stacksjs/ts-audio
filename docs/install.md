# Installation

ts-audio is published as a set of packages under the `@ts-audio` scope.
Installing the core package brings the format packages with it.

## As a library

::: code-group

```bash [bun]
bun add @ts-audio/core
```

```bash [npm]
npm install @ts-audio/core
```

```bash [pnpm]
pnpm add @ts-audio/core
```

```bash [yarn]
yarn add @ts-audio/core
```

:::

The format packages are optional peers of core and are loaded on demand. If you
want only some of them, install them explicitly and leave the rest out:

```bash
bun add @ts-audio/core @ts-audio/mp3 @ts-audio/wav
```

A codec whose package is absent is simply not decodable; nothing else breaks.

## As a CLI

```bash
bun add -g @ts-audio/core
```

That puts a `ts-audio` command on your path:

```bash
ts-audio info song.flac
```

Or run it without installing:

::: code-group

```bash [bunx]
bunx @ts-audio/core info song.flac
```

```bash [npx]
npx @ts-audio/core info song.flac
```

:::

## Requirements

Bun, or Node 18 and later. There is nothing to compile and no system package to
install — in particular, **no ffmpeg**.

Some optional paths do use what the runtime provides:
`transcodeAudioWithWebCodecs` needs the platform's WebCodecs `AudioEncoder`,
which browsers have and Bun currently does not.

## Next

- [Usage](./usage.md)
