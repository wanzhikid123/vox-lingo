import { test, expect } from "@playwright/test";
import { fakeMedia as fakeOpenAIMedia } from "./fake-openai-media.js";

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
  permissions: ["microphone"],
});

test("OpenAI provider selects WebRTC, sends SDP, displays transcripts and releases media", async ({
  page,
  request,
}) => {
  await request.post("/fixture/media-lesson");
  await page.addInitScript(fakeOpenAIMedia);
  await page.route("**/api/health", async (route) => {
    const health = await (await route.fetch()).json();
    await route.fulfill({
      json: {
        ...health,
        live: {
          ...health.live,
          provider: "openai",
          model: "gpt-live-1",
          voice: "marin",
        },
      },
    });
  });
  let offered = false;
  await page.route("**/api/lessons/*/connect", async (route) => {
    expect(route.request().postDataJSON().sdp).toBe(
      "fixture-offer-long-enough",
    );
    offered = true;
    await route.fetch();
    await route.fulfill({ json: { sdp: "fixture-answer" } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Stunde öffnen" }).click();
  await page.getByRole("button", { name: "Erneut verbinden" }).click();
  await expect(page.locator(".connection")).toHaveText("Verbunden");
  expect(offered).toBe(true);
  await page.evaluate(() =>
    window.fixtureTranscript("teacher", "Hello from OpenAI", 3),
  );
  await expect(
    page.getByText("Hello from OpenAI", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stumm", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Mikrofon an", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Beenden", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.fixtureMedia.peerClosed))
    .toBe(1);
  await expect
    .poll(() => page.evaluate(() => window.fixtureMedia.stopped))
    .toBe(1);
  await expect
    .poll(() => page.evaluate(() => window.fixtureMedia.audioClosed))
    .toBe(1);
});

test("real AudioWorklet and local WebSocket capture PCM, drain playback, interrupt and release microphone", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const NativeContext = window.AudioContext;
    window.mediaProbe = {
      contexts: [],
      streams: [],
      stoppedSources: 0,
      sources: 0,
    };
    window.AudioContext = class extends NativeContext {
      constructor(...args) {
        super(...args);
        window.mediaProbe.contexts.push(this);
      }
      createBufferSource() {
        const source = super.createBufferSource();
        window.mediaProbe.sources++;
        const stop = source.stop.bind(source);
        source.stop = (...args) => {
          window.mediaProbe.stoppedSources++;
          return stop(...args);
        };
        return source;
      }
    };
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await getUserMedia(...args);
      window.mediaProbe.streams.push(stream);
      return stream;
    };
  });
  const lesson = await (await request.post("/fixture/media-lesson")).json();
  await page.goto("/");
  await page.getByRole("button", { name: "Stunde öffnen" }).click();
  await page.getByRole("button", { name: "Erneut verbinden" }).click();
  await expect(page.locator(".connection")).toHaveText("Verbunden");
  const media = async (event) =>
    (
      await request.post("/fixture/media", { data: event ? { event } : {} })
    ).json();
  await expect
    .poll(async () => (await media()).receivedBytes)
    .toBeGreaterThan(3200);
  expect((await media()).frameSizes.every((size) => size === 640)).toBe(true);
  await page.getByRole("button", { name: "Stumm", exact: true }).click();
  await page.waitForTimeout(200);
  const muted = (await media()).receivedBytes;
  await page.waitForTimeout(200);
  expect((await media()).receivedBytes).toBe(muted);
  await page.getByRole("button", { name: "Mikrofon an", exact: true }).click();
  await expect
    .poll(async () => (await media()).receivedBytes)
    .toBeGreaterThan(muted);
  const pcm = Buffer.alloc(48000).toString("base64");
  await media({ type: "audio.chunk", data: pcm, sampleRate: 24000, epoch: 0 });
  await media({ type: "audio.turn_complete", epoch: 0 });
  expect((await media()).playbackDrained).toBe(false);
  await expect.poll(async () => (await media()).playbackDrained).toBe(true);
  await media({ type: "audio.chunk", data: pcm, sampleRate: 24000, epoch: 0 });
  await media({ type: "audio.interrupted", epoch: 1 });
  await expect
    .poll(() => page.evaluate(() => window.mediaProbe.stoppedSources))
    .toBe(1);
  await media({ type: "audio.chunk", data: pcm, sampleRate: 24000, epoch: 0 });
  await media({
    type: "session.input_transcript.delta",
    event_id: "part-1",
    delta: "Mon",
    start_ms: 100,
    end_ms: 101,
  });
  await media({
    type: "session.input_transcript.delta",
    event_id: "part-2",
    delta: "day",
    start_ms: 102,
    end_ms: 103,
  });
  await expect(page.locator(".speech.child")).toContainText("Monday");
  expect(await page.evaluate(() => window.mediaProbe.sources)).toBe(2);
  await request.post(`/api/lessons/${lesson.id}/end`, {
    data: { status: "interrupted" },
  });
  await expect(page.locator(".connection")).toHaveText("Nicht verbunden");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.mediaProbe.streams.every((s) =>
            s.getTracks().every((t) => t.readyState === "ended"),
          ) && window.mediaProbe.contexts.every((c) => c.state === "closed"),
      ),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});
