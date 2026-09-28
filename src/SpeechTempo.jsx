import { t as tr } from "./i18n.js";
import React, { useEffect, useRef, useState } from "react";
import { lessonApi } from "./api.js";
import { TEMPO_LABELS } from "../shared/speech.js";
import { readSpeechTempo, SPEECH_TEMPO_KEY } from "./speech-preference.js";
export function SpeechTempo({ lessonId, connected }) {
  const [tempo, setTempo] = useState(readSpeechTempo);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    let current = true;
    if (!connected) {
      setMessage("Für die nächste Verbindung");
      return;
    }
    setMessage("Wird eingestellt …");
    const timer = setTimeout(() => {
      queue.current = queue.current
        .catch(() => {})
        .then(async () => {
          if (!current) return;
          try {
            await lessonApi(lessonId, "/speech-tempo", {
              tempo,
            });
            if (current) setMessage("Ab dem nächsten Satz");
          } catch {
            if (current) setMessage("Nicht übernommen · erneut versuchen");
          }
        });
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [lessonId, connected, tempo, retry]);
  return (
    <div className="speech-tempo">
      <label htmlFor="speech-tempo">
        {" "}
        {tr("Sprechtempo")} <strong>{tr(TEMPO_LABELS[tempo])}</strong>
      </label>
      <input
        id="speech-tempo"
        type="range"
        min="1"
        max="5"
        step="1"
        value={tempo}
        aria-valuetext={tr(TEMPO_LABELS[tempo])}
        onChange={(event) => {
          const value = Number(event.target.value);
          setTempo(value);
          try {
            localStorage.setItem(SPEECH_TEMPO_KEY, String(value));
          } catch {}
        }}
      />
      {message.startsWith("Nicht") ? (
        <button className="tempo-retry" onClick={() => setRetry((n) => n + 1)}>
          {tr(message)}
        </button>
      ) : (
        <small aria-live="polite">{tr(message)}</small>
      )}
    </div>
  );
}
