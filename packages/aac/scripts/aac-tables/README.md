# AAC tables

`src/aac-tables.ts` is generated from the PacketVideo AAC decoder in the
Android Open Source Project (Apache License 2.0). The scripts read its C
source as text; nothing from it is compiled or run.

```bash
mkdir -p /tmp/pv-aac && curl -sfL "https://android.googlesource.com/platform/frameworks/base/+archive/refs/tags/android-2.3.7_r1/media/libstagefright/codecs/aacdec.tar.gz" | tar -xz -C /tmp/pv-aac
python3 -I extract_aac_huffman.py /tmp/pv-aac /tmp/aac_huffman.json
python3 -I gen_aac_tables.py /tmp/aac_huffman.json /tmp/pv-aac ../../src/aac-tables.ts
```

`extract_aac_huffman.py` rebuilds each codebook's codeword and length per
index from the decoder's lookup tables and stops unless every codebook is a
complete prefix code with every index present.
