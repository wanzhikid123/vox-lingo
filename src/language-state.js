import { useSyncExternalStore } from "react";
import { defaultLanguages } from "../shared/languages.js";

let state = { revision: null, languages: defaultLanguages, preview: null };
const listeners = new Set();
const publish = (next) => {
  state = { ...state, ...next };
  document.documentElement.lang =
    state.preview || state.languages.interfaceLanguage;
  for (const listener of listeners) listener();
};
export const languageState = () => state;
export const effectiveLocale = () =>
  state.preview || state.languages.interfaceLanguage;
export const previewLanguage = (preview) => publish({ preview });
export const acceptLanguages = ({ revision, languages }) =>
  publish({ revision, languages });
export function useLanguages() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, languageState);
}
