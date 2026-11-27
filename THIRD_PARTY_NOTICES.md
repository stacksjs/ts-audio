# Third-party notices

ts-audio is MIT licensed. Parts of it are derived from the following works.

## PacketVideo AAC and MP3 decoders (Android Open Source Project)

`packages/aac/src/aac-tables.ts` (the AAC Huffman codebooks and scale factor
band tables) is derived from the PacketVideo AAC decoder, and
`packages/mp3/src/mp3-tables.ts` (the MP3 Huffman codebooks, scale factor band
and partition tables and the synthesis window) from the PacketVideo MP3
decoder, both in the Android Open Source Project.

Neither table is written by hand. `packages/aac/scripts/aac-tables/` and
`packages/mp3/scripts/mp3-tables/` regenerate them from that C source, read as
text; their READMEs give the exact commands.

Copyright (C) 1998-2009 PacketVideo

Licensed under the Apache License, Version 2.0 (the "License"); you may not
use this file except in compliance with the License. You may obtain a copy of
the License at

<http://www.apache.org/licenses/LICENSE-2.0>

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
License for the specific language governing permissions and limitations under
the License.

## libopus

`packages/opus/src/` (the Opus, SILK and CELT decoders and their tables) is
ported from libopus 1.5.2 (<https://opus-codec.org>). The tables in
`celt-tables.ts` and `silk-tables.ts` are generated from that source by
`packages/opus/scripts/opus-tables/`, whose README gives the commands.

Copyright 2001-2023 Xiph.Org, Skype Limited, Octasic, Jean-Marc Valin,
Timothy B. Terriberry, CSIRO, Gregory Maxwell, Mark Borgerding, Erik de
Castro Lopo, Mozilla, Amazon

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

- Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.
- Neither the name of Internet Society, IETF or IETF Trust, nor the names of
  specific contributors, may be used to endorse or promote products derived
  from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
