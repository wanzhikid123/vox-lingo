import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../server/config.js";
import { createAIServices } from "../server/ai.js";
import { Store } from "../server/store.js";
import { Classroom } from "../server/classroom.js";
import { Preparation } from "../server/preparation.js";
import { LessonPlans } from "../server/lesson-plans.js";

const configFor = (env = {}) =>
  loadConfig({
    OPENAI_API_KEY: "test-openai",
    GEMINI_API_KEY: "test-gemini",
    DEEPSEEK_API_KEY: "test-deepseek",
    ...env,
  });
const message = {
  type: "message",
  role: "assistant",
  content: [{ type: "output_text", text: "Alles bereit." }],
};
const complete = (output) => Response.json({ status: "completed", output });
for (const provider of ["openai", "deepseek"]) {
  test(`${provider} Teacher saves a topic and generates a plan independently of the classroom provider`, async (t) => {
    const config = configFor({
      TEACHER_MODEL_PROVIDER: provider,
      OPENAI_TEACHER_SERVICE_TIER: "fast",
      BACKEND_MODEL_PROVIDER: provider === "openai" ? "deepseek" : "openai",
    });
    const store = new Store(":memory:");
    t.after(() => store.close());
    const topic = {
      ...store.topic("animals"),
      teachingNotes: "Kurze Tierwörter üben.",
    };
    delete topic.revision;
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
    const requests = [];
    t.mock.method(globalThis, "fetch", async (url, options) => {
      assert.equal(url, config.teacher.baseUrl + "/responses");
      assert.equal(options.headers.Authorization, `Bearer test-${provider}`);
      const body = JSON.parse(options.body);
      requests.push(body);
      assert.equal(body.model, config.teacher.model);
      assert.equal(body.reasoning.effort, "high");
      assert.equal(
        body.service_tier,
        provider === "openai" ? "auto" : undefined,
      );
      if (body.tools.some((tool) => tool.name === "save_lesson_plan"))
        return complete([
          {
            type: "function_call",
            name: "save_lesson_plan",
            call_id: "plan",
            arguments: JSON.stringify(plan),
          },
        ]);
      if (body.input.some((item) => item.type === "function_call_output")) {
        assert.equal(
          body.input.find((item) => item.type === "function_call_output")
            .call_id,
          "topic",
        );
        return complete([message]);
      }
      return complete([
        {
          type: "function_call",
          name: "save_topic",
          call_id: "topic",
          arguments: JSON.stringify({ topic, expectedRevision: 1 }),
        },
      ]);
    });
    const { teacherAI } = createAIServices(config);
    await new Preparation(store, teacherAI).chat({
      eventId: "new-topic",
      message: "Kurze Tierwörter üben",
      topicId: "animals",
      lessonId: null,
    });
    assert.equal(store.topic("animals").teachingNotes, topic.teachingNotes);
    const generated = await new LessonPlans(store, teacherAI, config).generate(
      store.topic("animals"),
      [],
      [],
      new AbortController().signal,
    );
    assert.deepEqual(generated, plan);
    assert.equal(requests.length, 3);
  });
}
test("OpenAI transcription and fast classroom use their own configuration with Gemini Live and Teacher", async (t) => {
  const config = configFor({
    LIVE_MODEL_PROVIDER: "gemini",
    TEACHER_MODEL_PROVIDER: "gemini",
    BACKEND_MODEL_PROVIDER: "openai",
    TRANSCRIPTION_MODEL_PROVIDER: "openai",
    OPENAI_BACKEND_SERVICE_TIER: "fast",
  });
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push(url);
    assert.equal(options.headers.Authorization, "Bearer test-openai");
    if (url.endsWith("/audio/transcriptions")) {
      assert.ok(options.body instanceof FormData);
      assert.equal(options.body.get("model"), "gpt-transcribe");
      assert.equal(options.body.get("language"), "de");
      return Response.json({ text: "Hallo" });
    }
    const body = JSON.parse(options.body);
    assert.equal(body.service_tier, "fast");
    assert.equal(body.reasoning.effort, "low");
    return complete([message]);
  });
  const services = createAIServices(config);
  assert.equal(
    (
      await services.transcriptionAI.transcribe(
        Buffer.from("test"),
        "audio/webm",
        "de",
      )
    ).text,
    "Hallo",
  );
  await services.classroomAI.responses([], [], "Test");
  assert.equal(requests.length, 2);
  assert.equal(services.teacherAI.config.apiKey, "test-gemini");
});
test("Gemini transcription is independently routed through Interactions", async (t) => {
  const services = createAIServices(
    configFor({ TRANSCRIPTION_MODEL_PROVIDER: "gemini" }),
  );
  const ai = services.transcriptionAI;
  ai.client = {
    interactions: {
      create: async (body) => {
        assert.equal(body.model, "gemini-3.5-transcribe");
        assert.equal(body.store, false);
        assert.deepEqual(
          body.generation_config.transcription_config.language_codes,
          ["en-US"],
        );
        return { output_text: "cat" };
      },
    },
  };
  assert.equal(ai.config.apiKey, "test-gemini");
  assert.equal(
    (await ai.transcribe(Buffer.from("test"), "audio/webm", "en")).text,
    "cat",
  );
});
test("OpenAI Live connects with SDP, acknowledges instructions and closes without waiting for Gemini playback", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const lesson = store.create("colors", "openai-live");
  const config = configFor();
  let onEvent,
    closed = 0;
  const sent = [];
  const socket = {
    readyState: 1,
    send(raw) {
      const event = JSON.parse(raw);
      sent.push(event);
      queueMicrotask(() =>
        onEvent({
          type: "session.instructions.appended",
          client_event_id: event.event_id,
        }),
      );
    },
  };
  const services = createAIServices(config, {
    live: {
      async live(sdp, instructions, context) {
        assert.equal(sdp, "browser-offer");
        assert.match(instructions, /Mia/);
        assert.ok(JSON.parse(context));
        return {
          session: { id: "live_test" },
          transport: { sdp: "server-answer" },
        };
      },
      async attach(id, receive) {
        assert.equal(id, "live_test");
        onEvent = receive;
        return socket;
      },
      async closeLive() {
        closed++;
      },
    },
  });
  services.classroomAI.responses = async () => ({ output: [message] });
  const classroom = new Classroom(store, services.classroomAI, config);
  assert.deepEqual(await classroom.connect(lesson.id, 2, "browser-offer"), {
    sdp: "server-answer",
  });
  assert.equal(classroom.room(lesson.id).mediaTicket, undefined);
  await classroom.send(
    lesson.id,
    "session.instructions.append",
    "Sprich langsam",
  );
  assert.equal(sent.length, 1);
  assert.equal(classroom.room(lesson.id).pending.size, 0);
  await assert.rejects(
    classroom.connect(lesson.id, 2, "second"),
    /bereits verbunden/,
  );
  t.mock.timers.enable({ apis: ["setTimeout"] });
  classroom.room(lesson.id).ready = true;
  classroom.scheduleGoodbye(lesson.id);
  t.mock.timers.tick(3000);
  await classroom.room(lesson.id).ending;
  assert.equal(store.lesson(lesson.id).status, "ended_early");
  assert.equal(closed, 1);
});
test("a missing backend key prevents either Live provider from allocating a remote session", () => {
  for (const provider of ["openai", "gemini"]) {
    const config = configFor({
      LIVE_MODEL_PROVIDER: provider,
      BACKEND_MODEL_PROVIDER: "deepseek",
    });
    config.backend.apiKey = "";
    const services = createAIServices(config, {
      live: {
        live() {
          assert.fail("Must not start Live");
        },
      },
    });
    assert.throws(() => services.classroomAI.live("test"), /DEEPSEEK_API_KEY/);
  }
});
