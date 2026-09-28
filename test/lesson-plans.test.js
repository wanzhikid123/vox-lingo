import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store.js";
import { Classroom } from "../server/classroom.js";
import {
  LessonPlans,
  validatePlan,
  planBoard,
} from "../server/lesson-plans.js";
import { practiceBoard } from "../server/practice.js";
import { runTeacher } from "../server/teacher.js";

const step = (id, word, mode = "repeat", extra = {}) => ({
  id,
  word,
  mode,
  meaning: word === "cat" ? "Katze" : "Hund",
  distractors: mode === "meaning_choice" ? ["dog"] : [],
  stage: mode === "repeat" ? "new" : "practice",
  seconds: 45,
  ...extra,
});
const sample = () => ({
  goal: "Tiere erkennen und selbst benennen.",
  steps: [
    step("cat", "cat"),
    step("dog", "dog"),
    step("choice", "cat", "meaning_choice"),
    step("speak", "dog", "picture_speak"),
    step("recall", "cat", "meaning_speak"),
  ],
});
function setup(t, ai = {}) {
  let now = 1_800_000_000_000;
  const dir = mkdtempSync(join(tmpdir(), "english-plans-"));
  const store = new Store(":memory:", () => now);
  const config = { dataDir: dir };
  const plans = new LessonPlans(store, ai, config);
  t.after(async () => {
    await plans.shutdown();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    store,
    plans,
    config,
    advance: (days) => {
      now += days * 86400000;
    },
  };
}
const request = (store) => ({
  expectedTopicRevision: store.topic("animals").revision,
  expectedRevision: store.lessonPlan("animals")?.revision || 0,
});
function introduce(store, word = "cat") {
  const l = store.create("animals", randomUUID());
  store.connect(l.id, "test");
  store.updateBoard(
    l.id,
    randomUUID(),
    practiceBoard({ ...step("test", word), expectedRevision: 0 }, l.topic),
  );
  store.finish(l.id, "ended_early");
}
function answerPractice(
  store,
  mode,
  { hinted = false, uncertain = false, correct = true, existing = null } = {},
) {
  const l = existing
    ? store.lesson(existing)
    : store.create("animals", randomUUID());
  store.connect(l.id, "test");
  store.updateBoard(
    l.id,
    randomUUID(),
    practiceBoard(
      { ...step("test", "cat", mode), expectedRevision: l.state.revision },
      l.topic,
    ),
  );
  const q = store.lesson(l.id).state.question;
  store.answer(l.id, {
    eventId: randomUUID(),
    questionId: q.id,
    optionId: uncertain
      ? null
      : correct
        ? q.correctOptionId
        : mode === "meaning_choice"
          ? q.options.find((o) => o.id !== q.correctOptionId).id
          : null,
    mode: mode === "meaning_choice" ? "click" : "voice",
    uncertain,
    hinted,
  });
  if (!existing) store.finish(l.id, "ended_early");
  return l.id;
}

test("recognition and speaking evidence are separate; repeat and uncertain speech cannot reschedule", (t) => {
  const { store, advance } = setup(t);
  answerPractice(store, "meaning_choice");
  let word = store.mastery("animals")[0];
  assert.equal(word.skills.recognition.independent, 1);
  assert.equal(word.skills.speaking.attemptCount, 0);
  assert.equal(store.reviewQueue("animals")[0].skill, "speaking");
  const due = word.skills.recognition.dueAt;
  advance(0.5);
  answerPractice(store, "repeat");
  answerPractice(store, "meaning_speak", { uncertain: true });
  word = store.mastery("animals")[0];
  assert.equal(word.skills.recognition.dueAt, due);
  assert.equal(word.skills.speaking.attemptCount, 0);
});

test("review intervals increase across lessons, never from massed retries, and shrink after help", (t) => {
  const { store, advance } = setup(t);
  const l = store.create("animals", "many");
  store.connect(l.id, "test");
  for (let i = 0; i < 4; i++)
    answerPractice(store, "meaning_speak", { existing: l.id });
  assert.equal(store.mastery("animals")[0].skills.speaking.intervalDays, 1);
  store.finish(l.id, "ended_early");
  advance(1);
  answerPractice(store, "meaning_speak");
  assert.equal(store.mastery("animals")[0].skills.speaking.intervalDays, 3);
  advance(3);
  answerPractice(store, "meaning_speak");
  assert.equal(store.mastery("animals")[0].skills.speaking.intervalDays, 7);
  advance(7);
  answerPractice(store, "meaning_speak", { hinted: true });
  assert.equal(store.mastery("animals")[0].skills.speaking.intervalDays, 1);
  assert.equal(store.mastery("animals")[0].skills.speaking.status, "review");
});

test("removed topic words keep history but do not enter the due queue", (t) => {
  const { store } = setup(t);
  introduce(store);
  const topic = store.topic("animals");
  topic.words = topic.words.filter((w) => w !== "cat");
  store.db
    .prepare("UPDATE topics SET payload=? WHERE id='animals'")
    .run(JSON.stringify(topic));
  assert.equal(store.mastery("animals")[0].knowledge, "cat");
  assert.deepEqual(store.reviewQueue("animals"), []);
});

test("plans validate prerequisite order, known distractors, unique IDs and time budget", (t) => {
  const { store } = setup(t);
  const topic = store.topic("animals");
  assert.equal(validatePlan(sample(), topic).steps.length, 5);
  assert.throws(
    () =>
      validatePlan({ ...sample(), steps: sample().steps.toReversed() }, topic),
    /zuerst/,
  );
  assert.throws(
    () =>
      validatePlan(
        { ...sample(), steps: [step("one", "cat"), step("one", "dog")] },
        topic,
      ),
    /eigene ID/,
  );
  assert.throws(
    () => validatePlan({ ...sample(), steps: [step("one", "apple")] }, topic),
    /außerhalb/,
  );
  assert.throws(
    () =>
      validatePlan(
        {
          ...sample(),
          steps: sample().steps.map((s) => ({ ...s, seconds: 120 })),
        },
        topic,
      ),
    /neun Minuten/,
  );
});

test("generation saves executable previews without learning evidence and rejects stale saves", async (t) => {
  const ai = {
    responses: async () => ({
      output: [
        {
          type: "function_call",
          name: "save_lesson_plan",
          arguments: JSON.stringify(sample()),
        },
      ],
    }),
  };
  const { store, plans } = setup(t, ai);
  const data = await plans.build("animals", request(store));
  assert.equal(data.plan.revision, 1);
  assert.equal(data.previews[3].elements[0].type, "emoji");
  assert.equal(
    data.previews[3].elements.filter((e) => e.type === "text").length,
    0,
  );
  assert.equal(store.home().history.length, 0);
  assert.equal(store.mastery("animals").length, 0);
  await assert.rejects(
    plans.build(
      "animals",
      { expectedTopicRevision: 1, expectedRevision: 0, plan: sample() },
      true,
    ),
    /neu laden/,
  );
});

test("failed generation preserves the saved plan, and topic changes invalidate new snapshots", async (t) => {
  const { store, plans } = setup(t, {
    responses: async () => {
      throw new Error("private provider body");
    },
  });
  await plans.build("animals", { ...request(store), plan: sample() }, true);
  await assert.rejects(
    plans.build("animals", request(store)),
    /bisherige Plan/,
  );
  assert.equal(store.lessonPlan("animals").revision, 1);
  assert.doesNotMatch(plans.state("animals").job.error, /provider/);
  const l = store.create("animals", "snapshot", plans.snapshot("animals"));
  store.db.exec("UPDATE topics SET revision=revision+1 WHERE id='animals'");
  assert.equal(plans.state("animals").plan.stale, true);
  assert.throws(() => plans.snapshot("animals"), {
    code: "matchingPlanRequired",
    status: 409,
  });
  assert.equal(store.lesson(l.id).state.planSnapshot.steps.length, 5);
  assert.equal(store.publicLesson(l.id).state.planSnapshot, undefined);
});

test("plans use German text immediately when no suitable emoji exists", async (t) => {
  const { store, plans } = setup(t, {});
  const topic = store.topic("animals");
  topic.words = ["striped lunchbox"];
  store.db
    .prepare("UPDATE topics SET payload=? WHERE id='animals'")
    .run(JSON.stringify(topic));
  const plan = {
    goal: "Eine Brotdose benennen.",
    steps: [
      step("new", "striped lunchbox", "repeat", {
        meaning: "Gestreifte Brotdose",
      }),
      step("picture", "striped lunchbox", "picture_speak", {
        meaning: "Gestreifte Brotdose",
      }),
    ],
  };
  await plans.build("animals", { ...request(store), plan }, true);
  const preview = plans.state("animals").previews[1];
  assert.equal(preview.mode, "meaning_speak");
  assert.equal(preview.elements[0].text, "Gestreifte Brotdose");
  assert.deepEqual(store.lessonPlan("animals").materials, {});
  // Old cached image references cannot re-enable removed generation/display.
  assert.equal(
    planBoard(plan.steps[1], topic, {
      "striped lunchbox": { status: "ready", src: "/assets/teaching/old.png" },
    }).question.mode,
    "meaning_speak",
  );
});

test("new lessons refresh due warmup without mutating the saved parent plan", async (t) => {
  const { store, plans } = setup(t);
  await plans.build("animals", { ...request(store), plan: sample() }, true);
  introduce(store);
  const snapshot = plans.snapshot("animals");
  assert.equal(snapshot.steps[0].stage, "review");
  assert.equal(snapshot.steps[0].mode, "meaning_speak");
  assert.equal(store.lessonPlan("animals").steps[0].stage, "new");
});

async function classroomSetup(
  t,
  decision = { action: "answer", uncertain: false, hinted: false },
) {
  let calls = 0;
  const { store, plans, config } = setup(t);
  await plans.build("animals", { ...request(store), plan: sample() }, true);
  const l = store.create("animals", "start", plans.snapshot("animals"));
  store.connect(l.id, "test");
  const classroom = new Classroom(
    store,
    {
      responses: async () => {
        calls++;
        const q = store.lesson(l.id).state.question;
        return {
          output: [
            {
              type: "function_call",
              name: "assess_prepared_turn",
              call_id: randomUUID(),
              arguments: JSON.stringify({
                ...decision,
                questionId: q.id,
                optionId: decision.uncertain ? null : q.correctOptionId,
              }),
            },
          ],
        };
      },
    },
    config,
  );
  classroom.waitRendered = async () => {};
  classroom.send = async () => {};
  const room = classroom.room(l.id);
  room.ready = true;
  t.after(() => {
    clearTimeout(room.answerCheckTimer);
    clearTimeout(room.feedbackTimer);
  });
  return { store, classroom, room, id: l.id, calls: () => calls };
}
function spoken(env) {
  const { id, room, store } = env;
  const q = store.lesson(id).state.question;
  const latestChild = {
    role: "child",
    text: q.knowledge,
    questionId: q.id,
    receivedAt: store.now(),
    answerToken: randomUUID(),
  };
  return {
    id,
    trigger: "Antwort prüfen",
    transcripts: [latestChild],
    latestChild,
    signal: room.controller.signal,
    inputVersion: room.inputVersion,
  };
}

test("prefetch never teaches or scores; a spoken success needs one model call then presents exactly one step", async (t) => {
  const env = await classroomSetup(t);
  const { store, classroom, room, id } = env;
  classroom.prepared.warm(id);
  assert.equal(store.lesson(id).state.revision, 0);
  assert.equal(store.results(id).taught.length, 0);
  await classroom.prepared.present(id, room.controller.signal);
  const response = await classroom.prepared.run(spoken(env));
  assert.match(response, /Hund/);
  assert.equal(env.calls(), 1);
  assert.equal(store.lesson(id).state.planCursor, 2);
  assert.equal(store.results(id).attempts.length, 1);
  assert.equal(store.mastery("animals")[0].attemptCount, 0);
  assert.equal(store.results(id).taught.length, 2);
  assert.equal(room.preparedNext.cursor, 2);
});

test("choice marks remain until the next delegation; duplicate clicks do not skip", async (t) => {
  const env = await classroomSetup(t);
  const { store, classroom, room, id } = env;
  const l = store.lesson(id);
  l.state.planCursor = 2;
  store.saveState(id, l.state);
  await classroom.prepared.present(id, room.controller.signal);
  const q = store.lesson(id).state.question;
  const data = {
    eventId: "click",
    questionId: q.id,
    optionId: q.correctOptionId,
    mode: "click",
    uncertain: false,
    hinted: false,
  };
  classroom.click(id, data);
  await room.queue;
  classroom.click(id, data);
  await room.queue;
  assert.equal(env.calls(), 0);
  assert.equal(store.lesson(id).state.planCursor, 3);
  assert.equal(
    store.publicLesson(id).state.question.correctOptionId,
    q.correctOptionId,
  );
  await classroom.prepared.run({
    id,
    trigger: "Nächster Schritt",
    transcripts: [],
    latestChild: null,
    signal: room.controller.signal,
    confirmedAnswer: null,
    inputVersion: room.inputVersion,
  });
  assert.equal(store.lesson(id).state.planCursor, 4);
  assert.equal(store.results(id).attempts.length, 1);
});

test("an answered choice continues after showing feedback without another child turn", async (t) => {
  const env = await classroomSetup(t);
  const { store, classroom, room, id } = env;
  classroom.feedbackDelayMs = 20;
  const spokenMessages = [];
  classroom.send = async (_id, type, content) => {
    if (type === "session.commentary.append") spokenMessages.push(content);
  };
  const lesson = store.lesson(id);
  lesson.state.planCursor = 2;
  store.saveState(id, lesson.state);
  await classroom.prepared.present(id, room.controller.signal);
  const q = store.lesson(id).state.question;
  classroom.click(id, {
    eventId: "auto-choice",
    questionId: q.id,
    optionId: q.options.find((option) => option.id !== q.correctOptionId).id,
    mode: "click",
    uncertain: false,
    hinted: false,
  });
  await room.queue;
  assert.equal(store.lesson(id).state.question.id, q.id);
  assert.equal(store.lesson(id).state.planCursor, 3);
  await new Promise((resolve) => setTimeout(resolve, 80));
  await room.queue;
  assert.equal(store.lesson(id).state.planCursor, 4);
  assert.notEqual(store.lesson(id).state.question.id, q.id);
  assert.ok(
    spokenMessages.some((message) => message.includes("Das richtige Zielwort")),
  );
  assert.ok(
    spokenMessages.some((message) => message.includes("Was siehst du")),
  );
});

test("a new child utterance cancels automatic advancement and reaches the flexible planner", async (t) => {
  const env = await classroomSetup(t);
  const { store, classroom, room, id } = env;
  classroom.feedbackDelayMs = 20;
  const lesson = store.lesson(id);
  lesson.state.planCursor = 2;
  store.saveState(id, lesson.state);
  await classroom.prepared.present(id, room.controller.signal);
  const q = store.lesson(id).state.question;
  classroom.click(id, {
    eventId: "before-interruption",
    questionId: q.id,
    optionId: q.correctOptionId,
    mode: "click",
    uncertain: false,
    hinted: false,
  });
  await room.queue;
  classroom.onEvent(id, {
    type: "session.input_transcript.delta",
    event_id: "child-interruption",
    delta: "Warte, ich habe eine Frage.",
    start_ms: 100,
    end_ms: 400,
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(store.lesson(id).state.planCursor, 3);
  const latestChild = room.transcripts.at(-1);
  assert.equal(
    await classroom.prepared.run({
      id,
      trigger: "Kind fragt nach",
      transcripts: room.transcripts,
      latestChild,
      signal: room.controller.signal,
      confirmedAnswer: null,
      inputVersion: room.inputVersion,
    }),
    null,
  );
});

for (const wrong of [false, true]) {
  test(`a ${wrong ? "corrected wrong" : "correct"} spoken recall continues without another child turn`, async (t) => {
    const env = await classroomSetup(t);
    const { store, classroom, room, id } = env;
    classroom.feedbackDelayMs = 20;
    const lesson = store.lesson(id);
    lesson.state.planCursor = 3;
    store.saveState(id, lesson.state);
    await classroom.prepared.present(id, room.controller.signal);
    const q = store.lesson(id).state.question;
    if (wrong)
      classroom.ai.responses = async () => ({
        output: [
          {
            type: "function_call",
            name: "assess_prepared_turn",
            call_id: randomUUID(),
            arguments: JSON.stringify({
              action: "answer",
              questionId: q.id,
              optionId: null,
              uncertain: false,
              hinted: false,
            }),
          },
        ],
      });
    room.transcripts.push({
      role: "child",
      text: wrong ? "cat" : "dog",
      questionId: q.id,
      receivedAt: store.now(),
      start_ms: 1,
      end_ms: 2,
    });
    classroom.enqueue(id, "Sprachantwort prüfen");
    await room.queue;
    assert.equal(store.lesson(id).state.question.status, "answered");
    assert.equal(
      store
        .lesson(id)
        .state.elements.find((element) => element.id === "practice-answer")
        ?.text,
      "dog",
    );
    assert.equal(store.lesson(id).state.planCursor, 4);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await room.queue;
    assert.equal(store.lesson(id).state.planCursor, 5);
    assert.notEqual(store.lesson(id).state.question.id, q.id);
  });
}

test("uncertain speech stays on the same question and does not count as failed learning", async (t) => {
  const env = await classroomSetup(t, {
    action: "answer",
    uncertain: true,
    hinted: false,
  });
  await env.classroom.prepared.present(env.id, env.room.controller.signal);
  await env.classroom.prepared.run(spoken(env));
  assert.equal(env.store.lesson(env.id).state.planCursor, 1);
  assert.equal(env.store.results(env.id).attempts[0].outcome, "uncertain");
});

test("help preserves the question and records hint usage; explicit wishes return to the flexible planner", async (t) => {
  const env = await classroomSetup(t, {
    action: "help",
    uncertain: false,
    hinted: false,
  });
  await env.classroom.prepared.present(env.id, env.room.controller.signal);
  await env.classroom.prepared.run(spoken(env));
  assert.equal(env.store.lesson(env.id).state.question.hinted, true);
  assert.equal(env.store.results(env.id).attempts.length, 0);
  env.classroom.ai.responses = async () => ({
    output: [
      {
        type: "function_call",
        name: "assess_prepared_turn",
        arguments: JSON.stringify({
          action: "adapt",
          questionId: env.store.lesson(env.id).state.question.id,
          optionId: null,
          uncertain: false,
          hinted: false,
        }),
      },
    ],
  });
  assert.equal(await env.classroom.prepared.run(spoken(env)), null);
  assert.equal(env.store.lesson(env.id).state.planCursor, 1);
});

test("a newer child utterance or a disconnected session invalidates an in-flight assessment", async (t) => {
  const env = await classroomSetup(t);
  await env.classroom.prepared.present(env.id, env.room.controller.signal);
  const q = env.store.lesson(env.id).state.question;
  let release;
  env.classroom.ai.responses = () =>
    new Promise((r) => {
      release = r;
    });
  const pending = env.classroom.prepared.run(spoken(env));
  env.room.inputVersion++;
  release({
    output: [
      {
        type: "function_call",
        name: "assess_prepared_turn",
        arguments: JSON.stringify({
          action: "answer",
          questionId: q.id,
          optionId: q.correctOptionId,
          uncertain: false,
          hinted: false,
        }),
      },
    ],
  });
  assert.equal(await pending, "");
  assert.equal(env.store.results(env.id).attempts.length, 0);
  env.room.controller.abort();
  await assert.rejects(
    env.classroom.prepared.present(env.id, env.room.controller.signal),
  );
});

test("a prepared board waits for browser rendering before returning its speech prompt", async (t) => {
  const env = await classroomSetup(t);
  let release;
  env.classroom.waitRendered = () =>
    new Promise((r) => {
      release = r;
    });
  let returned = false;
  const pending = env.classroom.prepared
    .present(env.id, env.room.controller.signal)
    .then(() => {
      returned = true;
    });
  await Promise.resolve();
  assert.equal(returned, false);
  assert.equal(env.store.lesson(env.id).state.question.mode, "repeat");
  release();
  await pending;
  assert.equal(returned, true);
});

test("plan snapshots and current question survive restart and are not replaced by later edits", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "english-plan-restart-"));
  const path = join(dir, "learning.sqlite");
  let store = new Store(path);
  const config = { dataDir: dir };
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const plans = new LessonPlans(store, {}, config);
  await plans.build("animals", { ...request(store), plan: sample() }, true);
  const l = store.create("animals", "persistent", () =>
    plans.snapshot("animals"),
  );
  store.connect(l.id, "test");
  const classroom = new Classroom(store, {}, config);
  classroom.waitRendered = async () => {};
  await classroom.prepared.present(
    l.id,
    classroom.room(l.id).controller.signal,
  );
  const questionId = store.lesson(l.id).state.question.id;
  const changed = sample();
  [changed.steps[0], changed.steps[1]] = [changed.steps[1], changed.steps[0]];
  await plans.build("animals", { ...request(store), plan: changed }, true);
  store.close();
  store = new Store(path);
  store.recover();
  store.connect(l.id, "reconnected");
  assert.equal(store.lessonPlan("animals").steps[0].word, "dog");
  assert.equal(store.lesson(l.id).state.planSnapshot.steps[0].word, "cat");
  assert.equal(store.lesson(l.id).state.question.id, questionId);
  assert.equal(store.lesson(l.id).state.planCursor, 1);
  store.deleteTopic("animals", 1);
  assert.equal(
    store.create("animals", "persistent", () => {
      throw new Error("must not rebuild a replayed start");
    }).id,
    l.id,
  );
});

test("a wrong prepared click reveals the answer and advances only after the next delegation", async (t) => {
  const env = await classroomSetup(t);
  const { store, classroom, room, id } = env;
  const l = store.lesson(id);
  l.state.planCursor = 2;
  store.saveState(id, l.state);
  await classroom.prepared.present(id, room.controller.signal);
  const q = store.lesson(id).state.question;
  const click = (eventId, optionId) => ({
    eventId,
    questionId: q.id,
    optionId,
    mode: "click",
    uncertain: false,
    hinted: false,
  });
  classroom.click(
    id,
    click("wrong", q.options.find((o) => o.id !== q.correctOptionId).id),
  );
  await room.queue;
  assert.equal(store.lesson(id).state.question.id, q.id);
  assert.equal(store.lesson(id).state.question.status, "answered");
  assert.equal(
    store.publicLesson(id).state.question.correctOptionId,
    q.correctOptionId,
  );
  assert.equal(
    classroom.click(id, click("right", q.correctOptionId)).ignored,
    true,
  );
  await room.queue;
  assert.equal(store.results(id).attempts.length, 1);
  assert.equal(store.lesson(id).state.planCursor, 3);
  await classroom.prepared.run({
    id,
    trigger: "Nächster Schritt",
    transcripts: [],
    latestChild: null,
    signal: room.controller.signal,
    confirmedAnswer: null,
    inputVersion: room.inputVersion,
  });
  assert.equal(store.lesson(id).state.planCursor, 4);
  assert.equal(env.calls(), 0);
});

test("the flexible planner discards obsolete model tools after a new utterance", async (t) => {
  const { store } = setup(t);
  const l = store.create("animals", "obsolete");
  store.connect(l.id, "test");
  let current = true,
    release,
    writes = 0;
  const pending = runTeacher({
    store,
    id: l.id,
    ai: {
      responses: () =>
        new Promise((r) => {
          release = r;
        }),
    },
    trigger: "begin",
    transcripts: [],
    signal: new AbortController().signal,
    isCurrent: () => current,
    execute: async () => {
      writes++;
    },
  });
  current = false;
  release({
    output: [
      {
        type: "function_call",
        name: "use_prepared_step",
        call_id: "obsolete",
        arguments: "{}",
      },
    ],
  });
  assert.equal(await pending, "");
  assert.equal(writes, 0);
});
