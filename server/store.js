import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { topics as seedTopics } from "../shared/topics.js";
import { findEmoji, normalizeVisual } from "./emoji.js";
import { wordMastery, dueReviews } from "./review.js";
import {
  defaultLanguages,
  normalizeLanguages,
  normalizeTopic,
  normalizePlan,
  normalizePractice,
  lessonLanguages,
} from "../shared/languages.js";
import { teachingText } from "../shared/teaching-text.js";
import {
  boardToolSchema,
  answerSchema,
  topicSchema,
} from "../shared/contracts.js";

export class AppError extends Error {
  constructor(message, status = 400, code = null, params = {}) {
    super(message);
    this.status = status;
    this.code =
      code ||
      (status === 404
        ? "notFound"
        : status === 403
          ? "permissionDenied"
          : status === 409
            ? "conflict"
            : status === 502 || status === 503
              ? "providerUnavailable"
              : "operationFailed");
    this.params = params;
  }
}
export class Store {
  constructor(path, now = () => Date.now()) {
    this.now = now;
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    const version = this.db.prepare("PRAGMA user_version").get().user_version;
    if (version > 5) {
      this.db.close();
      throw new AppError(
        "Diese Datenbank wurde mit einer neueren Version erstellt.",
        500,
      );
    }
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000",
    );
    try {
      this.transaction(() => {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK(id=1), age INTEGER, level TEXT, language TEXT);
      INSERT OR IGNORE INTO profile VALUES(1,8,'beginner','de');
      CREATE TABLE IF NOT EXISTS lessons (
        id TEXT PRIMARY KEY, start_event TEXT UNIQUE NOT NULL, topic_id TEXT NOT NULL,
        started_at INTEGER NOT NULL, ended_at INTEGER, last_seen INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, connected INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL, summary TEXT, summary_status TEXT NOT NULL DEFAULT 'pending', remote_id TEXT);
      CREATE TABLE IF NOT EXISTS taught (lesson_id TEXT REFERENCES lessons(id), text TEXT, kind TEXT, taught_at INTEGER, PRIMARY KEY(lesson_id,text));
      CREATE TABLE IF NOT EXISTS questions (id TEXT, lesson_id TEXT REFERENCES lessons(id), payload TEXT NOT NULL, status TEXT NOT NULL, hinted INTEGER DEFAULT 0, PRIMARY KEY(lesson_id,id));
      CREATE TABLE IF NOT EXISTS attempts (event_id TEXT PRIMARY KEY, lesson_id TEXT REFERENCES lessons(id), question_id TEXT,
        knowledge TEXT, option_id TEXT, mode TEXT, outcome TEXT, hinted INTEGER, created_at INTEGER);
      CREATE INDEX IF NOT EXISTS attempts_knowledge ON attempts(knowledge,created_at);
      CREATE TABLE IF NOT EXISTS events (event_id TEXT PRIMARY KEY, lesson_id TEXT REFERENCES lessons(id), kind TEXT, created_at INTEGER, result TEXT);
      CREATE TABLE IF NOT EXISTS topics (id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS lesson_plans (topic_id TEXT PRIMARY KEY, topic_revision INTEGER NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS deleted_topics (id TEXT PRIMARY KEY, deleted_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS preparation_context (id INTEGER PRIMARY KEY CHECK(id=1), generation INTEGER NOT NULL);
      INSERT OR IGNORE INTO preparation_context VALUES(1,0);
      CREATE TABLE IF NOT EXISTS preparation_turns (
        id TEXT PRIMARY KEY, message TEXT NOT NULL, topic_id TEXT, lesson_id TEXT,
        created_at INTEGER NOT NULL, status TEXT NOT NULL, response TEXT, error TEXT);
      `);
        if (version < 5) {
          this.db
            .exec(`ALTER TABLE lessons ADD COLUMN target_language TEXT NOT NULL DEFAULT 'en';
          ALTER TABLE lesson_plans RENAME TO legacy_lesson_plans;
          CREATE TABLE lesson_plans (topic_id TEXT NOT NULL, instruction_language TEXT NOT NULL, target_language TEXT NOT NULL,
            topic_revision INTEGER NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL,
            PRIMARY KEY(topic_id,instruction_language));
          INSERT INTO lesson_plans SELECT topic_id,'de','en',topic_revision,revision,payload,updated_at FROM legacy_lesson_plans;
          DROP TABLE legacy_lesson_plans;
          CREATE INDEX lessons_language ON lessons(target_language,started_at);
          CREATE TABLE language_settings (id INTEGER PRIMARY KEY CHECK(id=1), revision TEXT NOT NULL, payload TEXT NOT NULL);
          CREATE TABLE topic_operations (id TEXT PRIMARY KEY, request TEXT NOT NULL, status TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0,
            total INTEGER NOT NULL, result TEXT, error TEXT, created_at INTEGER NOT NULL);`);
          this.db
            .prepare("INSERT INTO language_settings VALUES(1,?,?)")
            .run(randomUUID(), JSON.stringify(defaultLanguages));
        }
        const insert = this.db.prepare(
          "INSERT OR IGNORE INTO topics SELECT ?,?,1 WHERE NOT EXISTS(SELECT 1 FROM deleted_topics WHERE id=?)",
        );
        for (const topic of seedTopics)
          insert.run(
            topic.id,
            JSON.stringify({
              ...topic,
              targetLanguage: "en",
              teachingNotes:
                topic.id === "days"
                  ? "Alle sieben Wochentage von Monday bis Sunday in Reihenfolge anbieten. Nach einer Wiederholung zum nächsten Tag führen. Bei Bedarf mehrere kleine Runden."
                  : "",
              coverage: topic.id === "days" ? "all" : "small_steps",
            }),
            topic.id,
          );
        // Freeze historical and in-progress lesson plans before parents edit the catalog.
        for (const row of this.db
          .prepare("SELECT id,topic_id,state FROM lessons")
          .all()) {
          const state = JSON.parse(row.state);
          if (!state.topicSnapshot) {
            state.topicSnapshot = this.topic(row.topic_id);
            this.saveState(row.id, state);
          }
        }
        this.db.exec("PRAGMA user_version=5");
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  lesson(id) {
    const row = this.db.prepare("SELECT * FROM lessons WHERE id=?").get(id);
    if (!row) throw new AppError("Diese Stunde wurde nicht gefunden.", 404);
    const state = JSON.parse(row.state);
    state.languages = lessonLanguages(state.languages);
    state.topicSnapshot = normalizeTopic(state.topicSnapshot);
    state.planSnapshot = normalizePlan(state.planSnapshot);
    state.question = normalizePractice(state.question);
    state.elements = state.elements.map((element) =>
      element.type === "image" ? normalizeVisual(element) : element,
    );
    if (
      state.question?.mode === "picture_speak" &&
      state.elements.some((e) => e.textFallback)
    ) {
      const meaning = state.elements.find((e) => e.textFallback).text;
      state.question.mode = "meaning_speak";
      state.question.prompt = teachingText(state.languages, "recall", {
        meaning,
      });
    }
    return {
      ...row,
      state,
      summary: row.summary ? JSON.parse(row.summary) : null,
      topic: state.topicSnapshot || this.topic(row.topic_id),
    };
  }
  saveState(id, state) {
    this.db
      .prepare("UPDATE lessons SET state=? WHERE id=?")
      .run(JSON.stringify(state), id);
  }
  active(id) {
    const lesson = this.lesson(id);
    if (lesson.status !== "active" || !lesson.connected)
      throw new AppError("Verbinde die Stunde zuerst erneut.", 409);
    return lesson;
  }
  create(topicId, eventId, planSnapshot = null, languages = null) {
    const prior = this.db
      .prepare("SELECT id FROM lessons WHERE start_event=?")
      .get(eventId);
    if (prior) {
      const previous = this.lesson(prior.id);
      if (previous.topic_id !== topicId)
        throw new AppError("Event ID already used.", 409, "eventConflict");
      return previous;
    }
    const topic = this.topic(topicId);
    if (!topic) throw new AppError("Bitte wähle ein Thema.");
    if (this.db.prepare("SELECT id FROM lessons WHERE status='active'").get())
      throw new AppError(
        "Eine Stunde ist bereits geöffnet. Bitte kehre zu ihr zurück.",
        409,
      );
    const id = randomUUID();
    const now = this.now();
    const state = {
      revision: 0,
      stepId: "welcome",
      title: topic.name,
      elements: [],
      question: null,
      phase: "warmup",
      readyToFinish: false,
      topicSnapshot: topic,
      languages: lessonLanguages(
        languages || { targetLanguage: topic.targetLanguage },
      ),
      planSnapshot:
        typeof planSnapshot === "function" ? planSnapshot() : planSnapshot,
      planCursor: 0,
      preparedQuestionId: null,
    };
    this.db
      .prepare(
        "INSERT INTO lessons(id,start_event,topic_id,started_at,last_seen,status,state,target_language) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        eventId,
        topicId,
        now,
        now,
        "active",
        JSON.stringify(state),
        topic.targetLanguage,
      );
    return this.lesson(id);
  }
  connect(id, remoteId) {
    const lesson = this.lesson(id);
    if (
      this.db
        .prepare("SELECT id FROM lessons WHERE status='active' AND id<>?")
        .get(id)
    )
      throw new AppError("A lesson is already open.", 409, "activeLesson");
    if (!["active", "interrupted"].includes(lesson.status))
      throw new AppError("Diese Stunde ist schon beendet.", 409);
    this.db
      .prepare(
        "UPDATE lessons SET status='active',connected=1,last_seen=?,ended_at=NULL,remote_id=? WHERE id=?",
      )
      .run(this.now(), remoteId, id);
    return this.lesson(id);
  }
  heartbeat(id) {
    const lesson = this.lesson(id);
    const now = this.now();
    if (lesson.status !== "active") return lesson;
    const delta = lesson.connected
      ? Math.min(20000, Math.max(0, now - lesson.last_seen))
      : 0;
    this.db
      .prepare(
        "UPDATE lessons SET duration_ms=duration_ms+?,last_seen=? WHERE id=?",
      )
      .run(delta, now, id);
    return this.lesson(id);
  }
  remember(id, eventId, kind, fn) {
    const prior = this.db
      .prepare("SELECT * FROM events WHERE event_id=?")
      .get(eventId);
    if (prior) {
      if (prior.lesson_id !== id)
        throw new AppError("Ereignis gehört zu einer anderen Stunde.", 409);
      return { ...JSON.parse(prior.result), duplicate: true };
    }
    return this.transaction(() => {
      const result = fn();
      this.db
        .prepare("INSERT INTO events VALUES(?,?,?,?,?)")
        .run(eventId, id, kind, this.now(), JSON.stringify(result));
      return result;
    });
  }
  updateBoard(id, eventId, raw) {
    const data = boardToolSchema.parse({
      ...raw,
      question: normalizePractice(raw.question),
    });
    return this.remember(id, eventId, "board", () => {
      const lesson = this.active(id);
      const state = structuredClone(lesson.state);
      if (state.readyToFinish)
        throw new AppError("Die Stunde wird bereits abgeschlossen.", 409);
      if (state.revision !== data.expectedRevision)
        throw new AppError(
          "Die Tafel wurde inzwischen geändert. Lade den aktuellen Stand.",
          409,
        );
      if (data.question) {
        if (
          ["choice", "meaning_choice"].includes(data.question.mode) &&
          data.question.options.length < 2
        )
          throw new AppError(
            "Eine Auswahlfrage braucht mindestens zwei Optionen.",
          );
        const ids = data.question.options.map((o) => o.id);
        if (
          new Set(ids).size !== ids.length ||
          !ids.includes(data.question.correctOptionId)
        )
          throw new AppError("Ungültige Antwortmöglichkeiten.");
        if (
          this.db
            .prepare("SELECT id FROM questions WHERE lesson_id=? AND id=?")
            .get(id, data.question.id)
        )
          throw new AppError("Nutze für eine neue Frage eine neue ID.");
      }
      // A single unlabeled shape accompanying a single taught object is the old
      // placeholder pattern. Preserve multi-shape diagrams and ordinary color balls.
      const shapeCount = data.operations.filter(
        (op) => op.action === "upsert" && op.element?.type === "shape",
      ).length;
      const visualWord =
        shapeCount === 1 &&
        data.taught.length === 1 &&
        findEmoji(data.taught[0].text)
          ? data.taught[0].text
          : "";
      for (const op of data.operations) {
        if (op.action === "clear") state.elements = [];
        if (op.action === "remove")
          state.elements = state.elements.filter((e) => e.id !== op.id);
        if (op.action === "upsert") {
          if (!op.element || op.id !== op.element.id)
            throw new AppError("Ungültiges Tafelelement.");
          if (
            op.element.x + op.element.width > 100 ||
            op.element.y + op.element.height > 100
          )
            throw new AppError("Tafelelement liegt außerhalb der Tafel.");
          state.elements = state.elements.filter((e) => e.id !== op.id);
          const visual = normalizeVisual(op.element, visualWord);
          if (visual.textFallback && !op.element.translation.trim())
            throw new AppError(
              "Kein passendes Emoji. Bitte die Bedeutung in translation angeben oder Text verwenden.",
            );
          state.elements.push(visual);
        }
      }
      if (state.elements.length > 20)
        throw new AppError("Zu viele Tafelelemente.");
      if (
        data.question?.mode === "picture_speak" &&
        state.elements.some((e) => e.textFallback)
      ) {
        const meaning = state.elements.find((e) => e.textFallback).text;
        data.question.mode = "meaning_speak";
        data.question.prompt = teachingText(state.languages, "recall", {
          meaning,
        });
      }
      // A step and its question change in one transaction and one browser snapshot.
      if (state.question?.status === "open")
        this.db
          .prepare(
            "UPDATE questions SET status='unanswered' WHERE lesson_id=? AND id=?",
          )
          .run(id, state.question.id);
      state.question = data.question
        ? { ...data.question, status: "open", hinted: false }
        : null;
      if (data.question)
        this.db
          .prepare(
            "INSERT INTO questions(id,lesson_id,payload,status) VALUES(?,?,?,?)",
          )
          .run(data.question.id, id, JSON.stringify(data.question), "open");
      Object.assign(state, {
        revision: state.revision + 1,
        stepId: data.stepId,
        title: data.title,
      });
      this.saveState(id, state);
      for (const item of data.taught)
        this.db
          .prepare("INSERT OR IGNORE INTO taught VALUES(?,?,?,?)")
          .run(id, item.text, item.kind, this.now());
      return { ok: true, revision: state.revision, stepId: state.stepId };
    });
  }
  answer(id, raw, { occurredAt = this.now() } = {}) {
    const data = answerSchema.parse(raw);
    return this.remember(id, data.eventId, "answer", () => {
      const lesson = this.active(id);
      const q = lesson.state.question;
      if (!q || q.id !== data.questionId)
        return {
          ok: false,
          ignored: true,
          reason: "Diese Frage ist nicht mehr offen.",
        };
      if (q.status !== "open") {
        const prior = this.db
          .prepare(
            "SELECT * FROM attempts WHERE lesson_id=? AND question_id=? AND option_id IS ? AND mode<>? AND ABS(created_at-?)<4500 ORDER BY created_at DESC LIMIT 1",
          )
          .get(id, q.id, data.optionId, data.mode, occurredAt);
        if (prior) return { ok: true, duplicate: true, outcome: prior.outcome };
        return {
          ok: false,
          ignored: true,
          reason: "Diese Frage ist nicht mehr offen.",
        };
      }
      const option = q.options.find((o) => o.id === data.optionId);
      const spoken = ["repeat", "picture_speak", "meaning_speak"].includes(
        q.mode,
      );
      if (spoken && data.mode === "click")
        throw new AppError("Diese Aufgabe wird mündlich beantwortet.");
      if (!data.uncertain && !option && !(spoken && data.optionId === null))
        throw new AppError("Bitte wähle eine gültige Antwort.");
      const prior = this.db
        .prepare(
          "SELECT * FROM attempts WHERE lesson_id=? AND question_id=? AND option_id IS ? AND mode<>? AND ABS(created_at-?)<4500 ORDER BY created_at DESC LIMIT 1",
        )
        .get(id, q.id, data.optionId, data.mode, occurredAt);
      if (prior) return { ok: true, duplicate: true, outcome: prior.outcome };
      const hinted = Boolean(q.hinted || data.hinted);
      const outcome = data.uncertain
        ? "uncertain"
        : data.optionId === q.correctOptionId
          ? "correct"
          : "incorrect";
      const choice = ["choice", "meaning_choice"].includes(q.mode);
      const spokenRecall = ["picture_speak", "meaning_speak"].includes(q.mode);
      this.db
        .prepare("INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?)")
        .run(
          data.eventId,
          id,
          q.id,
          q.knowledge,
          data.optionId,
          data.mode,
          outcome,
          Number(hinted),
          occurredAt,
        );
      if (outcome !== "uncertain" && choice) q.selectedOptionId = data.optionId;
      if (
        outcome === "correct" ||
        (outcome === "incorrect" && (choice || spokenRecall))
      ) {
        q.status = "answered";
        this.db
          .prepare(
            "UPDATE questions SET status='answered' WHERE lesson_id=? AND id=?",
          )
          .run(id, q.id);
      }
      if (outcome !== "uncertain" && spokenRecall) {
        const label =
          q.options.find((o) => o.id === q.correctOptionId)?.label ||
          q.knowledge;
        if (!lesson.state.elements.some((e) => e.id === "practice-answer")) {
          lesson.state.elements = lesson.state.elements.filter(
            (e) => e.id !== "practice-answer",
          );
          lesson.state.elements.push({
            id: "practice-answer",
            type: "text",
            text: label,
            translation: "",
            shape: "none",
            color: "#246838",
            x: 5,
            y: 74,
            width: 90,
            height: 23,
            fontSize: 64,
            highlight: false,
          });
        }
        if (outcome === "incorrect") {
          q.hinted = true;
          this.db
            .prepare("UPDATE questions SET hinted=1 WHERE lesson_id=? AND id=?")
            .run(id, q.id);
        }
      }
      const correctLabel =
        q.options.find((o) => o.id === q.correctOptionId)?.label || q.knowledge;
      q.feedback =
        outcome === "correct"
          ? teachingText(lesson.state.languages, "correct")
          : outcome === "uncertain"
            ? teachingText(lesson.state.languages, "uncertain")
            : choice || spokenRecall
              ? teachingText(lesson.state.languages, "incorrect", {
                  word: correctLabel,
                })
              : teachingText(lesson.state.languages, "retry");
      this.saveState(id, lesson.state);
      return {
        ok: true,
        outcome,
        hinted,
        feedback: q.feedback,
        questionId: q.id,
      };
    });
  }
  hint(id, questionId) {
    const lesson = this.active(id);
    const q = lesson.state.question;
    if (!q || q.id !== questionId || q.status !== "open")
      throw new AppError("Diese Frage ist nicht mehr offen.", 409);
    q.hinted = true;
    this.saveState(id, lesson.state);
    this.db
      .prepare("UPDATE questions SET hinted=1 WHERE lesson_id=? AND id=?")
      .run(id, q.id);
    return { ok: true, hint: q.hint };
  }
  requestFinish(id, reason) {
    const lesson = this.active(id);
    lesson.state.readyToFinish = true;
    lesson.state.finishReason = reason;
    lesson.state.phase = "summary";
    lesson.state.finishRequestedAt = this.now();
    lesson.state.finishDelivered = false;
    this.saveState(id, lesson.state);
    return {
      ok: true,
      message: `Say a short farewell in ${lesson.state.languages.instructionLanguage}. The app closes after a pause.`,
    };
  }
  finish(id, status) {
    const lesson = this.heartbeat(id);
    if (["completed", "ended_early"].includes(lesson.status)) return lesson;
    if (!["completed", "ended_early", "interrupted"].includes(status))
      throw new AppError("Ungültiger Abschluss.");
    if (status === "completed" && !lesson.state.readyToFinish)
      throw new AppError("Die Zusammenfassung ist noch nicht fertig.", 409);
    this.transaction(() => {
      this.db
        .prepare(
          "UPDATE lessons SET status=?,connected=0,ended_at=?,remote_id=NULL WHERE id=?",
        )
        .run(status, this.now(), id);
      if (status !== "interrupted") {
        this.db
          .prepare(
            "UPDATE questions SET status='unanswered' WHERE lesson_id=? AND status='open'",
          )
          .run(id);
        if (lesson.state.question?.status === "open")
          lesson.state.question.status = "unanswered";
        this.saveState(id, lesson.state);
      }
    });
    return this.lesson(id);
  }
  recover() {
    const pending = this.db
      .prepare("SELECT id,remote_id FROM lessons WHERE status='active'")
      .all();
    // Use the last heartbeat, never count time while the program was stopped.
    this.db
      .prepare(
        "UPDATE lessons SET status='interrupted',connected=0,ended_at=last_seen,remote_id=NULL WHERE status='active'",
      )
      .run();
    return pending;
  }
  results(id) {
    return {
      taught: this.db
        .prepare(
          "SELECT text,kind FROM taught WHERE lesson_id=? ORDER BY taught_at",
        )
        .all(id),
      attempts: this.db
        .prepare("SELECT * FROM attempts WHERE lesson_id=? ORDER BY created_at")
        .all(id),
      questions: this.db
        .prepare(
          "SELECT payload,status,hinted FROM questions WHERE lesson_id=?",
        )
        .all(id)
        .map((q) => ({
          ...normalizePractice(JSON.parse(q.payload)),
          status: q.status,
          hinted: Boolean(q.hinted),
        })),
    };
  }
  deleteLesson(id) {
    return this.transaction(() => {
      const lesson = this.lesson(id);
      if (lesson.status === "active")
        throw new AppError("Bitte die laufende Stunde zuerst beenden.", 409);
      for (const table of ["attempts", "questions", "taught", "events"])
        this.db.prepare(`DELETE FROM ${table} WHERE lesson_id=?`).run(id);
      this.db
        .prepare(
          "UPDATE preparation_turns SET lesson_id=NULL WHERE lesson_id=?",
        )
        .run(id);
      this.db.prepare("DELETE FROM lessons WHERE id=?").run(id);
      return { ok: true };
    });
  }
  mastery(topicId) {
    const rows = this.db
      .prepare(
        `SELECT a.*,COALESCE(json_extract(q.payload,'$.mode'),'choice') AS practice_mode FROM attempts a JOIN lessons l ON l.id=a.lesson_id JOIN questions q ON q.lesson_id=a.lesson_id AND q.id=a.question_id WHERE l.topic_id=? ORDER BY a.created_at DESC,a.rowid DESC`,
      )
      .all(topicId);
    const introduced = this.db
      .prepare(
        `SELECT t.text,MIN(t.taught_at) AS updatedAt FROM taught t JOIN lessons l ON l.id=t.lesson_id WHERE l.topic_id=? GROUP BY t.text`,
      )
      .all(topicId);
    return wordMastery(
      rows.map((row) => ({
        ...row,
        practice_mode: normalizePractice({ mode: row.practice_mode }).mode,
      })),
      introduced,
      this.now(),
    );
  }
  reviewQueue(topicId, limit = 3) {
    const topic = this.topic(topicId);
    return topic ? dueReviews(this.mastery(topicId), topic, limit) : [];
  }
  home(languages = this.languageSettings().languages) {
    const { targetLanguage, instructionLanguage } = languages;
    const allLessons = this.db
      .prepare(
        "SELECT id,topic_id,target_language AS targetLanguage,json_extract(state,'$.topicSnapshot.name') AS topic_name,started_at,ended_at,duration_ms,status,summary_status FROM lessons ORDER BY started_at DESC",
      )
      .all();
    const lessons = allLessons.filter(
      (l) => l.targetLanguage === targetLanguage,
    );
    const enriched = this.topics(targetLanguage).map((t, index) => {
      const history = lessons.filter((l) => l.topic_id === t.id);
      const learned = history.some((l) => l.status === "completed");
      const mastery = this.mastery(t.id),
        review = mastery.filter((m) => m.status === "review");
      const last = history[0]?.started_at;
      const due = this.reviewQueue(t.id, 80);
      const overdue = due.length > 0;
      const plan = this.lessonPlan(t.id, instructionLanguage);
      return {
        ...t,
        experience: learned ? "learned" : history.length ? "learning" : "new",
        lastStudied: last || null,
        lessonCount: history.length,
        mastery,
        review,
        dueReviews: due,
        preparedSteps:
          plan?.topicRevision === t.revision ? plan.steps.length : 0,
        priority: review.length
          ? 100 + review.length
          : overdue
            ? 85
            : !history.length
              ? 70 - index * 3
              : 40,
        reasonCode: review.length
          ? "reviewNeeded"
          : overdue
            ? "reviewDue"
            : !history.length
              ? "newWords"
              : "practiceMore",
        reasonCount: due.length,
        reason: review.length
          ? "Ein paar Wörter freuen sich auf eine Wiederholung."
          : overdue
            ? `${due.length} Wörter sind zum Wiederholen bereit.`
            : !history.length
              ? index === 0
                ? "Ein leichter Einstieg in dein erstes Sprach-Abenteuer."
                : "Entdecke neue Wörter in kleinen Schritten."
              : "Übung macht dich sicherer. Du kannst jederzeit wiederholen.",
      };
    });
    const recommended = [...enriched]
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 3);
    return {
      languages,
      profile: this.db
        .prepare("SELECT age,level,language FROM profile WHERE id=1")
        .get(),
      topics: enriched,
      recommended,
      history: lessons,
      stats: {
        completed: lessons.filter((l) => l.status === "completed").length,
        words: this.db
          .prepare(
            "SELECT COUNT(DISTINCT t.text) AS n FROM taught t JOIN lessons l ON l.id=t.lesson_id WHERE t.kind='word' AND l.target_language=?",
          )
          .get(targetLanguage).n,
        minutes: Math.round(
          lessons.reduce((s, l) => s + l.duration_ms, 0) / 60000,
        ),
      },
      pending:
        allLessons.find((l) => l.status === "active") ||
        allLessons.find((l) => l.status === "interrupted") ||
        null,
    };
  }
  publicLesson(id) {
    const l = this.lesson(id);
    const state = structuredClone(l.state);
    // The parent preview lives on its own endpoint. Future answers never appear
    // in the classroom snapshot or the child's caption context.
    delete state.planSnapshot;
    if (state.question) {
      if (
        state.question.status !== "answered" ||
        !["choice", "meaning_choice"].includes(state.question.mode)
      )
        delete state.question.correctOptionId;
      delete state.question.hint;
      if (
        ["repeat", "picture_speak", "meaning_speak"].includes(
          state.question.mode,
        )
      ) {
        state.question.options = [];
        delete state.question.knowledge;
      }
    }
    const { remote_id, start_event, ...rest } = l;
    return {
      ...rest,
      state,
      results: this.results(id),
      mastery: this.mastery(l.topic_id),
    };
  }
  setSummary(id, summary, status) {
    this.db
      .prepare("UPDATE lessons SET summary=?,summary_status=? WHERE id=?")
      .run(JSON.stringify(summary), status, id);
  }
  lessonPlan(topicId, instructionLanguage = "de") {
    const row = this.db
      .prepare(
        "SELECT * FROM lesson_plans WHERE topic_id=? AND instruction_language=?",
      )
      .get(topicId, instructionLanguage);
    return row
      ? {
          ...normalizePlan(JSON.parse(row.payload)),
          instructionLanguage: row.instruction_language,
          targetLanguage: row.target_language,
          topicId,
          topicRevision: row.topic_revision,
          revision: row.revision,
          updatedAt: row.updated_at,
        }
      : null;
  }
  saveLessonPlan(topicId, topicRevision, expectedRevision, plan) {
    plan = normalizePlan(plan);
    return this.transaction(() => {
      if (this.topic(topicId)?.revision !== topicRevision)
        throw new AppError(
          "Das Thema wurde geändert. Bitte den Unterrichtsplan neu erstellen.",
          409,
        );
      if (
        (this.lessonPlan(topicId, plan.instructionLanguage)?.revision || 0) !==
        expectedRevision
      )
        throw new AppError(
          "Der Unterrichtsplan wurde inzwischen geändert. Bitte neu laden.",
          409,
        );
      this.db
        .prepare(
          "INSERT INTO lesson_plans VALUES(?,?,?,?,?,?,?) ON CONFLICT(topic_id,instruction_language) DO UPDATE SET topic_revision=excluded.topic_revision,revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at",
        )
        .run(
          topicId,
          plan.instructionLanguage,
          this.topic(topicId).targetLanguage,
          topicRevision,
          expectedRevision + 1,
          JSON.stringify(plan),
          this.now(),
        );
      return this.lessonPlan(topicId, plan.instructionLanguage);
    });
  }
  topics(targetLanguage = null) {
    return this.db
      .prepare(
        "SELECT payload,revision FROM topics WHERE id NOT IN (SELECT id FROM deleted_topics) ORDER BY rowid",
      )
      .all()
      .map((row) => ({
        ...normalizeTopic(JSON.parse(row.payload)),
        revision: row.revision,
      }))
      .filter(
        (topic) => !targetLanguage || topic.targetLanguage === targetLanguage,
      );
  }
  topic(id) {
    const row = this.db
      .prepare(
        "SELECT payload,revision FROM topics WHERE id=? AND id NOT IN (SELECT id FROM deleted_topics)",
      )
      .get(id);
    return row
      ? { ...normalizeTopic(JSON.parse(row.payload)), revision: row.revision }
      : null;
  }
  topicDeleted(id) {
    return Boolean(
      this.db.prepare("SELECT id FROM deleted_topics WHERE id=?").get(id),
    );
  }
  deleteTopic(id, expectedRevision, turnId = null) {
    return this.transaction(() => {
      const turn = turnId ? this.preparationTurn(turnId) : null;
      const proposal =
        turn?.status === "completed"
          ? turn.response.deletionRequests?.find(
              (item) =>
                item.topicId === id &&
                item.expectedRevision === expectedRevision,
            )
          : null;
      if (turnId && !proposal)
        throw new AppError(
          "Diese Löschanfrage ist nicht mehr verfügbar. Bitte erneut anfragen.",
          409,
        );
      if (this.topicDeleted(id)) return { ok: true, topicId: id };
      const topic = this.topic(id);
      if (!topic) throw new AppError("Dieses Thema existiert nicht.", 404);
      if (topic.revision !== expectedRevision)
        throw new AppError(
          "Das Thema wurde inzwischen geändert. Bitte die aktuelle Version erneut bestätigen.",
          409,
        );
      this.db
        .prepare("INSERT INTO deleted_topics VALUES(?,?)")
        .run(id, this.now());
      if (proposal) {
        proposal.status = "deleted";
        this.db
          .prepare("UPDATE preparation_turns SET response=? WHERE id=?")
          .run(JSON.stringify(turn.response), turnId);
      }
      return { ok: true, topicId: id };
    });
  }
  preparationGeneration() {
    return this.db
      .prepare("SELECT generation FROM preparation_context WHERE id=1")
      .get().generation;
  }
  clearPreparation(expectedGeneration) {
    return this.transaction(() => {
      if (this.preparationGeneration() !== expectedGeneration)
        throw new AppError(
          "Das Gespräch wurde inzwischen geleert. Bitte die Ansicht aktualisieren.",
          409,
        );
      this.db.exec(
        "DELETE FROM preparation_turns; UPDATE preparation_context SET generation=generation+1 WHERE id=1;",
      );
    });
  }
  priorTaught(topicId, exceptLessonId) {
    return this.db
      .prepare(
        "SELECT DISTINCT t.text,t.kind FROM taught t JOIN lessons l ON l.id=t.lesson_id WHERE l.topic_id=? AND l.id<>?",
      )
      .all(topicId, exceptLessonId);
  }
  preparationTurn(id) {
    const row = this.db
      .prepare("SELECT * FROM preparation_turns WHERE id=?")
      .get(id);
    if (!row) return null;
    let error = row.error,
      errorCode = null;
    if (error?.startsWith("{")) {
      try {
        const saved = JSON.parse(error);
        if (saved.errorCode) {
          error = saved.message;
          errorCode = saved.errorCode;
        }
      } catch {
        /* Keep legacy error text verbatim. */
      }
    }
    return {
      ...row,
      error,
      errorCode,
      response: row.response ? JSON.parse(row.response) : null,
    };
  }
  preparationHistory(limit = 30) {
    return this.db
      .prepare(
        "SELECT id FROM preparation_turns ORDER BY created_at DESC,rowid DESC LIMIT ?",
      )
      .all(limit)
      .reverse()
      .map((row) => this.preparationTurn(row.id));
  }
  startPreparation(data) {
    this.db
      .prepare(
        "INSERT INTO preparation_turns(id,message,topic_id,lesson_id,created_at,status) VALUES(?,?,?,?,?,'pending')",
      )
      .run(data.eventId, data.message, data.topicId, data.lessonId, this.now());
  }
  finishPreparation(id, response) {
    this.transaction(() => {
      for (const operationId of response.operationIds || []) {
        const operation = this.db
          .prepare("SELECT * FROM topic_operations WHERE id=?")
          .get(operationId);
        if (operation?.status !== "prepared")
          throw new AppError("Batch interrupted.", 409, "batchFailed");
        const { sources } = JSON.parse(operation.request);
        if (
          sources.some(
            (source) => this.topic(source.id)?.revision !== source.revision,
          )
        )
          throw new AppError("Source topic changed.", 409, "batchConflict");
      }
      const counts = new Map();
      for (const topic of this.topics())
        counts.set(
          topic.targetLanguage,
          (counts.get(topic.targetLanguage) || 0) + 1,
        );
      for (const change of response.changes) {
        const language = normalizeTopic(change.after).targetLanguage;
        if (!change.before)
          counts.set(language, (counts.get(language) || 0) + 1);
      }
      if ([...counts.values()].some((count) => count > 60))
        throw new AppError("Topic capacity exceeded.", 409, "batchCapacity");
      for (const change of response.changes) {
        const topic = topicSchema.parse(normalizeTopic(change.after));
        if (this.topicDeleted(topic.id))
          throw new AppError(
            "Dieses Thema wurde gelöscht. Bitte eine neue Themen-ID verwenden.",
            409,
          );
        const current = this.topic(topic.id);
        if (current && current.targetLanguage !== topic.targetLanguage)
          throw new AppError(
            "Create a new topic to change its target language.",
            409,
            "topicLanguageImmutable",
          );
        if ((current?.revision || 0) !== (change.before?.revision || 0))
          throw new AppError(
            "Das Thema wurde inzwischen geändert. Bitte die Änderung erneut anfragen.",
            409,
          );
        this.db
          .prepare(
            "INSERT INTO topics VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision",
          )
          .run(topic.id, JSON.stringify(topic), change.after.revision);
      }
      this.db
        .prepare(
          "UPDATE preparation_turns SET status='completed',response=?,error=NULL WHERE id=?",
        )
        .run(JSON.stringify(response), id);
      for (const operationId of response.operationIds || [])
        this.db
          .prepare("UPDATE topic_operations SET status='completed' WHERE id=?")
          .run(operationId);
    });
  }
  failPreparation(id, error, errorCode = null) {
    this.db
      .prepare(
        "UPDATE preparation_turns SET status='failed',error=? WHERE id=? AND status='pending'",
      )
      .run(
        errorCode ? JSON.stringify({ message: error, errorCode }) : error,
        id,
      );
  }
  recoverPreparation() {
    this.db
      .prepare(
        "UPDATE preparation_turns SET status='failed',error='Die Vorbereitung wurde beim Neustart unterbrochen. Bitte erneut senden.' WHERE status='pending'",
      )
      .run();
    this.db
      .prepare(
        "UPDATE topic_operations SET status='failed',error='interrupted' WHERE status IN ('running','prepared')",
      )
      .run();
  }
  languageSettings() {
    const row = this.db
      .prepare("SELECT revision,payload FROM language_settings WHERE id=1")
      .get();
    return {
      revision: row.revision,
      languages: JSON.parse(row.payload),
      defaults: defaultLanguages,
    };
  }
  saveLanguages(raw) {
    const languages = normalizeLanguages(raw.languages || {});
    return this.transaction(() => {
      if (raw.revision !== this.languageSettings().revision)
        throw new AppError(
          "Language settings changed in another window. Reload the saved settings.",
          409,
          "languageConflict",
        );
      this.db
        .prepare("UPDATE language_settings SET revision=?,payload=? WHERE id=1")
        .run(randomUUID(), JSON.stringify(languages));
      return this.languageSettings();
    });
  }
  close() {
    this.db.close();
  }
}
