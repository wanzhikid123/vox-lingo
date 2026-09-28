import express from "express";
import { AppError } from "./store.js";
import {
  AUDIO_EXTENSIONS,
  MAX_AUDIO_BYTES,
  TRANSCRIPTION_LANGUAGES,
  audioMimeType,
} from "../shared/transcription.js";

export function transcriptionRouter(ai) {
  const router = express.Router();
  router.post(
    "/",
    (req, _res, next) => {
      if (
        !Object.hasOwn(AUDIO_EXTENSIONS, audioMimeType(req.get("Content-Type")))
      )
        return next(
          new AppError("Dieses Aufnahmeformat wird nicht unterstützt.", 415),
        );
      next();
    },
    express.raw({ type: () => true, limit: MAX_AUDIO_BYTES, inflate: false }),
    async (req, res) => {
      const language =
        req.query.language === "cn" ? "zh" : (req.query.language ?? "auto");
      if (!["auto", ...TRANSCRIPTION_LANGUAGES].includes(language))
        throw new AppError(
          "Bitte Chinesisch, Englisch, Deutsch oder Automatisch wählen.",
        );
      if (!Buffer.isBuffer(req.body) || !req.body.length)
        throw new AppError("Die Aufnahme ist leer. Bitte erneut aufnehmen.");
      const controller = new AbortController();
      const cancel = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.on("close", cancel);
      try {
        const result = await ai.transcribe(
          req.body,
          audioMimeType(req.get("Content-Type")),
          language,
          controller.signal,
        );
        if (!res.destroyed) res.json(result);
      } finally {
        res.off("close", cancel);
      }
    },
  );
  router.use((error, _req, _res, next) => {
    next(
      error.type === "entity.too.large"
        ? new AppError(
            "Die Aufnahme ist zu groß. Bitte kürzer als drei Minuten aufnehmen.",
            413,
          )
        : error,
    );
  });
  return router;
}
