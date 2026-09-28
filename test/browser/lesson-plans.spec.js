import { test, expect } from "@playwright/test";
import { fakeMedia } from "./fake-media.js";

test("selected topic starts directly from Unterrichtsplan & Lernbelege", async ({
  page,
  request,
}) => {
  await request.post("/api/topics/animals/plan/generate", {
    data: { expectedTopicRevision: 1, expectedRevision: 0 },
  });
  await page.addInitScript(fakeMedia);
  await page.goto("/");
  await page.getByRole("button", { name: "Vorbereitung", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Thema", exact: true })
    .selectOption("animals");
  await page
    .getByRole("button", { name: "Unterrichtsplan & Lernbelege", exact: true })
    .click();
  const start = page
    .getByRole("region", { name: "Ausführbarer Unterrichtsplan" })
    .getByRole("button", { name: "Mikrofon an & Stunde starten" });
  await expect(start).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await start.click();
  await expect(page.locator(".classroom-title")).toContainText("Tierisch gut");
  await expect(page.locator(".connection")).toHaveText("Verbunden");
  await page.getByRole("button", { name: "Beenden", exact: true }).click();
  await expect(page.locator(".summary-page")).toBeVisible();
});

test("parents generate, preview, reorder and persist an executable plan without creating learning results", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.getByRole("button", { name: "Vorbereitung", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Thema", exact: true })
    .selectOption("animals");
  await page
    .getByRole("button", { name: "Unterrichtsplan & Lernbelege", exact: true })
    .click();
  const editor = page.getByRole("region", {
    name: "Ausführbarer Unterrichtsplan",
  });
  await editor
    .getByRole("button", { name: /Plan (neu erstellen|erstellen)/ })
    .click();
  await expect(editor.locator(".plan-steps li")).toHaveCount(4);
  await expect(
    editor.getByLabel("Tafelvorschau", { exact: true }),
  ).toContainText("Sprich mir nach");
  await editor
    .getByRole("button", { name: "Schritt 2 nach oben", exact: true })
    .click();
  await expect(editor.locator(".plan-steps li").first()).toContainText("dog");
  await editor
    .getByRole("button", {
      name: "Plan speichern",
      exact: true,
    })
    .click();
  await expect(editor).toContainText("Gespeicherter Plan · Version 3");
  await editor.locator(".plan-step-select").last().click();
  const preview = editor.getByLabel("Tafelvorschau", { exact: true });
  await expect(preview.locator("img")).toHaveCount(1);
  await expect(preview.locator(".board-element.text")).toHaveCount(0);
  await expect(preview).not.toContainText("Hund");
  const home = await (await request.get("/api/home")).json();
  expect(home.topics.find((t) => t.id === "animals").mastery).toHaveLength(0);
  await editor.screenshot({ path: ".cache/lesson-plan-editor.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: ".cache/lesson-plan-mobile.png",
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("button", { name: "Vorbereitung", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Thema", exact: true })
    .selectOption("animals");
  await page
    .getByRole("button", { name: "Unterrichtsplan & Lernbelege", exact: true })
    .click();
  await expect(page.locator(".plan-steps li").first()).toContainText("dog");
});

test("invalid reordering keeps the parent's draft and the last saved plan", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Vorbereitung", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Thema", exact: true })
    .selectOption("animals");
  await page
    .getByRole("button", { name: "Unterrichtsplan & Lernbelege", exact: true })
    .click();
  const before = await (await request.get("/api/topics/animals/plan")).json();
  await page
    .getByRole("button", { name: "Schritt 3 nach oben", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Plan speichern",
      exact: true,
    })
    .click();
  await expect(
    page.locator(".lesson-plan-editor [role=alert]").first(),
  ).toContainText("zuerst");
  await expect(page.locator(".plan-actions")).toContainText(
    "Ungespeicherte Änderungen",
  );
  const after = await (await request.get("/api/topics/animals/plan")).json();
  expect(after.plan.revision).toBe(before.plan.revision);
});
