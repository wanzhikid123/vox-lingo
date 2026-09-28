import { test, expect } from "@playwright/test";
import { fakeMedia } from "./fake-media.js";

for (const height of [720, 620]) {
  test(`FHD at 150% keeps classroom controls and answers in view (${height}px)`, async ({
    page,
  }) => {
    // 1920x1080 at 150% is 1280x720 CSS pixels; allow browser chrome too.
    await page.setViewportSize({ width: 1280, height });
    await page.goto("/");
    await page.getByRole("button", { name: "Stunde öffnen" }).click();
    await expect(page.locator(".quiz-options button")).toHaveCount(2);
    const geometry = await page.evaluate(() => ({
      viewport: innerHeight,
      page: document.documentElement.scrollHeight,
      width: document.documentElement.scrollWidth,
      elements: [
        ".classroom-controls",
        ".quiz-options",
        ".quiz-bottom",
        ".board-footer",
        ".conversation-footer",
      ].map((selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { selector, top: rect.top, bottom: rect.bottom };
      }),
    }));
    expect(geometry.page, JSON.stringify(geometry)).toBeLessThanOrEqual(
      height + 1,
    );
    expect(geometry.width).toBeLessThanOrEqual(1280);
    for (const element of geometry.elements) {
      expect(element.top, element.selector).toBeGreaterThanOrEqual(0);
      expect(element.bottom, element.selector).toBeLessThanOrEqual(height);
    }
  });
}

test("long captions and a network interruption keep controls accessible and release media", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1280, height: 620 });
  await page.addInitScript(fakeMedia);
  await page.goto("/");
  await page.getByRole("button", { name: "Stunde öffnen" }).click();
  await page.getByRole("button", { name: "Erneut verbinden" }).click();
  await expect(page.locator(".connection")).toHaveText("Verbunden");
  await page.evaluate(() => {
    for (let i = 0; i < 30; i++)
      window.fixtureTranscript(
        "teacher",
        "Wir lernen heute zusammen Englisch. ".repeat(5),
        i,
      );
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeLessThanOrEqual(621);
  const layout = await page
    .locator(".board-main")
    .evaluate((el) => ({ height: el.clientHeight, content: el.scrollHeight }));
  expect(layout.content).toBeLessThanOrEqual(layout.height + 1);
  await request.post("/fixture/disconnect");
  await expect(page.getByRole("status")).toContainText(
    "Die Stunde wurde unterbrochen",
  );
  await expect(
    page.getByRole("button", { name: "Erneut verbinden" }),
  ).toBeEnabled();
  await expect(page.locator(".quiz-options button").first()).toBeDisabled();
  expect(await page.evaluate(() => window.fixtureMedia)).toEqual({
    stopped: 1,
    socketClosed: 1,
    audioClosed: 1,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeLessThanOrEqual(621);
  await page.screenshot({
    path: ".cache/classroom-fhd-150-disconnected.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Erneut verbinden" }).click();
  await expect(page.locator(".connection")).toHaveText("Verbunden");
  await expect(page.locator(".quiz-options button").first()).toBeEnabled();
  await expect(page.getByRole("status")).not.toBeVisible();
  await request.post("/fixture/disconnect");
  await expect(page.locator(".connection")).toHaveText("Nicht verbunden");
});
test("home, topic selection, settings and history work without model calls", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Hallo, schön, dass du da bist!" }),
  ).toBeVisible();
  await expect(page.locator(".topic-card")).toHaveCount(7);
  await page
    .getByRole("button", { name: /Die Welt ist bunt/ })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mikrofon an & Stunde starten" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Schließen", exact: true }).click();
  await page
    .getByRole("button", { name: "Einstellungen", exact: true })
    .click();
  await expect(
    page
      .getByRole("group", { name: "Live-Gespräch", exact: true })
      .getByLabel("Modell", { exact: true }),
  ).toHaveText("gemini-3.8-live");
  await expect(
    page
      .getByRole("group", { name: "Unterrichts-Backend", exact: true })
      .getByLabel("Modell", { exact: true }),
  ).toHaveText("gpt-6-luna");
  await expect(
    page
      .getByRole("group", { name: "Gespräche & Unterrichtsplan", exact: true })
      .getByLabel("Modell", { exact: true }),
  ).toHaveText("gemini-3.5-flash-lite");
  await expect(page.locator("body")).not.toContainText(
    "fixture-only-not-a-real-key",
  );
  await page.getByRole("button", { name: "Schließen", exact: true }).click();
  await page.getByRole("button", { name: "Mein Lernweg" }).click();
  await expect(
    page.getByRole("heading", { name: "Dein Lernweg" }),
  ).toBeVisible();
  await expect(page.locator(".history-list")).toContainText("Unterbrochen");
  expect(errors).toEqual([]);
});

test("missing selected backend key blocks classroom start and identifies the correct provider", async ({
  page,
}) => {
  await page.route("**/api/settings", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.roles.backend = data.options.backend.deepseek.defaults;
    data.options.backend.deepseek.keyConfigured = false;
    await route.fulfill({ json: data });
  });
  await page.route("**/api/health", async (route) => {
    const response = await route.fetch();
    const health = await response.json();
    await route.fulfill({
      json: {
        ...health,
        classroomKeyConfigured: false,
        missingClassroomKeys: ["DEEPSEEK_API_KEY"],
        backend: {
          provider: "deepseek",
          model: "deepseek-flash",
          reasoningEffort: "high",
          apiKeyName: "DEEPSEEK_API_KEY",
          keyConfigured: false,
        },
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: /Die Welt ist bunt/ })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Mikrofon an & Stunde starten" }),
  ).toBeDisabled();
  await expect(page.getByRole("dialog")).toContainText("DEEPSEEK_API_KEY");
  await expect(page.getByRole("dialog")).toContainText("DeepSeek");
  await page.getByRole("button", { name: "Schließen", exact: true }).click();
  await page
    .getByRole("button", { name: "Einstellungen", exact: true })
    .click();
  await expect(
    page
      .getByRole("group", { name: "Unterrichts-Backend", exact: true })
      .getByLabel("Modell", { exact: true }),
  ).toHaveText("deepseek-flash");
  await expect(
    page.getByText("DEEPSEEK_API_KEY fehlt", { exact: true }),
  ).toBeVisible();
});
test("saved classroom has a white board, 60/40 layout and blocks answering when disconnected", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Stunde öffnen" }).click();
  await expect(page.getByText("Red · Rot", { exact: true })).toBeVisible();
  await expect(page.locator('[data-element-id="label"]')).toHaveText("redrot");
  await expect(page.locator(".quiz-options button")).toHaveCount(2);
  await expect(page.locator(".quiz-options button").first()).toBeDisabled();
  const board = await page.locator(".whiteboard-panel").boundingBox(),
    chat = await page.locator(".conversation-panel").boundingBox();
  expect(board.width / (board.width + chat.width)).toBeCloseTo(0.6, 2);
  await expect(
    page.getByRole("button", { name: "Erneut verbinden" }),
  ).toBeEnabled();
  await page.screenshot({
    path: ".cache/classroom-fixture.png",
    fullPage: true,
  });
});
test("narrow screens have no horizontal overflow and all topic cards remain available", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".topic-card")).toHaveCount(7);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: /Tierisch gut/ })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("parents chat to edit and create durable playable topics in a compact preparation page", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1280, height: 620 });
  await page.addInitScript(fakeMedia);
  await page.goto("/");
  await page.getByRole("button", { name: "Vorbereitung", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Unterricht vorbereiten" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Thema", exact: true })
    .selectOption("colors");
  await page.getByLabel("Deine Nachricht").fill("请补充 purple");
  await page.getByRole("button", { name: "Senden", exact: true }).click();
  await expect(page.locator(".prep-change")).toContainText("Aktualisiert");
  await expect(page.locator(".prep-sidebar .word-tags")).toContainText(
    "purple",
  );
  await page.reload();
  await page.getByRole("button", { name: "Vorbereitung", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("请补充 purple");
  await page
    .getByLabel("Deine Nachricht")
    .fill("Erstelle bitte ein neues Thema Obst mit apple und banana.");
  await page.getByRole("button", { name: "Senden", exact: true }).click();
  await expect(page.locator(".prep-change").last()).toContainText(
    "Neu gespeichert: Obst entdecken",
  );
  await expect(page.locator(".prep-sidebar")).toContainText("banana");
  const prepared = await request.post("/api/topics/fruit/plan/save", {
    data: {
      expectedTopicRevision: 1,
      expectedRevision: 0,
      plan: {
        goal: "Obst",
        steps: [
          {
            id: "apple",
            mode: "repeat",
            word: "apple",
            meaning: "Apfel",
            distractors: [],
            stage: "new",
            seconds: 30,
          },
        ],
      },
    },
  });
  expect(prepared.ok()).toBeTruthy();
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeLessThanOrEqual(621);
  const composer = await page.locator(".prep-composer").boundingBox();
  expect(composer.y + composer.height).toBeLessThanOrEqual(620);
  await page.screenshot({ path: ".cache/preparation-fhd.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 620 });
  await page.getByRole("button", { name: "Entdecken", exact: true }).click();
  await page
    .getByRole("button", { name: /Obst entdecken/ })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toContainText("banana");
  await page
    .getByRole("button", { name: "Mikrofon an & Stunde starten" })
    .click();
  await expect(page.locator(".classroom-title")).toContainText(
    "Obst entdecken",
  );
  await expect(page.locator(".connection")).toHaveText("Verbunden");
});

test("clearing preparation requires confirmation and stays cleared after reload", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1280, height: 620 });
  await page.goto("/");
  await page.getByRole("button", { name: "Vorbereitung", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("请补充 purple");
  const clear = page.getByRole("button", {
    name: "Gespräch leeren",
    exact: true,
  });
  await expect(clear).toBeVisible();
  const state = await (await request.get("/api/preparation")).json();
  expect(
    (
      await request.post("/api/preparation/clear", {
        data: { expectedGeneration: state.generation, confirmed: false },
      })
    ).status(),
  ).toBe(400);
  page.once("dialog", (dialog) => dialog.dismiss());
  await clear.click();
  await expect(page.getByRole("log")).toContainText("请补充 purple");
  page.once("dialog", (dialog) => dialog.accept());
  await clear.click();
  await expect(page.locator(".prep-message")).toHaveCount(0);
  await expect(clear).toBeDisabled();
  await expect(
    page.getByRole("combobox", { name: "Thema", exact: true }),
  ).toContainText("Obst entdecken");
  await page.reload();
  await page.getByRole("button", { name: "Vorbereitung", exact: true }).click();
  await expect(page.locator(".prep-message")).toHaveCount(0);
  await page.getByLabel("Deine Nachricht").fill("新聊天：请补充 purple");
  await page.getByRole("button", { name: "Senden", exact: true }).click();
  await expect(page.locator(".prep-message.parent")).toHaveCount(1);
  await expect(page.locator(".prep-change")).toContainText("Aktualisiert");
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeLessThanOrEqual(621);
  await page.screenshot({
    path: ".cache/preparation-clear-fhd.png",
    fullPage: true,
  });
});

test("topic card deletion can be cancelled and preserves past lessons after confirmation", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const button = page.getByRole("button", {
    name: "Thema löschen: Die Welt ist bunt",
    exact: true,
  });
  const state = await (await request.get("/api/home")).json();
  const colors = state.topics.find((topic) => topic.id === "colors");
  expect(
    (
      await request.post("/api/topics/colors/delete", {
        data: { expectedRevision: colors.revision },
      })
    ).status(),
  ).toBe(400);
  page.once("dialog", (dialog) => dialog.dismiss());
  await button.click();
  await expect(button).toBeVisible();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await button.click();
  await expect(button).toHaveCount(0);
  await page.reload();
  await expect(button).toHaveCount(0);
  await page.getByRole("button", { name: "Mein Lernweg", exact: true }).click();
  await expect(page.locator(".history-list")).toContainText(
    "Die Welt ist bunt",
  );
  await page
    .locator(".history-list .history-open")
    .filter({ hasText: "Die Welt ist bunt" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Deine Entdeckungen sind gespeichert." }),
  ).toBeVisible();
  await expect(page.locator("main")).toContainText("Die Welt ist bunt");
});

test("AI proposes deletion and waits for the user's confirmation", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1280, height: 620 });
  await page.goto("/");
  await page.getByRole("button", { name: "Vorbereitung", exact: true }).click();
  await page.getByLabel("Deine Nachricht").fill("请删除 Hallo Welt");
  await page.getByRole("button", { name: "Senden", exact: true }).click();
  const confirm = page.getByRole("button", {
    name: "Löschen bestätigen",
    exact: true,
  });
  await expect(confirm).toBeVisible();
  expect(
    (await (await request.get("/api/home")).json()).topics.some(
      (topic) => topic.id === "greetings",
    ),
  ).toBe(true);
  page.once("dialog", (dialog) => dialog.dismiss());
  await confirm.click();
  await expect(confirm).toBeEnabled();
  await page.screenshot({
    path: ".cache/preparation-delete-fhd.png",
    fullPage: true,
  });
  page.once("dialog", (dialog) => dialog.accept());
  await confirm.click();
  await expect(page.locator(".prep-deletion")).toContainText(
    "Aus der Themenliste gelöscht",
  );
  await page.reload();
  await page.getByRole("button", { name: "Vorbereitung", exact: true }).click();
  await expect(page.locator(".prep-deletion")).toContainText(
    "Aus der Themenliste gelöscht",
  );
  expect(
    (await (await request.get("/api/home")).json()).topics.some(
      (topic) => topic.id === "greetings",
    ),
  ).toBe(false);
});

test("deleting all topic cards leaves a usable empty home and preparation entry", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  page.on("dialog", (dialog) => dialog.accept());
  await expect(page.locator(".topic-delete").first()).toBeVisible();
  while (await page.locator(".topic-delete").count()) {
    const count = await page.locator(".topic-delete").count();
    await page.locator(".topic-delete").first().click();
    await expect(page.locator(".topic-delete")).toHaveCount(count - 1);
  }
  await expect(page.getByText(/Noch keine Themen/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Noch keine Themen/)).toBeVisible();
  await page.getByRole("button", { name: "Vorbereitung", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Unterricht vorbereiten" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
