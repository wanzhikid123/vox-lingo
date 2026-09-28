import { t as tr, languageLabel } from "./i18n.js";
import {
  acceptLanguages,
  useLanguages,
  languageState,
} from "./language-state.js";
import React, { useState, useEffect, useRef, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  ArrowLeft,
  BookOpen,
  Home,
  ChartNoAxesCombined,
  Settings,
  Clock,
  Mic,
  MicOff,
  PhoneOff,
  Check,
  ChevronRight,
  Volume2,
  Sparkles,
  RefreshCw,
  X,
  ArrowDown,
  Lightbulb,
  Leaf,
  Star,
  CheckCircle2,
  LoaderCircle,
  AlertCircle,
  MessageSquare,
  Trash2,
} from "lucide-react";
import { api, lessonApi, clockText, dateText } from "./api.js";
import { microphone, LiveConnection } from "./live.js";
import { mergeTranscript } from "./transcripts.js";
import "./styles.css";
import { PreparationPage } from "./Preparation.jsx";
import { confirmTopicDeletion } from "./topic-actions.js";
import { BoardElement } from "./BoardElement.jsx";
import { WordProgress } from "./LessonPlan.jsx";
import { SpeechTempo } from "./SpeechTempo.jsx";
import { ModelSettings } from "./ModelSettings.jsx";
const statusText = {
  active: "In der Stunde",
  completed: "Abgeschlossen",
  ended_early: "Früher beendet",
  interrupted: "Unterbrochen",
};
const masteryText = {
  observing: "Wir üben noch",
  review: "Noch einmal üben",
  developing: "Schon sicherer",
};
function Mascot({ small = false }) {
  return (
    <svg
      className={small ? "mascot small" : "mascot"}
      viewBox="0 0 220 210"
      role="img"
      aria-label={tr("Mia, die freundliche Lerneule")}
    >
      <path d="M42 85 28 23 89 49M135 49 196 23 179 88" fill="#be7847" />
      <path
        d="M40 90C40 26 180 26 180 90v57c0 75-140 75-140 0Z"
        fill="#d99761"
      />
      <ellipse cx="76" cy="109" rx="39" ry="46" fill="#fff8e9" />
      <ellipse cx="145" cy="109" rx="39" ry="46" fill="#fff8e9" />
      <path d="m110 108-13 13 13 17 13-17Z" fill="#edb640" />
      <path
        d="M60 104q15-17 29 0M131 104q15-17 29 0"
        fill="none"
        stroke="#493a30"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <ellipse cx="60" cy="123" rx="10" ry="6" fill="#f0b09a" />
      <ellipse cx="159" cy="123" rx="10" ry="6" fill="#f0b09a" />
      <path
        d="M102 161q-25-14-66-10v49q43 0 74 10 26-10 74-10v-49q-43-4-74 10Z"
        fill="#406e58"
      />
      <path d="M110 166v39" stroke="#a6c5ab" strokeWidth="3" />
      <path
        d="m59 167 27 3m-27 12 27 3m46-15 27-3m-27 18 27-3"
        stroke="#dbe6cb"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
function Button({ children, variant = "", className = "", ...props }) {
  return (
    <button className={`button ${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}
function App() {
  const languageSettings = useLanguages();
  const [preparationTopicId, setPreparationTopicId] = useState("");
  const [home, setHome] = useState(null),
    [health, setHealth] = useState(null),
    [view, setView] = useState("home"),
    [selected, setSelected] = useState(null),
    [lesson, setLesson] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [settings, setSettings] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const providerName = (provider) =>
    ({
      openai: "OpenAI",
      gemini: tr("Google Gemini"),
      deepseek: "DeepSeek",
    })[provider] || "…";
  const backendName = providerName(health?.backend?.provider);
  const liveName = providerName(health?.live?.provider);
  const pendingStream = useRef(null),
    startEvent = useRef(null);
  async function refresh() {
    try {
      const [h, s] = await Promise.all([api("/home"), api("/health")]);
      if (
        h.languages.targetLanguage ===
          languageState().languages.targetLanguage &&
        h.languages.instructionLanguage ===
          languageState().languages.instructionLanguage
      )
        setHome(h);
      setHealth(s);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    api("/languages")
      .then(acceptLanguages)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!languageSettings.revision) return;
    refresh();
    setSelected(null);
    setPreparationTopicId("");
  }, [languageSettings.revision]);
  async function deleteTopic(topic) {
    if (deleting) return;
    setDeleting(true);
    setError("");
    try {
      if (await confirmTopicDeletion(topic)) {
        if (selected?.id === topic.id) setSelected(null);
        await refresh();
      }
    } catch (e) {
      setError(e.message);
      await refresh();
    } finally {
      setDeleting(false);
    }
  }
  async function start(topic) {
    setBusy(true);
    setError("");
    let stream;
    try {
      stream = await microphone();
      if (startEvent.current?.topicId !== topic.id)
        startEvent.current = {
          topicId: topic.id,
          eventId: crypto.randomUUID(),
        };
      const l = await api("/lessons", startEvent.current);
      startEvent.current = null;
      pendingStream.current = stream;
      setLesson(l);
      setSelected(null);
      setView("classroom");
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function resume(id) {
    setBusy(true);
    setError("");
    try {
      const l = await api("/lessons/" + id);
      setLesson(l);
      setView("classroom");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function history(id) {
    try {
      setLesson(await api("/lessons/" + id));
      setView("summary");
    } catch (e) {
      setError(e.message);
    }
  }
  async function deleteResults(record) {
    if (
      deleting ||
      !window.confirm(
        tr("deleteResults", {
          name: record.topic?.name || record.topic_name || record.topic_id,
          date: dateText(record.started_at),
        }),
      )
    )
      return;
    setDeleting(true);
    setError("");
    try {
      await lessonApi(record.id, "/delete", {
        confirmed: true,
      });
      if (lesson?.id === record.id) {
        setLesson(null);
        setView("progress");
      }
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setDeleting(false);
    }
  }
  const back = () => {
    setView("home");
    setLesson(null);
    refresh();
  };
  const settingsDialog = settings && (
    <ModelSettings onClose={() => setSettings(false)} onSaved={setHealth} />
  );
  if (view === "classroom" && lesson)
    return (
      <>
        <Classroom
          onSettings={() => setSettings(true)}
          initial={lesson}
          initialStream={pendingStream.current}
          onConsumed={() => {
            pendingStream.current = null;
          }}
          onFinish={(l) => {
            setLesson(l);
            setView("summary");
            refresh();
          }}
        />
        {settingsDialog}
      </>
    );
  return (
    <div className="app-shell">
      <header className="site-header">
        <button className="brand" onClick={back}>
          <span className="brand-icon">
            <BookOpen size={24} />
          </span>
          <span>
            {" "}
            {languageLabel(languageSettings.languages.targetLanguage)}{" "}
            <span className="brand-light"> {tr("Lehrerin")} </span>
            <small> {tr("Kleine Schritte. Große Abenteuer.")} </small>
          </span>
        </button>
        <nav aria-label={tr("Hauptnavigation")}>
          <button
            className={view === "home" ? "nav-link active" : "nav-link"}
            onClick={back}
          >
            <Home size={18} /> {tr("Entdecken")}{" "}
          </button>
          <button
            className={view === "progress" ? "nav-link active" : "nav-link"}
            onClick={() => {
              setView("progress");
              refresh();
            }}
          >
            <ChartNoAxesCombined size={18} /> {tr("Mein Lernweg")}{" "}
          </button>
          <button
            className={view === "preparation" ? "nav-link active" : "nav-link"}
            aria-label={tr("Vorbereitung")}
            onClick={() => {
              setView("preparation");
              refresh();
            }}
          >
            <MessageSquare size={18} /> {tr("Vorbereitung")}{" "}
          </button>
        </nav>
        <button
          className="settings-button"
          onClick={() => setSettings(true)}
          aria-label={tr("Einstellungen")}
        >
          <Settings size={20} />
        </button>
      </header>
      {error && (
        <div className="notice error" role="alert">
          <AlertCircle size={19} />
          {tr(error)}
          <button
            onClick={() => {
              setError("");
              refresh();
            }}
            aria-label={tr("Erneut laden")}
          >
            <RefreshCw size={18} />
          </button>
        </div>
      )}
      {!home ? (
        <main className="loading">
          <LoaderCircle className="spin" />{" "}
          {tr("Dein Lernabenteuer wird vorbereitet …")}{" "}
        </main>
      ) : view === "summary" && lesson ? (
        <Summary
          lesson={lesson}
          onBack={back}
          onDelete={deleteResults}
          deleting={deleting}
        />
      ) : view === "progress" ? (
        <Progress
          home={home}
          onOpen={history}
          onChoose={setSelected}
          onDelete={deleteResults}
          deleting={deleting}
        />
      ) : view === "preparation" ? (
        <PreparationPage
          home={home}
          onUpdated={refresh}
          initialTopicId={preparationTopicId}
          onStart={start}
          startBusy={busy}
          startError={tr(error)}
          keyConfigured={health?.classroomKeyConfigured}
          missingKeys={health?.missingClassroomKeys}
          backendName={backendName}
          liveName={liveName}
          teacherName={providerName(health?.teacher?.provider)}
          transcriptionName={providerName(health?.transcription?.provider)}
        />
      ) : (
        <main className="home-page">
          <div className="page-eyebrow">
            <span className="tiny-sun">✳</span>{" "}
            {tr("DEIN KLEINES ENGLISCH-ABENTEUER")}{" "}
          </div>
          <div className="welcome-row">
            <div>
              <h1> {tr("Hallo, schön, dass du da bist!")} </h1>
              <p> {tr("Was möchtest du heute entdecken?")} </p>
            </div>
            <div className="daily-pill">
              <Clock size={17} /> {tr("10 Minuten voller neuer Wörter")}{" "}
            </div>
          </div>
          {home.pending && (
            <div className="resume-banner">
              <BookOpen size={22} />
              <div>
                <strong>
                  {tr("resumeLanguage", {
                    target: languageLabel(home.pending.targetLanguage),
                  })}
                </strong>
                <span>
                  {" "}
                  {tr(
                    "Deine angefangene Stunde und alle Ergebnisse sind gespeichert.",
                  )}{" "}
                </span>
              </div>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => resume(home.pending.id)}
              >
                {" "}
                {tr("Stunde öffnen")} <ArrowRight size={17} />
              </Button>
            </div>
          )}
          <button className="prep-entry" onClick={() => setView("preparation")}>
            <MessageSquare size={21} />
            <span>
              <strong> {tr("Unterricht vorbereiten")} </strong>
              <small>
                {" "}
                {tr(
                  "Themen erweitern, neue Themen erstellen und Stunden besprechen · Vor- und Nachbereitung",
                )}{" "}
              </small>
            </span>
            <ArrowRight size={20} />
          </button>
          {!!home.recommended.length && (
            <section className="hero">
              <div className="hero-copy">
                <span className="hero-label">
                  <Sparkles size={15} /> {tr("FÜR DICH EMPFOHLEN")}{" "}
                </span>
                <h2>{home.recommended[0].name}</h2>
                <p>{home.recommended[0].goal}</p>
                <div className="hero-meta">
                  <span>
                    <Clock size={16} /> {tr("etwa 10 Minuten")}{" "}
                  </span>
                  <span>
                    <Volume2 size={16} /> {tr("Zuhören & mitsprechen")}{" "}
                  </span>
                </div>
                <Button
                  variant="cream"
                  onClick={() => setSelected(home.recommended[0])}
                >
                  {" "}
                  {tr("Los geht’s")} <ArrowRight size={18} />
                </Button>
                <small>
                  {tr(home.recommended[0].reasonCode, {
                    count: home.recommended[0].reasonCount,
                  })}
                </small>
              </div>
              <div className="hero-art">
                <span className="art-orbit" />
                <span className="art-star one">✦</span>
                <span className="art-star two">✧</span>
                <span className="hello-bubble">
                  {" "}
                  {tr("Hello!")} <span>👋</span>
                </span>
                <Mascot />
                <span className="art-leaf">
                  <Leaf size={48} />
                </span>
                <span className="mia-label"> {tr("Deine Lehrerin Mia")} </span>
              </div>
            </section>
          )}
          <section className="topic-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow"> {tr("DU ENTSCHEIDEST")} </span>
                <h2> {tr("Eine Welt voller Wörter")} </h2>
              </div>
              <span className="muted">
                {" "}
                {tr("Alle Themen sind für dich offen")}{" "}
              </span>
            </div>
            <div className="topic-grid">
              {home.topics.map((t) => (
                <TopicCard
                  key={t.id}
                  topic={t}
                  onClick={() => setSelected(t)}
                  onDelete={() => deleteTopic(t)}
                  deleting={deleting}
                />
              ))}
            </div>
            {!home.topics.length && (
              <div className="empty-inline">
                <BookOpen size={22} />{" "}
                {tr(
                  "Noch keine Themen. Erstelle ein neues Thema unter „Vorbereitung“.",
                )}{" "}
              </div>
            )}
          </section>
          <section className="learning-strip">
            <div className="strip-icon">
              <Leaf />
            </div>
            <div>
              <h3> {tr("Jeder kleine Schritt zählt.")} </h3>
              <p>
                {" "}
                {tr(
                  "Du darfst nachfragen, Fehler machen und alles noch einmal üben.",
                )}{" "}
              </p>
            </div>
            <div className="mini-stat">
              <b>{home.stats.words}</b>
              <span> {tr("Wörter entdeckt")} </span>
            </div>
            <div className="mini-stat">
              <b>{home.stats.completed}</b>
              <span> {tr("Stunden geschafft")} </span>
            </div>
          </section>
          <section className="plan-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow"> {tr("DEIN LERNPLAN")} </span>
                <h2> {tr("So könnte es weitergehen")} </h2>
              </div>
              <span className="muted">
                {" "}
                {tr("In deinem Tempo. Ohne feste Termine.")}{" "}
              </span>
            </div>
            <div className="plan-list">
              {home.recommended.map((t, i) => (
                <button
                  className="plan-item"
                  key={t.id}
                  onClick={() => setSelected(t)}
                >
                  <span className="plan-number">0{i + 1}</span>
                  <span className={`topic-symbol ${t.color}`}>{t.icon}</span>
                  <span>
                    <strong>{t.name}</strong>
                    <small>
                      {tr(t.reasonCode, {
                        count: t.reasonCount,
                      })}
                    </small>
                  </span>
                  <ArrowRight size={20} />
                </button>
              ))}
            </div>
          </section>
          <section className="learned-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow"> {tr("SCHON ENTDECKT")} </span>
                <h2> {tr("Deine Wiederholungskiste")} </h2>
              </div>
            </div>
            {home.topics.some((t) => t.experience === "learned") ? (
              <div className="topic-grid">
                {home.topics
                  .filter((t) => t.experience === "learned")
                  .map((t) => (
                    <TopicCard
                      key={t.id}
                      topic={t}
                      onClick={() => setSelected(t)}
                      onDelete={() => deleteTopic(t)}
                      deleting={deleting}
                    />
                  ))}
              </div>
            ) : (
              <div className="empty-inline">
                <Star size={23} />
                <span>
                  {" "}
                  {tr(
                    "Hier sammeln sich deine abgeschlossenen Themen. Du kannst jedes beliebig oft wiederholen.",
                  )}{" "}
                </span>
              </div>
            )}
          </section>
          <footer>
            <span>
              <Leaf size={14} /> {tr("Mit Neugier wächst dein Englisch.")}{" "}
            </span>
            <span> {tr("Dein Fortschritt bleibt auf diesem Computer.")} </span>
          </footer>
        </main>
      )}
      {selected && (
        <div
          className="modal-backdrop"
          onClick={() => !busy && setSelected(null)}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="topic-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label={tr("Schließen")}
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              <X />
            </button>
            <span className={`topic-symbol large ${selected.color}`}>
              {selected.icon}
            </span>
            <span className="eyebrow"> {tr("DEINE NÄCHSTE ENTDECKUNG")} </span>
            <h2 id="topic-title">{selected.name}</h2>
            <p>{selected.goal}</p>
            <div className="lesson-preview">
              <h3> {tr("Das erwartet dich")} </h3>
              <div>
                <Check />{" "}
                {tr("lessonLanguages", {
                  instruction: languageLabel(
                    languageSettings.languages.instructionLanguage,
                  ),
                  target: languageLabel(selected.targetLanguage),
                })}{" "}
              </div>
              <div>
                <Check /> {tr("Gemeinsam sprechen, schauen und spielen")}{" "}
              </div>
              <div>
                <Check /> {tr("Etwa 10 Minuten, ganz in deinem Tempo")}{" "}
              </div>
            </div>
            <div className="word-tags">
              {selected.words.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
            {selected.review?.length > 0 && (
              <p className="hint">
                {" "}
                {tr("Wir üben besonders:")}{" "}
                {selected.review.map((r) => r.knowledge).join(", ")}.
              </p>
            )}
            {!!selected.dueReviews?.length && (
              <p className="hint">
                {" "}
                {tr("Zum Aufwärmen:")}{" "}
                {selected.dueReviews
                  .slice(0, 3)
                  .map((r) => r.word)
                  .join(", ")}
                .
              </p>
            )}
            {selected.preparedSteps > 0 && (
              <p className="hint">
                {" "}
                {tr("Unterrichtsplan mit")} {selected.preparedSteps}{" "}
                {tr("Schritten bereit.")}{" "}
              </p>
            )}
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => {
                setPreparationTopicId(selected.id);
                setSelected(null);
                setView("preparation");
              }}
            >
              {" "}
              {tr("Unterrichtsplan ansehen & vorbereiten")}{" "}
            </button>
            {error && (
              <p className="error-text" role="alert">
                {tr(error)}
              </p>
            )}
            {health && !health.classroomKeyConfigured && (
              <p className="error-text">
                {" "}
                {tr("Bitte zuerst die Windows-Umgebungsvariablen")}{" "}
                {health.missingClassroomKeys.join(", ")}{" "}
                {tr("einrichten.")}{" "}
              </p>
            )}
            <Button
              disabled={
                busy ||
                !health?.classroomKeyConfigured ||
                !selected.preparedSteps
              }
              onClick={() => start(selected)}
            >
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <Mic size={18} />
              )}{" "}
              {busy
                ? tr("Mikrofon wird vorbereitet …")
                : tr("Mikrofon an & Stunde starten")}
            </Button>
            <small className="modal-note">
              {" "}
              {tr(
                "Mia ist eine KI-Lehrerin. Deine Stimme wird für das Gespräch an",
              )}{" "}
              {liveName}{" "}
              {tr(
                "übertragen. Unterrichtstext und Lernkontext werden zur Planung an",
              )}{" "}
              {backendName}{" "}
              {tr(
                "gesendet. Auf diesem Computer werden keine Aufnahmen gespeichert.",
              )}{" "}
            </small>
          </section>
        </div>
      )}
      {settingsDialog}
    </div>
  );
}
function TopicCard({ topic: t, onClick, onDelete, deleting }) {
  return (
    <div className={`topic-card ${t.color}`}>
      <button className="topic-open" onClick={onClick}>
        <div className="topic-top">
          <span className="card-emoji">{t.icon}</span>
          <span className={"topic-badge " + t.experience}>
            {t.experience === "learned" ? (
              <>
                <Check size={12} /> {tr("Schon entdeckt")}{" "}
              </>
            ) : t.experience === "learning" ? (
              tr("Angefangen")
            ) : (
              tr("Entdecken")
            )}
          </span>
        </div>
        <span className="card-english">{t.targetTitle}</span>
        <h3>{t.name}</h3>
        <p>{t.goal}</p>
        <div className="card-footer">
          <span>{t.review.length ? tr("Noch einmal üben") : t.level}</span>
          <span className="circle-arrow">
            <ArrowRight size={17} />
          </span>
        </div>
      </button>
      <button
        className="topic-delete"
        aria-label={`${tr("Thema löschen")}: ${t.name}`}
        title={tr("Thema löschen")}
        disabled={deleting}
        onClick={onDelete}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}
function Progress({ home, onOpen, onChoose, onDelete, deleting }) {
  return (
    <main className="progress-page">
      <span className="eyebrow"> {tr("KLEINE SCHRITTE SICHTBAR MACHEN")} </span>
      <h1> {tr("Dein Lernweg")} </h1>
      <p> {tr("Jede Entdeckung zählt. Und Wiederholen gehört dazu.")} </p>
      <div className="stats-grid">
        {[
          [home.stats.completed, tr("Stunden abgeschlossen")],
          [home.stats.words, tr("Wörter entdeckt")],
          [home.stats.minutes, tr("Minuten gemeinsam gelernt")],
        ].map(([n, t]) => (
          <div key={t}>
            <strong>{n}</strong>
            <span>{t}</span>
          </div>
        ))}
      </div>
      <h2> {tr("Deine Themen")} </h2>
      <div className="progress-topics">
        {home.topics.map((t) => (
          <section key={t.id}>
            <div>
              <span className={`topic-symbol ${t.color}`}>{t.icon}</span>
              <div>
                <h3>{t.name}</h3>
                <p>
                  {t.experience === "learned"
                    ? tr("Schon entdeckt")
                    : t.experience === "learning"
                      ? tr("Angefangen")
                      : tr("Noch nicht begonnen")}
                  {t.lastStudied &&
                    tr("lastStudied", { date: dateText(t.lastStudied) })}
                </p>
              </div>
              <Button variant="secondary" onClick={() => onChoose(t)}>
                {t.lessonCount ? tr("Wiederholen") : tr("Entdecken")}
                <ArrowRight size={16} />
              </Button>
            </div>
            {t.mastery.length > 0 && (
              <div className="mastery-tags">
                {t.mastery.map((m) => (
                  <span
                    title={tr(m.reasonCode || "")}
                    className={m.status}
                    key={m.knowledge}
                  >
                    {m.knowledge}
                    <small>{tr(masteryText[m.status])}</small>
                  </span>
                ))}
              </div>
            )}
            {t.mastery.length > 0 && (
              <details className="plan-evidence">
                <summary>
                  {" "}
                  {tr("Auswählen, sprechen & nächste Wiederholung")}{" "}
                </summary>
                <WordProgress items={t.mastery} />
              </details>
            )}
          </section>
        ))}
      </div>
      <h2> {tr("Deine bisherigen Stunden")} </h2>
      {!home.history.length ? (
        <div className="empty-inline">
          <BookOpen />{" "}
          {tr("Deine erste Geschichte beginnt mit deiner ersten Stunde.")}{" "}
        </div>
      ) : (
        <div className="history-list">
          {home.history.map((l) => (
            <div className="history-row" key={l.id}>
              <button className="history-open" onClick={() => onOpen(l.id)}>
                <span>
                  <strong>
                    {l.topic_name ||
                      home.topics.find((t) => t.id === l.topic_id)?.name ||
                      l.topic_id}
                  </strong>
                  <small>
                    {dateText(l.started_at)} · {clockText(l.duration_ms)}
                  </small>
                </span>
                <span className={`status-pill ${l.status}`}>
                  {tr(statusText[l.status])}
                </span>
                <ChevronRight size={18} />
              </button>
              <button
                className="history-delete"
                disabled={deleting || l.status === "active"}
                aria-label={`${tr("Lernergebnisse löschen")}: ${l.topic_name || l.topic_id} · ${dateText(l.started_at)}`}
                title={
                  l.status === "active"
                    ? tr("Bitte die Stunde zuerst beenden")
                    : tr("Lernergebnisse löschen")
                }
                onClick={() => onDelete(l)}
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
function Classroom({
  onSettings,
  initial,
  initialStream,
  onConsumed,
  onFinish,
}) {
  const [lesson, setLesson] = useState(initial),
    [status, setStatus] = useState("disconnected"),
    [rows, setRows] = useState([]),
    [muted, setMuted] = useState(false),
    [notice, setNotice] = useState(""),
    [thinking, setThinking] = useState(false),
    [elapsed, setElapsed] = useState(initial.duration_ms),
    [follow, setFollow] = useState(true),
    [level, setLevel] = useState(0),
    [audioBlocked, setAudioBlocked] = useState(false),
    [answerBusy, setAnswerBusy] = useState(false),
    [ending, setEnding] = useState(false);
  const live = useRef(null),
    transcript = useRef(null),
    statusRef = useRef(status),
    mounted = useRef(true),
    closing = useRef(false),
    autoFinish = useRef(null),
    goodbyeToken = useRef(null),
    starting = useRef(false),
    initialUse = useRef(false),
    timeBase = useRef({
      ms: initial.duration_ms,
      at: Date.now(),
    });
  statusRef.current = status;
  const id = initial.id;
  function release() {
    live.current?.close();
    live.current = null;
  }
  async function connect(stream) {
    if (starting.current) return;
    starting.current = true;
    setNotice("");
    setStatus("connecting");
    setRows([]);
    setMuted(false);
    setAudioBlocked(false);
    try {
      const mic = stream || (await microphone());
      if (!mounted.current) {
        mic.getTracks().forEach((t) => t.stop());
        return;
      }
      const session = new LiveConnection(id, mic, {
        onInputActivity: () => {
          const token = goodbyeToken.current;
          if (token) {
            goodbyeToken.current = null;
            lessonApi(id, "/input-activity", {
              token,
            }).catch(() => {});
          }
        },
        onTranscript: (e) => {
          if (mounted.current) setRows((r) => mergeTranscript(r, e));
        },
        onConnected: () => {
          if (mounted.current) {
            setStatus("connected");
            timeBase.current.at = Date.now();
          }
        },
        onLevel: (v) => mounted.current && setLevel(v),
        onAudioBlocked: () => mounted.current && setAudioBlocked(true),
        onDisconnected: (message) => {
          if (mounted.current && !closing.current) {
            setStatus("disconnected");
            setNotice(message);
            lessonApi(id, "/end", {
              status: "interrupted",
            }).catch(() => {});
          }
        },
      });
      live.current = session;
      await session.connect();
    } catch (e) {
      release();
      if (mounted.current) {
        setNotice(e.message);
        setStatus("disconnected");
        lessonApi(id, "/end", {
          status: "interrupted",
        }).catch(() => {});
      }
    } finally {
      starting.current = false;
    }
  }
  useEffect(() => {
    mounted.current = true;
    const events = new EventSource(`/api/lessons/${id}/events`);
    events.addEventListener("lesson", (e) => {
      const l = JSON.parse(e.data);
      setLesson(l);
      timeBase.current = {
        ms: l.duration_ms,
        at: Date.now(),
      };
      setElapsed(l.duration_ms);
      if (["completed", "ended_early"].includes(l.status) && !closing.current) {
        closing.current = true;
        release();
        setStatus("disconnected");
        onFinish(l);
      }
      if (l.status === "interrupted" && statusRef.current === "connected") {
        release();
        setStatus("disconnected");
        setThinking(false);
        setNotice(
          "Die Stunde wurde unterbrochen. Deine Ergebnisse sind gespeichert.",
        );
      }
    });
    events.addEventListener("goodbye", (e) => {
      goodbyeToken.current = JSON.parse(e.data).token;
    });
    events.addEventListener("deleted", () => {
      release();
      window.location.reload();
    });
    events.addEventListener("notice", (e) =>
      setNotice(JSON.parse(e.data).message),
    );
    events.addEventListener("thinking", (e) =>
      setThinking(JSON.parse(e.data).busy),
    );
    events.onerror = () => {
      if (statusRef.current === "connected") {
        release();
        lessonApi(id, "/end", {
          status: "interrupted",
        }).catch(() => {});
        setStatus("disconnected");
        setNotice(
          "Die lokale Verbindung wurde unterbrochen. Bitte verbinde die Stunde erneut.",
        );
      }
    };
    const heartbeat = setInterval(() => {
      if (
        statusRef.current === "connected" ||
        statusRef.current === "connecting"
      )
        lessonApi(id, "/heartbeat", {})
          .then((r) => {
            timeBase.current = {
              ms: r.duration_ms,
              at: Date.now(),
            };
          })
          .catch(() => {
            release();
            setStatus("disconnected");
            setNotice(
              "Der lokale Dienst ist nicht erreichbar. Bitte prüfe das Startfenster.",
            );
          });
    }, 8000);
    const clock = setInterval(
      () =>
        setElapsed(
          timeBase.current.ms +
            (statusRef.current === "connected"
              ? Date.now() - timeBase.current.at
              : 0),
        ),
      1000,
    );
    const unload = () => {
      release();
      navigator.sendBeacon(
        `/api/lessons/${id}/end`,
        new Blob(
          [
            JSON.stringify({
              status: "interrupted",
            }),
          ],
          {
            type: "application/json",
          },
        ),
      );
    };
    window.addEventListener("pagehide", unload);
    if (initialStream && !initialUse.current) {
      initialUse.current = true;
      onConsumed();
      connect(initialStream);
    }
    return () => {
      mounted.current = false;
      clearInterval(heartbeat);
      clearInterval(clock);
      events.close();
      window.removeEventListener("pagehide", unload);
      release();
    };
  }, [id]);
  useLayoutEffect(() => {
    lessonApi(id, "/rendered", {
      revision: lesson.state.revision,
    }).catch(() => {});
  }, [id, lesson.state.revision]);
  useLayoutEffect(() => {
    if (follow && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [rows, follow]);
  useEffect(() => {
    if (
      !lesson.state.readyToFinish ||
      !lesson.state.finishDelivered ||
      status !== "connected"
    )
      return;
    // Transcript events and actual input/output energy both postpone automatic closure.
    autoFinish.current = Date.now();
    const timer = setInterval(() => {
      if (
        live.current &&
        live.current.lastTeacherActivity >= lesson.state.finishRequestedAt &&
        live.current.playbackIdle &&
        Date.now() - Math.max(autoFinish.current, live.current.lastActivity) >
          7000
      )
        finish(lesson.state.finishReason || "completed");
    }, 1000);
    return () => clearInterval(timer);
  }, [lesson.state.readyToFinish, lesson.state.finishDelivered, status]);
  async function finish(reason = "ended_early") {
    if (closing.current) return;
    closing.current = true;
    setEnding(true);
    // Stop capturing locally immediately. The server owns durable finalization.
    release();
    setStatus("disconnected");
    try {
      const result = await lessonApi(id, "/end", {
        status: reason,
      });
      onFinish(result);
    } catch (e) {
      setNotice(e.message + " Bitte klicke erneut auf Beenden.");
      closing.current = false;
      setEnding(false);
    }
  }
  async function answer(optionId) {
    setAnswerBusy(true);
    try {
      await lessonApi(id, "/answer", {
        eventId: crypto.randomUUID(),
        questionId: lesson.state.question.id,
        optionId,
        mode: "click",
        uncertain: false,
        hinted: false,
      });
    } catch (e) {
      setNotice(e.message);
    } finally {
      setAnswerBusy(false);
    }
  }
  async function hint() {
    try {
      const r = await lessonApi(id, "/hint", {
        questionId: lesson.state.question.id,
      });
      setNotice(r.hint);
    } catch (e) {
      setNotice(e.message);
    }
  }
  const connected = status === "connected";
  const q = lesson.state.question;
  return (
    <div className="classroom-shell">
      <header className="classroom-header">
        <div className="classroom-title">
          <span className={`topic-symbol ${lesson.topic.color}`}>
            {lesson.topic.icon}
          </span>
          <div>
            <span className="eyebrow"> {tr("DEINE ENGLISCHSTUNDE")} </span>
            <h1>{lesson.topic.name}</h1>
          </div>
        </div>
        <div className="classroom-controls">
          <button
            className="settings-button"
            aria-label={tr("Einstellungen")}
            onClick={onSettings}
          >
            <Settings size={20} />
          </button>
          <SpeechTempo lessonId={id} connected={connected} />
          <span className={`connection ${status}`}>
            <i />
            {connected
              ? tr("Verbunden")
              : status === "connecting"
                ? tr("Wir verbinden …")
                : tr("Nicht verbunden")}
          </span>
          <span className="timer">
            <Clock size={17} />
            {clockText(elapsed)}
          </span>
          <Button
            variant="secondary"
            disabled={!connected}
            onClick={() => {
              live.current?.mute(!muted);
              setMuted(!muted);
            }}
          >
            {muted ? <MicOff size={19} /> : <Mic size={19} />}{" "}
            {muted ? tr("Mikrofon an") : tr("Stumm")}
          </Button>
          <Button
            variant="end"
            disabled={ending}
            onClick={() =>
              finish(
                lesson.state.readyToFinish
                  ? lesson.state.finishReason || "completed"
                  : "ended_early",
              )
            }
          >
            <PhoneOff size={18} />
            {ending
              ? tr("Wird gespeichert …")
              : lesson.state.readyToFinish
                ? tr("Fertig")
                : tr("Beenden")}
          </Button>
        </div>
      </header>
      {notice && (
        <div className="classroom-notice" role="status">
          <Lightbulb size={18} />
          <span>{tr(notice)}</span>
          <button
            onClick={() => setNotice("")}
            aria-label={tr("Hinweis schließen")}
          >
            <X size={18} />
          </button>
        </div>
      )}
      <main className="classroom-grid">
        <section className="whiteboard-panel" aria-label={tr("Lerntafel")}>
          <div className="panel-heading">
            <span>
              <BookOpen size={18} /> {tr("UNSERE LERNTAFEL")}{" "}
            </span>
            <span className="step-pill">
              {lesson.state.phase === "summary"
                ? tr("Das hast du entdeckt")
                : q
                  ? tr("Mitmachen & ausprobieren")
                  : tr("Schauen & entdecken")}
            </span>
          </div>
          <div className="board-main">
            <h2>{lesson.state.title}</h2>
            <div className="board-canvas" data-testid="whiteboard">
              {lesson.state.elements.length ? (
                <>
                  {lesson.state.elements.map((e) => (
                    <BoardElement element={e} key={e.id} />
                  ))}
                </>
              ) : (
                <div className="board-welcome">
                  <Mascot />
                  <h3> {tr("Hallo! Ich bin Mia.")} </h3>
                  <p>
                    {" "}
                    {tr("Wir entdecken zusammen neue Wörter.")} <br />{" "}
                    {tr("Du kannst jederzeit mit mir sprechen.")}{" "}
                  </p>
                </div>
              )}
            </div>
            {q && (
              <section
                className="quiz"
                key={q.id}
                aria-labelledby="quiz-prompt"
              >
                <h3 id="quiz-prompt">{q.prompt}</h3>
                {["repeat", "picture_speak", "meaning_speak"].includes(
                  q.mode,
                ) ? (
                  <div className="spoken-practice">
                    <Mic size={24} />
                    <span>
                      {q.status === "answered"
                        ? tr("Gut gemacht!")
                        : q.mode === "repeat"
                          ? tr("Hör Mia zu. Dann bist du dran.")
                          : tr("Du bist dran. Sag das englische Wort.")}
                    </span>
                  </div>
                ) : (
                  <div className="quiz-options">
                    {q.options.map((o, i) => (
                      <button
                        key={o.id}
                        className={
                          q.status === "answered" && o.id === q.correctOptionId
                            ? "is-correct"
                            : q.status === "answered" &&
                                o.id === q.selectedOptionId
                              ? "is-incorrect"
                              : ""
                        }
                        onClick={() => answer(o.id)}
                        disabled={
                          !connected || answerBusy || q.status !== "open"
                        }
                      >
                        <span className="option-number">{i + 1}</span>
                        {o.color ? (
                          <span
                            className="option-color"
                            style={{
                              background: o.color,
                            }}
                          />
                        ) : o.emoji ? (
                          <span className="option-emoji">{o.emoji}</span>
                        ) : null}
                        <strong>{o.label}</strong>
                        {q.status === "answered" &&
                        o.id === q.correctOptionId ? (
                          <span
                            className="option-mark correct"
                            role="img"
                            aria-label={tr("Richtig")}
                          >
                            <Check size={21} strokeWidth={3} />
                          </span>
                        ) : q.status === "answered" &&
                          o.id === q.selectedOptionId ? (
                          <span
                            className="option-mark incorrect"
                            role="img"
                            aria-label={tr("Falsch")}
                          >
                            <X size={21} strokeWidth={3} />
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                )}
                <div className="quiz-bottom">
                  <span
                    className={
                      q.status === "answered"
                        ? "quiz-feedback correct"
                        : "quiz-feedback"
                    }
                  >
                    {q.feedback ||
                      (["repeat", "picture_speak", "meaning_speak"].includes(
                        q.mode,
                      )
                        ? tr("Mia hört dir zu. Lass dir Zeit.")
                        : tr("Klicke auf eine Antwort oder sag sie laut."))}
                  </span>
                  {q.status === "open" && (
                    <button disabled={!connected} onClick={hint}>
                      <Lightbulb size={15} /> {tr("Ein Tipp, bitte")}{" "}
                    </button>
                  )}
                </div>
              </section>
            )}
          </div>
          <div className="board-footer">
            <span>
              <Sparkles size={16} />{" "}
              {tr("Fehler sind erlaubt. Fragen auch.")}{" "}
            </span>
            {lesson.state.readyToFinish ? (
              <span>
                {" "}
                {tr(
                  "Gut gemacht! Wir schließen nach einer Sprechpause ab.",
                )}{" "}
              </span>
            ) : (
              <span> {tr("Dein Tempo zählt.")} </span>
            )}
          </div>
        </section>
        <aside className="conversation-panel">
          <div className="teacher-card">
            <div className="teacher-avatar">
              <Mascot small />
            </div>
            <div>
              <h2> {tr("Mia")} </h2>
              <span> {tr("Deine KI-Englischlehrerin")} </span>
            </div>
            <div
              className={"voice-bars " + (connected && !muted ? "live" : "")}
              style={{
                "--level": level,
              }}
            >
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
          <div className="conversation-heading">
            <span> {tr("Unser Gespräch")} </span>
            <span className="caption-label"> {tr("Live-Untertitel")} </span>
          </div>
          <div
            className="transcript"
            ref={transcript}
            onScroll={() => {
              const e = transcript.current;
              setFollow(e.scrollHeight - e.scrollTop - e.clientHeight < 65);
            }}
            role="log"
            aria-label={tr("Gespräch mit Mia")}
            aria-live="off"
          >
            {rows.length ? (
              rows.map((r) => (
                <div className={`speech ${r.role}`} key={r.id}>
                  <span className="speaker">
                    {r.role === "child" ? tr("Du") : tr("Mia")}
                  </span>
                  <p>{r.text}</p>
                </div>
              ))
            ) : (
              <div className="transcript-empty">
                <span>
                  <Volume2 size={26} />
                </span>
                <h3> {tr("Hier könnt ihr mitlesen.")} </h3>
                <p>
                  {" "}
                  {tr(
                    "Was du und Mia sagen, erscheint hier während eures Gesprächs.",
                  )}{" "}
                </p>
              </div>
            )}
          </div>
          {!follow && (
            <button className="follow-button" onClick={() => setFollow(true)}>
              <ArrowDown size={16} /> {tr("Zur neuesten Nachricht")}{" "}
            </button>
          )}
          <div className="conversation-footer">
            {audioBlocked && (
              <Button
                variant="secondary"
                onClick={() =>
                  live.current
                    ?.play()
                    .then(() => setAudioBlocked(false))
                    .catch(() => setNotice("Bitte prüfe den Lautsprecher."))
                }
              >
                <Volume2 size={17} /> {tr("Ton einschalten")}{" "}
              </Button>
            )}
            {status === "disconnected" ? (
              <>
                <p> {tr("Bereit für dein Abenteuer?")} </p>
                <Button onClick={() => connect()} disabled={ending}>
                  <Mic size={18} />{" "}
                  {lesson.state.revision || lesson.status === "interrupted"
                    ? tr("Erneut verbinden")
                    : tr("Mit Mia sprechen")}
                </Button>
              </>
            ) : status === "connecting" ? (
              <div className="connecting-message">
                <LoaderCircle size={18} className="spin" />{" "}
                {tr("Mia macht sich bereit …")}{" "}
              </div>
            ) : (
              <>
                <div className="listening-state">
                  <span className={muted ? "muted-dot" : "listening-dot"} />
                  {muted
                    ? tr("Dein Mikrofon ist stumm")
                    : thinking
                      ? tr("Mia bereitet den nächsten Schritt vor …")
                      : tr("Mia hört dir zu.")}
                </div>
                <button
                  className="repeat-button"
                  onClick={() =>
                    lessonApi(id, "/retry", {}).catch((e) =>
                      setNotice(e.message),
                    )
                  }
                >
                  <RefreshCw size={15} /> {tr("Noch einmal erklären")}{" "}
                </button>
              </>
            )}
            <small>
              {" "}
              {tr("Sprich einfach los. Du darfst Mia unterbrechen.")}{" "}
            </small>
          </div>
        </aside>
      </main>
    </div>
  );
}
function Summary({ lesson: initial, onBack, onDelete, deleting }) {
  const [lesson, setLesson] = useState(initial);
  useEffect(() => {
    if (
      ["active", "interrupted"].includes(initial.status) ||
      initial.summary_status !== "pending"
    )
      return;
    const timer = setInterval(
      () =>
        api("/lessons/" + initial.id)
          .then((l) => {
            setLesson(l);
            if (l.summary_status !== "pending") clearInterval(timer);
          })
          .catch(() => {}),
      2000,
    );
    return () => clearInterval(timer);
  }, [initial.id]);
  const results = lesson.results,
    valid = results.attempts.filter((a) => a.outcome !== "uncertain"),
    correct = valid.filter((a) => a.outcome === "correct");
  return (
    <main className="summary-page">
      <div className="summary-icon">
        {lesson.status === "completed" ? (
          <Star size={38} />
        ) : (
          <BookOpen size={38} />
        )}
      </div>
      <span className="eyebrow"> {tr("DEIN HEUTIGES ABENTEUER")} </span>
      <h1>
        {lesson.status === "completed"
          ? tr("Ein kleiner Schritt. Richtig gut!")
          : tr("Deine Entdeckungen sind gespeichert.")}
      </h1>
      <p>
        {lesson.topic.name} · {dateText(lesson.started_at)} ·{" "}
        {clockText(lesson.duration_ms)}
      </p>
      <span className={`status-pill ${lesson.status}`}>
        {tr(statusText[lesson.status])}
      </span>
      <section className="summary-message">
        {lesson.summary?.message ||
          (["active", "interrupted"].includes(lesson.status) ? (
            tr(
              "Die Stunde ist noch nicht abgeschlossen. Deine bisherigen Ergebnisse bleiben erhalten.",
            )
          ) : (
            <span>
              <LoaderCircle className="spin" size={17} />{" "}
              {tr("Mia fasst deine Stunde zusammen …")}{" "}
            </span>
          ))}
      </section>
      <div className="summary-columns">
        <section>
          <span className="eyebrow"> {tr("DAS HAST DU ENTDECKT")} </span>
          <h2> {tr("Deine Wörter & Sätze")} </h2>
          <div className="word-tags">
            {results.taught.length ? (
              results.taught.map((w) => <span key={w.text}>{w.text}</span>)
            ) : (
              <p> {tr("Es wurden noch keine Lernwörter bestätigt.")} </p>
            )}
          </div>
        </section>
        <section>
          <span className="eyebrow"> {tr("DEINE ÜBUNGEN")} </span>
          <h2> {tr("Ausprobieren zählt")} </h2>
          <p>
            {correct.length} {tr("richtige Antworten bei")} {valid.length}{" "}
            {tr("eindeutigen Versuchen.")}{" "}
          </p>
          <p>
            {valid.filter((a) => a.outcome === "correct" && a.hinted).length}{" "}
            {tr("davon mit einem Tipp.")}{" "}
          </p>
          <small>
            {" "}
            {tr("Unklare und offene Antworten zählen nicht als Fehler.")}{" "}
          </small>
        </section>
      </div>
      {lesson.mastery.filter((m) => m.status === "review").length > 0 && (
        <section className="review-box">
          <Lightbulb />
          <div>
            <h3> {tr("Das schauen wir uns noch einmal an")} </h3>
            <p>
              {lesson.mastery
                .filter((m) => m.status === "review")
                .map((m) => m.knowledge)
                .join(" · ")}
            </p>
          </div>
        </section>
      )}
      {results.questions.length > 0 && (
        <details className="result-details">
          <summary> {tr("Übungen und Lernbelege ansehen")} </summary>
          {results.questions.map((q) => (
            <div key={q.id}>
              <strong>{q.prompt}</strong>
              <small>
                {q.status === "unanswered"
                  ? tr("Offen geblieben · ohne Fehlerwertung")
                  : q.status === "answered"
                    ? tr("Beantwortet")
                    : tr("Noch offen")}
              </small>
              {results.attempts
                .filter((a) => a.question_id === q.id)
                .map((a) => (
                  <p key={a.event_id}>
                    {q.options.find((o) => o.id === a.option_id)?.label ||
                      tr("Nicht eindeutig")}{" "}
                    ·{" "}
                    {a.outcome === "correct"
                      ? tr("richtig")
                      : a.outcome === "incorrect"
                        ? tr("noch einmal üben")
                        : tr("bitte klären")}{" "}
                    · {a.mode === "voice" ? tr("gesprochen") : tr("geklickt")}
                    {a.hinted ? tr(" · mit Tipp") : ""}
                  </p>
                ))}
            </div>
          ))}
        </details>
      )}
      <Button onClick={onBack}>
        {" "}
        {tr("Zurück zu meinen Themen")} <ArrowRight size={18} />
      </Button>
      <Button
        variant="secondary"
        className="delete-results"
        disabled={deleting || lesson.status === "active"}
        onClick={() => onDelete(lesson)}
      >
        <Trash2 size={18} />{" "}
        {deleting ? tr("Wird gelöscht …") : tr("Diese Lernergebnisse löschen")}
      </Button>
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
