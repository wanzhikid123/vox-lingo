import { t as tr } from "./i18n.js";
import React, { useEffect, useRef, useState } from "react";
import {
  Send,
  LoaderCircle,
  CheckCircle2,
  MessageSquare,
  BookOpen,
  Trash2,
  Mic,
  Square,
} from "lucide-react";
import { api, clockText, dateText } from "./api.js";
import { confirmTopicDeletion } from "./topic-actions.js";
import { useDictation } from "./useDictation.js";
import { LessonPlanEditor } from "./LessonPlan.jsx";
import { useLanguages, languageState } from "./language-state.js";
export function PreparationPage({
  home,
  onUpdated,
  initialTopicId = "",
  onStart,
  startBusy,
  startError,
  keyConfigured,
  missingKeys,
  backendName,
  liveName,
  teacherName,
  transcriptionName,
}) {
  const { languages } = useLanguages();
  const [state, setState] = useState({
    turns: [],
    topics: home.topics,
    busy: false,
    generation: 0,
  });
  const [topicId, setTopicId] = useState(initialTopicId);
  const [planBusy, setPlanBusy] = useState(false);
  const [planView, setPlanView] = useState(Boolean(initialTopicId));
  const [startAttempted, setStartAttempted] = useState(false);
  const [lessonId, setLessonId] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");
  const [language, setLanguage] = useState("auto");
  const input = useRef(null);
  const dictation = useDictation({
    onTranscript: (text) => {
      setMessage((current) =>
        current.trim() ? `${current.trimEnd()}\n${text}` : text,
      );
      requestAnimationFrame(() => input.current?.focus());
    },
    onError: setError,
  });
  const messages = useRef(null),
    mounted = useRef(true),
    pending = useRef(null);
  const topic = state.topics.find((item) => item.id === topicId);
  async function refresh() {
    const data = await api("/preparation");
    if (
      mounted.current &&
      data.languages.targetLanguage === languageState().languages.targetLanguage
    ) {
      setState(data);
      setTopicId((current) =>
        data.topics.some((item) => item.id === current) ? current : "",
      );
      setLoading(false);
    }
    return data;
  }
  useEffect(() => {
    mounted.current = true;
    setLessonId("");
    refresh().catch((e) => {
      setError(e.message);
      setLoading(false);
    });
    return () => {
      mounted.current = false;
    };
  }, [languages.targetLanguage]);
  useEffect(() => {
    if (!state.busy && !sending) return;
    const timer = setInterval(
      () =>
        refresh()
          .then((data) => {
            if (!data.busy) onUpdated();
          })
          .catch((e) => mounted.current && setError(e.message)),
      2000,
    );
    return () => clearInterval(timer);
  }, [state.busy, sending]);
  useEffect(() => {
    if (messages.current)
      messages.current.scrollTop = messages.current.scrollHeight;
  }, [state.turns, sending]);
  async function submit(event) {
    event.preventDefault();
    if (!message.trim() || message.length > 4000 || busy || loading) return;
    const text = message.trim();
    if (
      !pending.current ||
      pending.current.message !== text ||
      pending.current.topicId !== (topicId || null) ||
      pending.current.lessonId !== (lessonId || null) ||
      pending.current.generation !== state.generation
    )
      pending.current = {
        eventId: crypto.randomUUID(),
        message: text,
        topicId: topicId || null,
        lessonId: lessonId || null,
        generation: state.generation,
      };
    setSending(true);
    setError("");
    try {
      const result = await api("/preparation/chat", pending.current);
      pending.current = null;
      if (!mounted.current) return;
      setMessage("");
      if (result.changes.length) setTopicId(result.changes.at(-1).after.id);
      await refresh();
      onUpdated();
    } catch (e) {
      if (!mounted.current) return;
      setError(e.message);
      const data = await refresh().catch(() => null);
      // Keep the request ID on transport uncertainty; failed transactions may be retried anew.
      if (
        (data && data.generation !== pending.current?.generation) ||
        data?.turns.some(
          (turn) =>
            turn.id === pending.current?.eventId && turn.status === "failed",
        )
      )
        pending.current = null;
    } finally {
      if (mounted.current) setSending(false);
    }
  }
  async function clearChat() {
    if (
      busy ||
      loading ||
      !window.confirm(
        tr(
          "Gespräch wirklich leeren?\nAlle bisherigen Nachrichten werden gelöscht und nicht mehr an die KI gesendet. Themen und Lernergebnisse bleiben erhalten.",
        ),
      )
    )
      return;
    setActing(true);
    setError("");
    try {
      const data = await api("/preparation/clear", {
        expectedGeneration: state.generation,
        confirmed: true,
      });
      if (!mounted.current) return;
      pending.current = null;
      setState(data);
      setMessage("");
      setLessonId("");
    } catch (e) {
      if (mounted.current) {
        setError(e.message);
        await refresh().catch(() => {});
      }
    } finally {
      if (mounted.current) setActing(false);
    }
  }
  async function deleteProposedTopic(proposal, turnId) {
    if (busy) return;
    setActing(true);
    setError("");
    try {
      const deleted = await confirmTopicDeletion(
        {
          id: proposal.topicId,
          name: proposal.name,
          revision: proposal.expectedRevision,
        },
        turnId,
      );
      if (deleted && mounted.current) {
        await refresh();
        onUpdated();
      }
    } catch (e) {
      if (mounted.current) {
        setError(e.message);
        await refresh().catch(() => {});
      }
    } finally {
      if (mounted.current) setActing(false);
    }
  }
  const working = sending || state.busy || acting || planBusy;
  const voiceBusy = dictation.status !== "idle";
  const busy = working || voiceBusy;
  return (
    <main className="preparation-page">
      <div className="preparation-heading">
        <div>
          <span className="eyebrow">
            {" "}
            {tr("FÜR ELTERN · VOR- UND NACHBEREITUNG")}{" "}
          </span>
          <h1> {tr("Unterricht vorbereiten")} </h1>
        </div>
        <button
          className="button secondary prep-clear"
          onClick={clearChat}
          disabled={busy || loading || !state.turns.length}
        >
          <Trash2 size={16} /> {tr("Gespräch leeren")}{" "}
        </button>
      </div>
      <div className="prep-context">
        <label>
          {" "}
          {tr("Thema")}{" "}
          <select
            value={topicId}
            disabled={busy}
            onChange={(e) => {
              setTopicId(e.target.value);
              setStartAttempted(false);
            }}
          >
            <option value=""> {tr("Alle Themen / neues Thema")} </option>
            {state.topics.map((item) => (
              <option value={item.id} key={item.id}>
                {item.icon} {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {" "}
          {tr("Stunde besprechen")}{" "}
          <select
            value={lessonId}
            disabled={busy}
            onChange={(e) => setLessonId(e.target.value)}
          >
            <option value="">
              {" "}
              {tr("Letzte Lernergebnisse als Kontext")}{" "}
            </option>
            {home.history.slice(0, 30).map((item) => (
              <option value={item.id} key={item.id}>
                {dateText(item.started_at)} ·{" "}
                {item.topic_name ||
                  home.topics.find((t) => t.id === item.topic_id)?.name ||
                  item.topic_id}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        className="prep-tabs"
        role="group"
        aria-label={tr("Vorbereitungsansicht")}
      >
        <button
          className={`button ${planView ? "secondary" : ""}`}
          disabled={busy}
          onClick={() => setPlanView(false)}
        >
          {" "}
          {tr("Gespräch")}{" "}
        </button>
        <button
          className={`button ${planView ? "" : "secondary"}`}
          disabled={busy || !topic}
          onClick={() => setPlanView(true)}
        >
          {" "}
          {tr("Unterrichtsplan & Lernbelege")}{" "}
        </button>
      </div>
      {state.operations?.map((operation) => (
        <div key={operation.id} className="notice" role="status">
          {tr(
            ["running", "prepared"].includes(operation.status)
              ? "batchRunning"
              : operation.status === "completed"
                ? "batchCommitted"
                : "batchFailed",
            {
              completed: operation.completed,
              total: operation.total,
              count: operation.total,
            },
          )}
          {["running", "prepared"].includes(operation.status) && (
            <button
              className="button secondary"
              onClick={() =>
                api(`/operations/${operation.id}/cancel`, {})
                  .then(refresh)
                  .catch((e) => setError(e.message))
              }
            >
              <Square size={16} />
              {tr("batchCancel")}
            </button>
          )}
        </div>
      ))}
      {!planView && (
        <div className="prep-layout">
          <section className="prep-chat" aria-label={tr("Vorbereitungschat")}>
            <div
              className="prep-messages"
              ref={messages}
              role="log"
              aria-label={tr("Gespräch zur Vorbereitung")}
              aria-live="polite"
            >
              {loading ? (
                <p>
                  <LoaderCircle size={18} className="spin" />{" "}
                  {tr("Gespräch wird geladen …")}{" "}
                </p>
              ) : (
                !state.turns.length && (
                  <div className="prep-empty">
                    <MessageSquare size={30} />
                    <h2> {tr("Was soll Mia als Nächstes unterrichten?")} </h2>
                    <p>
                      {" "}
                      {tr(
                        "Neue Themen erstellen, Wörter ergänzen oder eine Stunde besprechen. Du kannst auch auf Chinesisch schreiben.",
                      )}{" "}
                    </p>
                    <div className="prep-suggestions">
                      <button
                        disabled={busy}
                        onClick={() => {
                          setTopicId(
                            state.topics.some((item) => item.id === "days")
                              ? "days"
                              : "",
                          );
                          setMessage(tr("exampleWeekdays"));
                        }}
                      >
                        {" "}
                        {tr("Alle sieben Wochentage lernen")}{" "}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setTopicId(
                            state.topics.some((item) => item.id === "colors")
                              ? "colors"
                              : "",
                          );
                          setMessage(tr("exampleColors"));
                        }}
                      >
                        {" "}
                        {tr("Weitere Farben ergänzen")}{" "}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => setMessage(tr("exampleSummary"))}
                      >
                        {" "}
                        {tr("Stunde zusammenfassen")}{" "}
                      </button>
                    </div>
                  </div>
                )
              )}
              {state.turns.map((turn) => (
                <React.Fragment key={turn.id}>
                  <article className="prep-message parent">
                    <span> {tr("Du")} </span>
                    <p>{turn.message}</p>
                  </article>
                  <article className="prep-message assistant">
                    <span> {tr("Vorbereitungsassistent")} </span>
                    {turn.status === "completed" ? (
                      <>
                        <p>{turn.response.message}</p>
                        {turn.response.changes.map((change) => (
                          <details
                            className="prep-change"
                            key={change.after.id}
                          >
                            <summary>
                              <CheckCircle2 size={15} />{" "}
                              {change.before
                                ? tr("Aktualisiert")
                                : tr("Neu gespeichert")}
                              : {change.after.name}
                            </summary>
                            <p>
                              <b> {tr("Wörter:")} </b>{" "}
                              {change.after.words.join(" · ")}
                            </p>
                            {change.before && (
                              <p>
                                <b> {tr("Hinzugefügt:")} </b>{" "}
                                {change.after.words
                                  .filter(
                                    (word) =>
                                      !change.before.words.some(
                                        (old) =>
                                          old.toLowerCase() ===
                                          word.toLowerCase(),
                                      ),
                                  )
                                  .join(" · ") ||
                                  tr(
                                    "Keine neuen Wörter; Unterrichtsplan angepasst.",
                                  )}
                              </p>
                            )}
                            <p>
                              <b> {tr("Lernziel:")} </b> {change.after.goal}
                            </p>
                            <p>
                              <b> {tr("Unterricht:")} </b>{" "}
                              {change.after.teachingNotes ||
                                tr("In kleinen Schritten üben.")}
                            </p>
                          </details>
                        ))}
                        {turn.response.deletionRequests?.map((proposal) => {
                          const current = state.topics.find(
                            (item) => item.id === proposal.topicId,
                          );
                          const deleted = !current;
                          const changed =
                            current &&
                            current.revision !== proposal.expectedRevision;
                          return (
                            <div
                              className="prep-deletion"
                              key={proposal.topicId}
                            >
                              <strong>{proposal.name}</strong>
                              {deleted ? (
                                <p>
                                  {" "}
                                  {tr(
                                    "Aus der Themenliste gelöscht. Lernergebnisse bleiben erhalten.",
                                  )}{" "}
                                </p>
                              ) : changed ? (
                                <p>
                                  {" "}
                                  {tr(
                                    "Das Thema wurde geändert. Bitte die Löschung erneut anfragen.",
                                  )}{" "}
                                </p>
                              ) : (
                                <>
                                  <p>
                                    {" "}
                                    {tr(
                                      "Zum Löschen bitte bestätigen. Bisherige Stunden bleiben erhalten.",
                                    )}{" "}
                                  </p>
                                  <button
                                    className="button secondary"
                                    disabled={busy}
                                    onClick={() =>
                                      deleteProposedTopic(proposal, turn.id)
                                    }
                                  >
                                    <Trash2 size={16} />{" "}
                                    {tr("Löschen bestätigen")}{" "}
                                  </button>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </>
                    ) : (
                      <p>
                        {turn.status === "pending"
                          ? tr("Die Vorbereitung läuft …")
                          : turn.errorCode
                            ? tr(turn.errorCode)
                            : turn.error}
                      </p>
                    )}
                  </article>
                </React.Fragment>
              ))}
              {sending && (
                <p className="prep-working">
                  <LoaderCircle size={17} className="spin" />{" "}
                  {tr("Themen und Lernstand werden geprüft …")}{" "}
                </p>
              )}
            </div>
            <form className="prep-composer" onSubmit={submit}>
              {error && (
                <p className="error-text" role="alert">
                  {tr(error)}
                </p>
              )}
              <label htmlFor="preparation-message">
                {" "}
                {tr("Deine Nachricht")}{" "}
              </label>
              <div className="prep-input-row">
                <textarea
                  id="preparation-message"
                  ref={input}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={4000}
                  disabled={busy || loading}
                  placeholder={tr(
                    "Zum Beispiel: Ergänze die restlichen Wochentage …",
                  )}
                />
                <button
                  className="button"
                  type="submit"
                  disabled={
                    busy || loading || !message.trim() || message.length > 4000
                  }
                >
                  <Send size={18} />{" "}
                  {working ? tr("Wird vorbereitet …") : tr("Senden")}
                </button>
              </div>
              <div className="prep-voice-controls">
                <button
                  className={`button secondary prep-record ${dictation.status === "recording" ? "recording" : ""}`}
                  type="button"
                  disabled={
                    working ||
                    loading ||
                    ["requesting", "transcribing"].includes(dictation.status)
                  }
                  aria-pressed={dictation.status === "recording"}
                  onClick={() =>
                    dictation.status === "recording"
                      ? dictation.stop()
                      : dictation.start(language)
                  }
                >
                  {dictation.status === "recording" ? (
                    <Square size={16} />
                  ) : voiceBusy ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <Mic size={16} />
                  )}
                  {dictation.status === "recording"
                    ? tr("stopRecording", {
                        time: clockText(dictation.elapsed),
                      })
                    : tr("Spracheingabe")}
                </button>
                <label className="prep-voice-language">
                  {" "}
                  {tr("Sprache")}{" "}
                  <select
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                    disabled={busy || loading}
                  >
                    <option value="auto">
                      {" "}
                      {tr("Automatisch · ZH / EN / DE")}{" "}
                    </option>
                    <option value="zh"> {tr("Chinesisch")} </option>
                    <option value="en"> {tr("Englisch")} </option>
                    <option value="de"> {tr("Deutsch")} </option>
                  </select>
                </label>
                {voiceBusy && (
                  <button
                    className="prep-voice-cancel"
                    type="button"
                    onClick={dictation.cancel}
                  >
                    {" "}
                    {tr("Abbrechen")}{" "}
                  </button>
                )}
                <span className="prep-voice-status" role="status">
                  {dictation.status === "requesting"
                    ? tr("Mikrofon erlauben …")
                    : dictation.status === "transcribing"
                      ? tr("Sprache wird in Text umgewandelt …")
                      : dictation.status === "recording"
                        ? tr("Aufnahme läuft · maximal 3 Minuten")
                        : tr("Aufnehmen → stoppen → Text prüfen")}
                </span>
              </div>
              {message.length > 4000 && (
                <p className="error-text" role="alert">
                  {" "}
                  {tr(
                    "Der Text ist länger als 4.000 Zeichen. Bitte vor dem Senden kürzen; die Aufnahme wurde vollständig eingefügt.",
                  )}{" "}
                </p>
              )}
              <small>
                {" "}
                {tr(
                  "Gewünschte Änderungen werden lokal gespeichert und gelten ab der nächsten neuen Stunde.",
                )}{" "}
              </small>
            </form>
          </section>
          <aside className="prep-sidebar">
            <span className="eyebrow">
              <BookOpen size={15} /> {tr("GESPEICHERTER THEMENPLAN")}{" "}
            </span>
            {topic ? (
              <>
                <h2>
                  {topic.icon} {topic.name}
                </h2>
                <p>{topic.goal}</p>
                <h3>
                  {" "}
                  {tr("Wörter ·")} {topic.words.length}
                </h3>
                <div className="word-tags">
                  {topic.words.map((word) => (
                    <span key={word}>{word}</span>
                  ))}
                </div>
                {!!topic.phrases.length && (
                  <>
                    <h3> {tr("Sätze")} </h3>
                    <ul>
                      {topic.phrases.map((phrase) => (
                        <li key={phrase}>{phrase}</li>
                      ))}
                    </ul>
                  </>
                )}
                <h3> {tr("Unterrichtsplan")} </h3>
                <p>
                  {topic.coverage === "all"
                    ? tr("Alle Wörter schrittweise anbieten.")
                    : tr("Wenige neue Wörter pro Runde.")}
                </p>
                <p className="prep-notes">
                  {topic.teachingNotes ||
                    tr("Mia passt die Übungen an den Lernstand an.")}
                </p>
              </>
            ) : (
              <>
                <h2> {tr("Platz für neue Ideen")} </h2>
                <p>
                  {" "}
                  {tr(
                    "Wähle ein Thema, um die gespeicherten Wörter und den Unterrichtsplan zu sehen. Oder beschreibe ein ganz neues Thema im Chat.",
                  )}{" "}
                </p>
                <p>
                  {" "}
                  {tr(
                    "Für die Nachbesprechung stehen gespeicherte Wörter, Übungen und Ergebnisse zur Verfügung.",
                  )}{" "}
                </p>
              </>
            )}
            <p className="prep-privacy">
              {" "}
              {tr(
                "Dieser Vorbereitungschat wird auf deinem Computer gespeichert. Für die KI-Antwort werden die Nachrichten und nötigen Lernergebnisse an",
              )}{" "}
              {teacherName}{" "}
              {tr("gesendet. Sprachaufnahmen werden zur Texterkennung an")}{" "}
              {transcriptionName}{" "}
              {tr(
                "gesendet und lokal nicht gespeichert. Der erkannte Text wird erst mit „Senden“ als Nachricht übernommen.",
              )}{" "}
            </p>
          </aside>
        </div>
      )}
      {planView && topic && (
        <LessonPlanEditor
          key={`${topic.id}-${topic.revision}-${languages.instructionLanguage}`}
          instructionLanguage={languages.instructionLanguage}
          topic={topic}
          disabled={sending || acting || voiceBusy || startBusy}
          onBusy={setPlanBusy}
          onUpdated={onUpdated}
          onStart={() => {
            setStartAttempted(true);
            onStart(topic);
          }}
          starting={startBusy}
          startError={startAttempted ? startError : ""}
          keyConfigured={keyConfigured}
          missingKeys={missingKeys}
          backendName={backendName}
          liveName={liveName}
        />
      )}
    </main>
  );
}
