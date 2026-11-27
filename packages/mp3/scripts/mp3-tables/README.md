# MP3 tables

`src/mp3-tables.ts` is generated from the PacketVideo MP3 decoder in the
Android Open Source Project (Apache License 2.0). The script reads its C
source as text; nothing from it is compiled or run.

```bash
mkdir -p /tmp/pv-mp3 && curl -sfL "https://android.googlesource.com/platform/frameworks/av/+archive/refs/heads/main/media/module/codecs/mp3dec.tar.gz" | tar -xz -C /tmp/pv-mp3
python3 -I gen_mp3_tables.py /tmp/pv-mp3/src ../../src/mp3-tables.ts
```

The decoder looks its Huffman codewords up with small functions of shifts
and offsets (`pvmp3_decode_huff_cw.cpp`). The script evaluates exactly those
expressions (no `eval`) for every bit pattern, reads each codebook back as one
codeword and length per value, and stops unless every codebook is a complete
prefix code holding every value once.

The decoder stores the synthesis window folded for its own filter
(`pqmfSynthWin`). The script unfolds it into the 512 coefficients D[i] of
ISO/IEC 11172-3 Table 3-B.3, each a whole number of 2^-16, and checks the
window's symmetry.

The table built from the archive fetched on 2026-11-25
(sha256 `ac1868fd7610091bfbf2f32cdfae5d953b064fb4e7cd9a570908f6bd17cc798f`)
is the one committed.
