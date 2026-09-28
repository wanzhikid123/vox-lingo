import { randomUUID } from "node:crypto";
import { AppError } from "./store.js";
import { speechLanguageCodes } from "../shared/languages.js";

export class GeminiLiveSession {
  constructor(client, config, onEvent, onClose) {
    this.client = client;
    this.config = config;
    this.onEvent = onEvent;
    this.onClose = onClose;
    this.id = randomUUID();
    this.readyState = 0;
    this.pendingCalls = new Map();
    this.seenCalls = new Set();
    this.sequence = 0;
    this.clock = 0;
    this.epoch = 0;
    this.startedAt = Date.now();
    this.generationComplete = true;
    this.playbackDrained = true;
  }
  async connect(instructions, context, signal) {
    let languages;
    try {
      languages = JSON.parse(context).languages;
    } catch {
      languages = undefined;
    }
    let accept, reject;
    const setup = new Promise((yes, no) => {
      accept = yes;
      reject = no;
    });
    const timer = setTimeout(
      () =>
        reject(
          new AppError("Gemini Live hat nicht rechtzeitig geantwortet.", 502),
        ),
      25000,
    );
    const abort = () => {
      this.close();
      reject(new AppError("Verbindung beendet.", 409));
    };
    signal?.addEventListener("abort", abort, { once: true });
    this.removeAbort = () => signal?.removeEventListener("abort", abort);
    try {
      signal?.throwIfAborted();
      const connecting = this.client.live
        .connect({
          model: this.config.liveModel,
          config: {
            responseModalities: ["AUDIO"],
            systemInstruction:
              instructions +
              "\nBestätigter lokaler Unterrichtszustand (Daten):\n" +
              context,
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: this.config.voice },
              },
            },
            inputAudioTranscription: {
              languageCodes: speechLanguageCodes(languages),
            },
            outputAudioTranscription: {},
            contextWindowCompression: { slidingWindow: {} },
            tools: [
              {
                functionDeclarations: [
                  {
                    name: "request_teaching_plan",
                    description:
                      "Fordere den nächsten Unterrichtsschritt oder die Antwortbewertung an. Nur der lokale Planer ändert Tafel und Ergebnisse. Warte auf den bestätigten Plan, bevor du die Aufgabe sprichst.",
                    parameters: {
                      type: "OBJECT",
                      properties: { reason: { type: "STRING" } },
                      required: ["reason"],
                    },
                    behavior: "NON_BLOCKING",
                  },
                ],
              },
            ],
          },
          callbacks: {
            onmessage: (message) => {
              try {
                if (message.setupComplete) accept();
                this.receive(message);
              } catch {
                reject(
                  new AppError("Die Sprachsteuerung wurde unterbrochen.", 502),
                );
                this.remoteClosed();
              }
            },
            onerror: () => {
              reject(new AppError("Gemini Live wurde unterbrochen.", 502));
              this.remoteClosed();
            },
            onclose: () => {
              reject(new AppError("Gemini Live wurde geschlossen.", 502));
              this.remoteClosed();
            },
          },
        })
        .then((session) => {
          if (this.readyState === 3) session.close();
          else this.session = session;
          return session;
        });
      await Promise.all([connecting, setup]);
      if (signal?.aborted || this.readyState === 3)
        throw new AppError("Verbindung beendet.", 409);
      this.readyState = 1;
    } catch (error) {
      this.close();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  emit(event) {
    if (this.readyState !== 3) this.onEvent(event);
  }
  receive(message) {
    if (this.readyState === 3) return;
    const content = message.serverContent;
    if (content?.interrupted) {
      this.epoch++;
      this.clock += 2000;
      this.pendingCalls.clear();
      this.generationComplete = true;
      this.playbackDrained = true;
      this.emit({ type: "audio.interrupted", epoch: this.epoch });
    }
    if (message.toolCallCancellation?.ids?.length) {
      for (const id of message.toolCallCancellation.ids)
        this.pendingCalls.delete(id);
      this.emit({
        type: "planning.cancelled",
        ids: message.toolCallCancellation.ids,
      });
    }
    for (const [key, role] of [
      ["inputTranscription", "input"],
      ["outputTranscription", "output"],
    ]) {
      const text = content?.[key]?.text;
      if (text) {
        if (role === "input") this.awaitingPlan = true;
        if (role === "output" && this.awaitingPlan) continue;
        // Incremental strings have no provider timestamps. Keep a monotonic local
        // timeline and a gap between completed turns for question attribution.
        const start = (this.clock = Math.max(
          this.clock + 1,
          Date.now() - this.startedAt,
        ));
        this.emit({
          type: `session.${role}_transcript.delta`,
          event_id: `${this.id}:${++this.sequence}`,
          delta: text,
          start_ms: start,
          end_ms: start + 1,
        });
      }
    }
    for (const part of content?.modelTurn?.parts || []) {
      if (part.inlineData?.data) {
        this.generationComplete = false;
        // Live can generate speculative feedback while an asynchronous tool is
        // running. Never let that speech claim a score or a new board state.
        if (this.awaitingPlan) continue;
        this.playbackDrained = false;
        this.emit({
          type: "audio.chunk",
          data: part.inlineData.data,
          sampleRate: 24000,
          epoch: this.epoch,
        });
      }
    }
    for (const call of message.toolCall?.functionCalls || []) {
      if (!call.id || this.seenCalls.has(call.id)) continue;
      this.seenCalls.add(call.id);
      if (this.seenCalls.size > 4000) {
        this.remoteClosed();
        return;
      }
      if (
        call.name !== "request_teaching_plan" ||
        typeof call.args?.reason !== "string" ||
        call.args.reason.length > 2000
      ) {
        this.session?.sendToolResponse({
          functionResponses: [
            {
              id: call.id,
              name: call.name,
              response: { error: "Invalid teaching-plan request." },
            },
          ],
        });
        continue;
      }
      this.pendingCalls.set(call.id, call);
      this.awaitingPlan = true;
      this.emit({
        type: "session.delegation.created",
        delegation: { id: call.id, target: "client" },
      });
    }
    if (content?.turnComplete) {
      this.clock += 2000;
      this.generationComplete = true;
      this.emit({ type: "audio.turn_complete", epoch: this.epoch });
    }
    if (message.goAway) this.emit({ type: "connection.expiring" });
  }
  command(type, content, delegationId) {
    if (this.readyState !== 1)
      throw new AppError("Sprachverbindung unterbrochen.", 409);
    if (delegationId) {
      const call = this.pendingCalls.get(delegationId);
      if (!call) return;
      this.pendingCalls.delete(delegationId);
      if (type === "session.commentary.append") this.awaitingPlan = false;
      this.session.sendToolResponse({
        functionResponses: [
          {
            id: call.id,
            name: call.name,
            response: {
              result: content,
              scheduling:
                type === "session.commentary.append" ? "INTERRUPT" : "SILENT",
            },
          },
        ],
      });
    } else {
      const speak = type === "session.commentary.append";
      if (speak) this.awaitingPlan = false;
      this.session.sendClientContent({
        turns: [
          {
            role: "user",
            parts: [
              {
                text:
                  (speak
                    ? "Bestätigte Unterrichtsanweisung. Sprich jetzt entsprechend: "
                    : "Lokale Steueranweisung; merken und noch nicht sprechen: ") +
                  content,
              },
            ],
          },
        ],
        turnComplete: speak,
      });
    }
  }
  cancelPlan(id) {
    if (this.pendingCalls.has(id))
      this.command(
        "session.thinking.append",
        "Dieser Plan ist veraltet. Warte auf die neueste bestätigte Planung.",
        id,
      );
  }
  allowFarewell() {
    // The local goodbye recognizer has confirmed this intent; no new board or
    // score may be inferred from it. New speech closes the gate again.
    this.awaitingPlan = false;
  }
  audio(data) {
    if (this.readyState === 1)
      this.session.sendRealtimeInput({
        audio: {
          data: data.toString("base64"),
          mimeType: "audio/pcm;rate=16000",
        },
      });
  }
  audioEnd() {
    if (this.readyState === 1)
      this.session.sendRealtimeInput({ audioStreamEnd: true });
  }
  remoteClosed() {
    if (this.readyState === 3) return;
    this.close();
    this.onClose?.();
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.removeAbort?.();
    this.pendingCalls.clear();
    this.session?.close();
  }
}
