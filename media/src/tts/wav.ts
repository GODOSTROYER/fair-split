/**
 * Minimal RIFF/WAVE handling for Gemini TTS output (unary responses are WAV: 24 kHz, mono, 16-bit PCM).
 * Streaming responses are headerless `audio/l16`, which {@link pcmToWav} wraps so ffmpeg can read them.
 */

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataBytes: number;
  durationMs: number;
}

export function parseWav(buf: Uint8Array): WavInfo {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const ascii = (off: number, len: number) => String.fromCharCode(...buf.subarray(off, off + len));
  if (buf.byteLength < 12 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let off = 12;
  let fmt: Omit<WavInfo, "dataOffset" | "dataBytes" | "durationMs"> | null = null;
  while (off + 8 <= buf.byteLength) {
    const id = ascii(off, 4);
    const size = view.getUint32(off + 4, true);
    const body = off + 8;
    if (id === "fmt ") {
      fmt = {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!fmt) throw new Error("WAV data chunk before fmt chunk");
      // Streaming encoders may leave the data size at 0 or 0xFFFFFFFF; trust the bytes we have.
      const dataBytes =
        size === 0 || size === 0xffffffff ? buf.byteLength - body : Math.min(size, buf.byteLength - body);
      const frameBytes = fmt.channels * (fmt.bitsPerSample / 8);
      const durationMs = Math.round((dataBytes / frameBytes / fmt.sampleRate) * 1000);
      return { ...fmt, dataOffset: body, dataBytes, durationMs };
    }
    off = body + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

/** Wraps raw little-endian PCM in a canonical 44-byte WAV header. */
export function pcmToWav(pcm: Uint8Array, sampleRate = 24_000, channels = 1, bitsPerSample = 16): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, Buffer.from(pcm)]);
}

/** A sine-tone WAV with silent gaps, used by tests to exercise the silence splitter without a network. */
export function synthToneWav(
  segmentsMs: readonly { ms: number; tone: boolean }[],
  sampleRate = 24_000,
): Buffer {
  const total = segmentsMs.reduce((s, x) => s + Math.round((x.ms / 1000) * sampleRate), 0);
  const pcm = Buffer.alloc(total * 2);
  let i = 0;
  for (const seg of segmentsMs) {
    const n = Math.round((seg.ms / 1000) * sampleRate);
    for (let k = 0; k < n; k++, i++) {
      const v = seg.tone ? Math.round(Math.sin((2 * Math.PI * 440 * k) / sampleRate) * 12_000) : 0;
      pcm.writeInt16LE(v, i * 2);
    }
  }
  return pcmToWav(pcm, sampleRate);
}
