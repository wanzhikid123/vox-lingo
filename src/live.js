import { api } from "./api.js";
export { microphone } from "./microphone.js";

// Select the browser transport from the server's effective configuration.
// Only the selected transport is loaded; neither browser receives an API key.
export class LiveConnection {
  constructor(id, stream, callbacks) {
    this.args = [id, stream, callbacks];
    this.closed = false;
    this.controller = new AbortController();
  }
  get lastActivity() {
    return this.connection?.lastActivity || Date.now();
  }
  get lastTeacherActivity() {
    return this.connection?.lastTeacherActivity || 0;
  }
  get playbackIdle() {
    return this.connection?.playbackIdle ?? true;
  }
  async connect() {
    try {
      const health = await api("/health", undefined, {
        signal: this.controller.signal,
      });
      const transport =
        health.live.provider === "gemini"
          ? await import("./live-gemini.js")
          : await import("./live-openai.js");
      if (this.closed) throw new Error("Verbindung beendet.");
      this.connection = new transport.LiveConnection(...this.args);
      await this.connection.connect();
    } catch (error) {
      this.close();
      throw error;
    }
  }
  mute(muted) {
    this.connection?.mute(muted);
  }
  play() {
    return this.connection?.play();
  }
  close() {
    this.closed = true;
    this.controller.abort();
    if (this.connection) this.connection.close();
    else this.args[1].getTracks().forEach((track) => track.stop());
  }
}
