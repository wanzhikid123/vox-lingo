import test from "node:test";
import assert from "node:assert/strict";
import { createAIServices } from "../server/ai.js";
import { GeminiService } from "../server/gemini.js";
import { ResponsesService } from "../server/responses.js";
import { Store } from "../server/store.js";
import { Preparation } from "../server/preparation.js";
import { LessonPlans } from "../server/lesson-plans.js";
import { Classroom } from "../server/classroom.js";
import { runTeacher, generateSummary } from "../server/teacher.js";

for (const provider of ["openai", "deepseek"]) {
  test(`${provider} routing keeps preparation and saved plans on Gemini, with classroom decisions and summary on Responses`, async (t) => {
    const config = {
      apiKey: "gemini-test-only",
      teacherModel: "gemini-preparation-model",
      teacherThinkingLevel: "high",
      backend: {
        provider,
        apiKey: "backend-test-only",
        apiKeyName: `${provider.toUpperCase()}_API_KEY`,
        baseUrl:
          provider === "openai"
            ? "https://api.openai.com/v1"
            : "https://api.deepseek.com",
        model: "classroom-test-model",
        reasoningEffort: "low",
      },
    };
    const store = new Store(":memory:");
    t.after(() => store.close());
    const plan = {
      goal: "Tiere benennen.",
      steps: [
        {
          id: "cat",
          word: "cat",
          meaning: "Katze",
          mode: "repeat",
          distractors: [],
          stage: "new",
          seconds: 45,
        },
      ],
    };
    const geminiRequests = [];
    const gemini = new GeminiService(config, {
      models: {
        generateContent: async (request) => {
          geminiRequests.push(request);
          const isPlan = request.config.tools?.[0].functionDeclarations.some(
            (tool) => tool.name === "save_lesson_plan",
          );
          return {
            candidates: [
              {
                finishReason: "STOP",
                content: {
                  role: "model",
                  parts: isPlan
                    ? [
                        {
                          functionCall: {
                            name: "save_lesson_plan",
                            args: plan,
                          },
                        },
                      ]
                    : [{ text: "Wir können Tiere üben." }],
                },
              },
            ],
          };
        },
      },
    });
    const backendRequests = [];
    const backend = new ResponsesService(
      config.backend,
      async (url, options) => {
        assert.equal(url, `${config.backend.baseUrl}/responses`);
        const body = JSON.parse(options.body);
        backendRequests.push(body);
        const isAssessment = body.tools.some(
          (tool) => tool.name === "assess_prepared_turn",
        );
        const questionId = isAssessment
          ? JSON.parse(body.input[0].content).question.id
          : null;
        return Response.json({
          status: "completed",
          output: isAssessment
            ? [
                {
                  type: "function_call",
                  name: "assess_prepared_turn",
                  call_id: "assessment",
                  arguments: JSON.stringify({
                    action: "repeat",
                    questionId,
                    optionId: null,
                    uncertain: false,
                    hinted: false,
                  }),
                },
              ]
            : [
                {
                  type: "message",
                  role: "assistant",
                  content: [
                    { type: "output_text", text: "Heute hast du cat geübt." },
                  ],
                },
              ],
        });
      },
    );
    config.live = { provider: "gemini", apiKey: config.apiKey };
    config.teacher = { provider: "gemini", apiKey: config.apiKey };
    config.transcription = { provider: "gemini", apiKey: config.apiKey };
    const services = createAIServices(config, { teacher: gemini, backend });
    const preparation = new Preparation(store, services.teacherAI);
    await preparation.chat({
      eventId: "routing-preparation",
      message: "Wir üben Tiere.",
      topicId: "animals",
      lessonId: null,
    });
    const plans = new LessonPlans(store, services.teacherAI, config);
    const generated = await plans.generate(
      store.topic("animals"),
      [],
      [],
      new AbortController().signal,
    );
    assert.deepEqual(generated, plan);
    assert.equal(backendRequests.length, 0);
    for (const request of geminiRequests) {
      assert.equal(request.model, "gemini-preparation-model");
      assert.equal(request.config.thinkingConfig.thinkingLevel, "HIGH");
    }
    assert.equal(geminiRequests.length, 2);
    const lesson = store.create("animals", "routing-lesson", generated);
    store.connect(lesson.id, "test");
    const classroom = new Classroom(store, services.classroomAI, config);
    classroom.waitRendered = async () => {};
    const room = classroom.room(lesson.id);
    await classroom.prepared.present(lesson.id, room.controller.signal);
    const latestChild = {
      role: "child",
      text: "Bitte wiederholen",
      questionId: store.lesson(lesson.id).state.question.id,
    };
    const response = await classroom.prepared.run({
      id: lesson.id,
      trigger: "repeat",
      transcripts: [latestChild],
      latestChild,
      signal: room.controller.signal,
      inputVersion: room.inputVersion,
    });
    assert.match(response, /Repeat only the current task/);
    await runTeacher({
      store,
      ai: services.classroomAI,
      id: lesson.id,
      trigger: "test",
      transcripts: [],
      signal: room.controller.signal,
      execute: () => assert.fail("No classroom mutation expected"),
    });
    store.finish(lesson.id, "ended_early");
    await generateSummary(services.classroomAI, store, lesson.id);
    assert.equal(backendRequests.length, 3);
    assert.equal(geminiRequests.length, 2);
    for (const request of backendRequests) {
      assert.equal(request.model, "classroom-test-model");
      assert.equal(request.reasoning.effort, "low");
    }
  });
}

test("classroom voice stays on Gemini and a missing classroom key prevents starting Live", async () => {
  const calls = [];
  const gemini = {
    live(...args) {
      calls.push(["live", this, ...args]);
      return "session";
    },
    closeLive(...args) {
      calls.push(["close", this, ...args]);
    },
  };
  const config = {
    backend: { apiKey: "test-only", apiKeyName: "OPENAI_API_KEY" },
    live: { provider: "gemini" },
    teacher: { provider: "gemini" },
    transcription: { provider: "gemini" },
  };
  const services = createAIServices(config, { live: gemini });
  assert.equal(services.classroomAI.live("instructions", "context"), "session");
  services.classroomAI.closeLive("session");
  assert.deepEqual(calls, [
    ["live", gemini, "instructions", "context"],
    ["close", gemini, "session"],
  ]);
  config.backend.apiKey = "";
  assert.throws(
    () => services.classroomAI.live("instructions"),
    /OPENAI_API_KEY/,
  );
  assert.equal(calls.length, 2);
});
