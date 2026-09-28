import test from "node:test";
import assert from "node:assert/strict";
import { GeminiService } from "../server/gemini.js";
import { teacherTools } from "../server/teacher.js";
const config = {
  apiKey: "fixture-only-key",
  teacherModel: "gemini-3.5-flash-lite",
  teacherThinkingLevel: "medium",
  transcriptionModel: "gemini-3.5-transcribe",
};

test("real Google SDK preserves signed parallel function parts and ordered tool results on the wire", async (t) => {
  const requests = [];
  const signed = {
    role: "model",
    parts: [
      {
        text: "private reasoning",
        thought: true,
        thoughtSignature: "opaque-thought",
      },
      {
        functionCall: {
          id: "call-a",
          name: "search_emoji",
          args: { query: "cat" },
        },
        thoughtSignature: "opaque-signature",
      },
      {
        functionCall: {
          id: "call-b",
          name: "search_emoji",
          args: { query: "dog" },
        },
      },
    ],
  };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const request = new Request(url, options);
    assert.match(
      request.url,
      /generativelanguage.googleapis.com\/v1beta\/models\/gemini-3.5-flash-lite:generateContent/,
    );
    assert.equal(request.headers.get("x-goog-api-key"), config.apiKey);
    requests.push(await request.json());
    return Response.json({
      candidates: [
        {
          content:
            requests.length === 1
              ? signed
              : { role: "model", parts: [{ text: "Katze" }] },
          finishReason: "STOP",
        },
      ],
    });
  });
  const ai = new GeminiService(config);
  const input = [{ role: "user", content: "请准备猫的英语课" }];
  const first = await ai.responses(input, teacherTools, "System");
  assert.equal(
    first.output.filter((p) => p.type === "function_call").length,
    2,
  );
  assert.equal(first.output.filter((p) => p.type === "message").length, 0);
  input.push(
    ...first.output,
    { type: "function_call_output", call_id: "call-a", output: '{"ok":true}' },
    {
      type: "function_call_output",
      call_id: "call-b",
      output: '{"ok":false,"error":"Retry with valid parameters"}',
    },
  );
  const second = await ai.responses(input, teacherTools, "System");
  assert.deepEqual(requests[1].contents[1], signed);
  assert.deepEqual(
    requests[1].contents[2].parts.map((p) => p.functionResponse.id),
    ["call-a", "call-b"],
  );
  assert.equal(
    requests[1].contents[2].parts[1].functionResponse.response.ok,
    false,
  );
  assert.equal(
    requests[0].generationConfig.thinkingConfig.thinkingLevel,
    "MEDIUM",
  );
  assert.equal(requests[0].tools[0].functionDeclarations[0].strict, undefined);
  assert.equal(
    second.output.find((p) => p.type === "message").content[0].text,
    "Katze",
  );
});

test("Transcribe uses inline bytes, verbatim mode, language hints and no retained interaction", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const request = new Request(url, options);
    assert.match(request.url, /\/v1beta\/interactions/);
    const body = await request.json();
    requests.push(body);
    assert.equal(body.store, false);
    assert.equal(body.model, config.transcriptionModel);
    assert.equal(body.input[0].uri, undefined);
    assert.deepEqual(
      Buffer.from(body.input[0].data, "base64"),
      Buffer.from([26, 69, 223, 163]),
    );
    return Response.json({
      id: "fixture",
      status: "completed",
      outputs: [{ type: "text", text: " 请复习 red und blue。 " }],
    });
  });
  const ai = new GeminiService(config);
  for (const [language, expected] of [
    ["auto", []],
    ["zh", ["zh-CN"]],
    ["de", ["de-DE"]],
    ["en", ["en-US"]],
  ]) {
    assert.deepEqual(
      await ai.transcribe(
        Buffer.from([26, 69, 223, 163]),
        "audio/webm",
        language,
      ),
      { text: "请复习 red und blue。" },
    );
    assert.deepEqual(requests.at(-1).generation_config.transcription_config, {
      language_codes: expected,
      mode: { type: "verbatim" },
    });
  }
});

test("empty or rejected provider responses never expose credentials or raw bodies", async (t) => {
  const ai = new GeminiService(config);
  const mock = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ outputs: [{ type: "text", text: " " }] }),
  );
  await assert.rejects(
    ai.transcribe(Buffer.from("a"), "audio/wav", "auto"),
    /Keine Sprache/,
  );
  mock.mock.mockImplementation(async () =>
    Response.json(
      { error: { message: "private fixture-only-key", code: 429 } },
      { status: 429 },
    ),
  );
  await assert.rejects(
    ai.transcribe(Buffer.from("a"), "audio/wav", "auto"),
    (e) =>
      /API-Limit/.test(e.message) &&
      !/private|fixture-only-key/.test(e.message),
  );
  mock.mock.mockImplementation(async () =>
    Response.json({
      candidates: [
        {
          finishReason: "MAX_TOKENS",
          content: {
            parts: [{ functionCall: { name: "patch_board", args: {} } }],
          },
        },
      ],
    }),
  );
  await assert.rejects(
    ai.responses([{ role: "user", content: "hi" }], [], "test"),
    /vollständige/,
  );
});

test("cancelling an SDK transcription cancels its HTTP request and discards late text", async (t) => {
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const request = new Request(url, options);
    started();
    return new Promise((resolve, reject) => {
      request.signal.addEventListener(
        "abort",
        () => reject(request.signal.reason),
        { once: true },
      );
    });
  });
  const controller = new AbortController();
  const result = new GeminiService(config).transcribe(
    Buffer.from("a"),
    "audio/wav",
    "auto",
    controller.signal,
  );
  const rejected = assert.rejects(result, /beendet/);
  await ready;
  controller.abort();
  await rejected;
});
