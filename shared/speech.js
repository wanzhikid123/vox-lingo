export const DEFAULT_SPEECH_TEMPO = 3;
export const TEMPO_LABELS = [
  "",
  "Sehr langsam",
  "Langsam",
  "Normal",
  "Zügig",
  "Schnell",
];
export function speechTempoInstruction(tempo = DEFAULT_SPEECH_TEMPO) {
  const pace = [
    "",
    "sehr langsam und deutlich",
    "etwas langsamer als normal",
    "in natürlichem, normalem Gesprächstempo ohne künstliches Dehnen",
    "zügig und flüssig, mit kurzen natürlichen Satzpausen",
    "schnell und flüssig, aber weiterhin klar verständlich",
  ][tempo];
  return `Aktuelle Sprechtempo-Einstellung: ${tempo}/5 (${TEMPO_LABELS[tempo]}). Sprich ab dem nächsten Satz ${pace}. Diese Einstellung ersetzt frühere Tempo-Vorgaben. Lernwörter in der Zielsprache klar aussprechen. Die Unterrichtssprache bleibt unverändert. Die Antwortzeit des Kindes bleibt unverändert: nach einer Aufgabe geduldig warten. Die Änderung nicht ansagen und dafür keine neue Aufgabe beginnen.`;
}
