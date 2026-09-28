import WebSocket from "ws";
import { AppError } from "./store.js";
import {
  AUDIO_EXTENSIONS,
  TRANSCRIPTION_LANGUAGES,
} from "../shared/transcription.js";

export class OpenAIService {
  constructor(config) {
    this.config = config;
  }
  async request(path, body, signal, timeout = 60000) {
    if (!this.config.apiKey)
      throw new AppError(
        "Der API-Schlüssel fehlt. Bitte OPENAI_API_KEY als Windows-Umgebungsvariable setzen und das Programm neu starten.",
        503,
      );
    let response;
    try {
      response = await fetch(`https://api.openai.com/v1${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          ...(body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body:
          body instanceof FormData
            ? body
            : body
              ? JSON.stringify(body)
              : undefined,
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
          : AbortSignal.timeout(timeout),
      });
    } catch (e) {
      if (signal?.aborted)
        throw new AppError("Die Aufgabe wurde beendet.", 409);
      throw new AppError(
        "OpenAI ist gerade nicht erreichbar. Bitte prüfe die Internetverbindung und versuche es erneut.",
        502,
      );
    }
    if (!response.ok) {
      // Never return provider bodies, credentials, or request payloads to logs/the browser.
      const messages = {
        401: "Der API-Schlüssel wurde nicht akzeptiert.",
        403: "Dieser API-Schlüssel hat keinen Zugriff auf das angeforderte Modell.",
        404: "Das angeforderte Modell oder die Schnittstelle ist für diesen API-Schlüssel nicht verfügbar.",
        429: "Das API-Limit oder Guthaben ist erreicht. Bitte später erneut versuchen.",
        400: "Die KI-Anfrage wurde abgelehnt. Bitte die Modell-Einstellungen prüfen.",
      };
      throw new AppError(
        messages[response.status] ||
          "Der KI-Dienst hat gerade ein Problem. Bitte erneut versuchen.",
        502,
      );
    }
    return response.json();
  }
  async transcribe(audio, mimeType, language, signal) {
    const body = new FormData();
    const model = this.config.transcriptionModel;
    body.set(
      "file",
      new Blob([audio], { type: mimeType }),
      `recording.${AUDIO_EXTENSIONS[mimeType]}`,
    );
    body.set("model", model);
    body.set("response_format", "json");
    if (language !== "auto") body.set("language", language);
    else if (/^gpt-transcribe(?:-|$)/.test(model)) {
      // The multi-language hint is specific to this model family. Other models
      // use their own language detection, so changing the model remains possible.
      for (const code of TRANSCRIPTION_LANGUAGES)
        body.append("languages[]", code);
    }
    const result = await this.request(
      "/audio/transcriptions",
      body,
      signal,
      90000,
    );
    const text = typeof result.text === "string" ? result.text.trim() : "";
    if (!text)
      throw new AppError("Keine Sprache erkannt. Bitte erneut aufnehmen.", 422);
    return { text };
  }
  async live(sdp, instructions, context, signal) {
    const result = await this.request(
      "/live/sessions",
      {
        session: {
          model: this.config.liveModel,
          instructions,
          store: false,
          audio: { output: { voice: this.config.voice } },
          delegation: { type: "client" },
          input: [
            {
              type: "message",
              role: "developer",
              content: [{ type: "input_text", text: context }],
            },
          ],
        },
        transport: { type: "webrtc", sdp },
      },
      signal,
      30000,
    );
    if (!result.session?.id || !result.transport?.sdp)
      throw new AppError(
        "Die Sprachverbindung konnte nicht vorbereitet werden.",
        502,
      );
    return result;
  }
  attach(remoteId, onEvent, onClose) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(
        `wss://api.openai.com/v1/live/sessions/${encodeURIComponent(remoteId)}/attach`,
        {
          headers: { Authorization: `Bearer ${this.config.apiKey}` },
          handshakeTimeout: 15000,
          maxPayload: 8 * 1024 * 1024,
        },
      );
      socket.once("open", () => resolve(socket));
      socket.on("message", (raw) => {
        try {
          const event = JSON.parse(raw.toString());
          onEvent(event);
        } catch {
          /* Ignore malformed transport frames. */
        }
      });
      socket.on("error", () =>
        reject(
          new AppError(
            "Die Verbindung zur Sprachsteuerung ist fehlgeschlagen.",
            502,
          ),
        ),
      );
      socket.on("close", () => onClose?.());
    });
  }
  async closeLive(remoteId, socket) {
    if (!remoteId) return;
    let connection = socket;
    try {
      if (!connection || connection.readyState !== WebSocket.OPEN)
        connection = await this.attach(
          remoteId,
          () => {},
          () => {},
        );
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 2500);
        const listener = (raw) => {
          try {
            if (JSON.parse(raw.toString()).type === "session.closed") {
              clearTimeout(timer);
              resolve();
            }
          } catch {}
        };
        connection.on("message", listener);
        connection.send(JSON.stringify({ type: "session.close" }));
      });
    } catch {
      /* The primary media connection is also closed; session may already be gone. */
    } finally {
      connection?.close();
    }
  }
}
