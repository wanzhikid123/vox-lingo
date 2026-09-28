// Streaming, band-limited PCM conversion for microphone audio. A Blackman-windowed
// sinc low-pass filter removes frequencies that would alias when downsampling.
// At 16 kHz output the causal filter adds about 2.5 ms of delay; the stream and
// 20 ms frames remain continuous across AudioWorklet blocks. Native 16 kHz input
// bypasses the filter. No look-ahead, growing buffers or per-sample trig functions.
export class PCM16Resampler {
  constructor(sourceRate, targetRate = 16000, frameSize = 320) {
    if (
      !Number.isSafeInteger(sourceRate) ||
      !Number.isSafeInteger(targetRate) ||
      targetRate <= 0 ||
      sourceRate < targetRate ||
      !Number.isSafeInteger(frameSize) ||
      frameSize <= 0
    )
      throw new Error("Unsupported microphone sample rate or frame size");
    this.sourceRate = sourceRate;
    this.targetRate = targetRate;
    this.frame = new Int16Array(frameSize);
    this.index = 0;
    this.phase = 0;
    if (sourceRate === targetRate) return;
    const ratio = sourceRate / targetRate;
    const half = Math.ceil(40 * ratio);
    this.taps = 2 * half + 1;
    // Duplicate the circular history so each convolution reads a contiguous span.
    this.history = new Float32Array(this.taps * 2);
    this.writeIndex = 0;
    let a = sourceRate,
      b = targetRate;
    while (b) [a, b] = [b, a % b];
    // Exact phases for standard rates (one for 48 kHz, 160 for 44.1 kHz).
    // Bound table size for unusual hardware rates.
    const phaseCount = Math.min(256, targetRate / a);
    const cutoff = 0.45 / ratio; // 7.2 kHz cutoff for 16 kHz output.
    this.filters = Array.from(
      {
        length: phaseCount,
      },
      (_, phase) => {
        const coefficients = new Float64Array(this.taps);
        let sum = 0;
        for (let tap = 0; tap < this.taps; tap++) {
          const x = tap - half - phase / phaseCount;
          const angle = 2 * Math.PI * cutoff * x;
          const sinc = Math.abs(angle) < 1e-12 ? 1 : Math.sin(angle) / angle;
          const window =
            0.42 -
            0.5 * Math.cos((2 * Math.PI * tap) / (this.taps - 1)) +
            0.08 * Math.cos((4 * Math.PI * tap) / (this.taps - 1));
          coefficients[tap] = 2 * cutoff * sinc * window;
          sum += coefficients[tap];
        }
        for (let tap = 0; tap < this.taps; tap++) coefficients[tap] /= sum;
        return coefficients;
      },
    );
  }
  push(samples, emit) {
    for (const sample of samples) {
      const value = Number.isFinite(sample) ? sample : 0;
      if (!this.filters) {
        this.writeSample(value, emit);
        continue;
      }
      this.history[this.writeIndex] = value;
      this.history[this.writeIndex + this.taps] = value;
      this.writeIndex = (this.writeIndex + 1) % this.taps;
      // Integer clock: even fractional rate conversion cannot drift with time.
      this.phase += this.targetRate;
      if (this.phase < this.sourceRate) continue;
      this.phase -= this.sourceRate;
      const coefficients =
        this.filters[
          Math.floor((this.phase * this.filters.length) / this.targetRate)
        ];
      let filtered = 0;
      const end = this.writeIndex + this.taps - 1;
      for (let tap = 0; tap < this.taps; tap++)
        filtered += this.history[end - tap] * coefficients[tap];
      this.writeSample(filtered, emit);
    }
  }
  writeSample(sample, emit) {
    const value = Math.max(-1, Math.min(1, sample));
    this.frame[this.index++] = Math.round(value * (value < 0 ? 32768 : 32767));
    if (this.index !== this.frame.length) return;
    const bytes = new ArrayBuffer(this.frame.length * 2);
    const view = new DataView(bytes);
    this.frame.forEach((v, i) => view.setInt16(i * 2, v, true));
    this.index = 0;
    emit(bytes);
  }
}
