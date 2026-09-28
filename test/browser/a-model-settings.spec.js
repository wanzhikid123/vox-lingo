import { test, expect } from "@playwright/test";

const group = (page, name) => page.getByRole("group", { name, exact: true });
const open = async (page) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Einstellungen", exact: true })
    .click();
  await expect(
    group(page, "Live-Gespräch").getByLabel("Anbieter", { exact: true }),
  ).toBeVisible();
};
test.afterEach(async ({ request }) => {
  const data = await (await request.get("/api/settings")).json();
  const response = await request.post("/api/settings", {
    data: { revision: data.revision, roles: data.defaults },
  });
  expect(response.ok()).toBeTruthy();
});

test("only Anbieter is editable; environment parameters display immediately and providers apply only on save", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const settings = await (await request.get("/api/settings")).json();
  await open(page);
  const live = group(page, "Live-Gespräch");
  const backend = group(page, "Unterrichts-Backend");
  const teacher = group(page, "Gespräche & Unterrichtsplan");
  const transcription = group(page, "Spracheingabe");
  await expect(page.getByRole("dialog").getByRole("combobox")).toHaveCount(7);
  await expect(page.getByRole("dialog").locator("input")).toHaveCount(0);
  await live.getByLabel("Anbieter", { exact: true }).selectOption("openai");
  await expect(live.getByLabel("Stimme", { exact: true })).toHaveText(
    settings.options.live.openai.values.voice,
  );
  await expect(live.getByLabel("Modell", { exact: true })).toHaveText(
    settings.options.live.openai.values.model,
  );
  await backend
    .getByLabel("Anbieter", { exact: true })
    .selectOption("deepseek");
  await expect(
    backend.getByLabel("Dienstpriorität", { exact: false }),
  ).toHaveCount(0);
  await expect(backend.getByLabel("Modell", { exact: true })).toHaveText(
    settings.options.backend.deepseek.values.model,
  );
  await expect(
    backend.getByLabel("Denkintensität", { exact: true }),
  ).toHaveText(settings.options.backend.deepseek.values.reasoningEffort);
  await teacher.getByLabel("Anbieter", { exact: true }).selectOption("openai");
  await expect(teacher.getByLabel("Modell", { exact: true })).toHaveText(
    "gpt-6-luna",
  );
  await expect(
    teacher.getByLabel("Dienstpriorität", { exact: false }),
  ).toHaveCount(0);
  await transcription
    .getByLabel("Anbieter", { exact: true })
    .selectOption("openai");
  await expect(transcription.getByLabel("Stimme", { exact: true })).toHaveCount(
    0,
  );
  expect((await (await request.get("/api/health")).json()).live.provider).toBe(
    "gemini",
  );
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await page
    .getByRole("button", { name: "Einstellungen", exact: true })
    .click();
  await expect(live.getByLabel("Anbieter", { exact: true })).toHaveValue(
    "gemini",
  );
  await live.getByLabel("Anbieter", { exact: true }).selectOption("openai");
  await backend
    .getByLabel("Anbieter", { exact: true })
    .selectOption("deepseek");
  await teacher.getByLabel("Anbieter", { exact: true }).selectOption("openai");
  await transcription
    .getByLabel("Anbieter", { exact: true })
    .selectOption("openai");
  let sent;
  page.on("request", (req) => {
    if (req.url().endsWith("/api/settings") && req.method() === "POST")
      sent = req.postDataJSON();
  });
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.locator(".settings-success")).toContainText("jetzt aktiv");
  for (const role of Object.values(sent.roles))
    expect(Object.keys(role)).toEqual(["provider"]);
  const health = await (await request.get("/api/health")).json();
  expect(health.live).toMatchObject(settings.options.live.openai.values);
  expect(health.backend).toMatchObject(
    settings.options.backend.deepseek.values,
  );
  expect(health.backend.serviceTier).toBeUndefined();
  expect(health.teacher).toMatchObject({
    provider: "openai",
    model: "gpt-6-luna",
    serviceTier: "auto",
  });
  expect(health.transcription.provider).toBe("openai");
  await open(page);
  await expect(live.getByLabel("Anbieter", { exact: true })).toHaveValue(
    "openai",
  );
  await expect(
    teacher.getByLabel("Dienstpriorität", { exact: false }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("save errors retain provider draft, backend tier comes from environment, and defaults require saving", async ({
  page,
  request,
}) => {
  await open(page);
  const teacher = group(page, "Gespräche & Unterrichtsplan");
  const backend = group(page, "Unterrichts-Backend");
  const data = await (await request.get("/api/settings")).json();
  await expect(
    backend.getByLabel("Dienstpriorität", { exact: false }),
  ).toHaveText(data.options.backend.openai.values.serviceTier);
  await teacher.getByLabel("Anbieter", { exact: true }).selectOption("openai");
  await expect(
    teacher.getByLabel("Dienstpriorität", { exact: false }),
  ).toHaveCount(0);
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({
        status: 409,
        json: { error: "Bitte die laufende Stunde beenden." },
      });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("laufende Stunde");
  await expect(teacher.getByLabel("Anbieter", { exact: true })).toHaveValue(
    "openai",
  );
  expect(
    (await (await request.get("/api/health")).json()).teacher.provider,
  ).toBe("gemini");
  await page.unroute("**/api/settings");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.locator(".settings-success")).toContainText("jetzt aktiv");
  await page
    .getByRole("button", { name: "Standardwerte", exact: true })
    .last()
    .click();
  await expect(teacher.getByLabel("Anbieter", { exact: true })).toHaveValue(
    "gemini",
  );
  expect(
    (await (await request.get("/api/health")).json()).teacher.provider,
  ).toBe("openai");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.locator(".settings-success")).toContainText("jetzt aktiv");
});
test("settings fit narrow and desktop screens, retain keyboard focus and close with Escape", async ({
  page,
}) => {
  for (const viewport of [
    { width: 1280, height: 620 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await open(page);
    const geometry = await page.getByRole("dialog").evaluate((element) => ({
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
      width: element.scrollWidth,
      client: element.clientWidth,
    }));
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(viewport.width);
    expect(geometry.width).toBeLessThanOrEqual(geometry.client + 1);
    await page.getByRole("button", { name: "Fertig", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Schließen", exact: true }),
    ).toBeFocused();
    await page.screenshot({
      path: `.cache/settings-${viewport.width}.png`,
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Einstellungen", exact: true }),
    ).toBeFocused();
  }
});
