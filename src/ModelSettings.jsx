import { t as tr } from "./i18n.js";
import React, { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, X } from "lucide-react";
import { api } from "./api.js";
import { LanguageSettings } from "./LanguageSettings.jsx";
const roles = [
  ["live", "Live-Gespräch", "Die Stimme für die gemeinsame Englischstunde."],
  [
    "backend",
    "Unterrichts-Backend",
    "Plant Aufgaben, bewertet Antworten und steuert die Tafel.",
  ],
  [
    "transcription",
    "Spracheingabe",
    "Wandelt deine Aufnahme bei der Vorbereitung in Text um.",
  ],
  [
    "teacher",
    "Gespräche & Unterrichtsplan",
    "Hilft bei Themen, Vorbereitung und Unterrichtsplänen.",
  ],
];
export function ModelSettings({ onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [languageSaving, setLanguageSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const dialog = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    api("/settings", undefined, {
      signal: controller.signal,
    })
      .then((result) => {
        setData(result);
        setDraft(result.roles);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  function close() {
    if (!saving && !languageSaving) onClose();
  }
  function keyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
    if (event.key !== "Tab") return;
    const elements = [
      ...dialog.current.querySelectorAll(
        "button:not(:disabled), select:not(:disabled)",
      ),
    ];
    const first = elements[0],
      last = elements.at(-1);
    if (
      event.shiftKey &&
      [first, dialog.current].includes(document.activeElement)
    ) {
      event.preventDefault();
      last?.focus();
    } else if (
      !event.shiftKey &&
      [last, dialog.current, document.body].includes(document.activeElement)
    ) {
      event.preventDefault();
      first?.focus();
    }
  }
  useEffect(() => {
    document.addEventListener("keydown", keyDown);
    return () => document.removeEventListener("keydown", keyDown);
  }, [saving, languageSaving, onClose]);
  function change(role, provider) {
    setSaved(false);
    setError("");
    setDraft((previous) => ({
      ...previous,
      [role]: {
        provider,
      },
    }));
  }
  async function save(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const result = await api("/settings", {
        revision: data.revision,
        roles: draft,
      });
      setData(result);
      setDraft(result.roles);
      onSaved(result.health);
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  const dirty = data && JSON.stringify(draft) !== JSON.stringify(data.roles);
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        ref={dialog}
        tabIndex={-1}
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="modal-close"
          aria-label={tr("Schließen")}
          disabled={saving}
          onClick={close}
        >
          <X />
        </button>
        <span className="eyebrow"> {tr("FÜR ELTERN")} </span>
        <h2 id="settings-title"> {tr("Einstellungen & Verbindung")} </h2>
        <LanguageSettings onSaving={setLanguageSaving} />
        <p>
          {" "}
          {tr(
            "Wähle für jeden Bereich einen Anbieter. Modell, Denkintensität und Stimme sind vorgegeben. Änderungen gelten erst nach dem Speichern.",
          )}{" "}
        </p>
        {!data && !error && (
          <p role="status">
            <LoaderCircle className="spin" size={16} />{" "}
            {tr("Einstellungen werden geladen …")}{" "}
          </p>
        )}
        <form onSubmit={save}>
          {data &&
            roles.map(([role, label, description]) => {
              const value = draft[role];
              const option = data.options[role][value.provider];
              const display = (field, title) => (
                <div className="settings-field">
                  <label htmlFor={`settings-${role}-${field}`}>{title}</label>
                  <output id={`settings-${role}-${field}`}>
                    {option.values[field]}
                  </output>
                </div>
              );
              return (
                <fieldset
                  className="settings-role"
                  key={role}
                  disabled={saving}
                >
                  <legend>{tr(label)}</legend>
                  <p className="settings-description">{tr(description)}</p>
                  <div className="settings-fields">
                    <div className="settings-field">
                      <label htmlFor={`settings-${role}-provider`}>
                        {" "}
                        {tr("Anbieter")}{" "}
                      </label>
                      <select
                        id={`settings-${role}-provider`}
                        value={value.provider}
                        onChange={(event) => change(role, event.target.value)}
                      >
                        {Object.entries(data.options[role]).map(
                          ([provider, item]) => (
                            <option key={provider} value={provider}>
                              {item.label}
                            </option>
                          ),
                        )}
                      </select>
                    </div>
                    {display("model", tr("Modell"))}
                    {option.values.baseUrl &&
                      display("baseUrl", tr("Server-Adresse"))}
                    {option.values.voice && display("voice", tr("Stimme"))}
                    {option.values.reasoningEffort &&
                      display("reasoningEffort", tr("Denkintensität"))}
                    {role === "backend" &&
                      option.values.serviceTier &&
                      display("serviceTier", tr("Dienstpriorität · OpenAI"))}
                  </div>
                  <p
                    className={`settings-key ${option.keyConfigured ? "" : "error-text"}`}
                  >
                    {option.keyConfigured
                      ? tr("API-Schlüssel: Geladen ✓")
                      : tr("missingKey", {
                          name: option.apiKeyName,
                        })}
                  </p>
                </fieldset>
              );
            })}
          {error && (
            <p className="error-text" role="alert">
              {tr(error)}
            </p>
          )}
          {saved && (
            <p className="settings-success" role="status">
              <Check size={18} />{" "}
              {tr(
                "Gespeichert. Die neuen Einstellungen sind jetzt aktiv.",
              )}{" "}
            </p>
          )}
          {data && (
            <>
              <p className="hint">
                {" "}
                {tr(
                  "API-Schlüssel werden ausschließlich aus den System-Umgebungsvariablen gelesen. Deine Auswahl bleibt nach einem Neustart erhalten.",
                )}{" "}
              </p>
              <div className="settings-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={saving}
                  onClick={() => {
                    setDraft(structuredClone(data.defaults));
                    setSaved(false);
                    setError("");
                  }}
                >
                  {" "}
                  {tr("Standardwerte")}{" "}
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={saving}
                  onClick={close}
                >
                  {dirty ? tr("Abbrechen") : tr("Fertig")}
                </button>
                <button
                  type="submit"
                  className="button"
                  disabled={saving || !dirty}
                >
                  {saving ? tr("Wird gespeichert …") : tr("Speichern")}
                </button>
              </div>
            </>
          )}
        </form>
      </section>
    </div>
  );
}
