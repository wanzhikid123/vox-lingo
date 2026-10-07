import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { PlanBridgeLiveService } from "../server/planbridge-live.js";
import { compactLiveFeedback, runTeacher } from "../server/teacher.js";
import { Store } from "../server/store.js";
import { Classroom } from "../server/classroom.js";
import { mergeTranscript } from "../src/transcripts.js";
import { instructionLanguages, targetLanguages } from "../shared/languages.js";

const offer = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const message = (text) => ({
  type: "message",
  content: [{ type: "output_text", text }],
});

async function gateway(t, options = {}) {
  const calls = [],
    commands = [];
  let socket;
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer fixture-planbridge");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined;
    calls.push({ path: req.url, method: req.method, body });
    const send = (data) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
    };
    if (req.url === "/health") return send({ ok: true });
    if (req.url === "/pb/v1/status")
      return send({
        providers: [
          { provider: "codex-native", login: "ready", permission: "present" },
        ],
      });
    if (req.url === "/pb/v1/capabilities")
      return send({
        capabilities: [{ capability: "live", state: "pending_verification" }],
      });
    if (req.method === "POST") {
      await options.beforeCreate?.();
      res.statusCode = 201;
      return send({
        session: { id: "opaque-session" },
        transport: { sdp: offer },
      });
    }
    return send({ finalized: options.finalized !== false, state: "closed" });
  });
  const ws = new WebSocketServer({ server });
  ws.on("connection", (client, req) => {
    assert.equal(req.url, "/v1/live/sessions/opaque-session/attach");
    assert.equal(req.headers.authorization, "Bearer fixture-planbridge");
    socket = client;
    client.on("message", (raw) => {
      const command = JSON.parse(raw.toString());
      commands.push(command);
      if (options.ack !== false)
        client.send(
          JSON.stringify({
            type: "pb.native_ack",
            native_type: "session.context.appended",
            client_event_id: command.event_id,
            correlation: "gateway_serialized",
            start_ms: 1,
            end_ms: 2,
          }),
        );
    });
    setTimeout(
      () =>
        client.send(
          JSON.stringify({
            type: "session.started",
            session: { id: "opaque-session" },
          }),
        ),
      5,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const client of ws.clients) client.terminate();
    ws.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const service = new PlanBridgeLiveService({
    apiKey: "fixture-planbridge",
    liveModel: "gpt-live-1-codex",
    voice: "juniper",
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
  });
  return {
    service,
    calls,
    commands,
    options,
    get socket() {
      return socket;
    },
  };
}

test("PlanBridge uses the strict create contract, authenticated unique sideband, real IDs and byte limits", async (t) => {
  const mock = await gateway(t),
    events = [];
  const result = await mock.service.live(offer, "Mia", '{"board":"confirmed"}');
  const create = mock.calls.find((call) => call.method === "POST");
  assert.deepEqual(Object.keys(create.body.session).sort(), [
    "audio",
    "delegation",
    "instructions",
    "model",
  ]);
  assert.match(create.body.session.instructions, /Mia/);
  assert.match(create.body.session.instructions, /confirmed/);
  assert.equal(create.body.session.model, "gpt-live-1-codex");
  assert.equal(create.body.session.audio.output.voice, "juniper");
  assert.doesNotMatch(JSON.stringify(result), /fixture-planbridge/);
  const socket = await mock.service.attach(result.session.id, (event) =>
    events.push(event),
  );
  assert.equal(events[0].type, "session.started");
  await assert.rejects(
    mock.service.attach(result.session.id, () => {}),
    /Steuerverbindung/,
  );
  const received = once(socket, "message");
  mock.socket.send(
    JSON.stringify({
      type: "session.delegation.created",
      delegation: { target: "client", id: "real-task" },
    }),
  );
  await received;
  const sent = once(mock.socket, "message");
  await socket.command(
    "session.commentary.append",
    "中文".repeat(80),
    "real-task",
  );
  await sent;
  assert.equal(mock.commands[0].delegation_id, "real-task");
  assert.ok(mock.commands[0].event_id);
  await assert.rejects(
    socket.command("session.commentary.append", "中".repeat(167)),
    /500/,
  );
  await assert.rejects(
    socket.command("session.commentary.append", "Hello", "invented-task"),
    /Delegationsbezug/,
  );
  await assert.rejects(
    socket.command("session.instructions.append", "Hello", "real-task"),
    /Delegationsbezug/,
  );
  assert.deepEqual(await mock.service.closeLive(result.session.id, socket), {
    finalized: true,
  });
  await mock.service.closeLive(result.session.id);
  assert.equal(mock.calls.filter((call) => call.method === "DELETE").length, 1);
});

test("PlanBridge waits for native context confirmation and distinguishes protocol rejection from network failure", async (t) => {
  const mock = await gateway(t, { ack: false }),
    events = [];
  const created = await mock.service.live(offer, "Mia", "{}");
  const socket = await mock.service.attach(created.session.id, (e) =>
    events.push(e),
  );
  let completed = false;
  const received = once(mock.socket, "message");
  const pending = socket
    .command("session.commentary.append", "Confirmed next step.")
    .then(() => {
      completed = true;
    });
  await received;
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    completed,
    false,
    "Local dispatch must not confirm context delivery",
  );
  mock.socket.send(
    JSON.stringify({ type: "pb.native_ack", client_event_id: "unrelated" }),
  );
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(completed, false);
  mock.socket.send(
    JSON.stringify({
      type: "pb.native_ack",
      native_type: "session.context.appended",
      client_event_id: mock.commands[0].event_id,
    }),
  );
  await pending;
  const rejectedSent = once(mock.socket, "message");
  const rejected = socket.command("session.instructions.append", "Slower.");
  const verdict = assert.rejects(rejected, /Vertrag/);
  await rejectedSent;
  mock.socket.send(
    JSON.stringify({
      type: "error",
      error: {
        code: "invalid_parameter",
        native_code: "immutable_field_update",
        message: "private-provider-data",
        client_event_id: mock.commands[1].event_id,
      },
    }),
  );
  await verdict;
  assert.equal(events.at(-1).error.native_code, "immutable_field_update");
  assert.doesNotMatch(
    JSON.stringify(events),
    /private-provider-data|nicht erreichbar/,
  );
  await mock.service.closeLive(created.session.id, socket);
});

test("a create completing after cancellation is closed without an automatic retry", async (t) => {
  let release, entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const mock = await gateway(t, {
    beforeCreate: () => {
      entered();
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  const controller = new AbortController();
  const pending = mock.service.live(offer, "Mia", "state", controller.signal);
  await started;
  controller.abort();
  release();
  await assert.rejects(pending, /beendet/);
  assert.equal(mock.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(mock.calls.filter((call) => call.method === "DELETE").length, 1);
});

test("an unconfirmed close is a failure and a later explicit query can confirm it", async (t) => {
  const mock = await gateway(t, { finalized: false });
  const result = await mock.service.live(offer, "Mia", "state");
  const socket = await mock.service.attach(result.session.id, () => {});
  await assert.rejects(
    mock.service.closeLive(result.session.id, socket),
    /nicht bestätigt/,
  );
  assert.equal(mock.service.closed.size, 0);
  mock.options.finalized = true;
  assert.equal(
    (await mock.service.closeLive(result.session.id)).finalized,
    true,
  );
});

test("short feedback is one bounded message; rewriting cannot execute classroom tools", async (t) => {
  let rewrites = 0;
  const ai = {
    async responses(input, tools, instructions) {
      rewrites++;
      assert.deepEqual(tools, []);
      assert.match(instructions, /UTF-8/);
      assert.ok(JSON.parse(input[0].content).confirmedFeedback);
      return { output: [message("Richtig: cat. Sage jetzt dog.")] };
    },
  };
  assert.equal(await compactLiveFeedback(ai, "Hallo"), "Hallo");
  assert.equal(rewrites, 0);
  assert.equal(
    await compactLiveFeedback(ai, "Ä".repeat(300)),
    "Richtig: cat. Sage jetzt dog.",
  );
  assert.equal(rewrites, 1);
  await assert.rejects(
    compactLiveFeedback(
      { responses: async () => ({ output: [message("中".repeat(167))] }) },
      "X".repeat(501),
    ),
    /zu lang/,
  );
  await assert.rejects(
    compactLiveFeedback(
      {
        responses: async () => ({
          output: [{ type: "function_call" }, message("short")],
        }),
      },
      "X".repeat(501),
    ),
    /zu lang/,
  );
  const store = new Store(":memory:");
  t.after(() => store.close());
  const id = store.create("colors", "short-plan").id;
  await runTeacher({
    store,
    id,
    transcripts: [],
    shortFeedback: true,
    trigger: "next",
    signal: new AbortController().signal,
    ai: {
      responses: async (_input, _tools, instructions) => {
        assert.match(instructions, /350 UTF-8/);
        return { output: [message("Hello")] };
      },
    },
    execute: () => assert.fail("No tools expected"),
  });
});

test("ChatGPTPlus maps delegation prompts exactly once and preserves failed close state for retry", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const id = store.create("colors", "plus-lesson").id;
  const config = { live: { provider: "chatgptplus" } };
  let confirmed = false;
  const classroom = new Classroom(
    store,
    { closeLive: async () => ({ finalized: confirmed }) },
    config,
  );
  const room = classroom.room(id);
  room.remoteId = "real-session";
  room.ready = true;
  room.socket = { readyState: 1 };
  const tasks = [];
  classroom.enqueue = (...args) => tasks.push(args);
  const event = {
    type: "session.delegation.created",
    delegation: { target: "client", id: "task-1" },
  };
  classroom.onEvent(id, event);
  classroom.onEvent(id, {
    type: "pb.delegation.prompt",
    delegation_id: "task-1",
    prompt: "Please repeat colors",
  });
  classroom.onEvent(id, event);
  classroom.onEvent(id, {
    type: "pb.delegation.prompt",
    delegation_id: "invented",
    prompt: "Ignored",
  });
  assert.equal(tasks.length, 1);
  assert.match(tasks[0][1], /Please repeat colors/);
  assert.equal(tasks[0][2], "task-1");
  await assert.rejects(classroom.end(id, "ended_early"), /nicht bestätigt/);
  assert.equal(store.lesson(id).state.liveCloseUnconfirmed, true);
  assert.equal(room.remoteId, "real-session");
  assert.equal(store.lesson(id).state.liveCloseSessionId, "real-session");
  confirmed = true;
  const restarted = new Classroom(
    store,
    {
      closeLive: async (remoteId) => {
        assert.equal(remoteId, "real-session");
        return { finalized: true };
      },
    },
    config,
  );
  await restarted.end(id, "ended_early");
  assert.equal(store.lesson(id).state.liveCloseUnconfirmed, false);
  assert.equal(restarted.room(id).remoteId, null);
  assert.equal(store.lesson(id).state.liveCloseSessionId, null);
});

test("PlanBridge suffix deltas at the same timestamp append and duplicated events stay idempotent", () => {
  const event = {
    type: "session.input_transcript.delta",
    start_ms: 100,
    end_ms: 200,
    event_id: "a",
    delta: "Mon",
  };
  let rows = mergeTranscript([], event, true);
  rows = mergeTranscript(rows, { ...event, event_id: "b", delta: "day" }, true);
  rows = mergeTranscript(rows, event, true);
  assert.equal(rows[0].text, "Monday");
});
test("classroom cancellation waits for a late PlanBridge create and frees its single session", async (t) => {
  let entered, release;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const mock = await gateway(t, {
    beforeCreate: () => {
      entered();
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  const store = new Store(":memory:");
  t.after(() => store.close());
  const id = store.create("colors", "cancelled-classroom").id;
  const classroom = new Classroom(store, mock.service, {
    live: { provider: "chatgptplus" },
  });
  const pending = classroom.connect(id, 3, offer);
  await started;
  const ending = classroom.end(id, "interrupted");
  release();
  await assert.rejects(pending, /beendet/);
  await ending;
  assert.equal(mock.calls.filter((call) => call.method === "DELETE").length, 1);
  assert.equal(store.lesson(id).status, "interrupted");
  assert.equal(store.lesson(id).state.liveCloseUnconfirmed, false);
});
test("a delegation received before browser readiness waits and retains its real task ID", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const id = store.create("colors", "early-delegation").id;
  store.connect(id, "early-session");
  const classroom = new Classroom(
    store,
    {},
    { live: { provider: "chatgptplus" } },
  );
  classroom.send = async () => {};
  const tasks = [];
  classroom.enqueue = (...args) => tasks.push(args);
  classroom.onEvent(id, {
    type: "session.delegation.created",
    delegation: { id: "early-task", target: "client" },
  });
  classroom.onEvent(id, {
    type: "pb.delegation.prompt",
    delegation_id: "early-task",
    prompt: "Start colors",
  });
  assert.equal(tasks.length, 0);
  await classroom.ready(id);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0][2], "early-task");
  assert.match(tasks[0][1], /Start colors/);
});

for (const instructionLanguage of instructionLanguages)
  for (const targetLanguage of targetLanguages)
    test(`ChatGPTPlus ${instructionLanguage}/${targetLanguage}: frozen context, greeting and rewritten feedback obey the gateway contract`, async (t) => {
      const mock = await gateway(t);
      const store = new Store(":memory:");
      t.after(() => store.close());
      const languages = { instructionLanguage, targetLanguage };
      const id = store.create("colors", "language-live", null, languages).id;
      let rewrittenInstructions;
      const classroom = new Classroom(
        store,
        {
          live: (...args) => mock.service.live(...args),
          attach: (...args) => mock.service.attach(...args),
          closeLive: (...args) => mock.service.closeLive(...args),
          responses: async (_input, tools, instructions) => {
            assert.deepEqual(tools, []);
            rewrittenInstructions = instructions;
            return { output: [message("バス，答对了。继续看图。")] };
          },
        },
        { live: { provider: "chatgptplus" } },
      );
      classroom.enqueue = () => {};
      classroom.prepared.warm = () => {};
      await classroom.connect(id, 3, offer);
      const create = mock.calls.find((call) => call.method === "POST");
      assert.match(
        create.body.session.instructions,
        new RegExp(`instructionLanguage=${instructionLanguage}`),
      );
      assert.match(
        create.body.session.instructions,
        new RegExp(`targetLanguage=${targetLanguage}`),
      );
      assert.match(
        create.body.session.instructions,
        /never translate or invent/,
      );
      await classroom.ready(id);
      // ready dispatches its greeting asynchronously; wait for both real acks.
      for (
        let attempt = 0;
        mock.commands.length < 2 && attempt < 100;
        attempt++
      )
        await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(mock.commands.length, 2);
      assert.match(
        mock.commands[0].content,
        new RegExp(`Instruction language: ${instructionLanguage}`),
      );
      assert.match(
        mock.commands[0].content,
        new RegExp(`target language: ${targetLanguage}`),
      );
      assert.ok(
        mock.commands.every(
          (command) => Buffer.byteLength(command.content) <= 500,
        ),
      );
      await classroom.send(
        id,
        "session.commentary.append",
        "长反馈".repeat(80),
      );
      assert.match(
        rewrittenInstructions,
        new RegExp(`instructionLanguage=${instructionLanguage}`),
      );
      assert.match(
        rewrittenInstructions,
        new RegExp(`targetLanguage=${targetLanguage}`),
      );
      assert.equal(mock.commands.at(-1).content, "バス，答对了。继续看图。");
      await classroom.closeConnection(id);
      assert.equal(store.lesson(id).state.liveCloseUnconfirmed, false);
    });
