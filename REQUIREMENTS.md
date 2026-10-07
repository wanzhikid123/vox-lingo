# Requirements

[简体中文](REQUIREMENTS.zh-CN.md)

Current baseline: the decisions in [I18N_PLAN.md](I18N_PLAN.md), approved on 2026-09-27 and authorized for implementation on 2026-09-28. This checkout is `vox-lingo`. The earlier German-only interface/documentation and fixed English-target constraints are superseded, not restrictions on this implementation.

## Product Boundaries

- Keep the local single learner profile, age eight, beginner level and existing ten-minute lesson behavior.
- Keep the directory and storage identifiers. The Windows launcher scripts use the `vox-lingo` name: `Start-vox-lingo.cmd`, `Restart-vox-lingo.cmd`, `Stop-vox-lingo.cmd` and their PowerShell files. Do not edit other learning-app checkouts or publish to a remote repository as part of this change.
- Preserve one-question-at-a-time teaching, explicit board authority, evidence-based feedback, automatic continuation, priority for new utterances, tempo, interruption/reconnection and playback drain.
- Silence is not an incorrect answer. Uncertain recognition cannot become correct automatically. A transcript cannot establish precise pronunciation quality.
- Keep the four provider roles, model/environment configuration, process-only key sources and local-only server binding.

## ChatGPTPlus Live Provider

- Port KI-Englischlehrerin's `gpt-live-1-codex` provider into Vox-Lingo while keeping the reference project read-only. Preserve its HTTP/WebRTC/sideband contract, native acknowledgement correlation, delegation IDs, error sanitization, cancellation cleanup and confirmed closure/recovery.
- Read `PLANBRIDGE_BASE_URL`, `PLANBRIDGE_LIVE_MODEL` and `CHATGPT_CODEX_VOICE` from process environment, then project-root `.env`, then the reference defaults (`http://miniserver:8787/v1`, `gpt-live-1-codex`, `sol`). Read `PLANBRIDGE_API_KEY` only from process/Windows environment, including launcher import.
- Add ChatGPTPlus only to the Live role. Persist only the provider choice; display its model, voice and gateway URL read-only. Reject incompatible URL/model/voice configuration and retain provider switching guards until closure is confirmed.
- Keep browser microphone tracks disabled until the media connection and local classroom are ready. Receive business events and captions only through the backend sideband/SSE; retain suffix-fragment deduplication and acknowledged close before releasing the peer.
- Preserve Vox-Lingo's frozen language context and neutral practice modes. Keep subsequent commands within 500 UTF-8 bytes, including all 18 instruction/target combinations, and rewrite oversized confirmed feedback through the selected classroom backend without executing tools.
- Never use PlanBridge credentials for another provider's model-access check. Protect KI-Englischlehrerin's data directory, including junctions, from configuration that could write into it.

## Language Model

- Interface and instruction independently support en, de, zh-CN. Target supports en, de, ja, ko, fr, es. Defaults: de/de/en; no automatic browser-language override.
- Interface preview must preserve input, component state, question and media connection. Save persists atomically with a revision. Cancel, close, Escape, backdrop and refresh restore saved values. Failure retains the draft. Reset-to-default is a draft.
- Multiple windows cannot silently overwrite preferences. Language saves remain available during a lesson, independent of provider saves and their busy guards.
- New requests capture saved defaults at their start. Active/resumed lessons freeze instruction and target languages. Summaries use that snapshot.
- Fixed UI, system messages, accessible names, dates and numbers follow the effective interface language. Saved content, transcripts and parent chat do not get mechanically translated.
- Parent replies follow the parent's input language. New topic descriptions default to captured instruction language unless explicitly requested otherwise. Words and examples use target language.
- Same-language exercises use definitions, pictures or clues. Voice provider parameters are mapped separately; language hints are deduplicated. Farewell practice must not accidentally end the lesson.

## Data and Plans

- Partition topic lists, recommendations, history, totals, mastery and review by target. Same-spelling words across targets never share evidence. Instruction changes do not reset target progress.
- Keep a globally visible, language-labelled resumable lesson and the single-active-lesson restriction.
- Legacy data belongs to en target and de instruction. Preserve IDs, raw history, evidence, asset references, deleted-topic markers and existing snapshots.
- Use neutral targetTitle/meaning/meaning_choice/meaning_speak for new content; normalize legacy english/german fields at read boundaries.
- Schema upgrades require a complete data-directory backup with all present database sidecars/assets/settings, stopped writers, a copied-data test, transactional migration and idempotent restart. Rollback uses old code and the complete old backup.
- Plans are independent instruction-language variants per topic, with target, topic revision, plan revision and saved timestamp. Only a saved matching plan can start a new lesson; the server must enforce this.
- Topic edits/description translations invalidate old plans conservatively without deleting them. Existing lessons retain their own plan and topic snapshots.

## Parent Operations

- Translation modifies only explicitly requested description fields, never learning vocabulary, examples or evidence. Track description language per field.
- Another target language creates a new independent topic ID with optional source linkage, no copied evidence and no inherited plan.
- All means the current target partition unless explicit cross-partition sources are supplied; selected scope uses fixed IDs.
- Handle more than eight topics with bounded batches, timeout, progress, cancellation, persisted IDs and all-or-none commit. Provider/schema failures, interruption and source conflicts leave originals intact.
- Retrying the same successful request cannot duplicate variants. Existing variants need an explicit update request or clarification. Topic capacity is 60 per target, checked before creation and again at commit.
- Unicode, accents, Chinese descriptions, Japanese kanji and Korean are valid. Continue structural and size validation; never reject text merely for containing Han characters.

## Verification and Documentation

- Cover all 18 instruction/target combinations, same-language cases, three interface locales, old-data migration, settings failure/conflict/closure paths, partitioning, frozen lessons and summaries.
- Test all/selected batch scopes above eight topics, partial-field preservation, capacity, cancellation, timeout, restart and duplicate requests.
- Keep provider routing/key separation and existing audio/lesson regressions. Separate mocked provider assertions from real model/microphone results.
- Maintain English/Chinese README, requirements, validation and owned notices. Preserve historical validation dates, results and limitations. The approved Chinese plan remains a decision record.
- Real multilingual voice quality on all Live providers, children/noise, long sessions and actual target devices is a separate acceptance boundary, never inferred from a successful build or payload test.
