import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);
export const emojiDirectory = dirname(
  require.resolve("@twemoji/svg/package.json"),
);
const assets = new Set(
  readdirSync(emojiDirectory).filter((file) => file.endsWith(".svg")),
);
const normalize = (value) =>
  String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
const byName = new Map(),
  byGlyph = new Map();
const records = [];

function assetFor(glyph) {
  const code = Array.from(glyph)
    .map((char) => char.codePointAt(0).toString(16))
    .join("-");
  const file = [code, code.replace(/-?fe0f/g, "")]
    .map((key) => `${key}.svg`)
    .find((name) => assets.has(name));
  return file ? `/assets/emoji/${file}` : null;
}
for (const language of ["en", "de", "zh", "ja", "ko", "fr", "es"]) {
  const data = JSON.parse(
    readFileSync(
      require.resolve(`emojibase-data/${language}/data.json`),
      "utf8",
    ),
  );
  for (const item of data) {
    const src = assetFor(item.emoji);
    if (!src) continue;
    const record = { emoji: item.emoji, label: item.label, src };
    byName.set(normalize(item.label), record);
    byGlyph.set(item.emoji.replace(/\ufe0f/g, ""), record);
    records.push(record);
  }
}
// Teaching synonyms: exact matches only. Do not guess objects from a shared keyword.
const aliases = {
  bus: "🚌",
  autobus: "🚌",
  schulbus: "🚌",
  train: "🚆",
  zug: "🚆",
  sofa: "🛋️",
  couch: "🛋️",
  car: "🚗",
  auto: "🚗",
  bicycle: "🚲",
  bike: "🚲",
  fahrrad: "🚲",
  plane: "✈️",
  airplane: "✈️",
  flugzeug: "✈️",
  boat: "⛵",
  boot: "⛵",
  cat: "🐈",
  katze: "🐈",
  dog: "🐕",
  hund: "🐕",
  bird: "🐦",
  vogel: "🐦",
  bear: "🐻",
  bär: "🐻",
  rabbit: "🐇",
  hase: "🐇",
  horse: "🐎",
  pferd: "🐎",
  apple: "🍎",
  apfel: "🍎",
  banana: "🍌",
  banane: "🍌",
  orange: "🍊",
  book: "📖",
  buch: "📖",
  pencil: "✏️",
  bleistift: "✏️",
  bag: "🎒",
  schoolbag: "🎒",
  rucksack: "🎒",
  chair: "🪑",
  stuhl: "🪑",
  bed: "🛏️",
  bett: "🛏️",
  house: "🏠",
  haus: "🏠",
  ball: "⚽",
  football: "⚽",
  soccer: "⚽",
  fußball: "⚽",
  cup: "☕",
  tasse: "☕",
  hello: "👋",
  goodbye: "👋",
  mother: "👩",
  mum: "👩",
  father: "👨",
  dad: "👨",
};
for (const [word, glyph] of Object.entries(aliases)) {
  const record = byGlyph.get(glyph.replace(/\ufe0f/g, ""));
  if (record) byName.set(word, record);
}
export function findEmoji(value) {
  return (
    byGlyph.get(String(value || "").replace(/\ufe0f/g, "")) ||
    byName.get(normalize(value)) ||
    null
  );
}
export function searchEmoji(query) {
  const exact = findEmoji(query);
  const matches = records.filter((record) =>
    normalize(record.label).includes(normalize(query)),
  );
  return [
    ...new Map(
      [...(exact ? [exact] : []), ...matches].map((record) => [
        record.src,
        record,
      ]),
    ).values(),
  ].slice(0, 16);
}
export const emojiCount = assets.size;
export function normalizeVisual(element, contextWord = "") {
  if (!["shape", "emoji", "image"].includes(element.type)) return element;
  // Old saved image elements are also rendered through the local fallback.
  const { src, emoji, imageStatus, missingEmoji, ...clean } = element;
  element = clean;
  const subject =
    String(element.text || "").trim() ||
    String(element.translation || "").trim() ||
    contextWord;
  // Colored balls and real geometry remain precise SVG shapes.
  const basic =
    /^(?:(?:red|blue|green|yellow|purple|orange|pink|black|white|brown|grey|gray|rot|blau|grün|gelb|lila|rosa|schwarz|weiß|braun|grau)[ -]?)?(?:ball|circle|square|triangle|star|rectangle|kreis|quadrat|dreieck|stern|rechteck)?$/i;
  if (
    element.type === "shape" &&
    (basic.test(subject) || /^\d+$/.test(subject))
  )
    return element;
  const match = findEmoji(subject) || findEmoji(element.translation);
  if (match)
    return {
      ...element,
      text: element.text || subject,
      type: "emoji",
      shape: "none",
      emoji: match.emoji,
      src: match.src,
    };
  return {
    ...element,
    text: String(element.translation || "").trim(),
    translation: "",
    type: "text",
    shape: "none",
    textFallback: true,
  };
}
