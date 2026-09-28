import test from "node:test";
import assert from "node:assert/strict";
import { ResponsesService } from "../server/responses.js";
import { runTeacher, teacherTools } from "../server/teacher.js";
import { Store } from "../server/store.js";

const configFor = (provider) => ({
  provider,
  model: provider === "openai" ? "gpt-6-luna" : "deepseek-flash",
  baseUrl:
    provider === "openai"
      ? "https://api.openai.com/v1"
      : "https://api.deepseek.com",
  reasoningEffort: "low",
  apiKeyName: `${provider.toUpperCase()}_API_KEY`,
  apiKey: `${provider}-test-only`,
});
const message = {
  type: "message",
  role: "assistant",
  content: [{ type: "output_text", text: "Jetzt bus nachsprechen." }],
};
const completed = (output) => Response.json({ status: "completed", output });

for (const provider of ["openai", "deepseek"]) {
  test(`${provider} classroom tool loop uses Responses and preserves reasoning and matched tool results`, async (t) => {
    const config = configFor(provider);
    const store = new Store(":memory:");
    t.after(() => store.close());
    const id = store.create("colors", "response-test").id;
    const reasoning =
      provider === "openai"
        ? {
            type: "reasoning",
            id: "rs-test",
            summary: [],
            encrypted_content: "opaque-test-context",
          }
        : {
            type: "reasoning",
            id: "rs-test",
            content: [{ type: "reasoning_text", text: "private-test-context" }],
          };
    const call = {
      type: "function_call",
      call_id: "call-test",
      name: "search_emoji",
      arguments: '{"query":"bus"}',
    };
    const requests = [];
    const ai = new ResponsesService(config, async (url, options) => {
      assert.equal(url, `${config.baseUrl}/responses`);
      assert.equal(options.headers.Authorization, `Bearer ${config.apiKey}`);
      assert.equal(options.method, "POST");
      const body = JSON.parse(options.body);
      assert.equal(body.model, config.model);
      assert.deepEqual(body.reasoning, { effort: "low" });
      assert.equal(body.store, false);
      assert.deepEqual(body.tools, teacherTools);
      assert.equal(body.previous_response_id, undefined);
      assert.equal(
        body.include?.[0],
        provider === "openai" ? "reasoning.encrypted_content" : undefined,
      );
      requests.push(body);
      return completed(requests.length === 1 ? [reasoning, call] : [message]);
    });
    const executions = [];
    const answer = await runTeacher({
      store,
      ai,
      id,
      trigger: "Plan a step",
      transcripts: [],
      signal: new AbortController().signal,
      execute: async (...args) => {
        executions.push(args);
        return { ok: true, emoji: "🚌" };
      },
    });
    assert.equal(answer, "Jetzt bus nachsprechen.");
    assert.deepEqual(executions, [
      ["search_emoji", { query: "bus" }, "call-test"],
    ]);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].input.slice(1, 3), [reasoning, call]);
    assert.deepEqual(requests[1].input[3], {
      type: "function_call_output",
      call_id: "call-test",
      output: JSON.stringify({ ok: true, emoji: "🚌" }),
    });
    assert.doesNotMatch(
      JSON.stringify(store.results(id)),
      /private-test-context|opaque-test-context/,
    );
  });
}

test("missing key fails before any network request; provider errors do not leak upstream content", async () => {
  let calls = 0;
  const ai = new ResponsesService(
    { ...configFor("deepseek"), apiKey: "" },
    async () => {
      calls++;
    },
  );
  await assert.rejects(
    ai.responses([], [], "test"),
    (e) => e.status === 503 && /DEEPSEEK_API_KEY/.test(e.message),
  );
  assert.equal(calls, 0);
  for (const status of [400, 401, 402, 403, 404, 429, 500]) {
    const failing = new ResponsesService(configFor("deepseek"), async () => {
      calls++;
      return Response.json(
        { error: { message: "private-prompt-and-secret" } },
        { status },
      );
    });
    await assert.rejects(failing.responses([], [], "test"), (e) => {
      assert.equal(e.status, 502);
      assert.doesNotMatch(e.message, /private-prompt-and-secret/);
      return true;
    });
  }
  assert.equal(calls, 7); // Exactly one request per error: no retries or fallback.
});

test("incomplete and malformed responses cannot execute partial classroom tools", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const id = store.create("colors", "incomplete").id;
  let executions = 0;
  for (const payload of [
    {
      status: "incomplete",
      output: [
        { type: "function_call", name: "finish_lesson", arguments: "{}" },
      ],
    },
    { status: "failed", output: [message] },
    { status: "completed", output: [] },
    { status: "completed", output: "invalid" },
  ]) {
    const ai = new ResponsesService(configFor("openai"), async () =>
      Response.json(payload),
    );
    await assert.rejects(
      runTeacher({
        store,
        ai,
        id,
        trigger: "test",
        transcripts: [],
        signal: new AbortController().signal,
        execute: async () => {
          executions++;
        },
      }),
      /vollständige/,
    );
  }
  assert.equal(executions, 0);
});

test("cancellation aborts HTTP and discards a response that arrives after cancellation", async () => {
  for (const lateResponse of [false, true]) {
    const controller = new AbortController();
    let signal;
    const ai = new ResponsesService(
      configFor("openai"),
      async (_url, options) => {
        signal = options.signal;
        controller.abort();
        if (!lateResponse) signal.throwIfAborted();
        return completed([message]);
      },
    );
    await assert.rejects(
      ai.responses([], [], "test", controller.signal),
      (e) => e.status === 409,
    );
    assert.equal(signal.aborted, true);
  }
});
