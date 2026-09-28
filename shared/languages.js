import { z } from "zod";

export const interfaceLanguages = ["en", "de", "zh-CN"];
export const instructionLanguages = interfaceLanguages;
export const targetLanguages = ["en", "de", "ja", "ko", "fr", "es"];
export const defaultLanguages = Object.freeze({
  interfaceLanguage: "de",
  instructionLanguage: "de",
  targetLanguage: "en",
});
export const languageNames = {
  en: ["English", "Englisch", "英语", "English"],
  de: ["German", "Deutsch", "德语", "Deutsch"],
  "zh-CN": ["Chinese", "Chinesisch", "中文", "简体中文"],
  ja: ["Japanese", "Japanisch", "日语", "日本語"],
  ko: ["Korean", "Koreanisch", "韩语", "한국어"],
  fr: ["French", "Französisch", "法语", "Français"],
  es: ["Spanish", "Spanisch", "西班牙语", "Español"],
};
export function languageName(code, locale = "en") {
  return languageNames[code]?.[interfaceLanguages.indexOf(locale)] || code;
}
export const canonicalLanguage = (value) =>
  ({ cn: "zh-CN", zh: "zh-CN", jp: "ja", kr: "ko" })[value] || value;
export const languageSettingsSchema = z.object({
  interfaceLanguage: z.enum(interfaceLanguages),
  instructionLanguage: z.enum(instructionLanguages),
  targetLanguage: z.enum(targetLanguages),
});
export function normalizeLanguages(raw) {
  return languageSettingsSchema.parse(
    Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [
        key,
        canonicalLanguage(value),
      ]),
    ),
  );
}
export function lessonLanguages(value = {}) {
  return {
    instructionLanguage: canonicalLanguage(value.instructionLanguage) || "de",
    targetLanguage: canonicalLanguage(value.targetLanguage) || "en",
  };
}
export function languageInstruction(value) {
  const { instructionLanguage, targetLanguage } = lessonLanguages(value);
  return `Lesson languages: instructionLanguage=${instructionLanguage} (${languageName(instructionLanguage)}), targetLanguage=${targetLanguage} (${languageName(targetLanguage)}). All explanations, prompts, feedback and farewell must be in the instruction language. Vocabulary, examples and spoken answers must be in the target language. Preserve transcripts verbatim; never translate or invent the child's answer. ${instructionLanguage === targetLanguage ? "Both languages are the same: use a simple definition, picture or context clue, never a translation of a word into itself. The meaning field must be a short definition that does not reveal the answer." : "The meaning field is a short meaning in the instruction language."}`;
}
export const speechLanguageCodes = (value) =>
  [...new Set(Object.values(lessonLanguages(value)))].map(
    (code) =>
      ({
        en: "en-US",
        de: "de-DE",
        "zh-CN": "zh-CN",
        ja: "ja-JP",
        ko: "ko-KR",
        fr: "fr-FR",
        es: "es-ES",
      })[code],
  );

// All old JSON enters through these adapters; new writes use neutral fields.
export function normalizePractice(raw) {
  if (!raw) return raw;
  const { german, ...value } = raw;
  return {
    ...value,
    ...(value.meaning !== undefined || german !== undefined
      ? { meaning: value.meaning ?? german }
      : {}),
    mode:
      { german_choice: "meaning_choice", german_speak: "meaning_speak" }[
        value.mode
      ] || value.mode,
  };
}
export function normalizeTopic(raw) {
  if (!raw) return raw;
  const { english, ...value } = raw;
  return {
    ...value,
    targetTitle: value.targetTitle ?? english,
    targetLanguage: canonicalLanguage(value.targetLanguage) || "en",
    sourceTopicId: value.sourceTopicId ?? null,
    descriptionLanguages: {
      name: null,
      goal: null,
      level: null,
      teachingNotes: null,
      ...value.descriptionLanguages,
    },
  };
}
export function normalizePlan(raw) {
  return raw
    ? {
        ...raw,
        ...lessonLanguages(raw),
        steps: raw.steps.map(normalizePractice),
      }
    : raw;
}
export const knowledgeKey = (value) =>
  String(value).normalize("NFC").trim().toLowerCase();
