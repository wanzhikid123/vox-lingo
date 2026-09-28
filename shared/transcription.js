export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const MAX_RECORDING_MS = 3 * 60 * 1000;
export const TRANSCRIPTION_LANGUAGES = ["zh", "en", "de"];
export const AUDIO_EXTENSIONS = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
};
export const audioMimeType = (type = "") =>
  type.split(";")[0].trim().toLowerCase();
