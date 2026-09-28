import { randomUUID } from "node:crypto";
import { practiceToolSchema } from "../shared/contracts.js";
import { AppError } from "./store.js";
import { findEmoji } from "./emoji.js";
import {
  normalizePractice,
  lessonLanguages,
  knowledgeKey,
} from "../shared/languages.js";
import { teachingText } from "../shared/teaching-text.js";

export const isSpokenPractice = (question) =>
  ["repeat", "picture_speak", "meaning_speak"].includes(question?.mode);
const colors = {
  red: "#ed5c54",
  blue: "#5599dd",
  yellow: "#f4cd3d",
  green: "#63a45c",
  orange: "#f19538",
  purple: "#9466bf",
  pink: "#ee9fc5",
  black: "#252525",
  white: "#ffffff",
  brown: "#986238",
  gray: "#999999",
  grey: "#999999",
};
const colorNames = {
  red: ["rot", "rouge", "rojo", "roja", "赤", "赤い", "빨강", "빨간색", "红色"],
  blue: [
    "blau",
    "bleu",
    "bleue",
    "azul",
    "青",
    "青い",
    "파랑",
    "파란색",
    "蓝色",
  ],
  yellow: [
    "gelb",
    "jaune",
    "amarillo",
    "amarilla",
    "黄色",
    "黄色い",
    "노랑",
    "노란색",
  ],
  green: [
    "grün",
    "vert",
    "verte",
    "verde",
    "緑",
    "緑色",
    "초록",
    "초록색",
    "绿色",
  ],
  orange: ["naranja", "オレンジ", "オレンジ色", "주황", "주황색", "橙色"],
  purple: [
    "lila",
    "violett",
    "violet",
    "violette",
    "morado",
    "morada",
    "紫",
    "紫色",
    "보라",
    "보라색",
  ],
  pink: ["rosa", "rose", "ピンク", "분홍", "분홍색", "粉色"],
  black: [
    "schwarz",
    "noir",
    "noire",
    "negro",
    "negra",
    "黒",
    "黒い",
    "검정",
    "검은색",
    "黑色",
  ],
  white: [
    "weiß",
    "weiss",
    "blanc",
    "blanche",
    "blanco",
    "blanca",
    "白",
    "白い",
    "하양",
    "흰색",
    "白色",
  ],
  brown: ["braun", "marron", "marrón", "茶色", "갈색", "棕色"],
  gray: ["grau", "gris", "灰色", "회색"],
};
for (const [color, names] of Object.entries(colorNames))
  for (const name of names) colors[name] = colors[color];

export function practiceBoard(raw, topic) {
  const args = practiceToolSchema.parse(normalizePractice(raw));
  const languages = lessonLanguages(topic);
  const say = (key, params) => teachingText(languages, key, params);
  const same = languages.instructionLanguage === languages.targetLanguage;
  const { word, meaning } = args;
  const color =
    topic.id === "colors" ||
    topic.words.every((item) => colors[knowledgeKey(item)])
      ? colors[knowledgeKey(word)]
      : null;
  const mode =
    args.mode === "picture_speak" &&
    !color &&
    !findEmoji(word) &&
    !findEmoji(meaning)
      ? "meaning_speak"
      : args.mode;
  if (
    ![...topic.words, ...topic.phrases].some(
      (item) => knowledgeKey(item) === knowledgeKey(word),
    )
  )
    throw new AppError(
      "Bitte ein Wort oder einen Satz aus dem aktuellen Thema verwenden.",
    );
  const labels = [...new Set([word, ...args.distractors])];
  if (mode === "meaning_choice" && labels.length < 2)
    throw new AppError(
      "Bitte mindestens ein anderes gelerntes Wort als Auswahl ergänzen.",
    );
  // Rotate the correct answer; never make position one the answer to every exercise.
  if (mode === "meaning_choice") {
    const shift = args.expectedRevision % labels.length;
    labels.push(...labels.splice(0, shift));
  }
  const prompt = {
    repeat: say("repeat"),
    meaning_choice: say(same ? "definitionChoice" : "choice", { meaning }),
    picture_speak: say(color ? "color" : "picture"),
    meaning_speak: say(same ? "definitionRecall" : "recall", { meaning }),
  }[mode];
  const element = (id, type, text, x, y, width, height) => ({
    id,
    type,
    text,
    translation: "",
    shape: "none",
    color: "#354f3c",
    x,
    y,
    width,
    height,
    fontSize: 70,
    highlight: false,
  });
  const picture = (x, y, width, height) => ({
    ...element(
      "practice-picture",
      color ? "shape" : "emoji",
      word,
      x,
      y,
      width,
      height,
    ),
    ...(color ? { color, shape: "circle" } : {}),
    translation: meaning,
  });
  const elements =
    mode === "picture_speak"
      ? [picture(20, 3, 60, 90)]
      : mode === "repeat"
        ? color || findEmoji(word) || findEmoji(meaning)
          ? [
              picture(25, 0, 50, 58),
              {
                ...element("practice-word", "text", word, 5, 61, 90, 23),
                fontSize: 52,
              },
              {
                ...element("practice-meaning", "text", meaning, 5, 85, 90, 14),
                fontSize: 24,
              },
            ]
          : [
              element("practice-word", "text", word, 5, 10, 90, 55),
              {
                ...element("practice-meaning", "text", meaning, 5, 68, 90, 25),
                fontSize: 30,
              },
            ]
        : [element("practice-meaning", "text", meaning, 5, 20, 90, 60)];
  const qid = `practice-${randomUUID()}`;
  return {
    expectedRevision: args.expectedRevision,
    stepId: qid,
    title: {
      repeat: say("repeatTitle"),
      meaning_choice: say("choiceTitle"),
      picture_speak: say("pictureTitle"),
      meaning_speak: say("recallTitle"),
    }[mode],
    operations: [
      { action: "clear", id: null, element: null },
      ...elements.map((element) => ({
        action: "upsert",
        id: element.id,
        element,
      })),
    ],
    question: {
      id: qid,
      mode,
      prompt,
      knowledge: word,
      options: (mode === "meaning_choice" ? labels : [word]).map(
        (label, index) => ({
          id: `answer-${index}`,
          label,
          aliases: [],
          color: "",
          emoji: "",
        }),
      ),
      correctOptionId: `answer-${mode === "meaning_choice" ? labels.indexOf(word) : 0}`,
      hint: say("hint", { word }),
    },
    taught: [{ text: word, kind: word.includes(" ") ? "phrase" : "word" }],
  };
}
