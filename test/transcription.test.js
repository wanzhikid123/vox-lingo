import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "../server/app.js";
import { MAX_AUDIO_BYTES } from "../shared/transcription.js";

test("audio route validates language, type, size and origin without saving a preparation message", async (t) => {
  const calls = [];
  const ai = {
    async transcribe(...args) {
      calls.push(args);
      return { text: "Hello" };
    },
  };
  const server = createServer(
    createApp({ config: { port: 3210, dataDir: ".cache" }, ai }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${server.address().port}/api/preparation/transcribe`;
  const send = (
    body,
    language = "auto",
    type = "audio/webm;codecs=opus",
    headers = {},
  ) =>
    fetch(`${url}?language=${language}`, {
      method: "POST",
      body,
      headers: { "Content-Type": type, ...headers },
    });
  const response = await send(Buffer.from("audio"), "cn");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { text: "Hello" });
  assert.deepEqual(calls[0].slice(0, 3), [
    Buffer.from("audio"),
    "audio/webm",
    "zh",
  ]);
  for (const [body, language, type, expected] of [
    ["audio", "fr", "audio/webm", 400],
    ["audio", "auto", "application/octet-stream", 415],
    ["", "auto", "audio/webm", 400],
    [Buffer.alloc(MAX_AUDIO_BYTES + 1), "auto", "audio/webm", 413],
  ]) {
    assert.equal((await send(body, language, type)).status, expected);
  }
  assert.equal(
    (
      await send("audio", "auto", "audio/webm", {
        Origin: "https://other.example",
      })
    ).status,
    403,
  );
  assert.equal(calls.length, 1);
  for (const type of ["audio/mp4", "audio/wav", "audio/mpeg"]) {
    assert.equal((await send("audio", "en", type)).status, 200);
    assert.equal(calls.at(-1)[1], type);
  }
});

test("disconnecting a transcription upload cancels the provider request", async (t) => {
  let started, cancelled;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const aborted = new Promise((resolve) => {
    cancelled = resolve;
  });
  const ai = {
    transcribe(_audio, _type, _language, signal) {
      started();
      return new Promise((resolve) =>
        signal.addEventListener(
          "abort",
          () => {
            cancelled();
            resolve({ text: "" });
          },
          { once: true },
        ),
      );
    },
  };
  const server = createServer(
    createApp({ config: { port: 3210, dataDir: ".cache" }, ai }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const controller = new AbortController();
  const response = fetch(
    `http://127.0.0.1:${server.address().port}/api/preparation/transcribe`,
    {
      method: "POST",
      headers: { "Content-Type": "audio/webm" },
      body: "audio",
      signal: controller.signal,
    },
  ).catch(() => {});
  await ready;
  controller.abort();
  await response;
  await aborted;
});
