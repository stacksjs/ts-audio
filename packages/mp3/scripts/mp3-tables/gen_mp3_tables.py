"""Write src/mp3-tables.ts from the PacketVideo MP3 decoder's C source, read as text.

Nothing from the source is compiled or run. The Huffman lookups are small C
functions of shifts and offsets; a tiny evaluator for exactly those
expressions walks every bit pattern through them, which reads each codebook
back as one codeword and length per value. Every codebook must come out a
complete prefix code holding every value once, or this stops.

The synthesis window is stored folded for the decoder's own filter; it is
unfolded into the 512 coefficients D[i] of ISO/IEC 11172-3 Table 3-B.3.

  python3 -I gen_mp3_tables.py <mp3dec src dir> <out .ts>
"""
import re, sys
from fractions import Fraction

src, out_path = sys.argv[1], sys.argv[2]
tables_c = open(f'{src}/pvmp3_tables.cpp').read()
huff_c = open(f'{src}/pvmp3_decode_huff_cw.cpp').read()
scale_c = open(f'{src}/pvmp3_mpeg2_get_scale_data.cpp').read()

def strip_comments(text):
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    return re.sub(r'//[^\n]*', '', text)

tables_c, huff_c, scale_c = map(strip_comments, (tables_c, huff_c, scale_c))

def array_body(text, name):
    m = re.search(r'\b' + name + r'\s*(?:\[[^\]]*\])+\s*=\s*\{', text)
    assert m, name
    i, depth = m.end(), 1
    while depth:
        depth += {'{': 1, '}': -1}.get(text[i], 0)
        i += 1
    return text[m.end():i - 1]

def ints(body):
    return [int(n, 16) if n.lower().startswith('0x') else int(n) for n in re.findall(r'-?(?:0x[0-9a-fA-F]+|\d+)', body)]

# ---------------------------------------------------------------------------
# Huffman lookups

TOKEN = re.compile(r'\s*(0x[0-9a-fA-F]+|\d+|tmp|>>|>=|==|[-+&()])')

def tokenize(expr):
    tokens, at = [], 0
    expr = expr.strip()
    while at < len(expr):
        m = TOKEN.match(expr, at)
        assert m, f'cannot read {expr!r} at {at}'
        tokens.append(m.group(1))
        at = m.end()
        while at < len(expr) and expr[at].isspace():
            at += 1
    return tokens

# C precedence, loosest first, for the operators these functions use.
LEVELS = [['&'], ['=='], ['>='], ['>>'], ['+', '-']]

def parse(tokens):
    pos = 0
    def level(n):
        nonlocal pos
        if n == len(LEVELS):
            return atom()
        left = level(n + 1)
        while pos < len(tokens) and tokens[pos] in LEVELS[n]:
            op = tokens[pos]
            pos += 1
            right = level(n + 1)
            left = (op, left, right)
        return left
    def atom():
        nonlocal pos
        t = tokens[pos]
        pos += 1
        if t == '(':
            node = level(0)
            assert tokens[pos] == ')'
            pos += 1
            return node
        if t == 'tmp':
            return 'tmp'
        return int(t, 16) if t.startswith('0x') else int(t)
    node = level(0)
    assert pos == len(tokens), tokens
    return node

OPS = {'&': lambda a, b: a & b, '==': lambda a, b: int(a == b), '>=': lambda a, b: int(a >= b),
       '>>': lambda a, b: a >> b, '+': lambda a, b: a + b, '-': lambda a, b: a - b}

def compile_expr(node):
    if node == 'tmp':
        return lambda tmp: tmp
    if isinstance(node, int):
        return lambda tmp: node
    op, a, b = node
    fa, fb, f = compile_expr(a), compile_expr(b), OPS[op]
    return lambda tmp: f(fa(tmp), fb(tmp))

def function_body(name):
    m = re.search(r'uint16\s+' + name + r'\s*\([^)]*\)\s*\{', huff_c)
    assert m, name
    i, depth = m.end(), 1
    while depth:
        depth += {'{': 1, '}': -1}.get(huff_c[i], 0)
        i += 1
    return huff_c[m.end():i - 1]

class Body:
    """One function body, read a statement at a time."""

    def __init__(self, text):
        self.text, self.pos = text, 0

    def skip(self):
        while self.pos < len(self.text) and self.text[self.pos].isspace():
            self.pos += 1

    def at(self, pattern):
        self.skip()
        return re.match(pattern, self.text[self.pos:])

    def balanced(self, open_c, close_c):
        self.skip()
        assert self.text[self.pos] == open_c, self.text[self.pos:self.pos + 20]
        depth, start = 0, self.pos
        while True:
            depth += {open_c: 1, close_c: -1}.get(self.text[self.pos], 0)
            self.pos += 1
            if depth == 0:
                return self.text[start + 1:self.pos - 1]

    def condition(self):
        return compile_expr(parse(tokenize(self.balanced('(', ')'))))

    def block(self):
        if self.at(r'\{'):
            inner = Body(self.balanced('{', '}'))
            return inner.all()
        return [self.statement()]

    def all(self):
        out = []
        while self.at(r'\S'):
            out.append(self.statement())
        return out

    def statement(self):
        if self.at(r'if\b'):
            self.pos += 2
            branches = [(self.condition(), self.block())]
            otherwise = []
            while True:
                if m := self.at(r'else\s+if\b'):
                    self.pos += m.end()
                    branches.append((self.condition(), self.block()))
                elif self.at(r'else\b'):
                    self.pos += 4
                    otherwise = self.block()
                    break
                else:
                    break
            return ('if', branches, otherwise)
        end = self.text.index(';', self.pos)
        stmt = ' '.join(self.text[self.pos:end].split())
        self.pos = end + 1
        if m := re.fullmatch(r'tmp = get(?:UpTo9bits|UpTo17bits|Nbits)\(pMainData, (\d+)\)', stmt):
            return ('peek', int(m.group(1)))
        if m := re.fullmatch(r'cw = \*\((huffTable_\d+) \+ tmp\)', stmt):
            return ('table', m.group(1))
        if m := re.fullmatch(r'tmp = (.+)', stmt):
            return ('set', compile_expr(parse(tokenize(m.group(1)))))
        if re.fullmatch(r'(?:uint32|uint16) (?:tmp|cw)|pMainData->usedBits -= .+|return\(cw >> 8\)', stmt):
            return ('skip',)
        raise AssertionError(f'unexpected statement: {stmt}')


def statements(text):
    return Body(text).all()


def run(stmts, state):
    for stmt in stmts:
        kind = stmt[0]
        if kind == 'peek':
            state['bits'] = stmt[1]
        elif kind == 'set':
            state['tmp'] = stmt[1](state['tmp'])
        elif kind == 'table':
            state['table'] = stmt[1]
        elif kind == 'if':
            for cond, body in stmt[1]:
                if cond(state['tmp']):
                    run(body, state)
                    break
            else:
                run(stmt[2], state)

def peek_bits(stmts):
    for stmt in stmts:
        if stmt[0] == 'peek':
            return stmt[1]
    raise AssertionError('no peek')

def read_codebook(number):
    stmts = statements(function_body(f'pvmp3_decode_huff_cw_tab{number}'))
    bits = peek_bits(stmts)
    tables = {}
    codes = {}
    for pattern in range(1 << bits):
        state = {'tmp': pattern, 'table': None}
        run(stmts, state)
        name = state['table']
        if name not in tables:
            tables[name] = ints(array_body(tables_c, name))
        cw = tables[name][state['tmp']]
        length, value = cw & 0xFF, cw >> 8
        assert 0 < length <= bits, (number, pattern, length)
        key = (length, pattern >> (bits - length))
        assert codes.setdefault(key, value) == value, f'table {number}: codeword {key} decodes two ways'
    return codes

def check_complete(number, codes, values):
    kraft = sum(Fraction(1, 1 << length) for length, _ in codes)
    assert kraft == 1, f'table {number}: not a complete prefix code ({kraft})'
    got = sorted(codes.values())
    assert got == sorted(values), f'table {number}: values {got[:8]}...'
    # No codeword is a prefix of another.
    keys = sorted(codes)
    for la, ca in keys:
        for lb, cb in keys:
            if lb > la and cb >> (lb - la) == ca:
                raise AssertionError(f'table {number}: {ca:0{la}b} is a prefix of {cb:0{lb}b}')

PAIR_TABLES = {1: 2, 2: 3, 3: 3, 5: 4, 6: 4, 7: 6, 8: 6, 9: 6, 10: 8, 11: 8, 12: 8, 13: 16, 15: 16, 16: 16, 24: 16}
codebooks = {}
for number, size in PAIR_TABLES.items():
    codes = read_codebook(number)
    check_complete(number, codes, [(x << 4) | y for x in range(size) for y in range(size)])
    codebooks[number] = codes

# Quadruple table A: the function reads six bits; a set first bit is the
# one-bit codeword for 0, otherwise the low five bits index huffTable_32.
quad_a = {(1, 1): 0}
table32 = ints(array_body(tables_c, 'huffTable_32'))
for pattern in range(32):
    cw = table32[pattern]
    length, value = cw & 0xFF, cw >> 8
    key = (length, pattern >> (6 - length))
    assert quad_a.setdefault(key, value) == value
check_complete(32, quad_a, list(range(16)))
assert re.search(r'return\(\(0x0f - tmp\)\)', function_body('pvmp3_decode_huff_cw_tab33')), 'table B is no longer 15 - four bits'

# ---------------------------------------------------------------------------
# Synthesis window

window = [Fraction(v) for v in re.findall(r'Q30_fmt\((-?[\d.]+)F?\)', array_body(tables_c, 'pqmfSynthWin'))]
assert len(window) == 264, len(window)
# Every coefficient is a whole number of 2^-16.
window = [round(v * 65536) for v in window]
D = [None] * 512
def put(i, v):
    assert D[i] is None or D[i] == v, (i, D[i], v)
    D[i] = v
# pvmp3_polyphase_filter_window, for outputs j and 32 - j (j = 1..15): block b of
# the filter's history holds the 32-point DCT of slot b. Output j weighs slot i
# by D[j + 32i] (even i) or -D[j + 32i] (odd i, the V = -X half); output 32 - j
# weighs it by -D[32 - j + 32i].
for j in range(1, 16):
    w = window[16 * (j - 1):16 * j]
    for g in range(4):
        a, b, c, d = w[4 * g:4 * g + 4]
        put(j + 64 * g, a)
        put(j + 480 - 64 * g, b)
        put(j + 64 * g + 32, -c)
        put(j + 448 - 64 * g, d)
        put(512 - j - 64 * g, -a)
        put(32 - j + 64 * g, -b)
        put(480 - j - 64 * g, c)
        put(64 - j + 64 * g, -d)
# Outputs 0 and 16, four slots per group of six.
for group in range(4):
    v = window[240 + 6 * group:246 + 6 * group]
    b = 4 * group
    put(32 * b, v[0])
    put(32 * (b + 1), -v[1])
    put(16 + 32 * (b + 1), -v[2])
    put(32 * (b + 2), v[3])
    put(32 * (b + 3), -v[4])
    put(16 + 32 * (b + 3), -v[5])
# D[16 + 64m] weigh V[16] of each slot, which is always 0.
for i in range(16, 512, 64):
    assert D[i] is None
    D[i] = 0
assert all(v is not None for v in D)
# The window's own symmetry: D[512 - i] = D[i] on multiples of 64, -D[i] elsewhere.
for i in range(1, 512):
    if i % 64 == 16 or (512 - i) % 64 == 16:
        continue
    assert D[512 - i] == (D[i] if i % 64 == 0 else -D[i]), (i, D[i], D[512 - i])

# ---------------------------------------------------------------------------
# Scale factor bands

bands = ints(array_body(tables_c, 'mp3_sfBandIndex'))
assert len(bands) == 9 * (23 + 14), len(bands)
long_bands = [bands[k * 37:k * 37 + 23] for k in range(9)]
short_bands = [bands[k * 37 + 23:k * 37 + 37] for k in range(9)]
for row in long_bands:
    assert row[0] == 0 and row[-1] == 576 and row == sorted(row)
for row in short_bands:
    assert row[0] == 0 and row[-1] == 192 and row == sorted(row)
lsf_partitions = ints(array_body(scale_c, 'nr_of_sfb_block'))
assert len(lsf_partitions) == 72

# ---------------------------------------------------------------------------

def codebook_ts(codes):
    entries = sorted(codes.items(), key=lambda kv: kv[1])
    return ('{ values: [' + ', '.join(str(v) for _, v in entries) + '], lengths: [' + ', '.join(str(k[0]) for k, _ in entries)
            + '], codes: [' + ', '.join(str(k[1]) for k, _ in entries) + '] }')

def rows(values, width=16):
    return '[\n' + ''.join('  ' + ', '.join(str(v) for v in values[i:i + width]) + ',\n' for i in range(0, len(values), width)) + ']'

out = ['''/**
 * MP3 tables (ISO/IEC 11172-3 and 13818-3, Layer III): the Huffman
 * codebooks, the scale factor band edges for every sampling rate, the MPEG-2
 * scale factor partitions and the synthesis window.
 *
 * Derived from the PacketVideo MP3 decoder in the Android Open Source
 * Project, Copyright (C) 1998-2009 PacketVideo, licensed under the Apache
 * License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0). Its
 * lookup tables were read back into one codeword and length per value; each
 * codebook was checked to be a complete prefix code.
 *
 * Generated by scripts/mp3-tables: do not edit by hand.
 */

/** One codebook: each value (x << 4 | y for pairs, vwxy for quadruples), its codeword and length. */
export interface Mp3Codebook {
  values: readonly number[]
  lengths: readonly number[]
  codes: readonly number[]
}

/** The pair codebooks by table number; 0, 4 and 14 have none, 17-23 use 16's and 25-31 use 24's. */
export const MP3_PAIR_CODEBOOKS: Readonly<Record<number, Mp3Codebook>> = {
''']
for number, codes in codebooks.items():
    out.append(f'  {number}: {codebook_ts(codes)},\n')
out.append('}\n\n/** Quadruple codebook A (count1 table 0); table B is four bits, inverted. */\n')
out.append(f'export const MP3_QUAD_CODEBOOK_A: Mp3Codebook = {codebook_ts(quad_a)}\n\n')
out.append('/** Long-block scale factor band edges, by sampling rate index (44.1, 48, 32, 22.05, 24, 16, 11.025, 12, 8 kHz). */\n')
out.append('export const MP3_LONG_BANDS: readonly (readonly number[])[] = [\n' + ''.join('  [' + ', '.join(map(str, r)) + '],\n' for r in long_bands) + ']\n\n')
out.append('/** Short-block scale factor band edges, in one window\'s lines, by sampling rate index. */\n')
out.append('export const MP3_SHORT_BANDS: readonly (readonly number[])[] = [\n' + ''.join('  [' + ', '.join(map(str, r)) + '],\n' for r in short_bands) + ']\n\n')
out.append('/** MPEG-2 scale factor partitions: [table][block kind: long, short, mixed][partition]. */\n')
out.append('export const MP3_LSF_PARTITIONS: readonly (readonly (readonly number[])[])[] = [\n'
           + ''.join('  [' + ', '.join('[' + ', '.join(map(str, lsf_partitions[t * 12 + k * 4:t * 12 + k * 4 + 4])) + ']' for k in range(3)) + '],\n' for t in range(6)) + ']\n\n')
out.append('/** The synthesis window D[i] of ISO/IEC 11172-3 Table 3-B.3, in units of 2^-16. */\n')
out.append(f'export const MP3_SYNTHESIS_WINDOW: Int32Array = new Int32Array({rows(D)})\n')
open(out_path, 'w').write(''.join(out))
print('codebooks', {n: len(c) for n, c in codebooks.items()}, 'quad A', len(quad_a), 'window', len(D))
