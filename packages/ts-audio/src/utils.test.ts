import { describe, expect, test } from 'bun:test'
import { formatDuration, formatFileSize, parseDuration } from './utils'

describe('utils', () => {
  test('formatDuration formats seconds correctly', () => {
    expect(formatDuration(0)).toBe('00:00.000')
    expect(formatDuration(61)).toBe('01:01.000')
    expect(formatDuration(3661)).toBe('01:01:01.000')
  })

  test('parseDuration parses time strings', () => {
    expect(parseDuration('01:30')).toBe(90)
    expect(parseDuration('1:00:00')).toBe(3600)
    expect(parseDuration('42.5')).toBe(42.5)
  })

  test('formatFileSize formats bytes', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(1024)).toBe('1.00 KB')
    expect(formatFileSize(1048576)).toBe('1.00 MB')
  })
})
