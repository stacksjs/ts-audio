# Opus tables

`src/celt-tables.ts` and `src/silk-tables.ts` are generated from
libopus 1.5.2 (BSD 3-clause). The scripts read its C source as text; nothing
from it is compiled or run. `unifdef` (on macOS by default) first reduces the
sources to the floating-point decoder build.

```bash
scripts=$(pwd)   # this folder
mkdir -p /tmp/opus && curl -sfL https://github.com/xiph/opus/archive/refs/tags/v1.5.2.tar.gz | tar -xz -C /tmp/opus
cd /tmp/opus/opus-1.5.2 && mkdir -p flat/celt flat/silk
for f in celt/*.[ch] silk/*.[ch]; do unifdef -UFIXED_POINT -UENABLE_DEEP_PLC -UENABLE_DRED -UENABLE_OSCE -UENABLE_QEXT -UCUSTOM_MODES "$f" > "flat/$f"; done
python3 -I "$scripts/c_arrays.py" /tmp/celt.json flat/celt/modes.c flat/celt/static_modes_float.h flat/celt/cwrs.c flat/celt/quant_bands.c flat/celt/rate.c
python3 -I "$scripts/c_arrays.py" /tmp/silk.json flat/silk/tables_other.c flat/silk/tables_gain.c flat/silk/tables_pitch_lag.c flat/silk/tables_pulses_per_block.c flat/silk/tables_LTP.c flat/silk/tables_NLSF_CB_NB_MB.c flat/silk/tables_NLSF_CB_WB.c flat/silk/table_LSF_cos.c flat/silk/resampler_rom.c flat/silk/pitch_est_tables.c
python3 -I "$scripts/gen_celt_tables.py" /tmp/celt.json "$scripts/../../src/celt-tables.ts"
python3 -I "$scripts/gen_silk_tables.py" /tmp/silk.json "$scripts/../../src/silk-tables.ts"
```

Arrays written with macros (the SILK quantisation offsets, the resampler's
2x coefficients) are set in `gen_silk_tables.py` from libopus's `define.h`
and `resampler_rom.h`.
