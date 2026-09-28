import { test, expect } from "@playwright/test";

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
  permissions: ["microphone"],
});

async function openPreparation(page) {
  await page.setViewportSize({ width: 1280, height: 620 });
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    window.dictationStreams = [];
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await original(...args);
      window.dictationStreams.push(stream);
      return stream;
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Vorbereitung", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Spracheingabe", exact: true }),
  ).toBeEnabled();
}

async function record(page) {
  await page
    .getByRole("button", { name: "Spracheingabe", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Stoppen · 00:01/ }),
  ).toBeVisible();
}

async function released(page) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.dictationStreams.every((stream) =>
          stream.getTracks().every((track) => track.readyState === "ended"),
        ),
      ),
    )
    .toBe(true);
}

test("real browser WebM recording appends editable multilingual text without sending the chat", async ({
  page,
}) => {
  await openPreparation(page);
  const input = page.getByLabel("Deine Nachricht");
  await input.fill("已有草稿");
  let chats = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/preparation/chat")) chats++;
  });
  await record(page);
  await expect(
    page.getByRole("button", { name: "Senden", exact: true }),
  ).toBeDisabled();
  const upload = page.waitForResponse(
    "**/api/preparation/transcribe?language=auto",
  );
  await page.getByRole("button", { name: /Stoppen/ }).click();
  const uploaded = await (await upload).json();
  // Chromium does not expose Blob request bytes in postDataBuffer. Check what
  // the fixture service actually received, including the WebM EBML header.
  expect(uploaded.format).toBe("audio/webm");
  expect(uploaded.signature).toBe("1a45dfa3");
  await expect(input).toHaveValue("已有草稿\n请复习颜色，red und blue。");
  await expect(input).toBeEditable();
  await expect(input).toBeFocused();
  expect(chats).toBe(0);
  await released(page);
  await page.screenshot({
    path: ".cache/preparation-dictation.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeLessThanOrEqual(621);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("cancel and navigation release the microphone and do not upload audio", async ({
  page,
}) => {
  await openPreparation(page);
  let uploads = 0;
  page.on("request", (request) => {
    if (request.url().includes("/preparation/transcribe")) uploads++;
  });
  await record(page);
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await released(page);
  await record(page);
  await page.getByRole("button", { name: "Entdecken", exact: true }).click();
  await released(page);
  expect(uploads).toBe(0);
});

test("failed transcription preserves the draft and allows recording again with a language hint", async ({
  page,
}) => {
  await openPreparation(page);
  const input = page.getByLabel("Deine Nachricht");
  await input.fill("Keep my draft.");
  await page
    .getByRole("combobox", { name: "Sprache", exact: true })
    .selectOption("de");
  await page.route(
    "**/api/preparation/transcribe?language=de",
    (route) =>
      route.fulfill({ status: 502, json: { error: "API-Limit erreicht." } }),
    { times: 1 },
  );
  await record(page);
  await page.getByRole("button", { name: /Stoppen/ }).click();
  await expect(page.getByRole("alert")).toHaveText("API-Limit erreicht.");
  await expect(input).toHaveValue("Keep my draft.");
  await released(page);
  await record(page);
  await page.getByRole("button", { name: /Stoppen/ }).click();
  await expect(input).toHaveValue(
    "Keep my draft.\nBitte die Farben wiederholen.",
  );
});

test("microphone denial gives a useful error and leaves typing available", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Denied", "NotAllowedError");
    };
  });
  await openPreparation(page);
  await page
    .getByRole("button", { name: "Spracheingabe", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Mikrofonzugriff wurde nicht erlaubt",
  );
  await expect(page.getByLabel("Deine Nachricht")).toBeEditable();
});

test("cancelling while permission is pending releases a late microphone stream", async ({
  page,
}) => {
  await openPreparation(page);
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = () =>
      new Promise((resolve) => {
        window.resolveMicrophone = async () =>
          resolve(await original({ audio: true }));
      });
  });
  await page
    .getByRole("button", { name: "Spracheingabe", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Mikrofon erlauben");
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await page.evaluate(() => window.resolveMicrophone());
  await released(page);
  await expect(
    page.getByRole("button", { name: "Spracheingabe", exact: true }),
  ).toBeEnabled();
});

test("three-minute limit stops automatically and releases the microphone", async ({
  page,
}) => {
  await openPreparation(page);
  await page.clock.install();
  await page
    .getByRole("button", { name: "Spracheingabe", exact: true })
    .click();
  await expect(page.getByRole("button", { name: /Stoppen/ })).toBeVisible();
  await page.clock.fastForward(180000);
  await expect(
    page.getByRole("button", { name: "Spracheingabe", exact: true }),
  ).toBeEnabled();
  await released(page);
});
