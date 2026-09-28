import test from "node:test";
import assert from "node:assert/strict";
import { PCM16Resampler } from "../src/pcm.js";
import { PCMPlayback } from "../src/audio-playback.js";

for (const rate of [44100, 48000])
  test(`streaming ${rate} Hz microphone produces exactly one second of PCM16 at 16 kHz`, () => {
    const resampler = new PCM16Resampler(rate),
      frames = [];
    const audio = new Float32Array(rate).fill(0.5);
    for (let offset = 0; offset < audio.length; offset += 128)
      resampler.push(audio.subarray(offset, offset + 128), (b) =>
        frames.push(b),
      );
    assert.equal(
      frames.reduce((n, b) => n + b.byteLength, 0),
      32000,
    );
    // The causal anti-alias filter starts with silence and settles within 10 ms.
    assert.ok(
      Math.abs(new DataView(frames[0]).getInt16(160 * 2, true) - 16384) <= 1,
    );
  });

test("playback completes after the actual audio, interrupt stops all queued sources, and stale audio is ignored", () => {
  const sources = [],
    drained = [];
  const context = {
    currentTime: 0,
    destination: {},
    createBuffer: (_channels, count, rate) => ({
      duration: count / rate,
      getChannelData: () => new Float32Array(count),
    }),
    createBufferSource() {
      const source = {
        connect() {},
        disconnect() {},
        start(t) {
          this.startTime = t;
        },
        stop() {
          this.stopped = true;
        },
      };
      sources.push(source);
      return source;
    },
  };
  const playback = new PCMPlayback(context, (epoch) => drained.push(epoch));
  const audio = Buffer.alloc(48000).toString("base64");
  playback.enqueue(audio, 24000, 0);
  playback.enqueue(audio, 24000, 0);
  playback.finish(0);
  assert.equal(playback.idle, false);
  assert.equal(drained.length, 0);
  assert.ok(sources[1].startTime >= sources[0].startTime + 1);
  sources[0].onended();
  assert.equal(drained.length, 0);
  sources[1].onended();
  assert.deepEqual(drained, [0]);
  playback.enqueue(audio, 24000, 0);
  playback.clear(1);
  assert.equal(sources[2].stopped, true);
  playback.enqueue(audio, 24000, 0);
  assert.equal(sources.length, 3);
  assert.equal(playback.idle, true);
});
