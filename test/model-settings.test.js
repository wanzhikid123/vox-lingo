import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { loadConfig } from "../server/config.js";
import { ModelSettings } from "../server/model-settings.js";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";

function setup(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "ki-settings-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = {
    OPENAI_API_KEY: "fake-system-openai",
    GEMINI_API_KEY: "fake-system-gemini",
    DEEPSEEK_API_KEY: "fake-system-deepseek",
    PLANBRIDGE_API_KEY: "fake-system-planbridge",
  };
  writeFileSync(
    join(directory, ".env"),
    [
      "GEMINI_VOICE=Aoede",
      "DEEPSEEK_BACKEND_REASONING_EFFORT=max",
      "GEMINI_TEACHER_MODEL=env-gemini-teacher",
      "GEMINI_TEACHER_THINKING_LEVEL=medium",
      "OPENAI_BACKEND_MODEL=env-openai-backend",
      "OPENAI_BACKEND_SERVICE_TIER=auto",
      "OPENAI_TEACHER_SERVICE_TIER=fast",
    ].join("\n"),
  );
  const config = loadConfig(env, directory);
  const file = join(directory, "model-settings.json");
  const factory = (current) =>
    Object.fromEntries(
      [
        ["classroomAI", ["responses", "live", "attach", "closeLive"]],
        ["teacherAI", ["responses"]],
        ["transcriptionAI", ["transcribe"]],
      ].map(([service, methods]) => [
        service,
        Object.fromEntries(
          methods.map((method) => [
            method,
            async () =>
              current[
                service === "teacherAI"
                  ? "teacher"
                  : service === "transcriptionAI"
                    ? "transcription"
                    : method === "responses"
                      ? "backend"
                      : "live"
              ],
          ]),
        ),
      ]),
    );
  const settings = new ModelSettings(config, { file, factory, ...options });
  return { directory, env, config, file, factory, settings };
}
const request = (settings) => {
  const { revision, roles } = settings.state();
  return structuredClone({ revision, roles });
};
test("ChatGPTPlus selection persists independently and restores its own environment configuration", async (t) => {
  const { settings, file, directory, env, factory } = setup(t);
  const draft = request(settings);
  draft.roles.live = { provider: "chatgptplus" };
  settings.save(draft);
  assert.equal(settings.state().options.live.chatgptplus.label, "ChatGPTPlus");
  assert.equal(
    (await settings.classroomAI.live()).apiKeyName,
    "PLANBRIDGE_API_KEY",
  );
  const restored = new ModelSettings(
    loadConfig({ ...env, CHATGPT_CODEX_VOICE: "cove" }, directory),
    { file, factory },
  );
  assert.equal(restored.config.live.provider, "chatgptplus");
  assert.equal(restored.config.live.voice, "cove");
  assert.equal(restored.config.backend.provider, "openai");
  assert.doesNotMatch(
    readFileSync(file, "utf8"),
    /fake-system|apiKey|baseUrl|voice|model/,
  );
});

test("only provider choices persist; runtime parameters always come from environment configuration", async (t) => {
  const { settings, config, file, directory, env, factory } = setup(t);
  const draft = request(settings);
  for (const [role, provider] of Object.entries({
    live: "gemini",
    backend: "deepseek",
    transcription: "gemini",
    teacher: "gemini",
  }))
    draft.roles[role] = { provider };
  assert.equal(config.live.provider, "openai");
  const result = settings.save(draft);
  assert.deepEqual(result.roles, draft.roles);
  assert.equal((await settings.classroomAI.live()).voice, "Aoede");
  assert.equal((await settings.classroomAI.responses()).reasoningEffort, "max");
  assert.equal(
    (await settings.classroomAI.responses()).apiKey,
    env.DEEPSEEK_API_KEY,
  );
  assert.equal(
    (await settings.teacherAI.responses()).model,
    "env-gemini-teacher",
  );
  assert.equal(
    (await settings.teacherAI.responses()).reasoningEffort,
    "medium",
  );
  assert.equal(
    (await settings.transcriptionAI.transcribe()).apiKey,
    env.GEMINI_API_KEY,
  );
  assert.equal(config.teacher.serviceTier, undefined);
  const disk = readFileSync(file, "utf8");
  assert.deepEqual(JSON.parse(disk), { version: 2, roles: draft.roles });
  assert.doesNotMatch(
    disk,
    /fake-system|apiKey|baseUrl|API_KEY|model|voice|reasoningEffort|serviceTier/,
  );
  assert.doesNotMatch(JSON.stringify(result), /fake-system/);
  const restarted = new ModelSettings(
    loadConfig({ ...env, GEMINI_VOICE: "Puck" }, directory),
    { file, factory },
  );
  assert.deepEqual(restarted.state().roles, draft.roles);
  assert.equal((await restarted.classroomAI.live()).voice, "Puck");
  assert.equal(
    (await restarted.teacherAI.responses()).apiKey,
    env.GEMINI_API_KEY,
  );
  const back = request(settings);
  back.roles.backend = { provider: "openai" };
  back.roles.teacher = { provider: "openai" };
  settings.save(back);
  assert.equal(
    (await settings.classroomAI.responses()).model,
    "env-openai-backend",
  );
  assert.equal((await settings.classroomAI.responses()).serviceTier, "auto");
  assert.equal((await settings.teacherAI.responses()).model, "gpt-6-luna");
  assert.equal((await settings.teacherAI.responses()).serviceTier, "auto");
  assert.deepEqual(settings.state().options.teacher.openai.values, {
    provider: "openai",
    model: "gpt-6-luna",
    reasoningEffort: "high",
    serviceTier: "auto",
  });
});

test("legacy settings preserve providers but discard all previously saved parameter overrides", async (t) => {
  const { directory, env, file, factory } = setup(t);
  const roles = {
    live: { provider: "gemini", model: "old-live", voice: "old-voice" },
    backend: {
      provider: "openai",
      model: "gpt-6-sol",
      reasoningEffort: "ultra",
      serviceTier: "fast",
    },
    teacher: {
      provider: "openai",
      model: "gpt-6-astra",
      reasoningEffort: "low",
      serviceTier: "fast",
    },
    transcription: { provider: "gemini", model: "old-transcription" },
  };
  writeFileSync(file, JSON.stringify({ version: 1, roles }));
  const restored = new ModelSettings(loadConfig(env, directory), {
    file,
    factory,
  });
  assert.equal((await restored.classroomAI.live()).voice, "Aoede");
  assert.equal(
    (await restored.classroomAI.responses()).model,
    "env-openai-backend",
  );
  assert.equal((await restored.classroomAI.responses()).reasoningEffort, "low");
  assert.equal((await restored.teacherAI.responses()).model, "gpt-6-luna");
  assert.equal((await restored.teacherAI.responses()).serviceTier, "auto");
  assert.equal(
    (await restored.transcriptionAI.transcribe()).model,
    "gemini-3.5-transcribe",
  );
  restored.save(request(restored));
  assert.equal(JSON.parse(readFileSync(file, "utf8")).version, 2);
  assert.doesNotMatch(
    readFileSync(file, "utf8"),
    /old-|gpt-6|serviceTier|reasoningEffort|voice/,
  );
});

test("rejects provider errors, every non-provider field and stale saves without changing disk", (t) => {
  const { settings, file } = setup(t);
  settings.save(request(settings));
  const original = readFileSync(file, "utf8");
  for (const edit of [
    (roles) => {
      roles.live.provider = "deepseek";
    },
    (roles) => {
      roles.backend.provider = "__proto__";
    },
    ...[
      "apiKey",
      "model",
      "voice",
      "reasoningEffort",
      "serviceTier",
      "baseUrl",
    ].map((field) => (roles) => {
      roles.teacher[field] = "forged-value";
    }),
  ]) {
    const draft = request(settings);
    edit(draft.roles);
    assert.throws(() => settings.save(draft));
    assert.equal(readFileSync(file, "utf8"), original);
  }
  const old = request(settings);
  settings.save(request(settings));
  assert.throws(() => settings.save(old), /anderen Fenster/);
});
test("failed persistence and in-flight calls retain the previous services", async (t) => {
  const { settings, directory, config } = setup(t);
  const blocker = join(directory, "not-a-directory");
  writeFileSync(blocker, "blocked");
  settings.file = join(blocker, "settings.json");
  const draft = request(settings);
  draft.roles.live = settings.state().options.live.gemini.defaults;
  assert.throws(() => settings.save(draft), /nicht gespeichert/);
  assert.equal(config.live.provider, "openai");
  assert.equal((await settings.classroomAI.live()).provider, "openai");
  settings.file = null;
  let finish;
  settings.services.transcriptionAI.transcribe = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const pending = settings.transcriptionAI.transcribe();
  assert.equal(settings.state().busy, true);
  assert.throws(() => settings.save(draft), /laufende Stunde/);
  finish({ text: "hello" });
  await pending;
  settings.save(draft);
  assert.equal(config.live.provider, "gemini");
});

test("settings HTTP enforces local origin, active work guard, persistence and fresh health", async (t) => {
  const { config, settings } = setup(t);
  const store = new Store(":memory:");
  const classroom = { rooms: new Map() };
  const preparation = { active: null };
  const plans = { jobs: new Map() };
  const server = createServer(
    createApp({ store, classroom, config, preparation, plans, settings }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
    store.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = (body, origin) =>
    fetch(base + "/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify(body),
    });
  const response = await fetch(base + "/settings");
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.doesNotMatch(await response.text(), /fake-system/);
  const draft = request(settings);
  draft.roles.live = settings.state().options.live.gemini.defaults;
  assert.equal((await post(draft, "https://foreign.example")).status, 403);
  const lesson = store.create("colors", "settings-test-lesson");
  assert.equal((await post(draft)).status, 409);
  store.finish(lesson.id, "interrupted");
  preparation.active = {};
  assert.equal((await post(draft)).status, 409);
  preparation.active = null;
  plans.jobs.set("pending", { done: false });
  assert.equal((await post(draft)).status, 409);
  plans.jobs.clear();
  classroom.rooms.set("connecting", { connecting: true });
  assert.equal((await post(draft)).status, 409);
  classroom.rooms.clear();
  assert.equal((await post(draft)).status, 200);
  assert.equal(
    (await (await fetch(base + "/health")).json()).live.provider,
    "gemini",
  );
  assert.equal((await post(draft)).status, 409);
});
