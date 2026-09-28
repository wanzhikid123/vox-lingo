import { effectiveLocale } from "./language-state.js";
import { translate } from "../shared/ui-messages.js";
import { languageName } from "../shared/languages.js";
export const t = (key, params = {}) =>
  translate(effectiveLocale(), key, params);
export const languageLabel = (code) => languageName(code, effectiveLocale());
export const numberText = (value) =>
  new Intl.NumberFormat(effectiveLocale()).format(value);
