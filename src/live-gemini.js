import { t as tr } from "./i18n.js";
import { lessonApi } from "./api.js";
import { readSpeechTempo } from "./speech-preference.js";
import { PCMPlayback } from "./audio-playback.js";
import workletUrl from "./audio-worklet.js?worker&url";
export class LiveConnection {
  constructor(id, stream, callbacks) {
    this.id = id;
    this.stream = stream;
    this.callbacks = callbacks;
    this.closed = false;
    this.lastActivity = Date.now();
    this.lastTeacherActivity = 0;
    this.controller = new AbortController();
  }
  get playbackIdle() {
    return this.playback?.idle ?? true;
  }
  async connect() {
    try {
      this.audioContext = new AudioContext();
      await this.audioContext.resume();
      if (this.closed) throw new Error("Verbindung beendet.");
      this.playback = new PCMPlayback(
        this.audioContext,
        (epoch) =>
          this.send({
            type: "playback.drained",
            epoch,
          }),
        () => {
          this.lastActivity = this.lastTeacherActivity = Date.now();
        },
      );
      if (this.audioContext.state !== "running")
        this.callbacks.onAudioBlocked?.();
      for (const track of this.stream.getTracks())
        track.onended = () => this.fail(tr("Das Mikrofon wurde getrennt."));
      await this.audioContext.audioWorklet.addModule(workletUrl);
      if (this.closed) throw new Error("Verbindung beendet.");
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.source.connect(this.analyser);
      this.processor = new AudioWorkletNode(
        this.audioContext,
        "microphone-pcm",
      );
      this.silent = this.audioContext.createGain();
      this.silent.gain.value = 0;
      this.source.connect(this.processor);
      this.processor.connect(this.silent);
      this.silent.connect(this.audioContext.destination);
      this.processor.port.onmessage = ({ data }) => {
        if (
          this.closed ||
          this.muted ||
          this.socket?.readyState !== WebSocket.OPEN
        )
          return;
        if (this.socket.bufferedAmount > 64000)
          return this.fail(
            tr("Die Audioverbindung ist zu langsam. Bitte erneut verbinden."),
          );
        this.socket.send(data);
      };
      const result = await lessonApi(
        this.id,
        "/connect",
        {
          tempo: readSpeechTempo(),
        },
        {
          signal: this.controller.signal,
        },
      );
      if (this.closed) throw new Error("Verbindung beendet.");
      const url = new URL(result.audioUrl, location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      await new Promise((resolve, reject) => {
        this.rejectStartup = reject;
        this.startTimer = setTimeout(
          () =>
            reject(new Error("Die Sprachverbindung hat zu lange gebraucht.")),
          30000,
        );
        this.socket = new WebSocket(url);
        this.socket.onmessage = ({ data }) => {
          try {
            const event = JSON.parse(data);
            if (event.type === "session.started") {
              clearTimeout(this.startTimer);
              resolve();
            } else this.event(event);
          } catch (error) {
            this.fail(error.message || "Ungültige Audioantwort.");
          }
        };
        this.socket.onerror = () =>
          this.fail("Die Sprachverbindung ist fehlgeschlagen.");
        this.socket.onclose = () =>
          this.fail(
            "Die Sprachverbindung wurde geschlossen. Bitte erneut verbinden.",
          );
      });
      await lessonApi(
        this.id,
        "/ready",
        {},
        {
          signal: this.controller.signal,
        },
      );
      if (this.closed) throw new Error("Verbindung beendet.");
      if (this.closed) throw new Error("Verbindung beendet.");
      this.callbacks.onConnected();
      this.meterTimer = setInterval(() => this.sampleAudio(), 100);
    } catch (error) {
      this.close();
      throw error;
    }
  }
  event(event) {
    if (event.type === "audio.chunk") {
      this.playback.enqueue(event.data, event.sampleRate, event.epoch);
      this.lastActivity = Date.now();
      if (this.audioContext.state !== "running")
        this.callbacks.onAudioBlocked?.();
    } else if (event.type === "audio.interrupted")
      this.playback.clear(event.epoch);
    else if (event.type === "audio.turn_complete")
      this.playback.finish(event.epoch);
    else if (event.type.includes("transcript")) {
      this.lastActivity = Date.now();
      this.callbacks.onTranscript(event);
    } else if (event.type === "connection.expiring")
      this.fail(
        tr(
          "Die Sprachsitzung wird erneuert. Bitte erneut verbinden; dein Lernstand bleibt erhalten.",
        ),
      );
  }
  send(event) {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify(event));
  }
  sampleAudio() {
    const samples = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(samples);
    const rms =
      Math.sqrt(
        samples.reduce((sum, value) => sum + (value - 128) ** 2, 0) /
          samples.length,
      ) / 128;
    if (!this.muted && rms > 0.025) {
      if (!this.inputSpeaking) {
        this.send({
          type: "input.activity",
        });
        this.callbacks.onInputActivity?.();
      }
      this.inputSpeaking = true;
      this.lastInputEnergy = this.lastActivity = Date.now();
    } else if (Date.now() - (this.lastInputEnergy || 0) >= 300)
      this.inputSpeaking = false;
    this.callbacks.onLevel?.(this.muted ? 0 : Math.min(1, rms * 5));
  }
  mute(muted) {
    this.muted = muted;
    for (const track of this.stream.getAudioTracks()) track.enabled = !muted;
    if (muted)
      this.send({
        type: "audio.end",
      });
  }
  async play() {
    await this.audioContext.resume();
  }
  fail(message) {
    if (this.closed) return;
    this.close();
    this.callbacks.onDisconnected(message);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
    clearTimeout(this.startTimer);
    clearInterval(this.meterTimer);
    this.rejectStartup?.(new Error("Verbindung beendet."));
    this.send({
      type: "session.close",
    });
    this.socket?.close();
    this.playback?.clear();
    if (this.processor) {
      this.processor.port.onmessage = null;
      this.processor.disconnect();
    }
    this.source?.disconnect();
    this.silent?.disconnect();
    this.stream.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    this.audioContext?.close().catch(() => {});
  }
}
