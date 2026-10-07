import {
  resolve,
  relative,
  isAbsolute,
  dirname,
  basename,
  join,
} from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { parseEnv } from "node:util";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const reasoningLevels = {
  openai: ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"],
  deepseek: ["none", "low", "high", "max"],
  gemini: ["minimal", "low", "medium", "high"],
};
export const roleProviders = {
  live: ["openai", "gemini", "chatgptplus"],
  backend: ["openai", "deepseek"],
  transcription: ["openai", "gemini"],
  teacher: ["openai", "gemini", "deepseek"],
};
const defaults = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-6-luna" },
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-flash" },
  gemini: { model: "gemini-3.5-flash-lite" },
};
function canonical(path) {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return parent === path ? path : join(canonical(parent), basename(path));
}
export function loadConfig(env = process.env, directory = root) {
  const path = resolve(directory, ".env");
  const file = existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
  const setting = (key, fallback) =>
    env[key]?.trim() || file[key]?.trim() || fallback;
  const choice = (key, fallback, allowed, strict = true) => {
    const value = setting(key, fallback).toLowerCase();
    if (!allowed.includes(value) && strict)
      throw new Error(`${key} must be ${allowed.join(", ")}.`);
    return allowed.includes(value) ? value : fallback;
  };
  const credential = (provider) => {
    const apiKeyName = `${provider.toUpperCase()}_API_KEY`;
    return {
      apiKeyName,
      apiKey:
        env[apiKeyName]?.trim() || env[apiKeyName.toLowerCase()]?.trim() || "",
    };
  };
  const textModel = (role, provider, strict = true) => {
    const prefix = `${provider.toUpperCase()}_${role}`;
    return {
      provider,
      ...credential(provider),
      ...defaults[provider],
      model: setting(`${prefix}_MODEL`, defaults[provider].model),
      reasoningEffort: choice(
        `${prefix}_${role === "TEACHER" ? "THINKING_LEVEL" : "REASONING_EFFORT"}`,
        role === "TEACHER" ? "high" : "low",
        reasoningLevels[provider],
        strict,
      ),
      ...(provider === "openai"
        ? {
            serviceTier:
              role === "TEACHER"
                ? "auto"
                : choice(
                    `${prefix}_SERVICE_TIER`,
                    "fast",
                    ["auto", "fast"],
                    strict,
                  ),
          }
        : {}),
    };
  };
  const liveModel = (provider) => ({
    provider,
    ...credential(provider === "chatgptplus" ? "planbridge" : provider),
    ...(provider === "chatgptplus"
      ? { baseUrl: setting("PLANBRIDGE_BASE_URL", "http://miniserver:8787/v1") }
      : {}),
    model: setting(
      provider === "chatgptplus"
        ? "PLANBRIDGE_LIVE_MODEL"
        : provider === "openai"
          ? "GPT_LIVE_MODEL"
          : "GEMINI_LIVE_MODEL",
      provider === "chatgptplus"
        ? "gpt-live-1-codex"
        : provider === "openai"
          ? "gpt-live-1"
          : "gemini-3.8-live",
    ),
    voice: setting(
      provider === "chatgptplus"
        ? "CHATGPT_CODEX_VOICE"
        : provider === "openai"
          ? "GPT_VOICE"
          : "GEMINI_VOICE",
      provider === "chatgptplus"
        ? "sol"
        : provider === "openai"
          ? "marin"
          : "Kore",
    ),
  });
  const transcriptionModel = (provider) => ({
    provider,
    ...credential(provider),
    model: setting(
      provider === "openai"
        ? "GPT_TRANSCRIPTION_MODEL"
        : "GEMINI_TRANSCRIPTION_MODEL",
      provider === "openai" ? "gpt-transcribe" : "gemini-3.5-transcribe",
    ),
  });
  const selected = {},
    modelDefaults = {};
  for (const [role, providers] of Object.entries(roleProviders)) {
    const provider = choice(
      `${role.toUpperCase()}_MODEL_PROVIDER`,
      "openai",
      providers,
    );
    modelDefaults[role] = Object.fromEntries(
      providers.map((candidate) => [
        candidate,
        role === "live"
          ? liveModel(candidate)
          : role === "transcription"
            ? transcriptionModel(candidate)
            : textModel(role.toUpperCase(), candidate, candidate === provider),
      ]),
    );
    selected[role] = modelDefaults[role][provider];
  }
  const plus = modelDefaults.live.chatgptplus;
  const gateway = new URL(plus.baseUrl);
  if (
    !["http:", "https:"].includes(gateway.protocol) ||
    gateway.username ||
    gateway.password ||
    gateway.search ||
    gateway.hash ||
    !/^\/v1\/?$/.test(gateway.pathname)
  )
    throw new Error(
      "PLANBRIDGE_BASE_URL must be an HTTP(S) URL ending in /v1 without credentials or query parameters.",
    );
  plus.baseUrl = plus.baseUrl.replace(/\/$/, "");
  if (plus.model !== "gpt-live-1-codex")
    throw new Error("PLANBRIDGE_LIVE_MODEL must be gpt-live-1-codex.");
  if (
    ![
      "arbor",
      "breeze",
      "cove",
      "ember",
      "juniper",
      "maple",
      "sol",
      "spruce",
      "vale",
    ].includes(plus.voice)
  )
    throw new Error("Invalid CHATGPT_CODEX_VOICE.");
  const port = Number(setting("KI_PORT", "3212"));
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid KI_PORT.");
  const dataDir = canonical(resolve(directory, setting("KI_DATA_DIR", "data")));
  for (const referenceName of [
    "EnglishLehrer",
    "EnglishLehrerGemini",
    "KI-Englischlehrerin",
  ]) {
    const reference = canonical(resolve(directory, "..", referenceName));
    if (reference === canonical(resolve(directory))) continue;
    const within = relative(reference, dataDir);
    if (
      !within ||
      (!within.startsWith(`..\\`) &&
        !within.startsWith("../") &&
        within !== ".." &&
        !isAbsolute(within))
    )
      throw new Error(
        "KI_DATA_DIR must not point into a read-only source project. Copy its data into this project first.",
      );
  }
  return { port, dataDir, ...selected, modelDefaults };
}
export function publicConfig(config) {
  const visible = ({
    provider,
    model,
    voice,
    reasoningEffort,
    serviceTier,
    apiKeyName,
    apiKey,
    baseUrl,
  }) => ({
    provider,
    model,
    voice,
    reasoningEffort,
    serviceTier,
    apiKeyName,
    keyConfigured: Boolean(apiKey),
    ...(provider === "chatgptplus" ? { baseUrl } : {}),
  });
  const missingClassroomKeys = [
    ...new Set(
      [config.live, config.backend]
        .filter((role) => !role.apiKey)
        .map((role) => role.apiKeyName),
    ),
  ];
  return {
    ok: true,
    app: "KI-Englischlehrerin",
    live: visible(config.live),
    backend: visible(config.backend),
    teacher: visible(config.teacher),
    transcription: visible(config.transcription),
    classroomKeyConfigured: missingClassroomKeys.length === 0,
    missingClassroomKeys,
  };
}
export const config = loadConfig();
