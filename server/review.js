const DAY = 86400000;
const intervals = [1, 3, 7, 14, 30];
export { knowledgeKey } from "../shared/languages.js";
import { knowledgeKey } from "../shared/languages.js";

function skillEvidence(rows, introducedAt, now) {
  const recent = rows.slice(0, 6);
  const independent = recent.filter(
    (a) => a.outcome === "correct" && !a.hinted,
  );
  const latest = recent[0];
  let successes = new Set();
  for (const row of rows) {
    if (row.outcome !== "correct" || row.hinted) break;
    successes.add(row.lesson_id);
  }
  const review =
    !!latest &&
    (latest.outcome === "incorrect" ||
      !!latest.hinted ||
      recent.filter((a) => a.outcome === "incorrect").length >= 2);
  const developing =
    independent.length >= 3 &&
    new Set(independent.map((a) => a.lesson_id)).size >= 2 &&
    !review;
  const intervalDays = latest
    ? review
      ? 1
      : intervals[
          Math.min(Math.max(0, successes.size - 1), intervals.length - 1)
        ]
    : 0;
  const dueAt = latest ? latest.created_at + intervalDays * DAY : introducedAt;
  return {
    status: developing ? "developing" : review ? "review" : "observing",
    independent: independent.length,
    attemptCount: rows.length,
    updatedAt: latest?.created_at ?? introducedAt,
    dueAt,
    due: dueAt <= now,
    intervalDays,
    reasonCode: !latest
      ? "noEvidence"
      : review
        ? "needsHelp"
        : developing
          ? "independent"
          : "firstEvidence",
    reason: !latest
      ? "Noch ohne selbstständigen Übungsbeleg."
      : review
        ? "Zuletzt mit Hilfe oder noch verwechselt."
        : developing
          ? "Mehrmals selbstständig in verschiedenen Stunden richtig."
          : "Erster selbstständiger Übungsbeleg; später erneut abrufen.",
  };
}

// Derive the schedule from durable question/attempt evidence; old databases need
// no invented scores, and repeats/uncertainty cannot push a review into the future.
export function wordMastery(attempts, taught, now) {
  const groups = new Map();
  for (const item of taught)
    groups.set(knowledgeKey(item.text), {
      knowledge: item.text,
      introducedAt: item.updatedAt,
      rows: [],
    });
  for (const row of attempts) {
    if (row.outcome === "uncertain" || row.practice_mode === "repeat") continue;
    const key = knowledgeKey(row.knowledge);
    if (!groups.has(key))
      groups.set(key, {
        knowledge: row.knowledge,
        introducedAt: row.created_at,
        rows: [],
      });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()].map(({ knowledge, introducedAt, rows }) => {
    const speakingRows = rows.filter((a) =>
      ["picture_speak", "meaning_speak"].includes(a.practice_mode),
    );
    const recognitionRows = rows.filter(
      (a) => !["picture_speak", "meaning_speak"].includes(a.practice_mode),
    );
    const skills = {
      recognition: skillEvidence(recognitionRows, introducedAt, now),
      speaking: skillEvidence(speakingRows, introducedAt, now),
    };
    const aggregate = skillEvidence(rows, introducedAt, now);
    const status = Object.values(skills).some((s) => s.status === "review")
      ? "review"
      : skills.speaking.status === "developing"
        ? "developing"
        : "observing";
    return {
      knowledge,
      ...aggregate,
      status,
      reason: `Auswählen: ${skills.recognition.reason} Selbst sprechen: ${skills.speaking.reason}`,
      dueAt: Math.min(skills.recognition.dueAt, skills.speaking.dueAt),
      due: skills.recognition.due || skills.speaking.due,
      skills,
    };
  });
}

export function dueReviews(mastery, topic, limit = 3) {
  const allowed = new Set([...topic.words, ...topic.phrases].map(knowledgeKey));
  return mastery
    .filter((m) => allowed.has(knowledgeKey(m.knowledge)))
    .flatMap((m) => {
      // Missing spoken evidence takes priority over another recognition quiz.
      const due = Object.entries(m.skills)
        .filter(([, skill]) => skill.due)
        .sort(
          (a, b) => a[1].dueAt - b[1].dueAt || (a[0] === "speaking" ? -1 : 1),
        );
      if (!due.length) return [];
      const [skill, evidence] = due[0];
      return [
        {
          word: m.knowledge,
          skill,
          dueAt: evidence.dueAt,
          reasonCode: evidence.reasonCode,
          reason: `${skill === "speaking" ? "Selbst sprechen" : "Erkennen und wählen"}: ${evidence.reason}`,
        },
      ];
    })
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, limit);
}
