import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { TopicOperations } from "../server/topic-operations.js";
import { defaultLanguages } from "../shared/languages.js";
import { Preparation } from "../server/preparation.js";

const request = (extra = {}) => ({
  operation: "translate",
  scope: "all",
  topicIds: [],
  fields: ["name", "goal"],
  descriptionLanguage: "zh-CN",
  targetLanguage: null,
  crossPartition: false,
  ...extra,
});
const response = (topics) => ({
  output: [
    {
      type: "function_call",
      name: "prepare_topic_batch",
      arguments: JSON.stringify({ topics }),
    },
  ],
});
function seed(store, count, language = "en") {
  const base = store.topic("colors");
  const changes = Array.from({ length: count }, (_, i) => ({
    before: null,
    after: {
      ...base,
      id: `${language}-fixture-${i}`,
      targetLanguage: language,
      revision: 1,
    },
  }));
  store.finishPreparation("seed", { changes });
  return changes.map(({ after }) => after.id);
}
function fixture(t) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  seed(store, 12);
  return store;
}
function translateAI(hook = () => {}) {
  let calls = 0;
  return {
    responses: async (input, _tools, _instructions, signal) => {
      const { sources } = JSON.parse(input[0].content);
      await hook(++calls, sources, signal);
      return response(
        sources.map(({ id }) => ({ id, name: `中文 ${id}`, goal: "中文目标" })),
      );
    },
  };
}

test("all topics exceeds eight, captures the partition, changes only requested fields and commits atomically", async (t) => {
  const store = fixture(t);
  seed(store, 2, "ja");
  const originals = store.topics(),
    count = store.topics("en").length;
  let calls = 0;
  const operations = new TopicOperations(
    store,
    translateAI((n) => {
      calls = n;
      assert.deepEqual(store.topics(), originals);
      if (n === 1)
        store.saveLanguages({
          revision: store.languageSettings().revision,
          languages: { ...defaultLanguages, targetLanguage: "ja" },
        });
    }),
  );
  const staged = await operations.stage("all", request(), defaultLanguages);
  assert.equal(calls, Math.ceil(count / 6));
  assert.equal(staged.changes.length, count);
  assert.equal(operations.state("all").status, "prepared");
  assert.deepEqual(store.topics(), originals);
  store.finishPreparation("all", staged);
  assert.equal(operations.state("all").status, "completed");
  for (const before of originals) {
    const after = store.topic(before.id);
    if (before.targetLanguage === "ja") assert.deepEqual(after, before);
    else {
      for (const field of [
        "words",
        "phrases",
        "targetTitle",
        "targetLanguage",
        "level",
        "teachingNotes",
        "sourceTopicId",
      ])
        assert.deepEqual(after[field], before[field]);
      assert.equal(after.name, `中文 ${before.id}`);
      assert.equal(after.descriptionLanguages.name, "zh-CN");
      assert.equal(
        after.descriptionLanguages.level,
        before.descriptionLanguages.level,
      );
    }
  }
});

for (const failure of ["provider", "invalid", "cancel", "timeout", "conflict"])
  test(`batch ${failure} keeps every original topic`, async (t) => {
    const store = fixture(t),
      original = store.topics();
    const abort = new AbortController();
    let operations;
    let ai = translateAI((n) => {
      if (n !== 2) return;
      if (failure === "provider") throw new Error("fixture outage");
      if (failure === "cancel") operations.cancel("failure");
      if (failure === "timeout")
        abort.abort(new DOMException("Timeout", "TimeoutError"));
    });
    if (failure === "invalid") ai = { responses: async () => response([]) };
    operations = new TopicOperations(store, ai);
    if (failure === "conflict") {
      const staged = await operations.stage(
        "failure",
        request(),
        defaultLanguages,
      );
      store.db
        .prepare("UPDATE topics SET revision=revision+1 WHERE id=?")
        .run(original[0].id);
      assert.throws(() => store.finishPreparation("failure", staged), {
        code: "batchConflict",
      });
      operations.fail("failure", "batchConflict");
      assert.deepEqual(
        store.topics().map(({ revision, ...topic }) => topic),
        original.map(({ revision, ...topic }) => topic),
      );
    } else {
      await assert.rejects(
        operations.stage("failure", request(), defaultLanguages, abort.signal),
        { code: "batchFailed" },
      );
      assert.deepEqual(store.topics(), original);
    }
    assert.equal(operations.state("failure").status, "failed");
  });

test("selected fields and explicit cross-partition scope are enforced", async (t) => {
  const store = fixture(t),
    [ja] = seed(store, 1, "ja");
  const operations = new TopicOperations(store, translateAI());
  await assert.rejects(
    operations.stage(
      "bad",
      request({ scope: "selected", topicIds: [ja] }),
      defaultLanguages,
    ),
    { code: "wrongTargetLanguage" },
  );
  await assert.rejects(
    operations.stage(
      "missing",
      request({ crossPartition: true }),
      defaultLanguages,
    ),
    { code: "invalidInput" },
  );
  const staged = await operations.stage(
    "good",
    request({ crossPartition: true, sourceLanguages: ["ja"] }),
    defaultLanguages,
  );
  assert.equal(staged.changes.length, 1);
  store.finishPreparation("good", staged);
  assert.equal(store.topic(ja).name, `中文 ${ja}`);
  assert.notEqual(store.topic("colors").name, "中文 colors");
});

test("variants have independent identities, plans and evidence; repeat requests cannot duplicate them", async (t) => {
  const store = fixture(t);
  const operations = new TopicOperations(store, {
    responses: async (input) =>
      response(
        JSON.parse(input[0].content).sources.map((topic) => ({
          ...topic,
          name: "色",
          targetTitle: "色",
          words: ["赤", "青"],
          phrases: ["赤です"],
          targetLanguage: "ja",
        })),
      ),
  });
  const raw = request({
    operation: "variant",
    scope: "selected",
    topicIds: ["colors"],
    targetLanguage: "ja",
  });
  const original = store.topic("colors");
  const staged = await operations.stage("variant", raw, defaultLanguages);
  store.finishPreparation("variant", staged);
  const variant = store.topics("ja")[0];
  assert.notEqual(variant.id, original.id);
  assert.equal(variant.sourceTopicId, original.id);
  assert.deepEqual(variant.words, ["赤", "青"]);
  assert.deepEqual(store.mastery(variant.id), []);
  assert.equal(store.lessonPlan(variant.id), null);
  assert.deepEqual(store.topic("colors"), original);
  assert.equal(
    (await operations.stage("variant", raw, defaultLanguages)).duplicate,
    true,
  );
  assert.equal(store.topics("ja").length, 1);
  await assert.rejects(operations.stage("another", raw, defaultLanguages), {
    code: "variantExists",
  });
  await assert.rejects(
    operations.stage(
      "variant",
      { ...raw, targetLanguage: "ko" },
      defaultLanguages,
    ),
    { code: "eventConflict" },
  );
});

test("capacity is per destination and rechecked at commit", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  seed(store, 60 - store.topics("en").length);
  seed(store, 59, "ja");
  const operations = new TopicOperations(store, {
    responses: async (input) => response(JSON.parse(input[0].content).sources),
  });
  await assert.rejects(
    operations.stage(
      "full",
      request({ operation: "variant", targetLanguage: "ja" }),
      defaultLanguages,
    ),
    { code: "batchCapacity" },
  );
  const staged = await operations.stage(
    "last",
    request({
      operation: "variant",
      scope: "selected",
      topicIds: ["colors"],
      targetLanguage: "ja",
    }),
    defaultLanguages,
  );
  store.finishPreparation("new", {
    changes: [
      {
        before: null,
        after: {
          ...store.topic("colors"),
          id: "ja-extra",
          targetLanguage: "ja",
          revision: 1,
        },
      },
    ],
  });
  assert.throws(() => store.finishPreparation("last", staged), {
    code: "batchCapacity",
  });
  assert.equal(store.topic(staged.changes[0].after.id), null);
});

test("restart exposes interrupted batches without applying staged changes", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vox-batch-"));
  let store = new Store(join(dir, "learning.sqlite"));
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const original = store.topics();
  await new TopicOperations(store, translateAI()).stage(
    "restart",
    request(),
    defaultLanguages,
  );
  store.close();
  store = new Store(join(dir, "learning.sqlite"));
  store.recoverPreparation();
  const operations = new TopicOperations(store, translateAI());
  assert.equal(operations.state("restart").error, "interrupted");
  assert.equal(operations.state("restart").status, "failed");
  assert.deepEqual(store.topics(), original);
  await assert.rejects(
    operations.stage("restart", request(), defaultLanguages),
    { code: "batchFailed" },
  );
  const retry = await operations.stage("retry", request(), defaultLanguages);
  store.finishPreparation("retry", retry);
  assert.equal(operations.state("retry").status, "completed");
});

test("parent chat commits a complete batch once and does not force the classroom reply language", async (t) => {
  const store = fixture(t);
  const translator = translateAI();
  let calls = 0;
  const ai = {
    responses: async (input, tools, instructions, signal) => {
      if (tools.some((tool) => tool.name === "prepare_topic_batch"))
        return translator.responses(input, tools, instructions, signal);
      assert.ok(
        instructions.includes("Reply in the language of the parent message"),
      );
      if (++calls === 1)
        return {
          output: [
            {
              type: "function_call",
              name: "batch_topics",
              call_id: "batch",
              arguments: JSON.stringify(request()),
            },
          ],
        };
      return {
        output: [
          {
            type: "message",
            content: [
              { type: "output_text", text: "所有主题的标题和目标已翻译。" },
            ],
          },
        ],
      };
    },
  };
  const preparation = new Preparation(store, ai);
  const data = {
    eventId: randomUUID(),
    generation: 0,
    message: "把所有英语主题标题和目标翻译成中文",
    topicId: null,
    lessonId: null,
  };
  const result = await preparation.chat(data);
  assert.equal(result.changes.length, store.topics("en").length);
  assert.equal(preparation.operations.list()[0].status, "completed");
  assert.deepEqual(await preparation.chat(data), result);
  assert.equal(calls, 2);
});

test("cancelling a prepared batch aborts the final model response without committing topics", async (t) => {
  const store = fixture(t),
    originals = store.topics(),
    translator = translateAI();
  const waiting = Promise.withResolvers();
  let calls = 0;
  const ai = {
    responses: async (input, tools, instructions, signal) => {
      if (tools.some((tool) => tool.name === "prepare_topic_batch"))
        return translator.responses(input, tools, instructions, signal);
      if (++calls === 1)
        return {
          output: [
            {
              type: "function_call",
              name: "batch_topics",
              call_id: "batch",
              arguments: JSON.stringify(request()),
            },
          ],
        };
      waiting.resolve();
      return new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      );
    },
  };
  const preparation = new Preparation(store, ai),
    id = randomUUID();
  const pending = preparation.chat({
    eventId: id,
    generation: 0,
    message: "Translate all topic titles and goals to Chinese",
    topicId: null,
    lessonId: null,
  });
  const rejected = assert.rejects(pending);
  await waiting.promise;
  assert.equal(preparation.operations.state(id).status, "prepared");
  assert.equal(preparation.cancelOperation(id).status, "failed");
  await rejected;
  assert.equal(preparation.active, null);
  assert.equal(store.preparationTurn(id).errorCode, "batchFailed");
  assert.deepEqual(store.topics(), originals);
});
