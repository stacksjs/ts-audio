#!/bin/sh
# Rebuilds the AAC voice fixtures with macOS's own speech synthesiser and
# Apple's audio converter (no ffmpeg): what a voice note sounds like as AAC,
# in the ADTS stream @ts-audio/aac reads.
#
# The ref-*.wav files are Apple's own decodes of the same ADTS files, which
# the decoder is checked against. ADTS carries no edit list, so Apple's decode
# holds every frame, the encoder's priming at the start included, and ours
# should match it sample for sample.
#
#   sh test/fixtures/voice/make-aac-fixtures.sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap "rm -rf '$tmp'" EXIT
say -o "$tmp/short.aiff" "Knee is fine."
# The phone app's voice note: AAC-LC, mono, 44.1 kHz.
afconvert -f adts -d aac@44100 -c 1 -b 64000 "$tmp/short.aiff" "$here/voice-aac-lc.aac"
# Stereo at 48 kHz, as Safari and Voice Memos record.
afconvert -f adts -d aac@48000 -c 2 -b 96000 "$tmp/short.aiff" "$here/voice-aac-stereo.aac"
# HE-AAC (SBR), what low bitrates use. Its ADTS header names the core: 22.05 kHz.
afconvert -f adts -d aach@44100 -c 1 -b 32000 "$tmp/short.aiff" "$here/voice-he-aac.aac"
afconvert -f WAVE -d LEI16 "$here/voice-aac-lc.aac" "$here/ref-voice-aac-lc.wav"
afconvert -f WAVE -d LEI16 "$here/voice-aac-stereo.aac" "$here/ref-voice-aac-stereo.wav"
