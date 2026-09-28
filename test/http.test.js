import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { Classroom } from "../server/classroom.js";
import { root } from "../server/config.js";

test("local HTTP API initializes history, enforces origins and never returns the long-lived key", async (t) => {
  const store = new Store(":memory:");
  store.saveLessonPlan("colors", 1, 0, {
    goal: "Colors",
    steps: [
      {
        id: "red",
        mode: "repeat",
        word: "red",
        meaning: "Rot",
        distractors: [],
        stage: "new",
        seconds: 30,
      },
    ],
  });
  const config = {
    port: 3210,
    apiKey: "secret-test-value",
    backend: {
      provider: "deepseek",
      model: "deepseek-flash",
      reasoningEffort: "high",
      apiKey: "backend-secret-test-value",
      apiKeyName: "DEEPSEEK_API_KEY",
    },
    dataDir: ".cache/test-data",
    liveModel: "live-test",
    teacherModel: "teacher-test",
  };
  config.live = {
    provider: "gemini",
    apiKey: config.apiKey,
    apiKeyName: "GEMINI_API_KEY",
    model: config.liveModel,
  };
  config.teacher = {
    provider: "gemini",
    apiKey: config.apiKey,
    apiKeyName: "GEMINI_API_KEY",
    model: config.teacherModel,
  };
  config.transcription = {
    provider: "openai",
    apiKey: "",
    apiKeyName: "OPENAI_API_KEY",
    model: "gpt-transcribe",
  };
  const tempoCalls = [];
  const app = createApp({
    store,
    classroom: {
      setSpeechTempo: async (id, tempo) => {
        tempoCalls.push({ id, tempo });
        return { ok: true, tempo };
      },
    },
    config,
  });
  const server = createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
    store.close();
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const health = await (await fetch(base + "/api/health")).json();
  assert.equal(health.teacher.keyConfigured, true);
  assert.equal(health.classroomKeyConfigured, true);
  assert.equal(health.backend.provider, "deepseek");
  assert.equal(health.backend.model, "deepseek-flash");
  assert.equal(health.backend.reasoningEffort, "high");
  assert.equal(health.backend.keyConfigured, true);
  assert.deepEqual(health.missingClassroomKeys, []);
  assert.doesNotMatch(JSON.stringify(health), /secret-test-value/);
  config.backend.apiKey = "";
  const missing = await (await fetch(base + "/api/health")).json();
  assert.equal(missing.teacher.keyConfigured, true); // Gemini preparation remains available.
  assert.equal(missing.classroomKeyConfigured, false);
  assert.deepEqual(missing.missingClassroomKeys, ["DEEPSEEK_API_KEY"]);
  const origin = await fetch(base + "/api/lessons", {
    method: "POST",
    headers: {
      Origin: "https://evil.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ topicId: "colors", eventId: "start" }),
  });
  assert.equal(origin.status, 403);
  const hostStatus = await new Promise((resolve) => {
    const req = request(
      base + "/api/home",
      { headers: { Host: "evil.example" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.end();
  });
  assert.equal(hostStatus, 403);
  const create = await fetch(base + "/api/lessons", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topicId: "colors", eventId: "start" }),
  });
  assert.equal(create.status, 201);
  const lesson = await create.json();
  assert.equal(lesson.topic_id, "colors");
  assert.equal(lesson.remote_id, undefined);
  const home = await (await fetch(base + "/api/home")).json();
  assert.equal(home.history.length, 1);
  assert.equal(home.topics.length, 7);
  const broken = await fetch(base + "/api/lessons", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(broken.status, 400);
  const emoji = await fetch(base + "/assets/emoji/1f68c.svg");
  assert.equal(emoji.status, 200);
  assert.match(emoji.headers.get("content-type"), /image\/svg/);
  assert.match(await emoji.text(), /<svg/);
  for (const tempo of [0, 1.5, 6, "4"]) {
    assert.equal(
      (
        await fetch(base + `/api/lessons/${lesson.id}/speech-tempo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tempo }),
        })
      ).status,
      400,
    );
  }
  assert.equal(tempoCalls.length, 0);
  const changed = await fetch(base + `/api/lessons/${lesson.id}/speech-tempo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tempo: 4 }),
  });
  assert.equal(changed.status, 200);
  assert.deepEqual(tempoCalls, [{ id: lesson.id, tempo: 4 }]);
});

test("lesson deletion requires confirmation, rejects active lessons and leaves other data intact", async (t) => {
  const store = new Store(":memory:");
  const classroom = new Classroom(store, {}, {});
  let stopped = 0;
  const app = createApp({
    store,
    classroom,
    config: { port: 3210 },
    shutdown: () => stopped++,
  });
  const server = createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
    store.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = (path, body, origin) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify(body),
    });
  const record = store.create("animals", "delete-http");
  store.connect(record.id, "test");
  assert.equal((await post(`/lessons/${record.id}/delete`, {})).status, 400);
  assert.equal(
    (await post(`/lessons/${record.id}/delete`, { confirmed: true })).status,
    409,
  );
  store.finish(record.id, "ended_early");
  assert.equal(
    (
      await post(
        `/lessons/${record.id}/delete`,
        { confirmed: true },
        "https://evil.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (await post(`/lessons/${record.id}/delete`, { confirmed: true })).status,
    200,
  );
  assert.equal((await fetch(base + `/lessons/${record.id}`)).status, 404);
  assert.equal(
    (await post(`/lessons/${record.id}/delete`, { confirmed: true })).status,
    404,
  );
  assert.equal(store.home().history.length, 0);
  assert.equal(
    (await post("/shutdown", { directory: root + "/another-checkout" })).status,
    409,
  );
  assert.equal(
    (await post("/shutdown", { directory: root }, "https://evil.example"))
      .status,
    403,
  );
  assert.equal(stopped, 0);
  assert.equal((await post("/shutdown", { directory: root })).status, 200);
  await new Promise((r) => setImmediate(r));
  assert.equal(stopped, 1);
  assert.equal(
    (await post("/lessons", { topicId: "animals", eventId: "too-late" }))
      .status,
    503,
  );
  assert.equal((await post("/shutdown", { directory: root })).status, 200);
  await new Promise((r) => setImmediate(r));
  assert.equal(stopped, 1);
});
