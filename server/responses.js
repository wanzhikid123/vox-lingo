import { AppError } from "./store.js";

// Both providers use stateless Responses requests. Keep complete output items
// (including reasoning context) in memory for the next tool round.
export class ResponsesService {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.config = config;
    this.fetch = fetchImpl;
  }
  assertConfigured() {
    if (!this.config.apiKey)
      throw new AppError(
        `Bitte ${this.config.apiKeyName} als Windows-Umgebungsvariable setzen und das Programm neu starten.`,
        503,
      );
  }
  async responses(input, tools, instructions, signal) {
    this.assertConfigured();
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
      : AbortSignal.timeout(60000);
    const name = this.config.provider === "openai" ? "OpenAI" : "DeepSeek";
    try {
      requestSignal.throwIfAborted();
      const response = await this.fetch(`${this.config.baseUrl}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: requestSignal,
        body: JSON.stringify({
          model: this.config.model,
          instructions,
          input,
          tools,
          reasoning: { effort: this.config.reasoningEffort },
          max_output_tokens: 5000,
          store: false,
          ...(this.config.provider === "openai"
            ? {
                include: ["reasoning.encrypted_content"],
                service_tier: this.config.serviceTier || "auto",
                parallel_tool_calls: false,
              }
            : {}),
        }),
      });
      if (!response.ok) {
        // Never surface upstream bodies: they can echo prompts or credentials.
        const messages = {
          400: `${name}: Modell, Reasoning-Einstellung oder Anfrage nicht unterstützt. Bitte .env prüfen.`,
          401: `${this.config.apiKeyName} wurde nicht akzeptiert.`,
          402: `${name}: Das API-Guthaben ist aufgebraucht.`,
          403: `${name}: Kein Zugriff auf das angeforderte Modell.`,
          404: `${name}: Das konfigurierte Modell ist nicht verfügbar.`,
          429: `${name}: API-Limit oder Guthaben erreicht. Bitte später erneut versuchen.`,
        };
        throw new AppError(
          messages[response.status] ||
            `${name} ist gerade nicht erreichbar. Bitte erneut versuchen.`,
          502,
        );
      }
      const result = await response.json();
      requestSignal.throwIfAborted();
      if (
        result.status !== "completed" ||
        !Array.isArray(result.output) ||
        !result.output.length ||
        result.error
      )
        throw new AppError(
          `${name} hat keine vollständige Antwort geliefert. Bitte erneut versuchen.`,
          502,
        );
      return { output: result.output, usage: result.usage };
    } catch (error) {
      if (signal?.aborted)
        throw new AppError("Die Anfrage wurde beendet.", 409);
      if (error instanceof AppError) throw error;
      if (requestSignal.aborted)
        throw new AppError(
          `${name} hat nicht rechtzeitig geantwortet. Bitte erneut versuchen.`,
          504,
        );
      throw new AppError(
        `${name} ist gerade nicht erreichbar. Bitte erneut versuchen.`,
        502,
      );
    }
  }
}
