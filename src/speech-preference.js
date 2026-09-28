import { DEFAULT_SPEECH_TEMPO } from "../shared/speech.js";
export const SPEECH_TEMPO_KEY = "englishlehrer-speech-tempo";
export function readSpeechTempo() {
  try {
    const value = Number(localStorage.getItem(SPEECH_TEMPO_KEY));
    if (Number.isInteger(value) && value >= 1 && value <= 5) return value;
  } catch {}
  return DEFAULT_SPEECH_TEMPO;
}
