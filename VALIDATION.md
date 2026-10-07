# Validation

[简体中文](VALIDATION.zh-CN.md)

## 2026-10-07: Publication Checks

`.gitignore` additionally excludes local OAuth login/token caches and HAR network captures. Ignore checks retain `.env.example` and exclude local configuration, learner data, dependencies, generated output and test reports. The complete staged snapshot contains **117 files**; no configured process/Windows credentials or unintended local/generated files were found. Credential-pattern matches were reviewed as synthetic test fixtures, and `git diff --cached --check` passed.

Publication validation passed: **215 / 215 Node tests**, production build, **42 / 42 Playwright tests** after build completion, and `npm.cmd audit --omit=dev` with **0 vulnerabilities**. Evidence: `.cache/publish-audit.json`, `.cache/publish-node-tests.log`, `.cache/publish-build.log`, `.cache/publish-browser-tests.log` and `.cache/publish-dependency-audit.log`. This publication check did not repeat real provider or physical-audio tests.

## 2026-10-07: GPT Live Codex / ChatGPTPlus Port

All changes are in `vox-lingo`. KI-Englischlehrerin was inspected read-only; its Git status remained unchanged and all **103** checked source/configuration file hashes matched the captured reference snapshot. Six modules match the reference byte-for-byte: `server/planbridge-live.js`, `server/ai.js`, `server/model-settings.js`, `src/live-chatgptplus.js`, `src/live.js`, `src/transcripts.js`.

The integration retains Vox-Lingo's frozen languages, neutral practice contracts and UI translations. Full language instructions remain in session creation; short subsequent language reminders fit the gateway's 500-byte limit. Feedback compaction preserves instruction/target language context. The data-directory guard also protects KI-Englischlehrerin, and `check:api` routes its PlanBridge credential only to the gateway.

| Check | Result | Evidence |
| --- | --- | --- |
| Node unit/integration suite | **215 / 215 passed** | `.cache/chatgptplus-unit-tests.log` |
| Production build | **Passed** | `.cache/chatgptplus-build.log` |
| Playwright suite, after build completion | **42 / 42 passed** | `.cache/chatgptplus-browser-tests.log` |
| Gateway readiness and selected model metadata | **Passed** | `.cache/chatgptplus-api-check.log` |
| Real synthetic Live session | **Passed**, `http://miniserver:8787/v1`, `gpt-live-1-codex`, `sol` | `.cache/chatgptplus-live-smoke.log` |
| Reference file integrity and core-module parity | **Passed** | `.cache/chatgptplus-source-integrity.json` |
| Windows runtime script syntax | **0 parse errors** | PowerShell parser |
| Changed/new files plus local `.env` credential scan | **No known system-key values found** | Local content scan; no keys printed |

Coverage includes all **36** provider combinations; provider-only persistence and environment precedence; URL/model/voice validation; unique authenticated sideband; native acknowledgement correlation; 500 UTF-8 byte commands; real delegation IDs; cancellation and late-create cleanup; failed-close retry after controller recreation; suffix-caption deduplication; and all **18** instruction/target combinations for creation, greeting and feedback rewriting. Browser checks cover media readiness before microphone activation, SSE-only captions, local muting, confirmed-close ordering, and ChatGPTPlus settings in three locales at 390/1440 pixels.

The real smoke used an ephemeral headless Chromium session with synthetic microphone audio, without loading learner data. It created one session per run, established WebRTC and sideband, received native command acknowledgements, inbound audio and an output transcript, observed no provider errors, and received `finalized:true` before releasing the peer. This verifies this gateway/account's synthetic Live path; physical microphones/speakers, child speech, accents/noise, multilingual speech quality, long sessions and Safari/iPad remain untested.

One intermediate browser run overlapped a build, temporarily serving the existing “build first” page while `dist` was being replaced. The final full browser run followed the completed build and passed without code changes for that failure. Build warnings concern dependency comment annotations and did not prevent output.

The general WebRTC/sideband background was checked against [OpenAI Docs: Server-side controls](https://developers.openai.com/api/docs/guides/voice-server-controls). The native PlanBridge model, voices and successful subscription path are evidenced by the local reference implementation and this real synthetic check.

## 2026-09-28: Windows Launcher Rename

The five root `.cmd` and `.ps1` launchers use `vox-lingo` filenames. README and the shutdown test reference the new names; `.gitignore` excludes the old launcher filenames. Verification: all three `.cmd` targets exist, both PowerShell scripts parsed without errors, and `node --test test/shutdown.test.js` passed **1 / 1**. The start script was not launched in this check.

## 2026-09-28: Multilingual Implementation

Current checkout: `vox-lingo`. Tests used synthetic/temp/in-memory data. There was no existing user `data/` directory when implementation began. The original decision record is [I18N_PLAN.md](I18N_PLAN.md).

| Check | Result | Evidence |
| --- | --- | --- |
| Node unit/integration suite | **186 / 186 passed** | `.cache/unit-tests.log` |
| Production build | **Passed** | `.cache/build.log` |
| Playwright suite | **39 / 39 passed** | `.cache/browser-tests.log` |
| Selected model access | **Passed**, OpenAI Live/backend/teacher/transcription metadata | `.cache/api-access.log` |
| Real synthetic multilingual text | **OpenAI passed**, Chinese parent chat to Japanese topic/Chinese-instruction plan (6 steps) | `.cache/language-smoke.log` |
| Real synthetic multilingual text | **DeepSeek passed**, same scenario (12 steps) | `.cache/language-smoke.log` |
| Gemini synthetic multilingual text | **Not passed: service unavailable** at topic generation, reproduced twice | `.cache/language-smoke.log`, `.cache/gemini-language-smoke.log` |

A minimal Gemini request with just “Reply OK”, no tool schema or application data, also returned **HTTP 503 UNAVAILABLE / high demand**. This demonstrates a service availability failure in this run; it does not certify the new Gemini workflow. No provider configuration was changed to hide the failure.

### Automated Coverage

- Persistent defaults, alias normalization, restart, invalid language values, failed writes and stale-window conflicts.
- All **3 instruction × 6 target = 18** combinations for generated/saved plans, assessment context, board feedback, frozen lessons, resume and summary fallback. All three interface locales leave instructional snapshots unchanged.
- Both Live provider payloads across all 18 combinations: OpenAI session context/instructions and Gemini input transcription hints with same-language deduplication. These are **mocked transport tests**, not real voice acceptance.
- Definition-based same-language exercises, exact self-translation rejection, Unicode normalization, seven farewell languages, six target-language color boards and local multilingual emoji data.
- Version-4 directory backup, copied-directory migration rehearsal, raw historical state/summary preservation, legacy spoken evidence, deletion markers, repeated startup and transaction rollback after migration failure. This is a **synthetic old database**, not the user's real data migration.
- Target-isolated history/stats/same-spelling evidence, shared evidence across instruction variants, three retained plan versions and server rejection of missing/stale/wrong-language plans.
- Twelve batch tests: more than eight topics in “all”, selected and explicit cross-partition scopes, preserved unselected fields/vocabulary, captured settings, provider/schema failure, cancellation, timeout signal, source conflict, restart recovery, capacity checks and duplicate-safe variants. Cancellation also aborts a pending final model reply after staging; parent chat commits the entire operation once.
- Nine new browser cases cover every preview-close path, reload, latest successful save, failed saves, conflict/reload, separate provider drafts, an active lesson's unchanged question/media/language snapshot, and all three locales at 1440×900 and 390×900. Existing classroom, preparation, model settings, recording and audio tests remain in the full suite.
- Settings screenshots are generated under `test-results/zzzz-languages-three-locales-fit-desktop-and-mobile-settings/`; representative English desktop and Chinese mobile images were visually inspected. No horizontal overflow was found. Saved German topic text remains German when only the interface changes.

Earlier attempts in this implementation are **not counted as passes**. They exposed Windows copy failures while holding SQLite locks, a language-form key mapping error, Escape focus loss after a save, stale English-only assertions, a new-test/shared-fixture interaction and Playwright route teardown timing. These were corrected and the complete suite rerun. Builds were not changed while the final browser suite was running.

### Real Service Scope

The access probe made metadata requests only. `node scripts/smoke-languages.js --run --all` made billable synthetic text calls in a fresh in-memory profile; it did not read or send saved learner records, record audio, or print credentials. The script checks exact requested Japanese vocabulary and persisted language context, not the full pedagogical quality of generated content. Missing keys are reported as skipped, not passed.

The OpenAI Live prompting and Gemini language/transcription configuration were checked against [OpenAI Live prompting](https://developers.openai.com/api/docs/guides/live-prompting), [Gemini Live capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities) and the installed `@google/genai` transcription types. Provider-specific fields are not assumed to be interchangeable.

### Still Unverified

- Real OpenAI and Gemini **voice** for all six targets with all three instruction languages, including real welcome, pronunciation, interruptions, captions, tempo and farewells.
- Physical microphones/speakers, child accents, background noise, long sessions and Safari/iPad.
- Comprehensive real-model semantic assessment, self-correction and uncertain transcription across all language combinations. Existing decision/continuation mocks cannot prove recognition accuracy.
- Gemini's new real multilingual text workflow while its configured service is unavailable.
- A migration of an actual existing user database. Stop all writers and preserve the complete backup before doing one.

The plan's real-device/real-voice acceptance is therefore still open. Interface availability, metadata access and mock payload tests are not a substitute.

## Historical Record: 2026-09-27

The following results are inherited from the earlier `KI-Englischlehrerin` validation document. They preserve its dates, outcomes and limitations. They are **not new multilingual results** and old log/image paths may not exist in this checkout.

### Initial Provider Integration

- **124 Node tests**, including 24 provider combinations, key separation/case handling, environment precedence, invalid configuration and unsafe data path/junction protection.
- Native Gemini tool calls/thought signatures plus OpenAI/DeepSeek topic and plan tool rounds; classroom reasoning context, matching tool IDs, abort and late replies. Missing keys blocked Live; incomplete results executed no tools; provider errors did not disclose request content.
- OpenAI backend fast and teacher auto remained independent. DeepSeek received neither OpenAI tier nor encrypted-reasoning options.
- OpenAI Audio Transcriptions and Gemini Interactions routes retained validation/cancellation.
- **27 browser tests**: 26 existing flows plus OpenAI WebRTC selection, SDP, captions, mute and media release. Build and separate browser connection bundles passed.
- Windows start/health/stop passed on an isolated port/cache directory; shutdown retained directory-identity checking.
- Ignore/secret checks excluded local configuration, databases/sidecars, dependencies, builds, caches, backups, reports and private keys. The then-local environment file matched an empty-key template; README and environment example remained publishable.

### Historical Real Services

- Metadata access succeeded for OpenAI gpt-live-1, gpt-6-luna, gpt-transcribe and Gemini gemini-3.8-live, gemini-3.5-flash-lite, gemini-3.5-transcribe.
- Real synthetic two-round tools passed for OpenAI backend low/fast, OpenAI preparation high/auto and Gemini preparation high.
- DeepSeek lacked a key then: both roles passed mocks; **real DeepSeek was not tested in that historical run**.
- Only synthetic text/model metadata was sent, not saved learner records.
- Real children, physical devices, noisy recognition, Safari/iPad and long sessions were not accepted. OpenAI browser transport was mocked; Gemini used real browser AudioWorklets/local WebSockets with a fake upstream.

### First Online Settings Version

This superseded version allowed editing model parameters.

- Changes, temporary tests, npm cache, images and logs remained in the old project. Existing environment files were not used to source keys or modified.
- Four role forms covered provider-dependent defaults/drafts, cancel, atomic save, reload, explicitly saved defaults and failed-save draft retention.
- The first file format stored provider/model/voice/reasoning/tier but no keys; restart reused environment credentials.
- Four call paths, parameter/key isolation, invalid extra fields, stale windows, write failures and busy protection passed.
- **128 / 128 Node**, `.cache/model-settings-node-tests.log`; **30 / 30 Playwright**, `.cache/model-settings-browser-final.log`.
- An intermediate audio failure during a concurrent build was not counted as a pass. Two isolated audio tests and a full 30-test run without rebuilding passed; the initial root cause was not confirmed.
- Settings at 1280×620 and 390×844 had no horizontal overflow; focus trap, Escape and focus return passed; screenshots were inspected.
- Build/restart followed confirmation of no active work. Local settings returned 200, four configurations and no-store without credentials; selected providers were unchanged.
- No new paid model/device tests were made in that settings round.

### Provider-Only Settings

- Only four provider selectors remained editable; model/voice/reasoning/tier came from the environment.
- Save rejected extra model, voice, reasoningEffort, serviceTier, apiKey and baseUrl fields. Old files contributed providers only; new files stored providers only.
- Teacher OpenAI auto ignored legacy/system fast values; backend tier remained independent.
- **130 / 130 Node**, **30 / 30 Playwright**, build passed. Logs: `.cache/provider-only-node-tests.log`, `.cache/provider-only-browser-tests.log`, `.cache/provider-only-build.log`.
- Tests checked four selectors, immutable parameters, provider-only writes, cancel, failed-save drafts, reload, explicitly saved defaults, responsive layout and focus.
- No paid model/physical device calls; the then-existing environment file was unchanged.

### German UI and Publication Preparation

This historical German-only requirement is superseded by the approved multilingual plan.

- Home/preparation, example messages, labels and recording choices were German; Chinese parent input and recognition remained permitted.
- Four tracked Markdown files and environment-template comments were translated to German. Earlier results retained their historical identity. The existing environment and learner data were unchanged.
- A source/owned-doc scan then found no fixed Chinese text; Chinese test input remained intentionally present.
- **130 / 130 Node**, **30 / 30 Playwright**, build and three PowerShell syntax checks passed. Logs: `.cache/german-ui-node-tests.log`, `.cache/german-ui-browser-tests.log`, `.cache/german-ui-build.log`.
- Home/settings/preparation were checked at 1280×620 and 390×844; zh recording hint stayed intact, the three suggestions inserted German messages, and preparation did not overflow horizontally. Screenshots: `.cache/german-*.png`.
- Ignore checks covered credentials/service accounts/exports/sidecars; environment example remained tracked with empty keys.
- The staged snapshot contained **95 files**. Comparison against process credentials found no real keys; pattern matches were reviewed synthetic fixtures. Staged whitespace checks passed.
- The GitHub target wanzhikid123/KI-Englischlehrerin was confirmed empty/public and main configured in that old project. Publishing source did not host the app.
- No real models, microphones, child lessons or Safari/iPad were checked in that round.

### Standalone Documentation Change

- README/requirements were narrowed to that standalone app; external-project/data-transfer instructions were removed and validation wording adjusted.
- Environment-template/local comments were narrowed to its port/data path; a comparison confirmed unchanged values. The local file stayed ignored.
- No code or tests changed, and no model calls/tests were rerun for that documentation-only change.
- Owned Markdown and template scans plus staged secret/exclusion/whitespace checks passed.
