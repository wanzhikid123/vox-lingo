import { test, expect } from "@playwright/test";
import { fakeMedia } from "./fake-media.js";

test("large local emoji, spoken practice, choices and persistent tempo work at FHD 150%", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1280, height: 620 });
  await page.addInitScript(fakeMedia);
  await request.post("/fixture/practice", { data: { mode: "picture_speak" } });
  await page.goto("/");
  await page.getByRole("button", { name: "Stunde öffnen" }).click();
  await page
    .getByRole("button", { name: /Erneut verbinden|Mit Mia sprechen/ })
    .click();
  await expect(page.locator(".connection")).toHaveText("Verbunden");
  const image = page.locator(".board-element.emoji img");
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("src", /\/assets\/emoji\//);
  expect(await image.evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(
    true,
  );
  const size = await image.boundingBox();
  expect(size.width).toBeGreaterThan(150);
  expect(size.height).toBeGreaterThan(100);
  await expect(page.locator(".board-element.text")).toHaveCount(0);
  await expect(page.locator(".quiz-options button")).toHaveCount(0);
  await expect(page.locator(".spoken-practice")).toContainText(
    "Wort in der Zielsprache",
  );
  const slider = page.getByRole("slider", { name: /Sprechtempo/ });
  await slider.fill("5");
  await expect(page.locator(".speech-tempo")).toContainText("Schnell");
  await expect(page.locator(".speech-tempo small")).toHaveText(
    "Ab dem nächsten Satz",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeLessThanOrEqual(621);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1280);
  await page.screenshot({
    path: ".cache/classroom-emoji-tempo.png",
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("button", { name: "Stunde öffnen" }).click();
  await expect(slider).toHaveValue("5");
  await request.post("/fixture/practice", {
    data: { mode: "meaning_choice", word: "sofa", meaning: "Sofa" },
  });
  await expect(page.locator(".quiz-options button")).toHaveCount(3);
  await request.post("/fixture/practice", {
    data: { mode: "meaning_speak", word: "bus", meaning: "Bus" },
  });
  await expect(page.locator(".spoken-practice")).toBeVisible();
  await expect(page.locator(".board-element.text")).toHaveText("Bus");
  await expect(page.locator(".quiz-options button")).toHaveCount(0);
  await request.post("/fixture/practice", {
    data: { mode: "repeat", word: "train", meaning: "Zug" },
  });
  await expect(page.locator('[data-element-id="practice-word"]')).toHaveText(
    "train",
  );
  await expect(page.locator(".spoken-practice")).toContainText("Hör Mia zu");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await expect(slider).toBeVisible();
});
