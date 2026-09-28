import { t as tr } from "./i18n.js";
import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import {
  AUDIO_EXTENSIONS,
  MAX_AUDIO_BYTES,
  MAX_RECORDING_MS,
  audioMimeType,
} from "../shared/transcription.js";
function releaseMicrophone(job) {
  clearInterval(job.clock);
  clearTimeout(job.limit);
  job.stream?.getTracks().forEach((track) => track.stop());
  job.stream = null;
}
function discard(job) {
  if (!job) return;
  job.controller.abort();
  if (job.recorder) {
    job.recorder.ondataavailable = null;
    job.recorder.onstop = null;
    job.recorder.onerror = null;
    if (job.recorder.state !== "inactive") job.recorder.stop();
  }
  releaseMicrophone(job);
  job.chunks = [];
}
export function useDictation({ onTranscript, onError }) {
  const [status, setStatus] = useState("idle");
  const [elapsed, setElapsed] = useState(0);
  const active = useRef(null);
  const callbacks = useRef({
    onTranscript,
    onError,
  });
  callbacks.current = {
    onTranscript,
    onError,
  };
  function cancel() {
    const job = active.current;
    active.current = null;
    discard(job);
    setStatus("idle");
  }
  useEffect(() => {
    const abandon = () => {
      const job = active.current;
      active.current = null;
      discard(job);
    };
    const onPageHide = () => {
      abandon();
      setStatus("idle");
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      abandon();
    };
  }, []);
  function stop() {
    const job = active.current;
    if (!job?.recorder || job.recorder.state === "inactive") return;
    setStatus("transcribing");
    job.recorder.stop();
    releaseMicrophone(job);
  }
  async function start(language) {
    if (active.current) return;
    callbacks.current.onError("");
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      callbacks.current.onError(
        tr(
          "Sprachaufnahme ist hier nicht verfügbar. Bitte Chrome oder Edge auf diesem Computer verwenden.",
        ),
      );
      return;
    }
    const job = {
      controller: new AbortController(),
      chunks: [],
      bytes: 0,
    };
    active.current = job;
    setStatus("requesting");
    setElapsed(0);
    const fail = (message) => {
      if (active.current !== job) return;
      active.current = null;
      discard(job);
      setStatus("idle");
      callbacks.current.onError(message);
    };
    try {
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
        "audio/ogg",
        "audio/wav",
        "audio/mpeg",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType)
        throw new Error(
          "Kein unterstütztes Aufnahmeformat. Bitte Chrome oder Edge verwenden.",
        );
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (active.current !== job) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      job.stream = stream;
      const recorder = (job.recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 64000,
      }));
      recorder.ondataavailable = ({ data }) => {
        if (active.current !== job || !data.size) return;
        job.bytes += data.size;
        if (job.bytes > MAX_AUDIO_BYTES) {
          fail(
            tr(
              "Die Aufnahme ist zu groß. Bitte eine kürzere Nachricht aufnehmen.",
            ),
          );
          return;
        }
        job.chunks.push(data);
      };
      recorder.onerror = () =>
        fail(tr("Die Aufnahme wurde unterbrochen. Bitte erneut versuchen."));
      recorder.onstop = async () => {
        releaseMicrophone(job);
        if (active.current !== job) return;
        setStatus("transcribing");
        try {
          const type = audioMimeType(recorder.mimeType || mimeType);
          if (!Object.hasOwn(AUDIO_EXTENSIONS, type))
            throw new Error("Dieses Aufnahmeformat wird nicht unterstützt.");
          const blob = new Blob(job.chunks, {
            type,
          });
          job.chunks = [];
          if (!blob.size)
            throw new Error("Die Aufnahme ist leer. Bitte erneut aufnehmen.");
          const result = await api(
            `/preparation/transcribe?language=${encodeURIComponent(language)}`,
            undefined,
            {
              method: "POST",
              headers: {
                "Content-Type": type,
              },
              body: blob,
              signal: AbortSignal.any([
                job.controller.signal,
                AbortSignal.timeout(100000),
              ]),
            },
          );
          if (active.current !== job) return;
          if (!result.text?.trim())
            throw new Error("Keine Sprache erkannt. Bitte erneut aufnehmen.");
          active.current = null;
          setStatus("idle");
          callbacks.current.onTranscript(result.text.trim());
        } catch (error) {
          fail(
            error.name === "TimeoutError"
              ? tr(
                  "Die Spracherkennung dauert zu lange. Bitte erneut versuchen.",
                )
              : error instanceof TypeError
                ? tr(
                    "Die Verbindung zur Spracherkennung ist fehlgeschlagen. Bitte erneut versuchen.",
                  )
                : error.message,
          );
        }
      };
      recorder.start(1000);
      const started = Date.now();
      setStatus("recording");
      job.clock = setInterval(() => setElapsed(Date.now() - started), 250);
      job.limit = setTimeout(stop, MAX_RECORDING_MS);
      stream.getAudioTracks().forEach((track) =>
        track.addEventListener("ended", stop, {
          once: true,
        }),
      );
    } catch (error) {
      const messages = {
        NotAllowedError: tr(
          "Mikrofonzugriff wurde nicht erlaubt. Bitte die Mikrofonberechtigung im Browser aktivieren.",
        ),
        NotFoundError: tr(
          "Kein Mikrofon gefunden. Bitte ein Mikrofon anschließen.",
        ),
        NotReadableError: tr(
          "Das Mikrofon ist nicht verfügbar. Bitte andere Aufnahmen beenden und erneut versuchen.",
        ),
      };
      fail(
        messages[error.name] ||
          error.message ||
          tr("Die Aufnahme konnte nicht gestartet werden."),
      );
    }
  }
  return {
    status,
    elapsed,
    start,
    stop,
    cancel,
  };
}
