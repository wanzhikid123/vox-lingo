import { GoogleGenAI } from "@google/genai";
import { config } from "../server/config.js";

// Read-only model-access check. Never sends learner data or prints credentials.
const checked = new Map();
for (const name of ["live", "backend", "teacher", "transcription"]) {
  const role = config[name];
  const identity = `${role.provider}/${role.model}`;
  let result = checked.get(identity);
  if (!result) {
    result = {
      provider: role.provider,
      model: role.model,
      keyConfigured: Boolean(role.apiKey),
    };
    if (!role.apiKey) result.status = `missing ${role.apiKeyName}`;
    else
      try {
        if (role.provider === "gemini") {
          const client = new GoogleGenAI({
            apiKey: role.apiKey,
            httpOptions: { apiVersion: "v1beta", timeout: 20000 },
          });
          await client.models.get({ model: role.model });
          result.status = "model accessible";
        } else {
          const url =
            role.provider === "openai"
              ? `https://api.openai.com/v1/models/${encodeURIComponent(role.model)}`
              : "https://api.deepseek.com/models";
          const response = await fetch(url, {
            headers: { Authorization: `Bearer ${role.apiKey}` },
            signal: AbortSignal.timeout(20000),
          });
          if (!response.ok) result.status = `HTTP ${response.status}`;
          else {
            const body = await response.json();
            result.status = (
              role.provider === "openai"
                ? body.id === role.model
                : body.data?.some((model) => model.id === role.model)
            )
              ? "model accessible"
              : "model not listed";
          }
        }
      } catch {
        result.status = "model check failed or timed out";
      }
    checked.set(identity, result);
  }
  console.log(JSON.stringify({ role: name, ...result }));
  if (result.status !== "model accessible") process.exitCode = 1;
}
