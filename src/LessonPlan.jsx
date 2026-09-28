import { t as tr, languageLabel } from "./i18n.js";
import React, { useEffect, useState } from "react";
import {
  ArrowUp,
  ArrowDown,
  LoaderCircle,
  Save,
  RefreshCw,
  Eye,
  Mic,
} from "lucide-react";
import { api, dateText } from "./api.js";
import { BoardElement } from "./BoardElement.jsx";
import { practiceLabels, stageLabels } from "../shared/practice-labels.js";
const skillLabel = (skill) =>
  !skill?.attemptCount
    ? tr("Noch nicht geprüft")
    : skill.status === "review"
      ? tr("Mit Hilfe / noch unsicher")
      : skill.status === "developing"
        ? tr("Schon sicherer")
        : tr("Erste Erfolge");
export function WordProgress({ items = [] }) {
  if (!items.length)
    return (
      <p className="muted">
        {" "}
        {tr("Nach der ersten Übung erscheinen hier die Lernbelege.")}{" "}
      </p>
    );
  return (
    <div className="word-progress">
      <table>
        <thead>
          <tr>
            <th> {tr("Wort")} </th>
            <th> {tr("Auswählen")} </th>
            <th> {tr("Selbst sprechen")} </th>
            <th> {tr("Wiederholen")} </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.knowledge}>
              <th>{item.knowledge}</th>
              <td title={tr(item.skills?.recognition.reasonCode || "")}>
                {skillLabel(item.skills?.recognition)}
              </td>
              <td title={tr(item.skills?.speaking.reasonCode || "")}>
                {skillLabel(item.skills?.speaking)}
              </td>
              <td>{item.due ? tr("Jetzt bereit") : dateText(item.dueAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <small>
        {" "}
        {tr(
          "Nachsprechen zählt als Übung. Auswahl belegt kein eigenständiges Sprechen und keinen separaten Englisch-Hörtest.",
        )}{" "}
      </small>
    </div>
  );
}
export function LessonPlanEditor({
  instructionLanguage = "de",
  topic,
  disabled = false,
  onBusy = () => {},
  onUpdated = () => {},
  onStart,
  starting = false,
  startError = "",
  keyConfigured = false,
  missingKeys = [],
  backendName = "OpenAI",
  liveName = "OpenAI",
}) {
  const [state, setState] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const [previews, setPreviews] = useState([]);
  const base = `/topics/${topic.id}/plan`;
  const query = `${base}?instructionLanguage=${instructionLanguage}`;
  useEffect(() => () => onBusy(false), []);
  function accept(data) {
    setState(data);
    setDraft(
      data.plan
        ? {
            goal: data.plan.goal,
            steps: data.plan.steps,
          }
        : null,
    );
    setPreviews(data.previews || []);
    setDirty(false);
    setIndex(0);
  }
  useEffect(() => {
    const controller = new AbortController();
    api(query, undefined, {
      signal: controller.signal,
    })
      .then(accept)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [query]);
  useEffect(() => {
    if (!busy && !state?.job?.busy) return;
    let mounted = true;
    const timer = setInterval(
      () =>
        api(query)
          .then((data) => {
            if (!mounted) return;
            setState(data);
            if (!data.job?.busy && !busy && data.job?.phase === "ready")
              accept(data);
          })
          .catch(() => {}),
      1200,
    );
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [query, busy, state?.job?.busy]);
  const locked = disabled || busy || state?.job?.busy;
  const request = () => ({
    instructionLanguage,
    expectedTopicRevision: topic.revision,
    expectedRevision: state?.plan?.revision || 0,
  });
  async function build(editing) {
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      const data = await api(`${base}/${editing ? "save" : "generate"}`, {
        ...request(),
        ...(editing
          ? {
              plan: draft,
            }
          : {}),
      });
      accept(data);
      onUpdated();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  function edit(next) {
    setDraft(next);
    setDirty(true);
    setPreviews([]);
  }
  function move(from, to) {
    const steps = [...draft.steps];
    [steps[from], steps[to]] = [steps[to], steps[from]];
    edit({
      ...draft,
      steps,
    });
    setIndex(to);
  }
  function changeStep(field, value) {
    edit({
      ...draft,
      steps: draft.steps.map((s, i) =>
        i === index
          ? {
              ...s,
              [field]: value,
            }
          : s,
      ),
    });
  }
  async function preview() {
    setError("");
    try {
      setPreviews(
        (
          await api(`${base}/preview`, {
            ...request(),
            plan: draft,
          })
        ).previews,
      );
    } catch (e) {
      setError(e.message);
    }
  }
  const step = draft?.steps[index];
  const board = previews[index];
  return (
    <section
      className="lesson-plan-editor"
      aria-label={tr("Ausführbarer Unterrichtsplan")}
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow"> {tr("FÜR DIE NÄCHSTE STUNDE")} </span>
          <h2>
            {" "}
            {tr("Unterricht vorbereiten ·")} {topic.name}
          </h2>
        </div>
        <div className="plan-header-actions">
          <button
            className="button secondary"
            disabled={locked || !state}
            onClick={() => build(false)}
          >
            <RefreshCw size={17} />
            {state?.plan ? tr("Plan neu erstellen") : tr("Plan erstellen")}
          </button>
          <button
            className="button"
            disabled={locked || !state || dirty || !keyConfigured}
            onClick={onStart}
          >
            {starting ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <Mic size={18} />
            )}
            {starting
              ? tr("Mikrofon wird vorbereitet …")
              : tr("Mikrofon an & Stunde starten")}
          </button>
        </div>
      </div>
      {dirty && (
        <p className="hint">
          {" "}
          {tr("Bitte den Plan speichern, bevor du die Stunde startest.")}{" "}
        </p>
      )}
      {!keyConfigured && (
        <p className="error-text">
          {" "}
          {tr("Bitte zuerst die Windows-Umgebungsvariablen")}{" "}
          {missingKeys.join(", ")} {tr("einrichten.")}{" "}
        </p>
      )}
      {!state?.plan && (
        <p role="status">
          {tr("matchingPlanRequired", {
            instruction: languageLabel(instructionLanguage),
            target: languageLabel(topic.targetLanguage),
          })}
        </p>
      )}
      {state?.variants
        ?.filter((plan) => plan.instructionLanguage !== instructionLanguage)
        .map((plan) => (
          <details key={plan.instructionLanguage}>
            <summary>
              {tr("viewVariant", {
                language: languageLabel(plan.instructionLanguage),
              })}
            </summary>
            <p>{plan.goal}</p>
            <ol>
              {plan.steps.map((step) => (
                <li key={step.id}>
                  {step.word} · {step.meaning}
                </li>
              ))}
            </ol>
          </details>
        ))}
      {startError && (
        <p role="alert" className="error-text">
          {startError}
        </p>
      )}
      <small className="plan-start-note">
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
      <p>
        {" "}
        {tr(
          "Übungen mit Emoji oder deutschen Begriffen vorbereiten. Mia wartet bei jeder Aufgabe auf die Antwort und passt sich Wünschen an. Änderungen gelten für neue Stunden.",
        )}{" "}
      </p>
      {(busy || state?.job?.busy) && (
        <p className="plan-status" role="status">
          <LoaderCircle className="spin" size={18} />{" "}
          {tr("Unterrichtsplan wird erstellt …")}{" "}
        </p>
      )}
      {error && (
        <p role="alert" className="error-text">
          {tr(error)}
        </p>
      )}
      {state?.job?.error && !error && (
        <p role="alert" className="error-text">
          {tr(state.job.errorCode || "planFailed")}
        </p>
      )}
      {state?.plan?.stale && (
        <p className="hint">
          {" "}
          {tr(
            "Das Thema wurde geändert. Bitte den Plan neu erstellen; neue Stunden nutzen den alten Plan nicht.",
          )}{" "}
        </p>
      )}
      {state?.reviews.length > 0 && (
        <div className="plan-reviews">
          <h3> {tr("Zum Aufwärmen bereit")} </h3>
          <ul>
            {state.reviews.map((r) => (
              <li key={r.word}>
                <b>{r.word}</b> — {tr(r.reasonCode || "")}
              </li>
            ))}
          </ul>
          <small>
            {" "}
            {tr(
              "Zu Stundenbeginn werden bis zu drei aktuell fällige Wörter eingesetzt. Die Reihenfolge der übrigen Schritte bleibt erhalten.",
            )}{" "}
          </small>
        </div>
      )}
      {draft && (
        <>
          <label className="plan-goal">
            {" "}
            {tr("Lernziel")}{" "}
            <input
              value={draft.goal}
              disabled={locked}
              maxLength={500}
              onChange={(e) =>
                edit({
                  ...draft,
                  goal: e.target.value,
                })
              }
            />
          </label>
          <p>
            <b>
              {Math.round(
                (draft.steps.reduce((sum, s) => sum + s.seconds, 0) / 60) * 10,
              ) / 10}{" "}
              {tr("Minuten Übungen")}{" "}
            </b>{" "}
            {tr(
              "+ etwa eine Minute Abschluss. Zeiten sind Orientierung, kein Antwort-Countdown.",
            )}{" "}
          </p>
          <div className="plan-workspace">
            <ol className="plan-steps">
              {draft.steps.map((s, i) => (
                <li key={s.id} className={index === i ? "selected" : ""}>
                  <button
                    className="plan-step-select"
                    onClick={() => setIndex(i)}
                    aria-pressed={index === i}
                  >
                    <small>
                      {tr(stageLabels[s.stage])} · {s.seconds} {tr("s")}{" "}
                    </small>
                    <strong>{s.word}</strong>
                    <span>{tr(practiceLabels[s.mode])}</span>
                  </button>
                  <div className="plan-move">
                    <button
                      aria-label={tr("moveUp", { step: i + 1 })}
                      disabled={locked || i === 0}
                      onClick={() => move(i, i - 1)}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      aria-label={tr("moveDown", { step: i + 1 })}
                      disabled={locked || i === draft.steps.length - 1}
                      onClick={() => move(i, i + 1)}
                    >
                      <ArrowDown size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            <div className="plan-detail">
              {step && (
                <>
                  <h3>
                    {" "}
                    {tr("Schritt")} {index + 1} · {step.word}
                  </h3>
                  <div className="plan-fields">
                    <label>
                      {" "}
                      {tr("Übungsform")}{" "}
                      <select
                        value={step.mode}
                        disabled={locked}
                        onChange={(e) => changeStep("mode", e.target.value)}
                      >
                        {Object.entries(practiceLabels).map(([mode, label]) => (
                          <option value={mode} key={mode}>
                            {tr(label)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {" "}
                      {tr("Deutsche Bedeutung")}{" "}
                      <input
                        value={step.meaning}
                        maxLength={80}
                        disabled={locked}
                        onChange={(e) => changeStep("meaning", e.target.value)}
                      />
                    </label>
                    <label>
                      {" "}
                      {tr("Sekunden")}{" "}
                      <input
                        type="number"
                        min="15"
                        max="120"
                        value={step.seconds}
                        disabled={locked}
                        onChange={(e) =>
                          changeStep("seconds", Number(e.target.value))
                        }
                      />
                    </label>
                    {step.mode === "meaning_choice" && (
                      <label>
                        {" "}
                        {tr("Andere bekannte Wörter (Komma)")}{" "}
                        <input
                          value={step.distractors.join(", ")}
                          disabled={locked}
                          onChange={(e) =>
                            changeStep(
                              "distractors",
                              e.target.value === ""
                                ? []
                                : e.target.value
                                    .split(",")
                                    .map((v) => v.trim()),
                            )
                          }
                        />
                      </label>
                    )}
                  </div>
                  <button
                    className="button secondary"
                    disabled={locked}
                    onClick={preview}
                  >
                    <Eye size={17} /> {tr("Tafelvorschau aktualisieren")}{" "}
                  </button>
                  {board ? (
                    <div
                      className="plan-preview"
                      aria-label={tr("Tafelvorschau")}
                    >
                      <p>
                        <b>{board.title}</b> · {board.prompt}
                      </p>
                      <div className="plan-board">
                        {board.elements.map((element) => (
                          <BoardElement key={element.id} element={element} />
                        ))}
                      </div>
                      {board.options.length > 0 && (
                        <div className="word-tags">
                          {board.options.map((o) => (
                            <span key={o.id}>{o.label}</span>
                          ))}
                        </div>
                      )}
                      {board.mode !== step.mode && (
                        <p className="hint">
                          {" "}
                          {tr(
                            "Kein passendes Emoji: mit dem deutschen Begriff üben.",
                          )}{" "}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="muted">
                      {" "}
                      {tr(
                        "Vorschau nach Änderungen aktualisieren. Dabei werden keine Lernbelege gespeichert.",
                      )}{" "}
                    </p>
                  )}
                  <p className="plan-branches">
                    <b> {tr("Nach der Antwort:")} </b>{" "}
                    {tr(
                      "Richtig → nächster vorbereiteter Schritt. Unsicher gehört → erneut nachfragen. Falsch / Hilfe → Hinweis und dieselbe Aufgabe erneut versuchen. Andere Wünsche → Mia passt den Ablauf an.",
                    )}{" "}
                  </p>
                </>
              )}
            </div>
          </div>
          <div className="plan-actions">
            <button
              className="button"
              disabled={locked || state?.plan?.stale}
              onClick={() => build(true)}
            >
              <Save size={17} /> {tr("Plan speichern")}{" "}
            </button>
            <span>
              {dirty
                ? tr("Ungespeicherte Änderungen")
                : tr("savedPlan", { version: state?.plan?.revision })}
            </span>
          </div>
        </>
      )}
      <details className="plan-evidence">
        <summary> {tr("Lernbelege pro Wort")} </summary>
        <WordProgress items={state?.mastery} />
      </details>
    </section>
  );
}
