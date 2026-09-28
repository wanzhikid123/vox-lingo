import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  emojiCount,
  emojiDirectory,
  findEmoji,
  normalizeVisual,
  searchEmoji,
} from "../server/emoji.js";
import { Classroom } from "../server/classroom.js";

const element = (text) => ({
  id: "object",
  type: "shape",
  shape: "square",
  text,
  translation: "",
  color: "#ffd166",
  x: 25,
  y: 5,
  width: 50,
  height: 60,
  fontSize: 70,
  highlight: false,
});

for (const word of ["bus", "train", "sofa"]) {
  test(`${word} gets a recognizable emoji instead of a colored square`, (t) => {
    const store = new Store(":memory:");
    t.after(() => store.close());
    const lesson = store.create("objects", `visual-${word}`);
    store.connect(lesson.id, "test");
    store.updateBoard(lesson.id, "board", {
      expectedRevision: 0,
      stepId: word,
      title: word,
      operations: [{ action: "upsert", id: "object", element: element(word) }],
      question: null,
      taught: [],
    });
    const visual = store.publicLesson(lesson.id).state.elements[0];
    assert.equal(visual.type, "emoji");
    assert.match(visual.src, /^\/assets\/emoji\/[a-f0-9-]+\.svg$/);
  });
}
test("an unlabeled object placeholder is resolved from the single taught word", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const lesson = store.create("objects", "unlabeled-bus");
  store.connect(lesson.id, "test");
  store.updateBoard(lesson.id, "board", {
    expectedRevision: 0,
    stepId: "bus",
    title: "Unterwegs",
    operations: [{ action: "upsert", id: "object", element: element("") }],
    question: null,
    taught: [{ text: "bus", kind: "word" }],
  });
  assert.equal(store.lesson(lesson.id).state.elements[0].emoji, "🚌");
  assert.equal(
    normalizeVisual({ ...element(""), translation: "Sofa" }).type,
    "emoji",
  );
});

test("local library resolves large teaching SVGs, aliases and actual emoji without guessing", () => {
  assert.ok(emojiCount > 3000);
  for (const query of [
    "bus",
    "train",
    "sofa",
    "🛋️",
    "chair",
    "elephant",
    "Fahrrad",
  ]) {
    const result = findEmoji(query);
    assert.ok(result, query);
    assert.ok(
      existsSync(join(emojiDirectory, result.src.split("/").at(-1))),
      query,
    );
  }
  assert.equal(findEmoji("a sofa inside a bus"), null);
  assert.equal(
    normalizeVisual(element("spaceship kitchen")).textFallback,
    true,
  );
  assert.equal(normalizeVisual(element("red ball")).type, "shape");
  assert.equal(searchEmoji("sofa")[0].emoji, "🛋️");
});

test("missing emoji uses the German word without calling any image service", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const lesson = store.create("objects", "missing-visual");
  store.connect(lesson.id, "test");
  const classroom = new Classroom(store, {}, {});
  classroom.waitRendered = async () => {};
  await classroom.execute(
    lesson.id,
    "patch_board",
    {
      expectedRevision: 0,
      stepId: "missing",
      title: "Üben",
      operations: [
        {
          action: "upsert",
          id: "object",
          element: {
            ...element("spaceship kitchen"),
            type: "emoji",
            translation: "Raumschiffküche",
          },
        },
      ],
      question: null,
      taught: [],
    },
    "missing-board",
    null,
    new AbortController().signal,
  );
  const visual = store.publicLesson(lesson.id).state.elements[0];
  assert.equal(visual.type, "text");
  assert.equal(visual.text, "Raumschiffküche");
  assert.equal(visual.src, undefined);
  assert.equal(visual.imageStatus, undefined);
});
