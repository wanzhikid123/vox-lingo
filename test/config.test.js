import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, publicConfig } from "../server/config.js";

test("OpenAI Teacher tier always stays auto even when environment overrides request fast", (t) => {
  const dir = directory(t);
  writeFileSync(
    join(dir, ".env"),
    "OPENAI_TEACHER_SERVICE_TIER=fast\nOPENAI_BACKEND_SERVICE_TIER=auto\n",
  );
  for (const tier of ["fast", "invalid", "auto"]) {
    const config = loadConfig(
      {
        OPENAI_TEACHER_SERVICE_TIER: tier,
        OPENAI_BACKEND_SERVICE_TIER: "fast",
      },
      dir,
    );
    assert.equal(config.teacher.serviceTier, "auto");
    assert.equal(config.modelDefaults.teacher.openai.serviceTier, "auto");
    assert.equal(config.backend.serviceTier, "fast");
  }
  assert.equal(loadConfig({}, dir).backend.serviceTier, "auto");
});

function directory(t) {
  const dir = mkdtempSync(join(tmpdir(), "ki-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test("all 24 provider combinations select their own credentials and models", (t) => {
  const dir = directory(t);
  const keys = {
    OPENAI_API_KEY: "test-openai",
    GEMINI_API_KEY: "test-gemini",
    DEEPSEEK_API_KEY: "test-deepseek",
  };
  for (const live of ["openai", "gemini"])
    for (const backend of ["openai", "deepseek"])
      for (const transcription of ["openai", "gemini"])
        for (const teacher of ["openai", "gemini", "deepseek"]) {
          const config = loadConfig(
            {
              ...keys,
              LIVE_MODEL_PROVIDER: live.toUpperCase(),
              BACKEND_MODEL_PROVIDER: backend,
              TRANSCRIPTION_MODEL_PROVIDER: transcription,
              TEACHER_MODEL_PROVIDER: teacher,
            },
            dir,
          );
          for (const [role, provider] of Object.entries({
            live,
            backend,
            transcription,
            teacher,
          })) {
            assert.equal(config[role].provider, provider);
            assert.equal(
              config[role].apiKey,
              keys[`${provider.toUpperCase()}_API_KEY`],
            );
            assert.equal(
              config[role].apiKeyName,
              `${provider.toUpperCase()}_API_KEY`,
            );
          }
          assert.equal(
            config.live.model,
            live === "openai" ? "gpt-live-1" : "gemini-3.8-live",
          );
          assert.equal(config.live.voice, live === "openai" ? "marin" : "Kore");
          assert.equal(config.teacher.reasoningEffort, "high");
          assert.equal(config.backend.reasoningEffort, "low");
          assert.equal(
            config.backend.serviceTier,
            backend === "openai" ? "fast" : undefined,
          );
          assert.equal(
            config.teacher.serviceTier,
            teacher === "openai" ? "auto" : undefined,
          );
          assert.doesNotMatch(
            JSON.stringify(publicConfig(config)),
            /test-openai|test-gemini|test-deepseek/,
          );
        }
});
test("env file is annotated configuration with system precedence, per-role isolation and lowercase legacy key", (t) => {
  const dir = directory(t);
  writeFileSync(
    join(dir, ".env"),
    `# local configuration
KI_PORT=3222
KI_DATA_DIR=local-data
LIVE_MODEL_PROVIDER=GEMINI
GEMINI_VOICE=Aoede
GEMINI_API_KEY=disk-gemini
OPENAI_API_KEY=disk-openai
OPENAI_BACKEND_MODEL=custom-backend
OPENAI_TEACHER_MODEL=custom-teacher
OPENAI_BACKEND_SERVICE_TIER=auto
TRANSCRIPTION_MODEL_PROVIDER=GEMINI
`,
  );
  const config = loadConfig(
    {
      openai_api_key: "system-openai",
      GEMINI_API_KEY: "system-gemini",
      OPENAI_BACKEND_SERVICE_TIER: "fast",
      GPT_LIVE_MODEL: "inactive",
    },
    dir,
  );
  assert.equal(config.port, 3222);
  assert.equal(config.dataDir, join(dir, "local-data"));
  assert.equal(config.live.apiKey, "system-gemini");
  assert.equal(config.live.voice, "Aoede");
  assert.equal(config.live.model, "gemini-3.8-live");
  assert.equal(config.backend.apiKey, "system-openai");
  assert.equal(config.backend.model, "custom-backend");
  assert.equal(config.teacher.model, "custom-teacher");
  assert.equal(config.backend.serviceTier, "fast");
  assert.equal(config.teacher.serviceTier, "auto");
  const fileOnly = loadConfig({}, dir);
  for (const role of ["live", "backend", "teacher", "transcription"])
    assert.equal(fileOnly[role].apiKey, "");
  assert.equal(publicConfig(fileOnly).classroomKeyConfigured, false);
  const missing = loadConfig(
    {
      LIVE_MODEL_PROVIDER: "gemini",
      BACKEND_MODEL_PROVIDER: "deepseek",
      OPENAI_API_KEY: "wrong-provider",
    },
    directory(t),
  );
  assert.deepEqual(publicConfig(missing).missingClassroomKeys, [
    "GEMINI_API_KEY",
    "DEEPSEEK_API_KEY",
  ]);
});
test("invalid selected provider, effort, tier and port fail clearly; inactive settings are ignored", (t) => {
  const dir = directory(t);
  for (const key of [
    "LIVE_MODEL_PROVIDER",
    "BACKEND_MODEL_PROVIDER",
    "TEACHER_MODEL_PROVIDER",
    "TRANSCRIPTION_MODEL_PROVIDER",
  ]) {
    for (const value of ["__proto__", "invalid"])
      assert.throws(() => loadConfig({ [key]: value }, dir), new RegExp(key));
  }
  for (const port of ["NaN", "0", "65536", "32.5"])
    assert.throws(() => loadConfig({ KI_PORT: port }, dir), /KI_PORT/);
  assert.throws(
    () => loadConfig({ OPENAI_BACKEND_SERVICE_TIER: "flex" }, dir),
    /SERVICE_TIER/,
  );
  assert.throws(
    () =>
      loadConfig(
        {
          TEACHER_MODEL_PROVIDER: "gemini",
          GEMINI_TEACHER_THINKING_LEVEL: "fast",
        },
        dir,
      ),
    /THINKING_LEVEL/,
  );
  assert.throws(
    () =>
      loadConfig(
        {
          BACKEND_MODEL_PROVIDER: "deepseek",
          DEEPSEEK_BACKEND_REASONING_EFFORT: "xhigh",
        },
        dir,
      ),
    /REASONING_EFFORT/,
  );
  assert.equal(
    loadConfig({ GEMINI_TEACHER_THINKING_LEVEL: "invalid" }, dir).teacher
      .provider,
    "openai",
  );
  assert.equal(
    loadConfig(
      { ENGLISH_PORT: "3210", GEMINI_PORT: "3211", ENGLISH_DATA_DIR: "old" },
      dir,
    ).port,
    3212,
  );
});
test("original data is protected, including a junction into either source", (t) => {
  const parent = directory(t),
    dir = join(parent, "KI-Englischlehrerin");
  mkdirSync(dir);
  for (const source of ["EnglishLehrer", "EnglishLehrerGemini"]) {
    const reference = join(parent, source);
    mkdirSync(reference);
    assert.throws(
      () => loadConfig({ KI_DATA_DIR: join(reference, "data") }, dir),
      /read-only/,
    );
    const link = join(dir, source + "-link");
    symlinkSync(
      reference,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.throws(
      () => loadConfig({ KI_DATA_DIR: join(link, "data") }, dir),
      /read-only/,
    );
  }
});
