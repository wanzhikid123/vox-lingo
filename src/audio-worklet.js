import { PCM16Resampler } from "./pcm.js";
class MicrophonePCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.resampler = new PCM16Resampler(sampleRate);
  }
  process(inputs) {
    const channels = inputs[0];
    if (channels?.length) {
      const mono = new Float32Array(channels[0].length);
      for (const channel of channels)
        for (let i = 0; i < mono.length; i++)
          mono[i] += channel[i] / channels.length;
      this.resampler.push(mono, (data) => this.port.postMessage(data, [data]));
    }
    return true;
  }
}
registerProcessor("microphone-pcm", MicrophonePCM);
