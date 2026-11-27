---
layout: home

hero:
  name: "ts-audio"
  text: "Audio in TypeScript, nothing native."
  tagline: "Read and write the containers audio arrives in, and decode five codecs to samples. No ffmpeg, nothing to compile."
  image: /images/logo-white.png
  actions:
    - theme: brand
      text: Get Started
      link: /intro
    - theme: alt
      text: View on GitHub
      link: https://github.com/stacksjs/ts-audio

features:
  - title: "Five Codecs, Decoded Here"
    icon: "🎵"
    details: "MP3, AAC, Opus, FLAC and Vorbis decode to samples in plain TypeScript, plus PCM, which needs no codec."
  - title: "Voice Notes to Text"
    icon: "🗣"
    details: "decodeAudioToWav turns any supported file into the 16 kHz mono WAV a speech-to-text service takes."
  - title: "Lossless Means Exact"
    icon: "🔍"
    details: "FLAC is checked against the MD5 every stream carries of its own audio. It matches or it does not."
  - title: "Containers Both Ways"
    icon: "🔄"
    details: "MP3, WAV and RF64, ADTS AAC, FLAC and Ogg — read and written, with ID3 and Vorbis comments."
  - title: "Nothing To Install"
    icon: "📦"
    details: "No ffmpeg, no native modules, no binary. Codec packages load only when a file needs them."
  - title: "CLI & Library"
    icon: "🛠"
    details: "A ts-audio command for inspecting and converting files, and a fully typed API underneath it."
---
