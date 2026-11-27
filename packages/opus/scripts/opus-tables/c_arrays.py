"""Pull named constant arrays out of C source as flat lists of numbers. Text only; nothing is compiled."""
import json, re, sys
def arrays(text):
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    text = re.sub(r'//[^\n]*', '', text)
    out = {}
    for m in re.finditer(r'(?:static\s+)?const\s+[\w\s]+?\s+(\w+)\s*(?:\[[^\]]*\])+\s*=\s*\{', text):
        name = m.group(1); i = m.end(); depth = 1
        while depth:
            depth += {'{': 1, '}': -1}.get(text[i], 0); i += 1
        body = text[m.end():i - 1]
        if re.search(r'[A-Za-z_]\w*', re.sub(r'(?<![\w.])(?:0x[0-9a-fA-F]+|\d+\.?\d*(?:[eE][-+]?\d+)?)[fFuUlL]*', '', body)):
            out[name] = None
            continue
        nums = re.findall(r'(?<![\w.])-?(?:0x[0-9a-fA-F]+|\d+\.?\d*(?:[eE][-+]?\d+)?)[fFuUlL]*', body)
        vals = []
        for n in nums:
            n = n.rstrip('fFuUlL')
            vals.append(int(n, 16) if n.lower().startswith(('0x', '-0x')) else (float(n) if ('.' in n or 'e' in n.lower()) else int(n)))
        out[name] = vals
    return out
result = {}
for path in sys.argv[2:]:
    result.update(arrays(open(path).read()))
json.dump(result, open(sys.argv[1], 'w'))
print(sorted((k, None if v is None else len(v)) for k, v in result.items()))
