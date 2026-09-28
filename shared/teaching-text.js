import { languageName, lessonLanguages } from "./languages.js";

const messages = {
  repeat: [
    "Listen and repeat.",
    "Hör zu und sprich nach.",
    "听一听，再跟着说。",
  ],
  choice: [
    "Which {target} word means “{meaning}”?",
    "Welches Wort auf {target} bedeutet „{meaning}“?",
    "哪个{target}词表示“{meaning}”？",
  ],
  recall: [
    "How do you say “{meaning}” in {target}?",
    "Wie heißt „{meaning}“ auf {target}?",
    "“{meaning}”用{target}怎么说？",
  ],
  definitionChoice: [
    "Which word matches this clue: {meaning}?",
    "Welches Wort passt: {meaning}?",
    "哪个词符合这个提示：{meaning}？",
  ],
  definitionRecall: [
    "Name the word: {meaning}.",
    "Nenne das passende Wort: {meaning}.",
    "说出符合提示的词：{meaning}。",
  ],
  picture: [
    "What do you see? Say the word in {target}.",
    "Was siehst du? Sag das Wort auf {target}.",
    "你看到了什么？用{target}说出来。",
  ],
  color: [
    "Which color do you see? Say it in {target}.",
    "Welche Farbe siehst du? Sag sie auf {target}.",
    "你看到了什么颜色？用{target}说出来。",
  ],
  repeatTitle: ["Repeat after me", "Sprich mir nach", "跟我说"],
  choiceTitle: ["Listen and choose", "Hören & wählen", "听一听，选一选"],
  pictureTitle: ["Look and speak", "Schauen & sprechen", "看一看，说一说"],
  recallTitle: ["Find the word", "Das passende Wort", "说出这个词"],
  hint: [
    "Listen: {word}. Now repeat it.",
    "Hör zu: {word}. Sprich es jetzt nach.",
    "听一听：{word}。现在跟着说。",
  ],
  introduce: [
    "{meaning}: {word}. Repeat after me.",
    "{meaning}: {word}. Sprich es nach.",
    "{meaning}：{word}。跟我说一遍。",
  ],
  correct: ["Great, that's right!", "Prima, das stimmt!", "真棒，答对了！"],
  answer: [
    "The correct word is {word}.",
    "Das richtige Zielwort ist {word}.",
    "正确的词语是{word}。",
  ],
  uncertain: [
    "I didn't quite catch that. Please say it again.",
    "Das habe ich noch nicht sicher verstanden. Sag es bitte noch einmal.",
    "我还没听清楚，请再说一次。",
  ],
  incorrect: [
    "Not quite. The answer is {word}.",
    "Nicht ganz. Richtig ist {word}.",
    "还不太对，正确答案是{word}。",
  ],
  retry: [
    "Almost! Try again. You can do it.",
    "Fast! Versuch es noch einmal. Du schaffst das.",
    "差一点！再试一次，你可以的。",
  ],
  summaryFallback: [
    "Your learning results are saved. The personal summary could not be created right now.",
    "Deine Lernergebnisse sind gespeichert. Die persönliche Zusammenfassung konnte gerade nicht erstellt werden.",
    "学习结果已保存，暂时无法生成课程总结。",
  ],
};
export function teachingText(languages, key, params = {}) {
  const context = lessonLanguages(languages);
  const index = { en: 0, de: 1, "zh-CN": 2 }[context.instructionLanguage] ?? 1;
  const text = messages[key]?.[index];
  if (!text) throw new Error(`Unknown teaching message: ${key}`);
  const values = {
    target: languageName(context.targetLanguage, context.instructionLanguage),
    ...params,
  };
  return text.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
}
