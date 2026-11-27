#!/bin/sh
# Rebuilds the speech fixture with macOS's own speech synthesiser and Apple's
# audio converter (no ffmpeg): a plain WAV upload as Apple writes one, with
# its FLLR padding chunk before the samples, which the reader has to walk
# past.
#
#   sh test/fixtures/voice/make-voice-fixtures.sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap "rm -rf '$tmp'" EXIT
say -o "$tmp/speech.aiff" "Felt strong today. Knee is fine."
afconvert -f WAVE -d LEI16@22050 -c 1 "$tmp/speech.aiff" "$here/speech-s16-22k-mono.wav"
