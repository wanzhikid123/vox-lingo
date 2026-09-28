export function fakeMedia() {
  const state = (window.fixtureMedia = {
    stopped: 0,
    socketClosed: 0,
    audioClosed: 0,
  });
  const track = {
    enabled: true,
    stop() {
      state.stopped++;
    },
  };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: async () => stream },
    configurable: true,
  });
  window.AudioContext = class {
    state = "running";
    currentTime = 0;
    destination = {};
    audioWorklet = { addModule: async () => {} };
    createGain() {
      return { gain: { value: 0 }, connect() {}, disconnect() {} };
    }
    async resume() {}
    async close() {
      state.audioClosed++;
    }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
    createAnalyser() {
      return {
        fftSize: 256,
        getByteTimeDomainData: (samples) =>
          samples.fill(window.fixtureSpeaking ? 145 : 128),
      };
    }
  };
  window.AudioWorkletNode = class {
    port = {};
    connect() {}
    disconnect() {}
  };
  window.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    constructor() {
      setTimeout(
        () =>
          this.onmessage({ data: JSON.stringify({ type: "session.started" }) }),
        0,
      );
      window.fixtureTranscript = (role, text, index) =>
        this.onmessage({
          data: JSON.stringify({
            type:
              role === "child"
                ? "session.input_transcript.delta"
                : "session.output_transcript.delta",
            event_id: "fixture-" + index,
            delta: text,
            start_ms: index * 5000,
            end_ms: index * 5000 + 1000,
          }),
        });
    }
    send() {}
    close() {
      this.readyState = 3;
      state.socketClosed++;
    }
  };
}
