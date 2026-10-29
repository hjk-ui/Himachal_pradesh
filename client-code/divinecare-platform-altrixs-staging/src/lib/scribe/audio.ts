/**
 * Audio helpers for streaming to Transcribe (browser-safe, pure): resample the microphone's
 * float samples to 16 kHz, convert to 16-bit little-endian PCM, and measure the level for the
 * on-screen mic meter. Nothing here stores audio.
 */

/** Average-pool resampling (good enough for speech; input rate is usually 44.1 / 48 kHz). */
export function downsample(input: Float32Array, inputRate: number, outRate = 16000): Float32Array {
  if (!input.length) return new Float32Array(0);
  if (inputRate === outRate) return input.slice();
  if (inputRate < outRate) throw new Error('downsample: input rate below output rate');
  const ratio = inputRate / outRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  let pos = 0;
  for (let i = 0; i < outLen; i++) {
    const next = Math.min(input.length, Math.round((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = pos; j < next; j++) {
      sum += input[j];
      count++;
    }
    out[i] = count ? sum / count : 0;
    pos = next;
  }
  return out;
}

export function floatToPcm16(input: Float32Array): Uint8Array {
  const out = new Uint8Array(input.length * 2);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    dv.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/** RMS level 0..1 scaled for a meter (speech peaks near 1). */
export function meterLevel(input: Float32Array): number {
  if (!input.length) return 0;
  let sum = 0;
  for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
  const rms = Math.sqrt(sum / input.length);
  return Math.max(0, Math.min(1, rms * 4));
}
