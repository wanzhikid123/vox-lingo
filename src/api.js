import { t as tr, languageLabel } from "./i18n.js";
import { effectiveLocale } from "./language-state.js";
import { uiMessages } from "../shared/ui-messages.js";
export async function api(path, body, options = {}) {
  const response = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
          },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...options,
  });
  const data = await response.json();
  if (!response.ok) {
    const key =
      data.code && data.code !== "operationFailed"
        ? data.code
        : uiMessages[data.error] || effectiveLocale() === "de"
          ? data.error || "operationFailed"
          : "operationFailed";
    const error = new Error(
      tr(key, {
        ...data.params,
        instruction: languageLabel(data.params?.instructionLanguage),
        target: languageLabel(data.params?.targetLanguage),
      }),
    );
    error.code = data.code;
    throw error;
  }
  return data;
}
export const lessonApi = (id, path, body, options) =>
  api(`/lessons/${id}${path}`, body, options);
export const clockText = (ms) =>
  `${Math.floor(ms / 60000)
    .toString()
    .padStart(2, "0")}:${Math.floor((ms / 1000) % 60)
    .toString()
    .padStart(2, "0")}`;
export const dateText = (ms) =>
  new Intl.DateTimeFormat(effectiveLocale(), {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(ms);
