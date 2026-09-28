// Match an actual farewell, not a lesson about the word or a negated request.
export function isGoodbye(
  text,
  languages = { instructionLanguage: "de", targetLanguage: "en" },
) {
  const words = String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}\s]/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
  const patterns = {
    de: /^(?:(?:okay|ok|ja|gut|danke|vielen dank|mia|und|also|dann)\s+)*(?:tschüss(?:chen|i)?|tschuess(?:chen|i)?|tüss(?:che|chen)?|tüssche|tschüs|tschüß|tschau|ciao|auf wiedersehen)(?:\s+(?:mia|danke|bis bald|bis morgen|bis zum nächsten mal))*$/,
    en: /^(?:(?:okay|ok|thanks|thank you)\s+)*(?:bye(?: bye)?|goodbye|see you)(?:\s+(?:mia|thanks|thank you|later))*$/,
    "zh-CN": /^(?:谢谢\s*)?(?:再见|拜拜|下次见)(?:\s*(?:mia|老师|米娅))?$/,
    ja: /^(?:さようなら|さよなら|またね|バイバイ)$/,
    ko: /^(?:안녕히 계세요|안녕히 가세요|잘 가|다음에 봐요)$/,
    fr: /^(?:au revoir|à bientôt|à la prochaine)(?:\s+mia)?$/,
    es: /^(?:adiós|hasta luego|hasta pronto)(?:\s+mia)?$/,
  };
  return [
    ...new Set([languages.instructionLanguage, languages.targetLanguage]),
  ].some((code) => patterns[code]?.test(words));
}
