import json, re, sys
huff = json.load(open(sys.argv[1]))
src = open(sys.argv[2] + '/sfb.cpp').read()
def table(name):
    body = re.search(r'const Int16 %s\[\]\s*=\s*\{(.*?)\};' % name, src, re.S).group(1)
    return [0] + [int(v) for v in re.findall(r'\d+', re.sub(r'/\*.*?\*/', '', body, flags=re.S))]
long_names = ['sfb_96_1024', 'sfb_96_1024', 'sfb_64_1024', 'sfb_48_1024', 'sfb_48_1024', 'sfb_32_1024', 'sfb_24_1024', 'sfb_24_1024', 'sfb_16_1024', 'sfb_16_1024', 'sfb_16_1024', 'sfb_8_1024']
short_names = ['sfb_64_128', 'sfb_64_128', 'sfb_64_128', 'sfb_48_128', 'sfb_48_128', 'sfb_48_128', 'sfb_24_128', 'sfb_24_128', 'sfb_16_128', 'sfb_16_128', 'sfb_16_128', 'sfb_8_128']
expected = [(41, 12), (41, 12), (47, 12), (49, 14), (49, 14), (51, 14), (47, 15), (47, 15), (43, 15), (43, 15), (43, 15), (40, 15)]
longs = {n: table(n) for n in set(long_names)}
shorts = {n: table(n) for n in set(short_names)}
for i, (nl, ns) in enumerate(expected):
    assert len(longs[long_names[i]]) == nl + 1 and longs[long_names[i]][-1] == 1024, (i, len(longs[long_names[i]]))
    assert len(shorts[short_names[i]]) == ns + 1 and shorts[short_names[i]][-1] == 128, (i, len(shorts[short_names[i]]))
def arr(values, width=20):
    rows = [', '.join(str(v) for v in values[i:i + width]) for i in range(0, len(values), width)]
    return '[\n    ' + ',\n    '.join(rows) + ',\n  ]'
out = ['''/**
 * AAC tables (ISO/IEC 14496-3): the Huffman codebooks and the scale factor
 * band edges for every sampling rate.
 *
 * Derived from the PacketVideo AAC decoder in the Android Open Source
 * Project, Copyright (C) 1998-2009 PacketVideo, licensed under the Apache
 * License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0). Its
 * lookup tables were read back into one codeword and length per index; each
 * codebook was checked to be a complete prefix code.
 *
 * Generated: do not edit by hand.
 */

/** One codebook: the codeword and its length in bits, by index. */
export interface AacCodebook {
  codes: readonly number[]
  lengths: readonly number[]
}
''']
for key in ['scalefactor'] + [f'cb{i}' for i in range(1, 12)]:
    codes, lengths = huff[key]
    name = 'AAC_SCALEFACTOR_CODEBOOK' if key == 'scalefactor' else f'AAC_SPECTRAL_CODEBOOK_{key[2:]}'
    out.append(f'export const {name}: AacCodebook = {{\n  codes: {arr(codes, 12)},\n  lengths: {arr(lengths)},\n}}\n')
out.append('/** The spectral codebooks by number (1 to 11); 0 is unused. */')
out.append('export const AAC_SPECTRAL_CODEBOOKS: readonly (AacCodebook | null)[] = [null, ' + ', '.join(f'AAC_SPECTRAL_CODEBOOK_{i}' for i in range(1, 12)) + ']\n')
for kind, names, store in [('LONG', long_names, longs), ('SHORT', short_names, shorts)]:
    uniq = []
    for n in names:
        if n not in uniq: uniq.append(n)
    for n in uniq:
        out.append(f'const {n.upper()} = {arr(store[n])}\n')
    width = '1024' if kind == 'LONG' else '128'
    out.append(f'/** Scale factor band edges of a {"long" if kind == "LONG" else "short"} ({width}-line) window, by sampling frequency index; the last is {width}. */')
    out.append(f'export const AAC_SWB_OFFSETS_{kind}: readonly (readonly number[])[] = [' + ', '.join(n.upper() for n in names) + ']\n')
out.append('/** The highest band TNS may filter, long and short windows, by sampling frequency index (AAC LC). */')
out.append('export const AAC_TNS_MAX_BANDS_LONG: readonly number[] = [31, 31, 34, 40, 42, 51, 46, 46, 42, 42, 42, 39]')
out.append('export const AAC_TNS_MAX_BANDS_SHORT: readonly number[] = [9, 9, 10, 14, 14, 14, 14, 14, 14, 14, 14, 14]\n')
out.append('/** Sampling frequencies by index. */')
out.append('export const AAC_SAMPLE_RATES: readonly number[] = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]')
open(sys.argv[3], 'w').write('\n'.join(out))
print('ok')
