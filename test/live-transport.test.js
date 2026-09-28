import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import WebSocket from "ws";
import { GeminiLiveSession } from "../server/gemini-live.js";
import { attachLiveTransport } from "../server/live-transport.js";
import { Store } from "../server/store.js";
import { Classroom } from "../server/classroom.js";
import { GeminiService } from "../server/gemini.js";
import { runTeacher } from "../server/teacher.js";

function provider() {
  const sent = [],
    audio = [],
    text = [];
  const session = {
    close() {},
    sendToolResponse: (value) => sent.push(value),
    sendRealtimeInput: (value) => audio.push(value),
    sendClientContent: (value) => text.push(value),
  };
  const client = {
    live: {
      async connect(options) {
        client.options = options;
        queueMicrotask(() =>
          options.callbacks.onmessage({ setupComplete: {} }),
        );
        return session;
      },
    },
  };
  return { client, session, sent, audio, text };
}
const config = {
  apiKey: "fixture-key",
  liveModel: "gemini-3.8-live",
  voice: "Kore",
};

test("Live maps audio, incremental captions, cancellation and exact tool IDs without allowing direct score tools", async () => {
  const mock = provider(),
    events = [];
  const live = new GeminiLiveSession(mock.client, config, (e) =>
    events.push(e),
  );
  await live.connect("Mia", "confirmed state", new AbortController().signal);
  assert.equal(
    mock.client.options.config.tools[0].functionDeclarations.length,
    1,
  );
  assert.equal(
    mock.client.options.config.tools[0].functionDeclarations[0].name,
    "request_teaching_plan",
  );
  live.audio(Buffer.from([0, 1]));
  assert.equal(mock.audio[0].audio.mimeType, "audio/pcm;rate=16000");
  const message = {
    toolCall: {
      functionCalls: [
        {
          id: "tool-7",
          name: "request_teaching_plan",
          args: { reason: "answer" },
        },
      ],
    },
  };
  live.receive(message);
  live.receive(message);
  assert.equal(
    events.filter((e) => e.type === "session.delegation.created").length,
    1,
  );
  live.command("session.commentary.append", "Tafel sichtbar: Katze", "tool-7");
  assert.equal(mock.sent[0].functionResponses[0].id, "tool-7");
  assert.equal(
    mock.sent[0].functionResponses[0].response.scheduling,
    "INTERRUPT",
  );
  live.receive({ serverContent: { inputTranscription: { text: "Tu" } } });
  live.receive({
    serverContent: {
      inputTranscription: { text: "esday" },
      modelTurn: { parts: [{ inlineData: { data: "AAA=" } }] },
    },
  });
  assert.equal(
    events
      .filter((e) => e.type === "session.input_transcript.delta")
      .map((e) => e.delta)
      .join(""),
    "Tuesday",
  );
  assert.equal(
    events.filter((e) => e.type === "audio.chunk").length,
    0,
    "unconfirmed speech stays off the speaker",
  );
  live.command(
    "session.commentary.append",
    "Bestätigte Antwort: Tuesday",
    null,
  );
  live.receive({
    serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAA=" } }] } },
  });
  assert.equal(live.playbackDrained, false);
  live.receive({ serverContent: { turnComplete: true } });
  assert.equal(live.generationComplete, true);
  assert.equal(
    live.playbackDrained,
    false,
    "generation completion is not audible completion",
  );
  live.receive({
    toolCall: {
      functionCalls: [
        { id: "old", name: "request_teaching_plan", args: { reason: "next" } },
      ],
    },
  });
  live.receive({
    toolCallCancellation: { ids: ["old"] },
    serverContent: { interrupted: true },
  });
  live.command("session.commentary.append", "obsolete", "old");
  assert.equal(mock.sent.length, 1);
  assert.equal(events.at(-1).type, "planning.cancelled");
  assert.equal(live.epoch, 1);
  live.close();
});

test("aborting Live setup closes a session which arrives after cancellation", async () => {
  let deliver,
    closed = 0;
  const client = {
    live: {
      connect: () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    },
  };
  const live = new GeminiLiveSession(client, config, () => {});
  const controller = new AbortController();
  const pending = live.connect("Mia", "state", controller.signal);
  controller.abort();
  await assert.rejects(pending, /beendet/);
  deliver({
    close() {
      closed++;
    },
  });
  await Promise.resolve();
  assert.equal(closed, 1);
});

test("local media socket rejects foreign origins, expired/reused tickets and relays PCM with playback acknowledgement", async (t) => {
  const received = [];
  let disconnected = 0;
  const room = {
    id: "lesson",
    mediaTicket: "single-use",
    mediaTicketExpires: Date.now() + 10000,
    socket: {
      readyState: 1,
      epoch: 2,
      playbackDrained: false,
      audio: (data) => received.push(data),
      audioEnd() {},
    },
  };
  const classroom = {
    rooms: new Map([["lesson", room]]),
    disconnect: async () => {
      disconnected++;
    },
    audioActivity() {},
  };
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const transport = attachLiveTransport(server, classroom, { port });
  t.after(() => {
    transport.close();
    server.close();
  });
  const url = `ws://127.0.0.1:${port}/api/lessons/lesson/audio?ticket=single-use`;
  const bad = new WebSocket(url, { origin: "https://foreign.example" });
  const [error] = await once(bad, "error");
  assert.match(error.message, /403/);
  const ws = new WebSocket(url, { origin: `http://127.0.0.1:${port}` });
  const first = once(ws, "message");
  await once(ws, "open");
  assert.equal(JSON.parse((await first)[0]).type, "session.started");
  assert.equal(room.mediaTicket, null);
  ws.send(Buffer.from([0, 1, 0, 2]));
  ws.send(JSON.stringify({ type: "playback.drained", epoch: 1 }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(received, [Buffer.from([0, 1, 0, 2])]);
  assert.equal(room.socket.playbackDrained, false);
  ws.send(JSON.stringify({ type: "playback.drained", epoch: 2 }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(room.socket.playbackDrained, true);
  const replay = new WebSocket(url, { origin: `http://127.0.0.1:${port}` });
  assert.match((await once(replay, "error"))[0].message, /403/);
  ws.close();
  await once(ws, "close");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(disconnected, 1);
  room.media = null;
  room.mediaTicket = "single-use";
  room.mediaTicketExpires = 0;
  const expired = new WebSocket(url, { origin: `http://127.0.0.1:${port}` });
  assert.match((await once(expired, "error"))[0].message, /403/);
});

test("classroom returns only a local ticket, aborts stale planning, and preserves state when reconnecting", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const mock = provider();
  const classroom = new Classroom(
    store,
    new GeminiService(config, mock.client),
    config,
  );
  const id = store.create("colors", "gemini-connect").id;
  const connection = await classroom.connect(id, 3);
  assert.match(connection.audioUrl, /\/audio\?ticket=/);
  assert.doesNotMatch(JSON.stringify(connection), /fixture-key|googleapis/);
  await assert.rejects(classroom.connect(id, 3), /bereits verbunden/);
  const room = classroom.room(id);
  room.ready = true;
  let requestStarted;
  const started = new Promise((resolve) => {
    requestStarted = resolve;
  });
  classroom.prepared.run = async ({ signal }) => {
    requestStarted();
    await new Promise((resolve) =>
      signal.addEventListener("abort", resolve, { once: true }),
    );
    return "obsolete";
  };
  classroom.enqueue(id, "slow request");
  await started;
  classroom.audioActivity(id);
  await room.queue;
  assert.equal(mock.text.length, 0);
  const before = structuredClone(store.lesson(id).state);
  await classroom.disconnect(id);
  if (room.ending) await room.ending;
  await classroom.connect(id, 3);
  assert.equal(store.lesson(id).state.revision, before.revision);
  assert.equal(store.results(id).attempts.length, 0);
  await classroom.disconnect(id);
  if (room.ending) await room.ending;
});

test("repeated backend tool IDs reuse their result without executing a second board change", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const id = store.create("colors", "dedup-tool").id;
  let round = 0,
    executions = 0;
  const call = {
    type: "function_call",
    call_id: "same",
    name: "patch_board",
    arguments: "{}",
  };
  await runTeacher({
    store,
    id,
    trigger: "test",
    transcripts: [],
    signal: new AbortController().signal,
    ai: {
      responses: async () => ({
        output:
          ++round < 3
            ? [call]
            : [
                {
                  type: "message",
                  content: [{ type: "output_text", text: "done" }],
                },
              ],
      }),
    },
    execute: async () => {
      executions++;
      return { ok: true };
    },
  });
  assert.equal(executions, 1);
});
