/**
 * The container readers that ship with ts-audio, loaded on demand.
 *
 * The format packages are optional peers of core, so core cannot import them
 * at the top level. They are pulled in the first time something needs to read
 * a file, and a package that is not installed is skipped.
 *
 * This lives apart from both `input.ts` and `audio-decode.ts` because both
 * need it and they already depend on each other.
 */

import type { InputFormat } from './demuxer'

/** A sibling package, or null when it is not installed. */
export async function optionalPackage<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load()
  }
  catch {
    return null
  }
}

let cached: InputFormat[] | null = null

/**
 * The installed container readers, strong magic numbers first so that a
 * frame-sniffing reader never claims a file another one owns. The list is
 * worked out once.
 */
export async function defaultInputFormats(): Promise<InputFormat[]> {
  if (cached)
    return cached
  const formats: InputFormat[] = []
  const wav = await optionalPackage(() => import('@ts-audio/wav'))
  if (wav)
    formats.push(new wav.WavInputFormat())
  const flac = await optionalPackage(() => import('@ts-audio/flac'))
  if (flac)
    formats.push(new flac.FlacInputFormat())
  const ogg = await optionalPackage(() => import('@ts-audio/ogg'))
  if (ogg)
    formats.push(new ogg.OggInputFormat())
  const mp3 = await optionalPackage(() => import('@ts-audio/mp3'))
  if (mp3)
    formats.push(new mp3.Mp3InputFormat())
  const aac = await optionalPackage(() => import('@ts-audio/aac'))
  if (aac)
    formats.push(new aac.AacInputFormat())
  cached = formats
  return formats
}
