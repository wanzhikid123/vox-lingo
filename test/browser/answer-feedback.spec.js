import { test, expect } from "@playwright/test";
import { fakeMedia } from "./fake-media.js";

test.afterEach(async ({ request }) => {
  await request.post("/fixture/reset-classroom");
});

test("clicked and spoken choices show check and cross; spoken recall writes the answer on the board", async ({
  page,
  request,
}) => {
  await page.addInitScript(fakeMedia);
  await request.post("/fixture/practice", { data: { mode: "meaning_choice" } });
  await page.goto("/");
  await page.getByRole("button", { name: "Stunde öffnen" }).click();
  await page
    .getByRole("button", { name: /Erneut verbinden|Mit Mia sprechen/ })
    .click();
  await expect(page.locator(".connection")).toHaveText("Verbunden");
  const options = page.locator(".quiz-options button");
  await expect(options).toHaveCount(3);
  await options.filter({ hasText: "train" }).click();
  await expect(
    options.filter({ hasText: "train" }).locator('[aria-label="Falsch"]'),
  ).toBeVisible();
  await expect(
    options.filter({ hasText: "sofa" }).locator('[aria-label="Richtig"]'),
  ).toBeVisible();
  await expect(page.locator(".quiz-feedback")).toContainText("sofa");
  await expect(options.first()).toBeDisabled();

  await request.post("/fixture/practice", { data: { mode: "meaning_choice" } });
  await options.filter({ hasText: "sofa" }).click();
  await expect(
    options.filter({ hasText: "sofa" }).locator('[aria-label="Richtig"]'),
  ).toBeVisible();
  await expect(page.locator('[aria-label="Falsch"]')).toHaveCount(0);

  await request.post("/fixture/practice", { data: { mode: "meaning_choice" } });
  await request.post("/fixture/voice-answer", { data: { word: "bus" } });
  await expect(
    options.filter({ hasText: "bus" }).locator('[aria-label="Falsch"]'),
  ).toBeVisible();
  await expect(
    options.filter({ hasText: "sofa" }).locator('[aria-label="Richtig"]'),
  ).toBeVisible();

  await request.post("/fixture/practice", {
    data: { mode: "meaning_speak", word: "bus", meaning: "Bus" },
  });
  await expect(page.locator('[data-element-id="practice-answer"]')).toHaveCount(
    0,
  );
  await request.post("/fixture/voice-answer", { data: { word: "wrong" } });
  await expect(page.locator('[data-element-id="practice-answer"]')).toHaveText(
    "bus",
  );

  await request.post("/fixture/practice", {
    data: { mode: "picture_speak", word: "sofa", meaning: "Sofa" },
  });
  await expect(page.locator('[data-element-id="practice-answer"]')).toHaveCount(
    0,
  );
  await request.post("/fixture/voice-answer", { data: { word: "sofa" } });
  await expect(page.locator('[data-element-id="practice-answer"]')).toHaveText(
    "sofa",
  );
});
