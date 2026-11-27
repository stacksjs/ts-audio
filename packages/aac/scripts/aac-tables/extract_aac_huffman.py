"""Rebuild AAC Huffman codebooks (codeword, length per index) from PacketVideo's
binary-search decoder, read as text. Nothing from the source is executed."""
import json, re, sys

src_dir = sys.argv[1]
decode = open(f'{src_dir}/decode_huff_cw_binary.cpp').read()
tables_src = open(f'{src_dir}/hcbtables_binary.cpp').read()

def parse_table(name):
    m = re.search(r'const U?Int32 %s\[(\d+)\]\s*=\s*\{(.*?)\};' % re.escape(name), tables_src, re.S)
    body = re.sub(r'/\*.*?\*/', '', m.group(2), flags=re.S)
    values = [int(v, 0) for v in re.findall(r'0x[0-9a-fA-F]+|\d+', body)]
    assert len(values) == int(m.group(1)), (name, len(values), m.group(1))
    return values

def parse_function(fname, table):
    body = re.search(r'Int %s\(.*?\n\}' % re.escape(fname), decode, re.S).group(0)
    body = re.sub(r'/\*.*?\*/', '', body, flags=re.S)
    n = int(re.search(r'get\w*bits\(\s*(\d+)', body).group(1))
    special = None
    m = re.search(r'if \(\(cw >> (\d+)\) == 0\)\s*\{\s*pInputStream->usedBits -= \(\d+ - (\d+)\);\s*return (\d+);', body)
    if m:
        special = (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    branches = [(int(s), int(lim), int(base or 0), int(off or 0)) for s, lim, base, off in
                re.findall(r'\(cw >> (\d+)\) <= (\d+)\)\s*\{\s*tab = \(cw >> \d+\)(?: - (\d+))?(?: \+ (\d+))?;', body)]
    m = re.search(r'else\s*\{\s*tab = cw - (\d+) \+ (\d+);', body)
    final = (int(m.group(1)), int(m.group(2))) if m else None
    tab = parse_table(table)
    codes = {}
    for cw in range(1 << n):
        if special and (cw >> special[0]) == 0:
            value, length = special[2], special[1]
        else:
            for s, lim, base, off in branches:
                if (cw >> s) <= lim:
                    t = (cw >> s) - base + off
                    break
            else:
                assert final, fname
                t = cw - final[0] + final[1]
            entry = tab[t]
            value, length = entry >> 16, entry & 0xFFFF
        code = cw >> (n - length)
        if value in codes:
            assert codes[value] == (code, length), (fname, value, codes[value], (code, length))
        codes[value] = (code, length)
    # A complete prefix code: every bit pattern decodes, and the lengths fill the code space exactly.
    kraft = sum(2.0 ** -length for _, length in codes.values())
    assert abs(kraft - 1) < 1e-12, (fname, kraft)
    items = sorted(codes.items())
    for (a, (ca, la)) in items:
        for (b, (cb, lb)) in items:
            if a != b and la <= lb and (cb >> (lb - la)) == ca:
                raise AssertionError((fname, 'prefix', a, b))
    size = max(codes) + 1
    assert sorted(codes) == list(range(size)), (fname, 'missing indices')
    return [codes[i][0] for i in range(size)], [codes[i][1] for i in range(size)]

out = {}
for i in range(1, 12):
    out[f'cb{i}'] = parse_function(f'decode_huff_cw_tab{i}', f'huff_tab{i}')
out['scalefactor'] = parse_function('decode_huff_scl', 'huff_tab_scl')
for k, (codes, lengths) in out.items():
    print(k, 'entries', len(codes), 'max length', max(lengths))
json.dump(out, open(sys.argv[2], 'w'))
