/**
 * Utility functions for audio processing
 */

/**
 * Format duration in seconds to HH:MM:SS.mmm
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toFixed(3).padStart(6, '0')}`
  }
  return `${minutes.toString().padStart(2, '0')}:${secs.toFixed(3).padStart(6, '0')}`
}

/**
 * Parse duration string to seconds
 */
export function parseDuration(duration: string): number {
  if (duration.includes(':')) {
    const parts = duration.split(':').map(Number)
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2]
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1]
    }
  }
  return Number.parseFloat(duration)
}

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(unitIndex > 0 ? 2 : 0)} ${units[unitIndex]}`
}

/**
 * Format bitrate in human-readable format
 */
export function formatBitrate(bitsPerSecond: number): string {
  if (bitsPerSecond >= 1_000_000) {
    return `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbps`
  }
  return `${Math.round(bitsPerSecond / 1000)} kbps`
}

/**
 * Format sample rate in human-readable format
 */
export function formatSampleRate(hz: number): string {
  if (hz >= 1000) {
    return `${(hz / 1000).toFixed(1)} kHz`
  }
  return `${hz} Hz`
}

/**
 * Get channel layout name from channel count
 */
export function getChannelLayoutName(channels: number): string {
  switch (channels) {
    case 1: return 'mono'
    case 2: return 'stereo'
    case 3: return '2.1'
    case 4: return '4.0'
    case 5: return '5.0'
    case 6: return '5.1'
    case 7: return '6.1'
    case 8: return '7.1'
    default: return `${channels}ch`
  }
}

/**
 * Concatenate multiple Uint8Arrays
 */
export function concatenateBuffers(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.byteLength, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.byteLength
  }
  return result
}

/**
 * Compare two Uint8Arrays for equality
 */
export function buffersEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Convert Float32Array to Int16Array
 */
export function floatToInt16(samples: Float32Array): Int16Array {
  const result = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    result[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
  }
  return result
}

/**
 * Convert Int16Array to Float32Array
 */
export function int16ToFloat(samples: Int16Array): Float32Array {
  const result = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    result[i] = samples[i] / (samples[i] < 0 ? 0x8000 : 0x7FFF)
  }
  return result
}

/**
 * Interleave multiple channel buffers
 */
export function interleaveChannels(channels: Float32Array[]): Float32Array {
  const numChannels = channels.length
  const numSamples = channels[0].length
  const result = new Float32Array(numChannels * numSamples)

  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      result[i * numChannels + ch] = channels[ch][i]
    }
  }

  return result
}

/**
 * Deinterleave a buffer into separate channels
 */
export function deinterleaveChannels(data: Float32Array, numChannels: number): Float32Array[] {
  const numSamples = data.length / numChannels
  const channels: Float32Array[] = []

  for (let ch = 0; ch < numChannels; ch++) {
    channels[ch] = new Float32Array(numSamples)
  }

  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      channels[ch][i] = data[i * numChannels + ch]
    }
  }

  return channels
}

/**
 * Calculate RMS (Root Mean Square) of audio samples
 */
export function calculateRMS(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i]
  }
  return Math.sqrt(sum / samples.length)
}

/**
 * Calculate peak level of audio samples
 */
export function calculatePeak(samples: Float32Array): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i])
    if (abs > peak) peak = abs
  }
  return peak
}

/**
 * Convert decibels to linear amplitude
 */
export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20)
}

/**
 * Convert linear amplitude to decibels
 */
export function linearToDb(linear: number): number {
  return 20 * Math.log10(Math.max(linear, 1e-10))
}

/**
 * Apply gain to audio samples
 */
export function applyGain(samples: Float32Array, gain: number): Float32Array {
  const result = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    result[i] = samples[i] * gain
  }
  return result
}

/**
 * Mix multiple audio buffers
 */
export function mixBuffers(buffers: Float32Array[]): Float32Array {
  if (buffers.length === 0) return new Float32Array(0)

  const length = Math.max(...buffers.map(b => b.length))
  const result = new Float32Array(length)

  for (const buffer of buffers) {
    for (let i = 0; i < buffer.length; i++) {
      result[i] += buffer[i]
    }
  }

  return result
}

/**
 * Normalize audio to a target peak level
 */
export function normalize(samples: Float32Array, targetPeak = 1.0): Float32Array {
  const peak = calculatePeak(samples)
  if (peak === 0) return samples

  const gain = targetPeak / peak
  return applyGain(samples, gain)
}

/**
 * Apply fade in to audio samples
 */
export function fadeIn(samples: Float32Array, fadeSamples: number): Float32Array {
  const result = new Float32Array(samples)
  for (let i = 0; i < Math.min(fadeSamples, samples.length); i++) {
    result[i] *= i / fadeSamples
  }
  return result
}

/**
 * Apply fade out to audio samples
 */
export function fadeOut(samples: Float32Array, fadeSamples: number): Float32Array {
  const result = new Float32Array(samples)
  const startFade = samples.length - fadeSamples
  for (let i = startFade; i < samples.length; i++) {
    result[i] *= (samples.length - i) / fadeSamples
  }
  return result
}

/**
 * Resample audio data (simple linear interpolation)
 */
export function resampleLinear(
  samples: Float32Array,
  inputRate: number,
  outputRate: number,
): Float32Array {
  if (inputRate === outputRate) return samples

  const ratio = inputRate / outputRate
  const outputLength = Math.floor(samples.length / ratio)
  const result = new Float32Array(outputLength)

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio
    const srcIndexInt = Math.floor(srcIndex)
    const frac = srcIndex - srcIndexInt

    if (srcIndexInt + 1 < samples.length) {
      result[i] = samples[srcIndexInt] * (1 - frac) + samples[srcIndexInt + 1] * frac
    } else {
      result[i] = samples[srcIndexInt]
    }
  }

  return result
}

/**
 * Delay helper for async operations
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Create a memoized version of a function
 */
export function memoize<T extends (...args: unknown[]) => unknown>(fn: T): T {
  const cache = new Map<string, unknown>()
  return ((...args: unknown[]) => {
    const key = JSON.stringify(args)
    if (cache.has(key)) {
      return cache.get(key)
    }
    const result = fn(...args)
    cache.set(key, result)
    return result
  }) as T
}

/**
 * Create an async memoized version of a function
 */
export function memoizeAsync<T extends (...args: unknown[]) => Promise<unknown>>(fn: T): T {
  const cache = new Map<string, Promise<unknown>>()
  return (async (...args: unknown[]) => {
    const key = JSON.stringify(args)
    if (cache.has(key)) {
      return cache.get(key)
    }
    const promise = fn(...args)
    cache.set(key, promise)
    try {
      return await promise
    } catch (error) {
      cache.delete(key)
      throw error
    }
  }) as T
}
