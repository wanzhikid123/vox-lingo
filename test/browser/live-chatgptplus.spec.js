import { test, expect } from "@playwright/test";
import { fakeMedia } from "./fake-openai-media.js";

// Keep the existing audio worker group together: earlier catalog/lesson UI
// checks use the initial classroom, while audio fixtures create fresh lessons.
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
test.beforeEach(async ({ request }) => {
  // Clear fixture-only socket placeholders from preceding farewell tests.
  expect((await request.post("/fixture/idle")).ok()).toBeTruthy();
});

test.afterEach(async ({ request }) => {
  const data = await (await request.get("/api/settings")).json();
  const reset = await request.post("/api/settings", {
    data: { revision: data.revision, roles: data.defaults },
  });
  expect(reset.ok()).toBeTruthy();
});

test("ChatGPTPlus settings expose its fixed model, voice, gateway and provider-only save", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Einstellungen", exact: true })
    .click();
  const live = page.getByRole("group", { name: "Live-Gespräch", exact: true });
  await live
    .getByLabel("Anbieter", { exact: true })
    .selectOption({ label: "ChatGPTPlus" });
  await expect(live.getByLabel("Modell", { exact: true })).toHaveText(
    "gpt-live-1-codex",
  );
  await expect(live.getByLabel("Stimme", { exact: true })).toHaveText("sol");
  await expect(live.getByLabel("Server-Adresse", { exact: true })).toHaveText(
    "http://miniserver:8787/v1",
  );
  await expect(live.getByRole("combobox")).toHaveCount(1);
  expect((await (await request.get("/api/health")).json()).live.provider).toBe(
    "gemini",
  );
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.locator(".settings-success")).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Einstellungen", exact: true })
    .click();
  await expect(live.getByLabel("Anbieter", { exact: true })).toHaveValue(
    "chatgptplus",
  );
  expect(await page.content()).not.toContain(
    "fixture-planbridge-not-a-real-key",
  );
});

test("ChatGPTPlus gateway settings stay translated and fit all three locales on mobile and desktop", async ({
  page,
}, testInfo) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [locale, label] of [
      ["de", "Server-Adresse"],
      ["en", "Server address"],
      ["zh-CN", "服务器地址"],
    ]) {
      await page.goto("/");
      await page.locator("button.settings-button").click();
      await page.locator("#language-interfaceLanguage").selectOption(locale);
      await page.locator("#settings-live-provider").selectOption("chatgptplus");
      await expect(
        page.locator('label[for="settings-live-baseUrl"]'),
      ).toHaveText(label);
      await expect(page.locator("#settings-live-baseUrl")).toHaveText(
        "http://miniserver:8787/v1",
      );
      expect(
        await page
          .locator(".settings-modal")
          .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`chatgptplus-${locale}-${width}.png`),
        fullPage: true,
      });
      await page.keyboard.press("Escape");
    }
  }
});

test("ChatGPTPlus uses sideband captions, waits for media, mutes locally and releases the peer after closure", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await request.post("/fixture/media-lesson");
  const data = await (await request.get("/api/settings")).json();
  data.roles.live = { provider: "chatgptplus" };
  await request.post("/api/settings", {
    data: { revision: data.revision, roles: data.roles },
  });
  await page.addInitScript(fakeMedia);
  await page.addInitScript(() => {
    window.fixtureHoldConnection = true;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Stunde öffnen" }).click();
  await page.getByRole("button", { name: "Erneut verbinden" }).click();
  await expect
    .poll(() => page.evaluate(() => typeof window.fixtureConnectPeer))
    .toBe("function");
  await expect(page.locator(".connection")).not.toHaveText("Verbunden");
  expect(await page.evaluate(() => window.fixtureMedia.track.enabled)).toBe(
    false,
  );
  await page.evaluate(() => window.fixtureConnectPeer());
  await expect(page.locator(".connection")).toHaveText("Verbunden");
  expect(await page.evaluate(() => window.fixtureMedia.track.enabled)).toBe(
    true,
  );
  await page.evaluate(() =>
    window.fixtureTranscript("teacher", "Native event must be ignored", 3),
  );
  const event = {
    type: "session.output_transcript.delta",
    event_id: "plus-1",
    delta: "Hello ",
    start_ms: 100,
    end_ms: 200,
  };
  await request.post("/fixture/live-event", { data: event });
  await request.post("/fixture/live-event", {
    data: { ...event, event_id: "plus-2", delta: "from ChatGPTPlus" },
  });
  await expect(
    page.getByText("Hello from ChatGPTPlus", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Native event must be ignored", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Stumm", exact: true }).click();
  expect(await page.evaluate(() => window.fixtureMedia.track.enabled)).toBe(
    false,
  );
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/lessons/*/close-live", async (route) => {
    await gate;
    await route.continue();
  });
  await page.getByRole("button", { name: "Beenden", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.fixtureMedia.stopped))
    .toBe(1);
  expect(await page.evaluate(() => window.fixtureMedia.peerClosed)).toBe(0);
  release();
  await expect
    .poll(() => page.evaluate(() => window.fixtureMedia.peerClosed))
    .toBe(1);
  expect(errors).toEqual([]);
});
