import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../server/store.js";
import { mergeTranscript } from "../src/transcripts.js";

const shape = (color = "#ef4444") => ({
  id: "ball",
  type: "shape",
  text: "ball",
  translation: "",
  shape: "circle",
  color,
  x: 30,
  y: 10,
  width: 30,
  height: 35,
  fontSize: 32,
  highlight: false,
});
const label = (text = "red") => ({
  ...shape(),
  id: "label",
  type: "text",
  text,
  shape: "none",
  x: 10,
  y: 60,
  width: 80,
  height: 20,
});
export const question = (id = "q1") => ({
  id,
  prompt: "Welcher Ball ist red?",
  knowledge: "red",
  options: [
    {
      id: "a",
      label: "red",
      color: "#ef4444",
      emoji: "",
      aliases: ["rot", "eins", "1"],
    },
    {
      id: "b",
      label: "blue",
      color: "#3b82f6",
      emoji: "",
      aliases: ["blau", "zwei", "2"],
    },
  ],
  correctOptionId: "a",
  hint: "Rot wie eine Erdbeere.",
});
export const board = (revision = 0, q = question()) => ({
  expectedRevision: revision,
  stepId: "colors-red",
  title: "Colors",
  operations: [
    { action: "clear", id: null, element: null },
    { action: "upsert", id: "ball", element: shape() },
    { action: "upsert", id: "label", element: label() },
  ],
  question: q,
  taught: [{ text: "red", kind: "word" }],
});
const answer = (overrides = {}) => ({
  eventId: "answer-1",
  questionId: "q1",
  optionId: "a",
  mode: "click",
  uncertain: false,
  hinted: false,
  ...overrides,
});

test("deleting one lesson removes its evidence and recomputes progress without touching other lessons or topics", (t) => {
  const { store, id } = setup(t);
  store.updateBoard(id, "deleted-board", board());
  store.answer(id, answer());
  store.finish(id, "ended_early");
  const other = store.create("animals", "keep-lesson");
  store.connect(other.id, "keep-remote");
  store.updateBoard(other.id, "keep-board", {
    ...board(),
    question: null,
    taught: [{ text: "cat", kind: "word" }],
  });
  store.finish(other.id, "interrupted");
  assert.equal(store.home().stats.words, 2);
  assert.equal(store.mastery("colors").length, 1);
  store.deleteLesson(id);
  assert.throws(() => store.lesson(id), { status: 404 });
  assert.equal(store.home().stats.words, 1);
  assert.equal(store.home().history.length, 1);
  assert.deepEqual(store.mastery("colors"), []);
  assert.deepEqual(store.reviewQueue("colors"), []);
  assert.equal(store.results(other.id).taught[0].text, "cat");
  assert.equal(store.topics().length, 7);
  for (const table of ["attempts", "questions", "events", "taught"])
    assert.equal(
      store.db
        .prepare(`SELECT COUNT(*) n FROM ${table} WHERE lesson_id=?`)
        .get(id).n,
      0,
    );
  assert.deepEqual(store.db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("deleting an active lesson is rejected without losing evidence", (t) => {
  const { store, id } = setup(t);
  store.updateBoard(id, "active-board", board());
  assert.throws(() => store.deleteLesson(id), { status: 409 });
  assert.equal(store.results(id).taught.length, 1);
});
function setup(t) {
  let time = 100000;
  const store = new Store(":memory:", () => time);
  t.after(() => store.close());
  const l = store.create("colors", "start");
  store.connect(l.id, "remote-test");
  return { store, id: l.id, advance: (ms) => (time += ms) };
}

test("red ball and label change atomically; bad batch rolls back every change", (t) => {
  const { store, id } = setup(t);
  store.updateBoard(id, "step-1", board());
  const next = board(1, null);
  next.operations = [
    { action: "upsert", id: "ball", element: shape("#3b82f6") },
    { action: "upsert", id: "label", element: label("blue") },
  ];
  store.updateBoard(id, "step-2", next);
  const state = store.lesson(id).state;
  assert.equal(state.elements.find((e) => e.id === "ball").color, "#3b82f6");
  assert.equal(state.elements.find((e) => e.id === "label").text, "blue");
  const bad = board(2, question("q-bad"));
  bad.operations.push({ action: "upsert", id: "bad-id", element: label() });
  assert.throws(() => store.updateBoard(id, "step-bad", bad));
  assert.deepEqual(store.lesson(id).state, state);
  assert.equal(store.results(id).questions.length, 1);
});
test("replayed start/board/answer IDs never duplicate courses or attempts", (t) => {
  const { store, id } = setup(t);
  assert.equal(store.create("colors", "start").id, id);
  store.updateBoard(id, "step", board());
  assert.equal(store.updateBoard(id, "step", board()).duplicate, true);
  store.answer(id, answer());
  assert.equal(store.answer(id, answer()).duplicate, true);
  assert.equal(store.results(id).attempts.length, 1);
});
test("unclear speech is preserved separately and does not make mastery incorrect", (t) => {
  const { store, id } = setup(t);
  store.updateBoard(id, "step", board());
  assert.equal(
    store.answer(id, answer({ mode: "voice", uncertain: true, optionId: null }))
      .outcome,
    "uncertain",
  );
  assert.equal(store.lesson(id).state.question.status, "open");
  assert.equal(store.mastery("colors")[0].status, "observing");
  assert.equal(store.mastery("colors")[0].attemptCount, 0);
});
test("wrong click and matching voice merge after choice closes; late retry cannot change the result", (t) => {
  const { store, id, advance } = setup(t);
  store.updateBoard(id, "step", board());
  store.answer(id, answer({ optionId: "b" }));
  advance(500);
  const duplicate = store.answer(
    id,
    answer({ eventId: "voice-1", optionId: "b", mode: "voice" }),
  );
  assert.equal(duplicate.duplicate, true);
  advance(2000);
  const result = store.answer(id, answer({ eventId: "retry-1" }));
  assert.equal(result.ignored, true);
  assert.equal(store.results(id).attempts.length, 1);
  assert.equal(store.mastery("colors")[0].status, "review");
});

test("wrong click on a choice reveals both marks and closes the question", (t) => {
  const { store, id } = setup(t);
  store.updateBoard(id, "choice-board", board());
  const result = store.answer(id, answer({ optionId: "b" }));
  assert.equal(result.outcome, "incorrect");
  const visible = store.publicLesson(id).state.question;
  assert.equal(visible.status, "answered");
  assert.equal(visible.selectedOptionId, "b");
  assert.equal(visible.correctOptionId, "a");
  assert.match(visible.feedback, /red/);
  assert.equal(
    store.answer(id, answer({ eventId: "late-retry", optionId: "a" })).ignored,
    true,
  );
});
test("late answer cannot score against next question and unanswered questions are not mistakes", (t) => {
  const { store, id } = setup(t);
  store.updateBoard(id, "step", board());
  store.updateBoard(id, "step-next", board(1, question("q2")));
  assert.equal(store.answer(id, answer()).ignored, true);
  assert.equal(store.results(id).attempts.length, 0);
  assert.equal(store.results(id).questions[0].status, "unanswered");
});

test("slow backend review deduplicates by when speech arrived, not by model completion time", (t) => {
  const { store, id, advance } = setup(t);
  store.updateBoard(id, "step", board());
  store.answer(id, answer({ optionId: "b" }));
  advance(20000);
  const result = store.answer(
    id,
    answer({ eventId: "late-voice", optionId: "b", mode: "voice" }),
    { occurredAt: 100500 },
  );
  assert.equal(result.duplicate, true);
  assert.equal(store.results(id).attempts.length, 1);
});
test("stale board revisions reject whole changes and question IDs cannot be reused", (t) => {
  const { store, id } = setup(t);
  store.updateBoard(id, "step", board());
  assert.throws(() => store.updateBoard(id, "stale", board()));
  assert.throws(() => store.updateBoard(id, "reuse", board(1)));
  assert.equal(store.lesson(id).state.revision, 1);
});
test("repeated choice evidence improves recognition without claiming independent speaking", (t) => {
  const { store, id, advance } = setup(t);
  store.updateBoard(id, "step", board());
  store.answer(id, answer());
  assert.equal(store.mastery("colors")[0].status, "observing");
  store.requestFinish(id, "completed");
  store.finish(id, "completed");
  advance(86400000);
  const l = store.create("colors", "start-2");
  store.connect(l.id, "remote-2");
  store.updateBoard(l.id, "s2", board());
  store.answer(l.id, answer({ eventId: "a2" }));
  advance(8000);
  store.updateBoard(l.id, "s3", board(1, question("q2")));
  store.answer(l.id, answer({ eventId: "a3", questionId: "q2" }));
  assert.equal(
    store.mastery("colors")[0].skills.recognition.status,
    "developing",
  );
  assert.equal(store.mastery("colors")[0].status, "observing");
  assert.equal(store.mastery("colors")[0].skills.speaking.attemptCount, 0);
  store.finish(l.id, "ended_early");
  assert.equal(
    store.home().topics.find((t) => t.id === "colors").experience,
    "learned",
  );
  assert.equal(store.home().history.length, 2);
});
test("interruption persists progress and reconnect uses the same lesson without counting downtime", (t) => {
  const { store, id, advance } = setup(t);
  store.updateBoard(id, "step", board());
  advance(8000);
  store.heartbeat(id);
  store.finish(id, "interrupted");
  advance(3600000);
  assert.throws(() => store.answer(id, answer()));
  store.connect(id, "remote-2");
  advance(8000);
  store.heartbeat(id);
  assert.equal(store.lesson(id).duration_ms, 16000);
  assert.equal(store.lesson(id).state.question.id, "q1");
  assert.equal(store.home().history.length, 1);
});
test("restart preserves SQLite results, marks crash interrupted and never stores transcripts", () => {
  const folder = mkdtempSync(join(tmpdir(), "englishlehrer-"));
  const path = join(folder, "learning.sqlite");
  try {
    let s = new Store(path, () => 100000);
    const l = s.create("colors", "start");
    s.connect(l.id, "remote");
    s.updateBoard(l.id, "step", board());
    s.answer(l.id, answer());
    s.close();
    s = new Store(path, () => 900000);
    assert.equal(s.recover().length, 1);
    assert.equal(s.lesson(l.id).status, "interrupted");
    assert.equal(s.results(l.id).attempts.length, 1);
    assert.equal(s.results(l.id).taught[0].text, "red");
    const schema = s.db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.sql)
      .join(" ");
    assert.doesNotMatch(schema, /transcript|audio/i);
    s.close();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
test("transcript fragments merge by timing, accept correction and preserve overlapping speakers", () => {
  const ev = (type, start, delta, id) => ({
    type: `session.${type}_transcript.delta`,
    start_ms: start,
    end_ms: start + 200,
    delta,
    event_id: id,
  });
  let rows = mergeTranscript([], ev("output", 1000, "Hello ", "e1"));
  rows = mergeTranscript(rows, ev("input", 1050, "Hi", "e2"));
  rows = mergeTranscript(rows, ev("output", 1200, "world", "e3"));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].text, "Hello world");
  rows = mergeTranscript(rows, ev("output", 1200, "there", "e4"));
  assert.equal(rows[0].text, "Hello there");
  assert.equal(rows[1].text, "Hi");
});
