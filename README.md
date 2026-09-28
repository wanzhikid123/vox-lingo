# Vox-Lingo

[简体中文](README.zh-CN.md)

A local language-learning app for an eight-year-old beginner: live conversation, parent preparation, editable lesson plans, visual practice and persistent learning evidence. The Windows startup scripts use the Vox-Lingo name.

## Start and Stop

Requires Node.js 24 or newer.

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Open [the local app](http://127.0.0.1:3212). The server listens only on this computer. On Windows, `Start-vox-lingo.cmd`, `Stop-vox-lingo.cmd` and `Restart-vox-lingo.cmd` manage this project's service. Closing the browser does not stop the service. Terminal starts can be stopped with Ctrl+C.

Non-secret configuration uses process variables, then `.env`, then code defaults. See `.env.example` for `KI_PORT`, `KI_DATA_DIR` and model configuration. Scripts import Windows user/system keys; a terminal started before adding a key may need to be reopened.

## Three Independent Languages

Open Settings using the gear icon.

| Setting | Choices | When applied |
| --- | --- | --- |
| Interface | English, German, Simplified Chinese | Immediate preview; persisted only by Save languages |
| Instruction | English, German, Simplified Chinese | Newly started requests and lessons after saving |
| Target | English, German, Japanese, Korean, French, Spanish | New lessons and the topic/progress partition after saving |

Defaults are **German interface / German instruction / English target**. Internal codes are `en/de/zh-CN` and `en/de/ja/ko/fr/es`; input aliases `cn/jp/kr` are normalized at language-setting boundaries.

Closing, Cancel/Done, Escape, clicking the backdrop or reloading discards an unsaved preview. Defaults also need saving. Failed saves retain the draft and preview; conflicting windows must reload saved values. Language and provider settings have separate save buttons and never submit each other's drafts.

Language settings can be saved during a lesson. Its connection, current question and original instruction/target snapshot stay unchanged, including when resuming. A resumable lesson remains visible even when it belongs to another target partition. Only one lesson can be active.

Switching languages does **not** translate saved topics, plans, summaries, answers or chat. Interface labels change; saved content retains its original text. Parent chat follows the parent's input language, independent of classroom language. The preparation recording hint (Automatic / Chinese / English / German) remains independent too.

## Topics and Plans

Each target language has its own topics, history, totals, review queue and learning evidence. Empty partitions stay empty until you create content in Preparation. Existing seed topics remain in the English partition.

Before starting a new lesson, prepare and save a plan that matches the topic revision, target language and saved instruction language. The server rejects missing, stale or mismatched plans. Plans are retained separately for all three instruction languages; changing a topic makes its old plans stale without deleting them. Resuming an old lesson uses its snapshots.

Parent-chat examples:
- “Translate the titles and goals of all English topics into Chinese.” Only those description fields change; vocabulary and evidence do not.
- “Create a Japanese learning version of the English colors topic.” This creates an independent topic with Japanese vocabulary, no copied progress and no inherited plan.

“All” defaults to the current target partition. Cross-partition requests must state their sources explicitly. More than eight topics are supported through batches of six, with a 60-topic limit per target language. Progress and cancellation are visible. Content is committed only when all batches and the final response succeed; provider failures, cancellation and conflicts preserve originals. Interrupted operations are marked failed after restart and can be retried. An existing destination variant requires an explicit update request, not another copy.

Same-language teaching uses definitions, pictures and context clues instead of translating a word into itself. Spoken recall requires the target-language answer; uncertain transcripts are not silently marked correct.

## Providers and Keys

The four existing provider roles remain independent:

| Role | Providers | Code defaults |
| --- | --- | --- |
| Live voice and captions | OpenAI / Gemini | OpenAI `gpt-live-1`, `marin` |
| Classroom decisions and summaries | OpenAI / DeepSeek | OpenAI `gpt-6-luna`, low, fast |
| Preparation recordings | OpenAI / Gemini | OpenAI `gpt-transcribe` |
| Parent chat, topics and plans | OpenAI / Gemini / DeepSeek | OpenAI `gpt-6-luna`, high, auto |

These are application defaults, not guarantees of account access. Model names, voices and reasoning settings come from the environment. Only provider choices are editable in the settings UI and saved in `data/model-settings.json`. Active lessons, preparation, plan generation and transcription continue to block provider changes, but not language changes. Environment changes require a restart. OpenAI preparation always uses `auto`; only the OpenAI backend reads `OPENAI_BACKEND_SERVICE_TIER`.

Keys are read only from process/system environment variables: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY` (existing lowercase names are accepted). Keys in `.env` are ignored. No key-entry UI, cross-provider fallback or key persistence is added. Missing keys do not prevent reading local records.

OpenAI Live uses WebRTC and a server control connection. Gemini uses native SDK WebSockets and local PCM transport. The providers receive the lesson's frozen language context; Gemini transcription hints use deduplicated BCP-47 language codes. Transcripts are not translated. Text and transcription adapters retain their separate official endpoints, parameters and key sources.

## Data and Upgrades

The default `data/` directory holds `learning.sqlite`, images and provider settings. Language settings and durable batch operation state live in SQLite. Schema version **5** reads legacy English/German fields and practice modes through compatibility adapters.

**Stop all instances that can write to the data directory before upgrading.** Startup checkpoints the old database, checks for contention and copies the complete directory to a sibling `*.backup-v4-<timestamp>-<id>` before migration. It releases SQLite locks for Windows file copying and rejects detected database changes during the copy. This is not a substitute for stopping another writer.

Migration is transactional and restart-safe. Legacy topics/evidence remain English; old lessons and plans retain German instruction. IDs, historical JSON, summaries, images, deletion markers and answer evidence are preserved. A synthetic v4 directory was tested; no pre-existing user database was present in this checkout during implementation.

To roll back, stop the app, preserve the upgraded directory, and restore the **whole** backup alongside matching old code. Do not run old code against schema 5 or merge individual SQLite files. Treat backups as private: they may contain chat, learning records and configuration.

## Verification

Optional `node scripts/smoke-languages.js --run --all` checks Chinese parent chat, Japanese topic creation and a Chinese-instruction plan on every configured text provider. This makes billable calls using a fresh synthetic in-memory profile; it never loads saved learner data.

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:browser
```

These use fixtures, not paid model calls. Browser tests include real AudioWorklets/local PCM plus simulated providers. `npm.cmd run check:api` checks selected model access only. Optional `node scripts/smoke-text.js --all` sends synthetic text/tool calls to configured providers and may incur charges; it does not read learning records.

See [Requirements](REQUIREMENTS.md), [Validation](VALIDATION.md), [the approved plan](I18N_PLAN.md) and [Third-party notices](THIRD_PARTY_NOTICES.md). Real child speech, accents/noise, physical devices, long sessions and Safari/iPad need separate validation. A dropdown or mocked payload is not proof of real multilingual voice quality.

Local data, backups, keys, dependencies, builds and test reports are ignored by Git. This implementation does not publish the app or modify a remote repository.
