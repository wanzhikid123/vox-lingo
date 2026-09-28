import { randomUUID } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { AppError } from "./store.js";
import { GeminiLiveSession } from "./gemini-live.js";

export function providerError(error, signal) {
  if (signal?.aborted) return new AppError("Die Aufgabe wurde beendet.", 409);
  if (error instanceof AppError) return error;
  const status = Number(error?.status || error?.code);
  const messages = {
    400: "Die Gemini-Anfrage wurde abgelehnt. Bitte Modell und Einstellungen prüfen.",
    401: "GEMINI_API_KEY wurde nicht akzeptiert.",
    403: "Dieser Gemini-Schlüssel hat keinen Zugriff auf das angeforderte Modell.",
    404: "Das Gemini-Modell ist für diesen Schlüssel nicht verfügbar.",
    429: "Das API-Limit oder Guthaben ist erreicht. Bitte später erneut versuchen.",
  };
  return new AppError(
    messages[status] ||
      "Gemini ist gerade nicht erreichbar. Bitte erneut versuchen.",
    502,
  );
}

// Provider-specific opaque content stays in memory in the adapter; round-trip
// complete model parts (including thought signatures) without inventing signatures.
export function geminiContents(input) {
  const contents = [];
  const calls = new Map(
    input.filter((i) => i.type === "function_call").map((i) => [i.call_id, i]),
  );
  const append = (role, part) => {
    if (contents.at(-1)?.role === role) contents.at(-1).parts.push(part);
    else contents.push({ role, parts: [part] });
  };
  for (const item of input) {
    if (item.type === "provider_context" && item.provider === "gemini") {
      contents.push(structuredClone(item.content));
    } else if (item.type === "function_call_output") {
      const call = calls.get(item.call_id);
      if (!call) throw new AppError("Werkzeugkontext fehlt.", 502);
      append("user", {
        functionResponse: {
          ...(call.provider_call_id ? { id: call.provider_call_id } : {}),
          name: call.name,
          response: JSON.parse(item.output),
        },
      });
    } else if (item.role && !item.providerMapped) {
      const text =
        typeof item.content === "string"
          ? item.content
          : (item.content || []).map((p) => p.text || "").join("\n");
      if (text) append(item.role === "assistant" ? "model" : "user", { text });
    }
  }
  return contents;
}

export class GeminiService {
  constructor(config, client) {
    this.config = config;
    this.client = client;
    this.sessions = new Map();
  }
  getClient() {
    if (!this.config.apiKey)
      throw new AppError(
        "Bitte GEMINI_API_KEY als Windows-Umgebungsvariable setzen und das Programm neu starten.",
        503,
      );
    return (this.client ||= new GoogleGenAI({
      apiKey: this.config.apiKey,
      httpOptions: { apiVersion: "v1beta" },
    }));
  }
  async responses(input, tools, instructions, signal) {
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
      : AbortSignal.timeout(60000);
    try {
      requestSignal.throwIfAborted();
      const result = await this.getClient().models.generateContent({
        model: this.config.teacherModel,
        contents: geminiContents(input),
        config: {
          systemInstruction: instructions,
          abortSignal: requestSignal,
          maxOutputTokens: 5000,
          thinkingConfig: {
            thinkingLevel: (
              this.config.teacherThinkingLevel || "medium"
            ).toUpperCase(),
          },
          ...(tools.length
            ? {
                tools: [
                  {
                    functionDeclarations: tools.map((tool) => {
                      const { $schema, ...parametersJsonSchema } =
                        tool.parameters;
                      return {
                        name: tool.name,
                        description: tool.description,
                        parametersJsonSchema,
                      };
                    }),
                  },
                ],
              }
            : {}),
        },
      });
      requestSignal.throwIfAborted();
      const candidate = result.candidates?.[0];
      if (
        !candidate?.content?.parts?.length ||
        ["SAFETY", "MAX_TOKENS", "MALFORMED_FUNCTION_CALL"].includes(
          candidate.finishReason,
        )
      )
        throw new AppError(
          "Gemini hat keine vollständige Antwort geliefert. Bitte erneut versuchen.",
          502,
        );
      const output = [
        {
          type: "provider_context",
          provider: "gemini",
          content: structuredClone(candidate.content),
        },
      ];
      for (const part of candidate.content.parts) {
        if (part.functionCall)
          output.push({
            type: "function_call",
            name: part.functionCall.name,
            call_id: part.functionCall.id || randomUUID(),
            provider_call_id: part.functionCall.id,
            arguments: JSON.stringify(part.functionCall.args || {}),
          });
        else if (part.text && !part.thought)
          output.push({
            type: "message",
            role: "assistant",
            providerMapped: true,
            content: [{ type: "output_text", text: part.text }],
          });
      }
      return { output, usage: result.usageMetadata };
    } catch (error) {
      throw providerError(error, signal);
    }
  }
  async transcribe(audio, mimeType, language, signal) {
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(90000)])
      : AbortSignal.timeout(90000);
    try {
      requestSignal.throwIfAborted();
      const result = await this.getClient().interactions.create(
        {
          model: this.config.transcriptionModel,
          store: false,
          input: [
            {
              type: "audio",
              data: audio.toString("base64"),
              mime_type:
                { "audio/x-wav": "audio/wav", "audio/mp4": "audio/m4a" }[
                  mimeType
                ] || mimeType,
            },
          ],
          generation_config: {
            transcription_config: {
              language_codes:
                language === "auto"
                  ? []
                  : [{ zh: "zh-CN", en: "en-US", de: "de-DE" }[language]],
              mode: { type: "verbatim" },
            },
          },
        },
        { signal: requestSignal, timeout: 90000, maxRetries: 0 },
      );
      requestSignal.throwIfAborted();
      const text = (
        result.output_text ||
        (result.outputs || [])
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n")
      ).trim();
      if (!text)
        throw new AppError(
          "Keine Sprache erkannt. Bitte erneut aufnehmen.",
          422,
        );
      return { text };
    } catch (error) {
      throw providerError(error, signal);
    }
  }
  async live(instructions, context, signal, onEvent, onClose) {
    const connection = new GeminiLiveSession(
      this.getClient(),
      this.config,
      onEvent,
      onClose,
    );
    try {
      await connection.connect(instructions, context, signal);
      this.sessions.set(connection.id, connection);
      return connection;
    } catch (error) {
      connection.close();
      throw providerError(error, signal);
    }
  }
  async closeLive(id, connection) {
    (connection || this.sessions.get(id))?.close();
    this.sessions.delete(id);
  }
}
