import { GeminiService } from "./gemini.js";
import { OpenAIService } from "./openai.js";
import { ResponsesService } from "./responses.js";
import { PlanBridgeLiveService } from "./planbridge-live.js";

// Each role gets its own provider configuration; keys and model settings cannot
// bleed from Live to transcription, preparation or classroom decisions.
export function createAIServices(config, overrides = {}) {
  const backend = overrides.backend || new ResponsesService(config.backend);
  const teacherAI =
    overrides.teacher ||
    (config.teacher.provider === "gemini"
      ? new GeminiService({
          apiKey: config.teacher.apiKey,
          teacherModel: config.teacher.model,
          teacherThinkingLevel: config.teacher.reasoningEffort,
        })
      : new ResponsesService(config.teacher));
  const LiveService =
    config.live.provider === "chatgptplus"
      ? PlanBridgeLiveService
      : config.live.provider === "gemini"
        ? GeminiService
        : OpenAIService;
  const live =
    overrides.live ||
    new LiveService({
      apiKey: config.live.apiKey,
      liveModel: config.live.model,
      voice: config.live.voice,
      baseUrl: config.live.baseUrl,
    });
  const TranscriptionService =
    config.transcription.provider === "gemini" ? GeminiService : OpenAIService;
  const transcriptionAI =
    overrides.transcription ||
    new TranscriptionService({
      apiKey: config.transcription.apiKey,
      transcriptionModel: config.transcription.model,
    });
  return {
    backend,
    teacherAI,
    transcriptionAI,
    classroomAI: {
      responses: (...args) => backend.responses(...args),
      live: (...args) => {
        backend.assertConfigured();
        return live.live(...args);
      },
      attach: (...args) => live.attach(...args),
      closeLive: (...args) => live.closeLive(...args),
    },
  };
}
