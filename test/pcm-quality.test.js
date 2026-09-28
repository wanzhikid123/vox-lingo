import test from "node:test";
import assert from "node:assert/strict";
import { PCM16Resampler } from "../src/pcm.js";

function convert(rate, audio, blockSizes = [128]) {
  const resampler = new PCM16Resampler(rate),
    frames = [];
  let offset = 0,
    block = 0;
  while (offset < audio.length) {
    const size = blockSizes[block++ % blockSizes.length];
    resampler.push(audio.subarray(offset, offset + size), (bytes) => {
      assert.equal(bytes.byteLength, 640);
      frames.push(new Int16Array(bytes));
    });
    offset += size;
  }
  return Int16Array.from(frames.flatMap((frame) => [...frame]));
}
const tone = (rate, frequency, length = rate) =>
  Float32Array.from(
    { length },
    (_, index) => 0.5 * Math.sin((2 * Math.PI * frequency * index) / rate),
  );
function gain(samples) {
  // Exclude startup FIR delay; measure signal energy independently of phase.
  const settled = samples.subarray(320);
  const rms = Math.sqrt(
    settled.reduce((sum, sample) => sum + (sample / 32768) ** 2, 0) /
      settled.length,
  );
  return rms / (0.5 / Math.sqrt(2));
}

for (const rate of [44100, 48000, 96000]) {
  test(`${rate} Hz speech frequencies survive resampling without significant level loss`, () => {
    for (const frequency of [100, 1000, 4000, 6500]) {
      const ratio = gain(convert(rate, tone(rate, frequency)));
      assert.ok(Math.abs(1 - ratio) < 0.02, `${frequency} Hz gain: ${ratio}`);
    }
  });
  test(`${rate} Hz high frequencies cannot fold into the 16 kHz speech signal`, () => {
    for (const frequency of [8200, 9000, 12000]) {
      const ratio = gain(convert(rate, tone(rate, frequency)));
      assert.ok(
        ratio < 0.0032,
        `${frequency} Hz alias suppression: ${20 * Math.log10(ratio)} dB`,
      );
    }
  });
  test(`${rate} Hz variable blocks preserve samples, frame boundaries and fractional timing`, () => {
    const audio = tone(rate, 1234, rate * 2 + 17003);
    const reference = convert(rate, audio, [audio.length]);
    assert.deepEqual(convert(rate, audio, [1, 17, 128, 257, 4096]), reference);
    assert.equal(
      reference.length,
      Math.floor((audio.length * 16000) / rate / 320) * 320,
    );
  });
}

test("native 16 kHz audio bypasses filtering and retains signed little-endian PCM clipping", () => {
  const resampler = new PCM16Resampler(16000, 16000, 7),
    frames = [];
  resampler.push([-2, -1, -0.5, 0, 0.5, 1, 2], (bytes) => frames.push(bytes));
  const view = new DataView(frames[0]);
  assert.deepEqual(
    Array.from({ length: 7 }, (_, i) => view.getInt16(i * 2, true)),
    [-32768, -32768, -16384, 0, 16384, 32767, 32767],
  );
});
