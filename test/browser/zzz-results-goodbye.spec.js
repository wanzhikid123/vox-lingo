import { test, expect } from "@playwright/test";
import { fakeMedia } from "./fake-media.js";

test("individual learning results can be cancelled or deleted from history and summary", async ({
  page,
  request,
}) => {
  const first = await (await request.post("/fixture/result")).json();
  const second = await (await request.post("/fixture/result")).json();
  await page.goto("/");
  await page.getByRole("button", { name: "Mein Lernweg" }).click();
  const row = page
    .locator(".history-row")
    .filter({ hasText: second.topic.name })
    .first();
  page.once("dialog", (dialog) => dialog.dismiss());
  await row.getByRole("button", { name: /Lernergebnisse löschen/ }).click();
  expect((await request.get(`/api/lessons/${second.id}`)).status()).toBe(200);
  const count = await page.locator(".history-row").count();
  page.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: /Lernergebnisse löschen/ }).click();
  await expect(page.locator(".history-row")).toHaveCount(count - 1);
  expect((await request.get(`/api/lessons/${second.id}`)).status()).toBe(404);
  expect((await request.get(`/api/lessons/${first.id}`)).status()).toBe(200);
  await row.locator(".history-open").click();
  await expect(
    page.getByRole("button", { name: "Diese Lernergebnisse löschen" }),
  ).toBeVisible();
  await page.screenshot({ path: ".cache/results-delete.png", fullPage: true });
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Diese Lernergebnisse löschen" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Dein Lernweg" }),
  ).toBeVisible();
  expect((await request.get(`/api/lessons/${first.id}`)).status()).toBe(404);
});

test("German text replaces unavailable emoji and a real goodbye countdown closes browser media", async ({
  page,
  request,
}) => {
  await page.addInitScript(fakeMedia);
  await request.post("/fixture/practice", {
    data: {
      mode: "picture_speak",
      word: "striped lunchbox",
      meaning: "Gestreifte Brotdose",
    },
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Stunde öffnen" }).click();
  await page
    .getByRole("button", { name: /Erneut verbinden|Mit Mia sprechen/ })
    .click();
  await expect(page.locator(".connection")).toHaveText("Verbunden");
  await expect(page.locator(".board-element.text")).toHaveText(
    "Gestreifte Brotdose",
  );
  await expect(page.locator("#quiz-prompt")).toHaveText(
    "Wie heißt „Gestreifte Brotdose“ auf Englisch?",
  );
  await expect(page.locator("body")).not.toContainText("GPT Image");
  await page.screenshot({
    path: ".cache/meaning-fallback.png",
    fullPage: true,
  });
  await request.post("/fixture/goodbye");
  const cancellation = page.waitForResponse(
    (r) => r.url().endsWith("/input-activity") && r.status() === 200,
  );
  await page.evaluate(() => {
    window.fixtureSpeaking = true;
  });
  await cancellation;
  await page.evaluate(() => {
    window.fixtureSpeaking = false;
  });
  // Cross the previous deadline to verify cancellation, using a condition with retry.
  await expect(async () => {
    expect(await page.evaluate(() => window.fixtureMedia.stopped)).toBe(0);
    await expect(page.locator(".connection")).toHaveText("Verbunden");
  }).toPass({ timeout: 4000 });
  await new Promise((r) => setTimeout(r, 3200));
  await expect(page.locator(".connection")).toHaveText("Verbunden");
  await request.post("/fixture/goodbye");
  await expect(page.locator(".summary-page")).toBeVisible({ timeout: 5000 });
  expect(await page.evaluate(() => window.fixtureMedia)).toEqual({
    stopped: 1,
    socketClosed: 1,
    audioClosed: 1,
  });
});
