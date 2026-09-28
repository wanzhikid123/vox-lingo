import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  cpSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Store } from "../server/store.js";
import { LessonPlans, validatePlan } from "../server/lesson-plans.js";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server/app.js";
import { context, generateSummary, runTeacher } from "../server/teacher.js";
import { practiceBoard } from "../server/practice.js";
import { backupBeforeMigration } from "../server/migration-backup.js";
import { GeminiLiveSession } from "../server/gemini-live.js";
import { OpenAIService } from "../server/openai.js";
import {
  defaultLanguages,
  instructionLanguages,
  targetLanguages,
  languageInstruction,
  speechLanguageCodes,
  knowledgeKey,
  normalizeTopic,
} from "../shared/languages.js";
import { teachingText } from "../shared/teaching-text.js";
import { uiMessages, translate } from "../shared/ui-messages.js";
import { isGoodbye } from "../shared/goodbye.js";

const step = (word, meaning) => ({
  id: "intro",
  mode: "repeat",
  word,
  meaning,
  distractors: [],
  stage: "new",
  seconds: 30,
});
const plan = (topic, language) => ({
  goal: "goal",
  instructionLanguage: language,
  targetLanguage: topic.targetLanguage,
  steps: [step(topic.words[0], "a vehicle for many people")],
});
function saveTopic(store, targetLanguage, id = `topic-${targetLanguage}`) {
  const words = {
    en: "bus",
    de: "Bus",
    ja: "バス",
    ko: "버스",
    fr: "bus",
    es: "autobús",
  };
  store.finishPreparation("fixture", {
    changes: [
      {
        before: null,
        after: {
          ...store.topic("colors"),
          id,
          targetLanguage,
          targetTitle: words[targetLanguage],
          words: [words[targetLanguage]],
          phrases: [],
          revision: 1,
        },
      },
    ],
  });
  return store.topic(id);
}

test("settings persist with aliases, conflict protection and atomic failed writes", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vox-settings-"));
  let store = new Store(join(dir, "learning.sqlite"));
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const first = store.languageSettings();
  assert.deepEqual(first.languages, defaultLanguages);
  const saved = store.saveLanguages({
    revision: first.revision,
    languages: {
      interfaceLanguage: "cn",
      instructionLanguage: "en",
      targetLanguage: "jp",
    },
  });
  assert.deepEqual(saved.languages, {
    interfaceLanguage: "zh-CN",
    instructionLanguage: "en",
    targetLanguage: "ja",
  });
  assert.throws(
    () =>
      store.saveLanguages({
        revision: first.revision,
        languages: defaultLanguages,
      }),
    { code: "languageConflict" },
  );
  assert.throws(() =>
    store.saveLanguages({
      revision: saved.revision,
      languages: { ...saved.languages, targetLanguage: "cn" },
    }),
  );
  store.db.exec("PRAGMA query_only=ON");
  assert.throws(() =>
    store.saveLanguages({
      revision: saved.revision,
      languages: defaultLanguages,
    }),
  );
  assert.deepEqual(store.languageSettings(), saved);
  store.close();
  store = new Store(join(dir, "learning.sqlite"));
  assert.deepEqual(store.languageSettings(), saved);
});

for (const instructionLanguage of instructionLanguages)
  for (const targetLanguage of targetLanguages) {
    test(`${instructionLanguage}/${targetLanguage}: plan, assessment, snapshot, feedback and summary retain their context`, async (t) => {
      const store = new Store(":memory:");
      t.after(() => store.close());
      const topic = saveTopic(store, targetLanguage);
      const languages = {
        interfaceLanguage: "zh-CN",
        instructionLanguage,
        targetLanguage,
      };
      store.saveLanguages({
        revision: store.languageSettings().revision,
        languages,
      });
      let prompt;
      const ai = {
        responses: async (_input, _tools, instructions) => {
          prompt = instructions;
          return {
            output: [
              {
                type: "function_call",
                name: "save_lesson_plan",
                arguments: JSON.stringify(plan(topic, instructionLanguage)),
              },
            ],
          };
        },
      };
      const plans = new LessonPlans(store, ai, {});
      await plans.build(topic.id, {
        expectedTopicRevision: 1,
        expectedRevision: 0,
      });
      assert.match(
        prompt,
        new RegExp(`instructionLanguage=${instructionLanguage}`),
      );
      assert.match(prompt, new RegExp(`targetLanguage=${targetLanguage}`));
      const snapshot = plans.snapshot(topic.id);
      const lesson = store.create(topic.id, randomUUID(), snapshot, languages);
      store.connect(lesson.id, "fixture");
      const board = practiceBoard(
        { ...snapshot.steps[0], expectedRevision: 0 },
        { ...topic, ...languages },
      );
      store.updateBoard(lesson.id, randomUUID(), board);
      const question = store.lesson(lesson.id).state.question;
      store.answer(lesson.id, {
        eventId: randomUUID(),
        questionId: question.id,
        optionId: question.correctOptionId,
        mode: "voice",
        uncertain: false,
        hinted: false,
      });
      assert.equal(
        store.lesson(lesson.id).state.question.feedback,
        teachingText(languages, "correct"),
      );
      for (const interfaceLanguage of instructionLanguages) {
        store.saveLanguages({
          revision: store.languageSettings().revision,
          languages: {
            interfaceLanguage,
            instructionLanguage: "de",
            targetLanguage: "en",
          },
        });
        assert.deepEqual(store.lesson(lesson.id).state.languages, {
          instructionLanguage,
          targetLanguage,
        });
      }
      assert.deepEqual(context(store, lesson.id).languages, {
        instructionLanguage,
        targetLanguage,
      });
      await runTeacher({
        store,
        ai: {
          responses: async (_input, _tools, instructions) => {
            assert.ok(instructions.includes(languageInstruction(languages)));
            return { output: [] };
          },
        },
        id: lesson.id,
        trigger: "question",
        transcripts: [],
        execute: () => {},
        signal: new AbortController().signal,
      });
      store.finish(lesson.id, "interrupted");
      store.connect(lesson.id, "resumed");
      assert.equal(store.results(lesson.id).attempts.length, 1);
      store.finish(lesson.id, "ended_early");
      await generateSummary(
        {
          responses: async (_input, _tools, instructions) => {
            assert.ok(instructions.includes(languageInstruction(languages)));
            throw new Error("offline");
          },
        },
        store,
        lesson.id,
      );
      assert.equal(
        store.lesson(lesson.id).summary.message,
        teachingText(languages, "summaryFallback"),
      );
    });
  }

test("same spelling stays partitioned; instruction variants share evidence and preserve saved plans", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const en = saveTopic(store, "en"),
    de = saveTopic(store, "de");
  const lesson = store.create(en.id, "en");
  store.connect(lesson.id, "remote");
  store.updateBoard(
    lesson.id,
    "board",
    practiceBoard(
      { ...step("bus", "Bus"), mode: "meaning_speak", expectedRevision: 0 },
      en,
    ),
  );
  const q = store.lesson(lesson.id).state.question;
  store.answer(lesson.id, {
    eventId: "answer",
    questionId: q.id,
    optionId: q.correctOptionId,
    mode: "voice",
    uncertain: false,
    hinted: false,
  });
  store.finish(lesson.id, "interrupted");
  assert.equal(
    store.home({ ...defaultLanguages, targetLanguage: "de" }).stats.words,
    0,
  );
  assert.equal(
    store.home({ ...defaultLanguages, targetLanguage: "de" }).history.length,
    0,
  );
  assert.equal(
    store.home({ ...defaultLanguages, targetLanguage: "de" }).pending.id,
    lesson.id,
  );
  assert.equal(store.mastery(de.id).length, 0);
  for (const language of instructionLanguages)
    store.saveLessonPlan(en.id, 1, 0, plan(en, language));
  const plans = new LessonPlans(store, {}, {});
  for (const instructionLanguage of instructionLanguages) {
    assert.equal(
      plans.snapshot(en.id, { instructionLanguage, targetLanguage: "en" })
        .instructionLanguage,
      instructionLanguage,
    );
    assert.equal(
      store
        .home({ ...defaultLanguages, instructionLanguage })
        .topics.find((topic) => topic.id === en.id).mastery.length,
      1,
    );
  }
  const second = store.create(de.id, "de");
  assert.throws(() => store.connect(lesson.id, "old"), {
    code: "activeLesson",
  });
  store.finish(second.id, "ended_early");
  assert.equal(store.lesson(lesson.id).topic.targetLanguage, "en");
});

test("HTTP start rejects missing, stale and wrong-language plans; settings remain writable during a lesson", async (t) => {
  const store = new Store(":memory:");
  const server = createServer(
    createApp({ store, classroom: {}, config: { port: 3212 } }),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
    store.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = (path, data) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  const start = () =>
    post("/lessons", { topicId: "colors", eventId: randomUUID() });
  assert.equal((await start()).status, 409);
  store.saveLessonPlan("colors", 1, 0, plan(store.topic("colors"), "de"));
  store.saveLanguages({
    revision: store.languageSettings().revision,
    languages: { ...defaultLanguages, instructionLanguage: "zh-CN" },
  });
  assert.equal((await (await start()).json()).code, "matchingPlanRequired");
  store.saveLessonPlan("colors", 1, 0, plan(store.topic("colors"), "zh-CN"));
  const created = await start();
  assert.equal(created.status, 201);
  const lesson = await created.json();
  const save = await post("/languages", {
    revision: store.languageSettings().revision,
    languages: { ...defaultLanguages, targetLanguage: "ja" },
  });
  assert.equal(save.status, 200);
  assert.equal((await (await start()).json()).code, "conflict");
  store.finish(lesson.id, "ended_early");
  assert.equal((await (await start()).json()).code, "wrongTargetLanguage");
  store.saveLanguages({
    revision: store.languageSettings().revision,
    languages: defaultLanguages,
  });
  store.db.prepare("UPDATE topics SET revision=2 WHERE id='colors'").run();
  assert.equal((await (await start()).json()).code, "matchingPlanRequired");
});

test("v4 migration copies complete data and preserves raw historical text and spoken evidence", (t) => {
  const parent = mkdtempSync(join(tmpdir(), "vox-migrate-"));
  const dir = join(parent, "data");
  mkdirSync(join(dir, "images"), { recursive: true });
  writeFileSync(join(dir, "images", "old.txt"), "legacy image bytes");
  let store = new Store(join(dir, "learning.sqlite"));
  t.after(() => {
    store.close();
    rmSync(parent, { recursive: true, force: true });
  });
  const old = store.create("colors", "old");
  store.connect(old.id, "remote");
  store.updateBoard(
    old.id,
    "board",
    practiceBoard(
      { ...step("red", "Rot"), mode: "meaning_speak", expectedRevision: 0 },
      old.topic,
    ),
  );
  const q = store.lesson(old.id).state.question;
  store.answer(old.id, {
    eventId: "answer",
    questionId: q.id,
    optionId: q.correctOptionId,
    mode: "voice",
    uncertain: false,
    hinted: false,
  });
  store.finish(old.id, "interrupted");
  store.setSummary(
    old.id,
    { message: "原有德语总结 nicht übersetzen" },
    "ready",
  );
  store.deleteTopic("greetings", 1);
  const topic = store.topic("colors");
  const legacyTopic = { ...topic, english: topic.targetTitle };
  delete legacyTopic.targetTitle;
  delete legacyTopic.targetLanguage;
  store.db
    .prepare("UPDATE topics SET payload=? WHERE id='colors'")
    .run(JSON.stringify(legacyTopic));
  const state = store.lesson(old.id).state;
  state.topicSnapshot = legacyTopic;
  delete state.languages;
  state.question.mode = "german_speak";
  store.saveState(old.id, state);
  store.db
    .prepare(
      "UPDATE questions SET payload=json_set(payload,'$.mode','german_speak')",
    )
    .run();
  const legacyPlan = {
    goal: "Alt",
    steps: [{ ...step("red", "Rot"), german: "Rot" }],
  };
  delete legacyPlan.steps[0].meaning;
  store.db
    .exec(`DROP TABLE language_settings; DROP TABLE topic_operations; DROP INDEX lessons_language;
    ALTER TABLE lessons DROP COLUMN target_language; DROP TABLE lesson_plans;
    CREATE TABLE lesson_plans (topic_id TEXT PRIMARY KEY, topic_revision INTEGER NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL); PRAGMA user_version=4;`);
  store.db
    .prepare("INSERT INTO lesson_plans VALUES('colors',1,1,?,123)")
    .run(JSON.stringify(legacyPlan));
  const raw = store.db
    .prepare("SELECT state,summary FROM lessons WHERE id=?")
    .get(old.id);
  store.close();
  const backup = backupBeforeMigration(dir);
  const copied = join(parent, "migration-copy");
  cpSync(backup, copied, { recursive: true });
  const rehearsal = new Store(join(copied, "learning.sqlite"));
  assert.equal(
    rehearsal.db.prepare("PRAGMA user_version").get().user_version,
    5,
  );
  assert.deepEqual(
    rehearsal.db
      .prepare("SELECT state,summary FROM lessons WHERE id=?")
      .get(old.id),
    raw,
  );
  assert.equal(rehearsal.results(old.id).attempts.length, 1);
  rehearsal.close();
  assert.equal(
    readFileSync(join(backup, "images", "old.txt"), "utf8"),
    "legacy image bytes",
  );
  store = new Store(join(dir, "learning.sqlite"));
  assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 5);
  assert.deepEqual(
    store.db
      .prepare("SELECT state,summary FROM lessons WHERE id=?")
      .get(old.id),
    raw,
  );
  assert.equal(store.topic("greetings"), null);
  assert.equal(store.lessonPlan("colors").steps[0].meaning, "Rot");
  assert.equal(store.lesson(old.id).state.question.mode, "meaning_speak");
  assert.equal(store.mastery("colors")[0].skills.speaking.attemptCount, 1);
  assert.equal(backupBeforeMigration(dir), null);
  const snapshot = store.lesson(old.id);
  store.close();
  store = new Store(join(dir, "learning.sqlite"));
  assert.deepEqual(store.lesson(old.id), snapshot);
});

test("migration failure rolls back all DDL and preserves version four", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vox-rollback-")),
    file = join(dir, "learning.sqlite");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let db = new DatabaseSync(file);
  db.exec(
    "CREATE TABLE lesson_plans (topic_id TEXT PRIMARY KEY, payload TEXT); PRAGMA user_version=4",
  );
  db.prepare("INSERT INTO lesson_plans VALUES('old',?)").run("原内容");
  db.close();
  assert.throws(() => new Store(file));
  db = new DatabaseSync(file);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 4);
  assert.equal(
    db.prepare("SELECT payload FROM lesson_plans").get().payload,
    "原内容",
  );
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='lessons'")
      .get().n,
    0,
  );
  db.close();
});

test("same-language tasks use definitions and all six targets have recognizable color boards", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  for (const instructionLanguage of ["en", "de"]) {
    const topic = {
      ...saveTopic(store, instructionLanguage),
      instructionLanguage,
    };
    const raw = { ...step(topic.words[0], topic.words[0]), mode: "repeat" };
    assert.throws(() => validatePlan({ goal: "goal", steps: [raw] }, topic), {
      code: "definitionRequired",
    });
    const board = practiceBoard(
      {
        ...raw,
        mode: "meaning_speak",
        meaning: "A vehicle for many people",
        expectedRevision: 0,
      },
      topic,
    );
    assert.equal(
      board.question.prompt,
      teachingText(topic, "definitionRecall", {
        meaning: "A vehicle for many people",
      }),
    );
  }
  for (const [targetLanguage, word] of Object.entries({
    en: "red",
    de: "rot",
    ja: "赤",
    ko: "빨간색",
    fr: "rouge",
    es: "rojo",
  })) {
    const topic = {
      ...store.topic("colors"),
      id: `color-${targetLanguage}`,
      targetLanguage,
      words: [word],
      phrases: [],
      instructionLanguage: "zh-CN",
    };
    const board = practiceBoard(
      { ...step(word, "红色"), mode: "picture_speak", expectedRevision: 0 },
      topic,
    );
    assert.equal(board.question.mode, "picture_speak");
    assert.equal(
      board.operations.find((op) => op.id === "practice-picture").element.color,
      "#ed5c54",
    );
    assert.equal(board.question.prompt, teachingText(topic, "color"));
  }
  assert.equal(
    translate("en", "reviewDue", { count: 1 }),
    "1 word is due for review.",
  );
  assert.equal(
    translate("de", "reviewDue", { count: 1000 }),
    "1.000 Wörter sind zum Wiederholen bereit.",
  );
});

test("catalogs have all three translations and matching interpolation variables", () => {
  const placeholders = (text) =>
    [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [key, values] of Object.entries(uiMessages))
    for (const code of instructionLanguages) {
      assert.ok(values[code]?.trim(), `${key}: ${code}`);
      assert.deepEqual(
        placeholders(values[code]),
        placeholders(values.de),
        `${key}: ${code}`,
      );
    }
  assert.equal(
    translate("zh-CN", "reviewDue", { count: 9 }),
    "9 个词语需要复习。",
  );
  assert.equal(knowledgeKey("e\u0301"), knowledgeKey("é"));
  assert.equal(
    normalizeTopic({ english: "旧", targetLanguage: "jp" }).targetLanguage,
    "ja",
  );
});

test("farewells cover lesson languages and reject quoted learning questions", () => {
  for (const [code, phrase] of Object.entries({
    en: "Goodbye",
    de: "Tschüss",
    "zh-CN": "再见",
    ja: "さようなら",
    ko: "안녕히 계세요",
    fr: "au revoir",
    es: "adiós",
  })) {
    assert.equal(
      isGoodbye(phrase, { instructionLanguage: "de", targetLanguage: code }),
      true,
    );
    assert.equal(
      isGoodbye(`How do I say ${phrase}?`, {
        instructionLanguage: "de",
        targetLanguage: code,
      }),
      false,
    );
  }
});

for (const instructionLanguage of instructionLanguages)
  for (const targetLanguage of targetLanguages) {
    test(`provider payloads carry ${instructionLanguage}/${targetLanguage} independently`, async () => {
      const languages = { instructionLanguage, targetLanguage };
      let geminiConfig;
      const session = new GeminiLiveSession(
        {
          live: {
            connect: async (options) => {
              geminiConfig = options.config;
              queueMicrotask(() =>
                options.callbacks.onmessage({ setupComplete: {} }),
              );
              return { close() {} };
            },
          },
        },
        { liveModel: "fixture", voice: "Kore" },
        () => {},
        () => {},
      );
      await session.connect(
        languageInstruction(languages),
        JSON.stringify({ languages }),
        new AbortController().signal,
      );
      assert.deepEqual(
        geminiConfig.inputAudioTranscription.languageCodes,
        speechLanguageCodes(languages),
      );
      assert.ok(
        geminiConfig.systemInstruction.includes(
          `targetLanguage=${targetLanguage}`,
        ),
      );
      session.close();
      const openai = new OpenAIService({
        liveModel: "fixture",
        voice: "marin",
      });
      openai.request = async (_path, body) => {
        assert.ok(
          body.session.instructions.includes(
            `instructionLanguage=${instructionLanguage}`,
          ),
        );
        assert.deepEqual(
          JSON.parse(body.session.input[0].content[0].text).languages,
          languages,
        );
        return { session: { id: "fixture" }, transport: { sdp: "fixture" } };
      };
      await openai.live(
        "fixture-sdp",
        languageInstruction(languages),
        JSON.stringify({ languages }),
        new AbortController().signal,
      );
    });
  }
