import { join } from "node:path";
import { config } from "./config.js";
import { Store } from "./store.js";
import { ModelSettings } from "./model-settings.js";
import { Classroom } from "./classroom.js";
import { createApp } from "./app.js";
import { Preparation } from "./preparation.js";
import { LessonPlans } from "./lesson-plans.js";
import { attachLiveTransport } from "./live-transport.js";
import { backupBeforeMigration } from "./migration-backup.js";
const migrationBackup = backupBeforeMigration(config.dataDir);
if (migrationBackup) console.log(`Data backup: ${migrationBackup}`);
const store = new Store(join(config.dataDir, "learning.sqlite"));
const settings = new ModelSettings(config);
const { teacherAI, transcriptionAI, classroomAI } = settings;
const classroom = new Classroom(store, classroomAI, config);
const preparation = new Preparation(store, teacherAI);
const plans = new LessonPlans(store, teacherAI, config);
const app = createApp({
  store,
  classroom,
  config,
  preparation,
  ai: transcriptionAI,
  plans,
  settings,
  shutdown: () =>
    stop()
      .then(() => process.exit())
      .catch(() => {
        process.exitCode = 1;
      }),
});
const server = app.listen(config.port, "127.0.0.1", () => {
  // Recover only after owning the port. A second launch must not interrupt the running instance.
  store.recoverPreparation();
  for (const lesson of store.recover()) {
    // Legacy Gemini sessions used local UUIDs. Preserve cleanup of legacy
    // OpenAI IDs without assuming an undocumented OpenAI ID prefix.
    const provider =
      store.lesson(lesson.id).state.liveProvider ||
      (/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(
        lesson.remote_id || "",
      )
        ? "gemini"
        : "openai");
    if (
      ["openai", "chatgptplus"].includes(config.live.provider) &&
      provider === config.live.provider &&
      lesson.remote_id
    )
      if (provider === "chatgptplus")
        classroom.restoreLive(lesson.id, lesson.remote_id).catch(() => {});
      else classroomAI.closeLive(lesson.remote_id).catch(() => {});
  }
  if (config.live.provider === "chatgptplus") {
    for (const row of store.db
      .prepare(
        "SELECT id,state FROM lessons WHERE json_extract(state, '$.liveCloseUnconfirmed')=1",
      )
      .all()) {
      const retained = JSON.parse(row.state);
      if (
        retained.liveProvider === "chatgptplus" &&
        retained.liveCloseSessionId &&
        !classroom.rooms.get(row.id)?.remoteClosing
      )
        classroom
          .restoreLive(row.id, retained.liveCloseSessionId)
          .catch(() => {});
    }
  }
  console.log(
    `KI-Englischlehrerin ist bereit: http://127.0.0.1:${config.port}\nLive: ${config.live.provider}; Backend: ${config.backend.provider}; Teacher: ${config.teacher.provider}; Transcription: ${config.transcription.provider}`,
  );
});
const media = attachLiveTransport(server, classroom, config);
server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? "KI-Englischlehrerin läuft bereits oder der Port ist belegt."
      : "Der lokale Server konnte nicht gestartet werden.",
  );
  process.exitCode = 1;
  store.close();
});
const sweep = setInterval(() => classroom.sweep().catch(() => {}), 10000);
sweep.unref();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(sweep);
  await classroom.shutdown();
  await preparation.shutdown();
  await plans.shutdown();
  media.close();
  server.close();
  server.closeAllConnections();
  store.close();
}
process.on("SIGINT", () => stop().finally(() => process.exit()));
process.on("SIGTERM", () => stop().finally(() => process.exit()));
