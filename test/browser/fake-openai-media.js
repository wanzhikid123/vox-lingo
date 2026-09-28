export function fakeMedia() {
  const state = (window.fixtureMedia = {
    stopped: 0,
    peerClosed: 0,
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
    async resume() {}
    async close() {
      state.audioClosed++;
    }
    createMediaStreamSource() {
      return { connect() {} };
    }
    createAnalyser() {
      return {
        fftSize: 256,
        getByteTimeDomainData: (samples) =>
          samples.fill(window.fixtureSpeaking ? 145 : 128),
      };
    }
  };
  window.RTCPeerConnection = class {
    iceGatheringState = "complete";
    addTrack() {}
    async createOffer() {
      return { type: "offer", sdp: "fixture-offer-long-enough" };
    }
    async setLocalDescription(value) {
      this.localDescription = value;
    }
    createDataChannel() {
      const channel = (this.channel = {
        readyState: "open",
        send() {},
        close() {
          channel.readyState = "closed";
        },
      });
      window.fixtureTranscript = (role, text, index) =>
        channel.onmessage({
          data: JSON.stringify({
            type:
              role === "child"
                ? "session.input_transcript.delta"
                : "session.output_transcript.delta",
            event_id: `fixture-${index}`,
            delta: text,
            start_ms: index * 5000,
            end_ms: index * 5000 + 1000,
          }),
        });
      return channel;
    }
    async setRemoteDescription() {
      this.channel.onmessage({
        data: JSON.stringify({ type: "session.started" }),
      });
    }
    close() {
      state.peerClosed++;
    }
  };
}
