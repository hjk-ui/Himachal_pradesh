/*
 * AI Scribe microphone capture worklet. Posts mono float32 blocks (about 100 ms) to the page,
 * which resamples to 16 kHz PCM and sends them to AWS Transcribe Medical over the presigned
 * WebSocket. Nothing is stored. Paused: blocks are dropped here, so no audio leaves the browser.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.paused = false;
    this.buf = [];
    this.len = 0;
    this.target = Math.round(sampleRate / 10);
    this.port.onmessage = (e) => {
      if (e.data && typeof e.data.paused === 'boolean') {
        this.paused = e.data.paused;
        this.buf = [];
        this.len = 0;
      }
    };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || this.paused) return true;
    this.buf.push(new Float32Array(ch));
    this.len += ch.length;
    if (this.len >= this.target) {
      const out = new Float32Array(this.len);
      let off = 0;
      for (const b of this.buf) {
        out.set(b, off);
        off += b.length;
      }
      this.buf = [];
      this.len = 0;
      this.port.postMessage(out, [out.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor);
