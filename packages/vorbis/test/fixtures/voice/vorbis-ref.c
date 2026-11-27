/*
 * The fixtures' oracle: libvorbis itself, the reference implementation.
 *
 * Vorbis is lossy, so unlike FLAC a decode cannot check itself. There is no
 * Vorbis encoder or decoder among macOS's own tools and ffmpeg is not an
 * option here, so the fixtures and the reference decodes they are compared
 * against are both made by libvorbis, through this.
 *
 * Audio is raw interleaved signed 16-bit little-endian on the way in and out;
 * the script beside this handles the WAV framing, so there is no container
 * parsing here.
 *
 *   vorbis-ref encode <raw-in> <ogg-out> <channels> <rate> <quality>
 *   vorbis-ref decode <ogg-in> <raw-out>        # prints "<channels> <rate>"
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <vorbis/vorbisenc.h>
#include <vorbis/vorbisfile.h>

/* One serial number and no timestamps, so a rebuild gives the same bytes. */
#define SERIAL 0x54534155

static int fail(const char *what) {
  fprintf(stderr, "vorbis-ref: %s\n", what);
  return 1;
}

static int write_pages(ogg_stream_state *os, FILE *out, int flush) {
  ogg_page og;
  while (flush ? ogg_stream_flush(os, &og) : ogg_stream_pageout(os, &og)) {
    if (fwrite(og.header, 1, og.header_len, out) != (size_t)og.header_len) return 1;
    if (fwrite(og.body, 1, og.body_len, out) != (size_t)og.body_len) return 1;
  }
  return 0;
}

static int encode(const char *inPath, const char *outPath, int channels, long rate, float quality) {
  FILE *in = fopen(inPath, "rb");
  FILE *out = fopen(outPath, "wb");
  if (!in || !out) return fail("cannot open files");

  vorbis_info vi;
  vorbis_info_init(&vi);
  if (vorbis_encode_init_vbr(&vi, channels, rate, quality)) return fail("vorbis_encode_init_vbr refused those settings");

  vorbis_comment vc;
  vorbis_comment_init(&vc);
  vorbis_comment_add_tag(&vc, "ENCODER", "ts-audio fixtures");

  vorbis_dsp_state vd;
  vorbis_block vb;
  vorbis_analysis_init(&vd, &vi);
  vorbis_block_init(&vd, &vb);

  ogg_stream_state os;
  ogg_stream_init(&os, SERIAL);

  ogg_packet id, comment, setup;
  vorbis_analysis_headerout(&vd, &vc, &id, &comment, &setup);
  ogg_stream_packetin(&os, &id);
  ogg_stream_packetin(&os, &comment);
  ogg_stream_packetin(&os, &setup);
  /* The headers end on their own page, so the audio starts on a fresh one. */
  if (write_pages(&os, out, 1)) return fail("cannot write the header pages");

  const int FRAMES = 1024;
  short *interleaved = malloc(sizeof(short) * FRAMES * channels);
  if (!interleaved) return fail("out of memory");

  for (;;) {
    size_t frames = fread(interleaved, sizeof(short) * channels, FRAMES, in);
    if (frames == 0) {
      /* A zero-length write tells the encoder the stream is over. */
      vorbis_analysis_wrote(&vd, 0);
    }
    else {
      float **buffer = vorbis_analysis_buffer(&vd, (int)frames);
      for (size_t i = 0; i < frames; i++)
        for (int c = 0; c < channels; c++)
          buffer[c][i] = interleaved[i * channels + c] / 32768.0f;
      vorbis_analysis_wrote(&vd, (int)frames);
    }

    while (vorbis_analysis_blockout(&vd, &vb) == 1) {
      vorbis_analysis(&vb, NULL);
      vorbis_bitrate_addblock(&vb);
      ogg_packet packet;
      while (vorbis_bitrate_flushpacket(&vd, &packet)) {
        ogg_stream_packetin(&os, &packet);
        if (write_pages(&os, out, 0)) return fail("cannot write an audio page");
      }
    }
    if (frames == 0) break;
  }

  if (write_pages(&os, out, 1)) return fail("cannot write the last page");

  free(interleaved);
  ogg_stream_clear(&os);
  vorbis_block_clear(&vb);
  vorbis_dsp_clear(&vd);
  vorbis_comment_clear(&vc);
  vorbis_info_clear(&vi);
  fclose(in);
  fclose(out);
  return 0;
}

static int decode(const char *inPath, const char *outPath) {
  OggVorbis_File vf;
  if (ov_fopen(inPath, &vf)) return fail("not an Ogg Vorbis file");
  FILE *out = fopen(outPath, "wb");
  if (!out) return fail("cannot open the output");

  vorbis_info *vi = ov_info(&vf, -1);
  printf("%d %ld\n", vi->channels, vi->rate);

  char buffer[8192];
  int bitstream = 0;
  for (;;) {
    /* Little-endian, 16-bit, signed: what the script reads back. */
    long read = ov_read(&vf, buffer, sizeof buffer, 0, 2, 1, &bitstream);
    if (read == 0) break;
    if (read < 0) return fail("the stream is damaged");
    if (fwrite(buffer, 1, (size_t)read, out) != (size_t)read) return fail("cannot write the output");
  }

  ov_clear(&vf);
  fclose(out);
  return 0;
}

int main(int argc, char **argv) {
  if (argc >= 7 && strcmp(argv[1], "encode") == 0)
    return encode(argv[2], argv[3], atoi(argv[4]), atol(argv[5]), (float)atof(argv[6]));
  if (argc >= 4 && strcmp(argv[1], "decode") == 0)
    return decode(argv[2], argv[3]);
  fprintf(stderr, "usage: vorbis-ref encode <raw-in> <ogg-out> <channels> <rate> <quality>\n");
  fprintf(stderr, "       vorbis-ref decode <ogg-in> <raw-out>\n");
  return 2;
}
