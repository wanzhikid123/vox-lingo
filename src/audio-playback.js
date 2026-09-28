export class PCMPlayback {
  constructor(context, onDrained, onPlayed) {
    this.context = context;
    this.onDrained = onDrained;
    this.onPlayed = onPlayed;
    this.sources = new Set();
    this.nextTime = 0;
    this.complete = true;
    this.epoch = 0;
  }
  get idle() {
    return this.complete && this.sources.size === 0;
  }
  enqueue(base64, rate, epoch) {
    if (epoch < this.epoch) return;
    if (epoch > this.epoch) this.clear(epoch);
    if (rate !== 24000) throw new Error("Unbekanntes Audioformat.");
    const raw = atob(base64);
    if (!raw.length || raw.length % 2) throw new Error("Ungültige Audiodaten.");
    const now = this.context.currentTime;
    if (Math.max(now, this.nextTime) + raw.length / 2 / rate - now > 20)
      throw new Error(
        "Die Audioausgabe ist zu weit zurückgefallen. Bitte erneut verbinden.",
      );
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const buffer = this.context.createBuffer(1, raw.length / 2, rate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++)
      channel[i] = view.getInt16(i * 2, true) / 32768;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    this.sources.add(source);
    this.complete = false;
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      if (epoch !== this.epoch) return;
      this.onPlayed?.();
      if (this.idle) this.onDrained?.(epoch);
    };
    const start = Math.max(now + 0.02, this.nextTime);
    this.nextTime = start + buffer.duration;
    source.start(start);
  }
  finish(epoch) {
    if (epoch !== this.epoch) return;
    this.complete = true;
    if (this.idle) this.onDrained?.(epoch);
  }
  clear(epoch = this.epoch + 1) {
    this.epoch = epoch;
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
        source.disconnect();
      } catch {}
    }
    this.sources.clear();
    this.nextTime = 0;
    this.complete = true;
  }
}
