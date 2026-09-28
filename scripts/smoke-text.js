import assert from "node:assert/strict";
import { loadConfig } from "../server/config.js";
import { createAIServices } from "../server/ai.js";

// Explicit opt-in: real, billable text requests using only artificial test data.
// --all checks every configured text provider, reporting missing keys as skipped.
const all = process.argv.includes("--all");
const cases = all
  ? [
      ["backend", "openai"],
      ["backend", "deepseek"],
      ["teacher", "openai"],
      ["teacher", "gemini"],
      ["teacher", "deepseek"],
    ]
  : [["backend"], ["teacher"]];
const tools = [
  {
    type: "function",
    name: "echo_test",
    description: "Return a synthetic test value.",
    strict: true,
    parameters: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
  },
];
for (const [role, provider] of cases) {
  const config = loadConfig({
    ...process.env,
    ...(provider ? { [`${role.toUpperCase()}_MODEL_PROVIDER`]: provider } : {}),
  });
  const selected = config[role];
  const summary = {
    role,
    provider: selected.provider,
    model: selected.model,
    reasoning: selected.reasoningEffort,
    serviceTier: selected.serviceTier,
  };
  if (!selected.apiKey) {
    console.log(
      JSON.stringify({
        ...summary,
        status: "skipped",
        reason: `missing ${selected.apiKeyName}`,
      }),
    );
    continue;
  }
  const services = createAIServices(config);
  const ai = role === "backend" ? services.backend : services.teacherAI;
  const input = [
    {
      role: "user",
      content:
        'Call echo_test exactly once with value "synthetic-ok". After receiving the tool result, reply with just OK.',
    },
  ];
  try {
    const first = await ai.responses(
      input,
      tools,
      "Follow the test instruction. This is synthetic integration test data.",
    );
    const calls = first.output.filter((item) => item.type === "function_call");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "echo_test");
    assert.equal(JSON.parse(calls[0].arguments).value, "synthetic-ok");
    input.push(...first.output, {
      type: "function_call_output",
      call_id: calls[0].call_id,
      output: JSON.stringify({ value: "synthetic-ok" }),
    });
    const second = await ai.responses(
      input,
      tools,
      "The tool has completed. Reply with just OK.",
    );
    assert.equal(
      second.output.filter((item) => item.type === "function_call").length,
      0,
    );
    assert.ok(
      second.output.some(
        (item) =>
          item.type === "message" &&
          item.content?.some((part) => part.text?.includes("OK")),
      ),
    );
    console.log(
      JSON.stringify({ ...summary, status: "passed", toolRounds: 2 }),
    );
  } catch (error) {
    // Upstream payloads and model output are deliberately omitted.
    console.log(
      JSON.stringify({
        ...summary,
        status: "failed",
        error: error.status
          ? `provider status ${error.status}`
          : "tool round-trip validation failed",
      }),
    );
    process.exitCode = 1;
  }
}
