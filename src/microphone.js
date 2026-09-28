import { t as tr } from "./i18n.js";
export async function microphone() {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error("Bitte öffne die Seite in Chrome über die lokale Adresse.");
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  } catch (e) {
    const messages = {
      NotAllowedError: tr(
        "Bitte erlaube das Mikrofon in Chrome (Symbol links neben der Adresse) und versuche es erneut.",
      ),
      NotFoundError: tr(
        "Kein Mikrofon gefunden. Bitte schließe ein Mikrofon an.",
      ),
      NotReadableError: tr(
        "Das Mikrofon ist gerade nicht verfügbar. Schließe andere Programme, die es verwenden.",
      ),
    };
    throw new Error(
      messages[e.name] ||
        "Das Mikrofon konnte nicht gestartet werden. Bitte überprüfe es und versuche es erneut.",
    );
  }
}
