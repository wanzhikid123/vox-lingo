import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../server/store.js";
import { Preparation } from "../server/preparation.js";

const text = (message = "已保存主题，下一次新课堂生效。") => ({
  output: [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: message }],
    },
  ],
});
const call = (topic, expectedRevision, callId = "save-1") => ({
  output: [
    {
      type: "function_call",
      name: "save_topic",
      call_id: callId,
      arguments: JSON.stringify({ topic, expectedRevision }),
    },
  ],
});
const request = (eventId = "prepare-1") => ({
  eventId,
  message: "给颜色主题补充 purple，并更新教学安排",
  topicId: "colors",
  lessonId: null,
});

test("topic edits and new topics survive restart while historical lessons keep their plans", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "english-prep-"));
  const path = join(dir, "learning.sqlite");
  let store = new Store(path);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const lesson = store.create("colors", "start");
  store.finish(lesson.id, "interrupted");
  const updated = {
    ...store.topic("colors"),
    words: [...store.topic("colors").words, "purple"],
    teachingNotes: "Auch purple üben.",
    coverage: "all",
  };
  const fruit = {
    ...updated,
    id: "fruit",
    name: "Obst entdecken",
    targetTitle: "Fruit",
    words: ["apple", "banana"],
    teachingNotes: "Mit Früchten spielen.",
  };
  const responses = [call(updated, 1), call(fruit, 0, "save-2"), text()];
  let calls = 0;
  const preparation = new Preparation(store, {
    responses: async () => {
      calls++;
      return responses.shift();
    },
  });
  const result = await preparation.chat(request());
  assert.equal(result.changes.length, 2);
  assert.equal(store.topic("colors").revision, 2);
  assert.ok(store.topic("colors").words.includes("purple"));
  assert.ok(!store.lesson(lesson.id).topic.words.includes("purple"));
  assert.deepEqual(await preparation.chat(request()), result);
  assert.equal(calls, 3, "replaying a request must not call the model again");
  store.close();
  store = new Store(path);
  assert.ok(store.topic("colors").words.includes("purple"));
  assert.equal(store.preparationHistory()[0].status, "completed");
  const newLesson = store.create("fruit", "start-fruit");
  assert.deepEqual(newLesson.topic.words, ["apple", "banana"]);
  assert.equal(store.home().topics.length, 8);
});

test("Chinese preparation chat can save Chinese descriptions without changing target vocabulary", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const source = store.topic("colors");
  const chinese = {
    ...source,
    id: "fruit",
    name: "水果主题",
    targetTitle: "Fruit",
    goal: "学习水果",
    level: "初学者",
    teachingNotes: "先学苹果",
    words: ["apple"],
  };
  const meaning = {
    ...chinese,
    name: "Obst entdecken",
    goal: "Lerne Obst auf Englisch kennen.",
    level: "Erste Wörter",
    teachingNotes: "Beginne mit apple.",
  };
  const outputs = [call(chinese, 0), text()];
  let rejected;
  const preparation = new Preparation(store, {
    responses: async (input) => {
      if (outputs.length === 1) rejected = JSON.parse(input.at(-1).output);
      return outputs.shift();
    },
  });
  await preparation.chat({
    ...request("chinese-topic"),
    message: "请创建水果主题",
    topicId: null,
  });
  assert.equal(rejected.ok, true);
  assert.equal(store.topic("fruit").name, "水果主题");
  assert.deepEqual(store.topic("fruit").words, ["apple"]);
});

test("version-one databases upgrade without losing lessons or learned words", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "english-migration-"));
  const path = join(dir, "learning.sqlite");
  let store = new Store(path);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const lesson = store.create("days", "legacy-lesson");
  const oldState = { ...lesson.state };
  delete oldState.topicSnapshot;
  store.saveState(lesson.id, oldState);
  store.db
    .prepare("INSERT INTO taught VALUES(?,?,?,?)")
    .run(lesson.id, "Monday", "word", Date.now());
  store.db.exec(
    `DROP TABLE topics; DROP TABLE preparation_turns; DROP TABLE language_settings; DROP TABLE topic_operations;
     DROP INDEX lessons_language; ALTER TABLE lessons DROP COLUMN target_language; DROP TABLE lesson_plans;
     CREATE TABLE lesson_plans (topic_id TEXT PRIMARY KEY, topic_revision INTEGER NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
     PRAGMA user_version=1;`,
  );
  store.close();
  store = new Store(path);
  assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 5);
  assert.equal(store.lesson(lesson.id).state.topicSnapshot.words.length, 7);
  assert.equal(store.results(lesson.id).taught[0].text, "Monday");
  assert.equal(store.home().topics.length, 7);
});

test("failed model follow-up commits no partial topic edits", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const before = store.topic("colors");
  let count = 0;
  const preparation = new Preparation(store, {
    responses: async () => {
      if (!count++)
        return call({ ...before, words: [...before.words, "purple"] }, 1);
      throw new Error("offline");
    },
  });
  await assert.rejects(preparation.chat(request()), /offline/);
  assert.deepEqual(store.topic("colors"), before);
  assert.equal(store.preparationHistory()[0].status, "failed");
  assert.equal(preparation.state().busy, false);
});

test("concurrent preparation is serialized and stale catalog revisions cannot overwrite changes", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  let release;
  const preparation = new Preparation(store, {
    responses: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const first = preparation.chat(request());
  const repeated = preparation.chat(request());
  await assert.rejects(
    preparation.chat({ ...request("prepare-2"), message: "another" }),
    /läuft noch/,
  );
  release(text("只是讨论，没有修改主题。"));
  assert.deepEqual(await first, await repeated);
  assert.equal(store.topic("colors").revision, 1);
  const before = store.topic("colors");
  store.startPreparation({ ...request("external-1") });
  store.finishPreparation("external-1", {
    message: "saved",
    changes: [{ before, after: { ...before, revision: 2 } }],
  });
  store.startPreparation({ ...request("external-2") });
  assert.throws(
    () =>
      store.finishPreparation("external-2", {
        message: "stale",
        changes: [
          { before, after: { ...before, words: ["pink"], revision: 2 } },
        ],
      }),
    /inzwischen/,
  );
  assert.ok(store.topic("colors").words.includes("red"));
});

test("post-lesson discussion receives saved evidence without modifying scores or topics", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const lesson = store.create("days", "lesson");
  store.finish(lesson.id, "interrupted");
  let context;
  const preparation = new Preparation(store, {
    responses: async (input) => {
      context = JSON.parse(input[0].content);
      return text("这节课没有已确认的作答记录。");
    },
  });
  await preparation.chat({
    ...request(),
    message: "请总结这节课",
    topicId: "days",
    lessonId: lesson.id,
  });
  assert.equal(context.selectedLesson.status, "interrupted");
  assert.deepEqual(context.selectedLesson.results.attempts, []);
  assert.equal(store.topic("days").words.length, 7);
  assert.equal(store.topic("days").revision, 1);
});

test("clearing preparation removes old model context, preserves learning, and rejects stale requests", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const lesson = store.create("colors", "kept-lesson");
  store.finish(lesson.id, "interrupted");
  const inputs = [];
  const preparation = new Preparation(store, {
    responses: async (input) => {
      inputs.push(structuredClone(input));
      return text("old-answer-marker");
    },
  });
  await preparation.chat({ ...request(), message: "old-chat-marker" });
  assert.throws(() =>
    preparation.clear({ expectedGeneration: 0, confirmed: false }),
  );
  assert.equal(store.preparationHistory().length, 1);
  const state = preparation.clear({ expectedGeneration: 0, confirmed: true });
  assert.deepEqual(state.turns, []);
  assert.equal(state.generation, 1);
  assert.equal(state.topics.length, 7);
  assert.equal(store.lesson(lesson.id).topic.name, "Die Welt ist bunt");
  await assert.rejects(preparation.chat(request()), /geleert/);
  assert.throws(
    () => preparation.clear({ expectedGeneration: 0, confirmed: true }),
    /geleert/,
  );
  await preparation.chat({
    ...request("new-chat"),
    generation: 1,
    message: "fresh-question",
  });
  assert.equal(inputs.length, 2);
  assert.doesNotMatch(
    JSON.stringify(inputs[1]),
    /old-chat-marker|old-answer-marker/,
  );
  assert.equal(inputs[1].filter((item) => item.role === "user").length, 1);
});

test("clear and deletion cannot race an active preparation", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  let release;
  const preparation = new Preparation(store, {
    responses: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const pending = preparation.chat(request());
  assert.throws(
    () => preparation.clear({ expectedGeneration: 0, confirmed: true }),
    /läuft noch/,
  );
  assert.throws(
    () =>
      preparation.deleteTopic("greetings", {
        expectedRevision: 1,
        confirmed: true,
      }),
    /läuft noch/,
  );
  release(text());
  await pending;
  assert.equal(store.preparationHistory().length, 1);
  assert.ok(store.topic("greetings"));
});

const deleteCall = (topicId, expectedRevision) => ({
  output: [
    {
      type: "function_call",
      name: "request_topic_deletion",
      call_id: "delete-request",
      arguments: JSON.stringify({ topicId, expectedRevision }),
    },
  ],
});

test("AI deletion requires a persisted proposal and explicit confirmation for its exact topic version", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const responses = [
    deleteCall("greetings", 1),
    text("请点击确认按钮删除 Hallo, Welt!。"),
  ];
  const preparation = new Preparation(store, {
    responses: async () => responses.shift(),
  });
  const result = await preparation.chat({
    ...request(),
    topicId: "greetings",
    message: "删除 Hallo Welt",
  });
  assert.equal(result.deletionRequests[0].topicId, "greetings");
  assert.ok(store.topic("greetings"), "The model cannot delete on its own");
  assert.throws(() =>
    preparation.deleteTopic("greetings", {
      expectedRevision: 1,
      turnId: result.eventId,
    }),
  );
  assert.throws(
    () =>
      preparation.deleteTopic("colors", {
        expectedRevision: 1,
        turnId: result.eventId,
        confirmed: true,
      }),
    /Löschanfrage/,
  );
  preparation.deleteTopic("greetings", {
    expectedRevision: 1,
    turnId: result.eventId,
    confirmed: true,
  });
  assert.equal(store.topic("greetings"), null);
  assert.equal(
    store.preparationTurn(result.eventId).response.deletionRequests[0].status,
    "deleted",
  );
  assert.deepEqual(
    preparation.deleteTopic("greetings", {
      expectedRevision: 1,
      turnId: result.eventId,
      confirmed: true,
    }),
    { ok: true, topicId: "greetings" },
  );
});

test("deletion persists across restart including all seed topics, while old lessons keep their plan and names", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "english-delete-"));
  const path = join(dir, "learning.sqlite");
  let store = new Store(path);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const lesson = store.create("greetings", "history");
  store.db
    .prepare("INSERT INTO taught VALUES(?,?,?,?)")
    .run(lesson.id, "hello", "word", Date.now());
  for (const topic of store.topics())
    store.deleteTopic(topic.id, topic.revision);
  assert.throws(() => store.create("greetings", "new"), /Thema/);
  store.close();
  store = new Store(path);
  assert.deepEqual(store.topics(), []);
  assert.deepEqual(store.home().recommended, []);
  assert.equal(store.home().history[0].topic_name, "Hallo, Welt!");
  assert.equal(store.lesson(lesson.id).topic.name, "Hallo, Welt!");
  assert.equal(store.results(lesson.id).taught[0].text, "hello");
  store.connect(lesson.id, "resume");
  assert.equal(store.lesson(lesson.id).status, "active");
  store.startPreparation(request("resurrect"));
  assert.throws(
    () =>
      store.finishPreparation("resurrect", {
        message: "saved",
        changes: [{ before: null, after: { ...lesson.topic, revision: 1 } }],
      }),
    /gelöscht/,
  );
});

test("stale deletion confirmations cannot remove a topic edited since the proposal", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const responses = [deleteCall("colors", 1), text("Bitte bestätigen.")];
  const preparation = new Preparation(store, {
    responses: async () => responses.shift(),
  });
  const result = await preparation.chat(request());
  const before = store.topic("colors");
  store.startPreparation(request("edit"));
  store.finishPreparation("edit", {
    message: "saved",
    changes: [{ before, after: { ...before, revision: 2 } }],
  });
  assert.throws(
    () =>
      preparation.deleteTopic("colors", {
        expectedRevision: 1,
        confirmed: true,
        turnId: result.eventId,
      }),
    /inzwischen/,
  );
  assert.equal(store.topic("colors").revision, 2);
  preparation.clear({ expectedGeneration: 0, confirmed: true });
  assert.throws(
    () =>
      preparation.deleteTopic("colors", {
        expectedRevision: 2,
        confirmed: true,
        turnId: result.eventId,
      }),
    /Löschanfrage/,
  );
});
