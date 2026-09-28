import React, { useEffect, useState } from "react";
import { Save, RotateCcw, RefreshCw, LoaderCircle } from "lucide-react";
import { api } from "./api.js";
import {
  acceptLanguages,
  previewLanguage,
  useLanguages,
} from "./language-state.js";
import {
  interfaceLanguages,
  instructionLanguages,
  targetLanguages,
  defaultLanguages,
  languageNames,
} from "../shared/languages.js";
import { t as tr, languageLabel } from "./i18n.js";
export function LanguageSettings({ onSaving }) {
  const saved = useLanguages();
  const [base, setBase] = useState(saved);
  const [draft, setDraft] = useState(saved.languages);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api("/languages", undefined, {
      signal: controller.signal,
    })
      .then((data) => {
        acceptLanguages(data);
        setBase(data);
        setDraft(data.languages);
        setLoaded(true);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.code || "operationFailed");
      });
    return () => {
      controller.abort();
      previewLanguage(null);
    };
  }, []);
  function change(next) {
    setDraft(next);
    previewLanguage(next.interfaceLanguage);
    setSuccess(false);
    setError("");
  }
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    onSaving(true);
    setError("");
    setSuccess(false);
    try {
      const data = await api("/languages", {
        revision: base.revision,
        languages: draft,
      });
      acceptLanguages(data);
      setBase(data);
      setDraft(data.languages);
      setSuccess(true);
    } catch (e) {
      setError(e.code === "languageConflict" ? e.code : "languageSaveFailed");
    } finally {
      setSaving(false);
      onSaving(false);
    }
  }
  async function reload() {
    try {
      const data = await api("/languages");
      acceptLanguages(data);
      setBase(data);
      change(data.languages);
      setLoaded(true);
    } catch {
      setError("operationFailed");
    }
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(base.languages);
  return (
    <form onSubmit={save} className="language-settings">
      <fieldset disabled={saving || !loaded} className="settings-role">
        <legend>{tr("languages")}</legend>
        <div className="settings-fields">
          {[
            ["interfaceLanguage", interfaceLanguages],
            ["instructionLanguage", instructionLanguages],
            ["targetLanguage", targetLanguages],
          ].map(([key, values]) => (
            <div key={key} className="settings-field">
              <label htmlFor={`language-${key}`}>{tr(key)}</label>
              <select
                id={`language-${key}`}
                value={draft[key]}
                onChange={(event) =>
                  change({
                    ...draft,
                    [key]: event.target.value,
                  })
                }
              >
                {values.map((code) => (
                  <option value={code} key={code}>
                    {languageLabel(code)} · {languageNames[code][3]}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div className="settings-actions">
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              change({
                ...defaultLanguages,
              })
            }
          >
            <RotateCcw size={16} />
            {tr("Standardwerte")}
          </button>
          <button type="submit" className="button" disabled={!dirty}>
            {saving ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Save size={16} />
            )}
            {tr("saveLanguages")}
          </button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="error-text">
          {tr(error)}
        </p>
      )}
      {(error === "languageConflict" || (!loaded && error)) && (
        <button type="button" className="button secondary" onClick={reload}>
          <RefreshCw size={16} />
          {tr("reloadLanguages")}
        </button>
      )}
      {success && (
        <p role="status" className="settings-success">
          {tr("Gespeichert. Die neuen Einstellungen sind jetzt aktiv.")}
        </p>
      )}
    </form>
  );
}
