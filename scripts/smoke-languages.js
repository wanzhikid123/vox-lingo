import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../server/config.js";
import { createAIServices } from "../server/ai.js";
import { Store } from "../server/store.js";
import { AppError } from "../server/store.js";
import { Preparation } from "../server/preparation.js";
import { LessonPlans } from "../server/lesson-plans.js";

// Explicit opt-in: billable text calls, using only a synthetic in-memory profile.
if (!process.argv.includes("--run")) {
  console.error(
    "Use --run to send synthetic, billable text requests. Optional: --all.",
  );
  process.exit(1);
}
const providers = process.argv.includes("--all")
  ? ["openai", "gemini", "deepseek"]
  : [loadConfig().teacher.provider];
for (const provider of providers) {
  const config = loadConfig({
    ...process.env,
    TEACHER_MODEL_PROVIDER: provider,
  });
  if (!config.teacher.apiKey) {
    console.log(
      JSON.stringify({
        provider,
        status: "skipped",
        reason: "missing provider key",
      }),
    );
    continue;
  }
  const store = new Store(":memory:");
  const ai = createAIServices(config).teacherAI;
  const preparation = new Preparation(store, ai),
    plans = new LessonPlans(store, ai, config);
  let stage = "topic";
  try {
    store.saveLanguages({
      revision: store.languageSettings().revision,
      languages: {
        interfaceLanguage: "en",
        instructionLanguage: "zh-CN",
        targetLanguage: "ja",
      },
    });
    const result = await preparation.chat({
      eventId: randomUUID(),
      generation: 0,
      topicId: null,
      lessonId: null,
      message:
        "创建一个日语颜色主题，只学习赤、青两个词，不添加例句。标题、目标、难度和教学备注使用简体中文。请直接创建，并用中文简短回复。",
    });
    assert.equal(result.changes.length, 1);
    const topic = store.topic(result.changes[0].after.id);
    assert.equal(topic.targetLanguage, "ja");
    assert.deepEqual([...topic.words].sort(), ["赤", "青"].sort());
    assert.match(result.message, /\p{Script=Han}/u);
    stage = "plan";
    await plans.build(topic.id, {
      expectedTopicRevision: topic.revision,
      expectedRevision: 0,
      instructionLanguage: "zh-CN",
    });
    const plan = plans.snapshot(topic.id);
    assert.equal(plan.instructionLanguage, "zh-CN");
    assert.equal(plan.targetLanguage, "ja");
    assert.ok(plan.steps.length > 0);
    assert.ok(plan.steps.every((step) => topic.words.includes(step.word)));
    assert.ok(plan.steps.some((step) => /\p{Script=Han}/u.test(step.meaning)));
    console.log(
      JSON.stringify({
        provider,
        model: config.teacher.model,
        status: "passed",
        scenario: "Chinese parent chat and Japanese topic/plan",
        steps: plan.steps.length,
      }),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        provider,
        status: "failed",
        stage,
        diagnostic:
          error instanceof AppError ? error.message : "synthetic assertion",
        reason: error.status
          ? `service status ${error.status}`
          : "synthetic content validation failed",
      }),
    );
    process.exitCode = 1;
  } finally {
    await preparation.shutdown();
    await plans.shutdown();
    store.close();
  }
}
