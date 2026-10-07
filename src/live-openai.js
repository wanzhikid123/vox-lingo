import { t as tr } from "./i18n.js";
import { lessonApi } from "./api.js";
import { readSpeechTempo } from "./speech-preference.js";

export class LiveConnection {
  constructor(id, stream, callbacks, { serverEvents = false } = {}) {
    this.id = id;
    this.stream = stream;
    this.callbacks = callbacks;
    this.closed = false;
    this.controller = new AbortController();
    this.lastActivity = Date.now();
    this.lastTeacherActivity = 0;
    this.audio = new Audio();
    this.audio.autoplay = true;
    this.audio.playsInline = true;
    this.sessionStarted = false;
    this.serverEvents = serverEvents;
    this.muted = false;
  }
  async connect() {
    const pc = new RTCPeerConnection();
    this.pc = pc;
    for (const track of this.stream.getTracks()) {
      if (this.serverEvents) track.enabled = false;
      pc.addTrack(track, this.stream);
      track.onended = () =>
        this.fail(tr("Das Mikrofon wurde getrennt. Bitte verbinde es erneut."));
    }
    this.audioContext = new AudioContext();
    await this.audioContext.resume();
    this.analyzers = [];
    this.watchAudio(this.stream, true);
    pc.ontrack = (e) => {
      const remote = e.streams[0] || new MediaStream([e.track]);
      this.audio.srcObject = remote;
      this.watchAudio(remote);
      this.audio.play().catch(() => this.callbacks.onAudioBlocked?.());
    };
    pc.onconnectionstatechange = () => {
      if (this.closed) return;
      if (pc.connectionState === "connected") this.resolveMedia?.();
      if (pc.connectionState === "failed")
        this.fail(
          tr(
            "Die Sprachverbindung wurde unterbrochen. Deine Ergebnisse sind gespeichert.",
          ),
        );
      if (pc.connectionState === "disconnected")
        this.disconnectTimer = setTimeout(() => {
          if (pc.connectionState === "disconnected")
            this.fail(
              "Die Verbindung ist abgebrochen. Bitte verbinde dich erneut.",
            );
        }, 4000);
      else clearTimeout(this.disconnectTimer);
    };
    this.channel = pc.createDataChannel("oai-events");
    const started = new Promise((resolve, reject) => {
      this.rejectStartup = reject;
      this.startTimer = setTimeout(
        () =>
          reject(
            new Error(
              "Die Sprachverbindung hat zu lange gebraucht. Bitte erneut versuchen.",
            ),
          ),
        this.serverEvents ? 65000 : 30000,
      );
      const receive = (e) => {
        let event;
        try {
          event = JSON.parse(e.data);
        } catch {
          return;
        }
        if (event.type === "session.started") {
          this.sessionStarted = true;
          clearTimeout(this.startTimer);
          resolve();
        }
        if (event.type === "session.closed" && !this.closed)
          this.fail(
            "Die Sprachstunde wurde getrennt. Du kannst sie erneut verbinden.",
          );
        if (
          event.type === "session.input_transcript.delta" ||
          event.type === "session.output_transcript.delta"
        ) {
          if (event.type === "session.output_transcript.delta")
            this.lastTeacherActivity = Date.now();
          this.lastActivity = Date.now();
          this.callbacks.onTranscript(
            this.serverEvents ? { ...event, incremental: true } : event,
          );
        }
      };
      this.channel.onmessage = this.serverEvents ? () => {} : receive;
      if (this.serverEvents) {
        this.events = new EventSource(`/api/lessons/${this.id}/events`);
        this.events.addEventListener("live-event", receive);
        this.events.onerror = () => {
          if (!this.closed)
            this.fail(
              tr(
                "ChatGPTPlus: Die lokale Steuerverbindung wurde getrennt. Bitte erneut verbinden.",
              ),
            );
        };
        this.eventsOpened = new Promise((resolve, reject) => {
          this.rejectEvents = reject;
          this.events.addEventListener("open", resolve, { once: true });
        });
        this.eventsOpened.catch(() => {});
      }
      this.channel.onclose = () => {
        if (!this.closed) this.fail("Die Sprachverbindung wurde geschlossen.");
      };
    });
    // The rejection handler is attached before network setup, avoiding an unhandled startup timeout.
    started.catch(() => {});
    if (this.eventsOpened) await this.eventsOpened;
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise((resolve, reject) => {
      if (pc.iceGatheringState === "complete") return resolve();
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              "Die Audioverbindung konnte nicht vorbereitet werden. Bitte prüfe dein Netzwerk.",
            ),
          ),
        10000,
      );
      pc.addEventListener("icegatheringstatechange", () => {
        if (pc.iceGatheringState === "complete") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    if (this.closed) throw new Error("Verbindung beendet.");
    const result = await lessonApi(
      this.id,
      "/connect",
      {
        sdp: pc.localDescription.sdp,
        tempo: readSpeechTempo(),
      },
      { signal: this.controller.signal },
    );
    if (this.closed) throw new Error("Verbindung beendet.");
    await pc.setRemoteDescription({ type: "answer", sdp: result.sdp });
    await started;
    if (this.serverEvents && pc.connectionState !== "connected") {
      await new Promise((resolve, reject) => {
        this.resolveMedia = resolve;
        this.rejectMedia = reject;
        this.mediaTimer = setTimeout(
          () =>
            reject(
              new Error(
                tr(
                  "ChatGPTPlus: Die Audioverbindung konnte nicht hergestellt werden.",
                ),
              ),
            ),
          20000,
        );
        if (pc.connectionState === "connected") resolve();
      });
      clearTimeout(this.mediaTimer);
    }
    await lessonApi(this.id, "/ready", {}, { signal: this.controller.signal });
    if (this.closed) throw new Error("Verbindung beendet.");
    this.connected = true;
    if (this.serverEvents) this.mute(this.muted);
    this.callbacks.onConnected();
    this.meterTimer = setInterval(() => this.sampleAudio(), 150);
  }
  sampleAudio() {
    let level = 0;
    for (const { analyser, isInput } of this.analyzers) {
      const samples = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(samples);
      const rms =
        Math.sqrt(
          samples.reduce((sum, v) => sum + (v - 128) ** 2, 0) / samples.length,
        ) / 128;
      level = Math.max(level, rms);
      if (isInput) {
        if (rms > 0.025) {
          if (!this.inputSpeaking) this.callbacks.onInputActivity?.();
          this.inputSpeaking = true;
          this.lastInputEnergy = Date.now();
        } else if (Date.now() - (this.lastInputEnergy || 0) >= 300) {
          this.inputSpeaking = false;
        }
      }
    }
    if (level > 0.025) this.lastActivity = Date.now();
    this.callbacks.onLevel?.(Math.min(1, level * 5));
  }
  watchAudio(stream, isInput = false) {
    try {
      const source = this.audioContext.createMediaStreamSource(stream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      this.analyzers.push({ analyser, isInput });
    } catch {}
  }
  mute(muted) {
    this.muted = muted;
    for (const track of this.stream.getAudioTracks())
      track.enabled = !muted && (!this.serverEvents || this.connected);
  }
  async play() {
    await this.audio.play();
  }
  fail(message) {
    if (this.closed) return;
    this.close();
    this.callbacks.onDisconnected(message);
  }
  close() {
    if (this.closed) return this.closing;
    this.closed = true;
    this.controller.abort();
    clearTimeout(this.startTimer);
    clearTimeout(this.disconnectTimer);
    clearInterval(this.meterTimer);
    clearTimeout(this.mediaTimer);
    this.rejectMedia?.(new Error("Verbindung beendet."));
    this.rejectEvents?.(new Error("Verbindung beendet."));
    this.rejectStartup?.(new Error("Verbindung beendet."));
    if (
      !this.serverEvents &&
      this.channel?.readyState === "open" &&
      this.sessionStarted
    )
      this.channel.send(JSON.stringify({ type: "session.close" }));
    this.stream.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.audio.pause();
    this.audio.srcObject = null;
    this.audioContext?.close().catch(() => {});
    const release = () => {
      this.events?.close();
      this.channel?.close();
      this.pc?.close();
    };
    if (this.serverEvents) {
      // Stop capture/playback now; keep media and sideband until the backend
      // reports confirmed closure or an explicit failure.
      this.closing = lessonApi(this.id, "/close-live", {})
        .catch((error) => {
          this.callbacks.onDisconnected?.(error.message);
        })
        .finally(release);
      return this.closing;
    }
    release();
  }
}
