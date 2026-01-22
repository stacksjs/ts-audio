/**
 * Format registry and detection utilities
 */

import type { Source, FormatInfo } from './types'
import { InputFormat } from './demuxer'
import { OutputFormat } from './muxer'
import { registerInputFormat, getInputFormats, detectFormat as detectInputFormat } from './input'
import { registerOutputFormat, getOutputFormats, getOutputFormat, getOutputFormatByExtension } from './output'

/**
 * Format registry
 */
class FormatRegistry {
  private inputFormats: Map<string, InputFormat> = new Map()
  private outputFormats: Map<string, OutputFormat> = new Map()

  /**
   * Register an input format
   */
  registerInput(format: InputFormat): void {
    this.inputFormats.set(format.name, format)
    registerInputFormat(format)
  }

  /**
   * Register an output format
   */
  registerOutput(format: OutputFormat): void {
    this.outputFormats.set(format.name, format)
    registerOutputFormat(format)
  }

  /**
   * Get input format by name
   */
  getInput(name: string): InputFormat | undefined {
    return this.inputFormats.get(name)
  }

  /**
   * Get output format by name
   */
  getOutput(name: string): OutputFormat | undefined {
    return this.outputFormats.get(name) ?? getOutputFormat(name) ?? undefined
  }

  /**
   * Get all input formats
   */
  getAllInputFormats(): InputFormat[] {
    return [...this.inputFormats.values()]
  }

  /**
   * Get all output formats
   */
  getAllOutputFormats(): OutputFormat[] {
    return [...this.outputFormats.values()]
  }

  /**
   * Detect format from source
   */
  async detect(source: Source): Promise<InputFormat | null> {
    return detectInputFormat(source)
  }

  /**
   * Get format by file extension
   */
  getByExtension(ext: string): { input?: InputFormat; output?: OutputFormat } {
    const normalizedExt = ext.toLowerCase().replace(/^\./, '')

    let input: InputFormat | undefined
    for (const format of this.inputFormats.values()) {
      if (format.extensions.includes(normalizedExt)) {
        input = format
        break
      }
    }

    const output = getOutputFormatByExtension(normalizedExt) ?? undefined

    return { input, output }
  }
}

/**
 * Global format registry
 */
export const formats = new FormatRegistry()

/**
 * Re-export for convenience
 */
export {
  registerInputFormat,
  registerOutputFormat,
  getInputFormats,
  getOutputFormats,
  getOutputFormat,
  getOutputFormatByExtension,
}

/**
 * Get format info from a source
 */
export async function getFormatInfo(source: Source): Promise<FormatInfo | null> {
  const format = await formats.detect(source)
  if (!format) return null

  return {
    name: format.name,
    mimeType: format.mimeType,
    extension: format.extensions[0] ?? '',
    hasAudio: true,
  }
}

/**
 * Check if a format is supported for input
 */
export function isInputSupported(format: string): boolean {
  const normalizedFormat = format.toLowerCase().replace(/^\./, '')
  return formats.getInput(normalizedFormat) !== undefined ||
    formats.getByExtension(normalizedFormat).input !== undefined
}

/**
 * Check if a format is supported for output
 */
export function isOutputSupported(format: string): boolean {
  const normalizedFormat = format.toLowerCase().replace(/^\./, '')
  return formats.getOutput(normalizedFormat) !== undefined ||
    getOutputFormatByExtension(normalizedFormat) !== null
}

/**
 * Get list of supported input extensions
 */
export function getSupportedInputExtensions(): string[] {
  const extensions = new Set<string>()
  for (const format of formats.getAllInputFormats()) {
    for (const ext of format.extensions) {
      extensions.add(ext)
    }
  }
  return [...extensions]
}

/**
 * Get list of supported output extensions
 */
export function getSupportedOutputExtensions(): string[] {
  const extensions = new Set<string>()
  for (const format of formats.getAllOutputFormats()) {
    extensions.add(format.extension)
  }
  return [...extensions]
}
