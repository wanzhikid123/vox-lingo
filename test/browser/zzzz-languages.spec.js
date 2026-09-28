import { test, expect } from "@playwright/test";
import { fakeMedia } from "./fake-media.js";

const defaults = {
  interfaceLanguage: "de",
  instructionLanguage: "de",
  targetLanguage: "en",
};
const saved = async (request) => (await request.get("/api/languages")).json();
const persist = async (request, languages = defaults) => {
  const current = await saved(request);
  expect(
    (
      await request.post("/api/languages", {
        data: { revision: current.revision, languages },
      })
    ).ok(),
  ).toBeTruthy();
};
const open = async (page) => {
  await page.locator("button.settings-button").click();
  await expect(page.locator("#language-interfaceLanguage")).toBeEnabled();
};
test.beforeEach(async ({ request }) => persist(request));
test.afterEach(async ({ request }) => persist(request));

for (const close of ["button", "escape", "backdrop", "footer", "reload"])
  test(`language preview rolls back on ${close}, preserving saved content and input`, async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await page
      .getByRole("button", { name: "Vorbereitung", exact: true })
      .click();
    const input = page.locator("#preparation-message");
    await input.fill("我的草稿 bleibt stehen");
    await open(page);
    await page.locator("#language-interfaceLanguage").selectOption("zh-CN");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(
      page.getByRole("button", { name: "保存语言设置", exact: true }),
    ).toBeEnabled();
    expect((await saved(request)).languages).toEqual(defaults);
    if (close === "button")
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "关闭", exact: true })
        .click();
    if (close === "escape") await page.keyboard.press("Escape");
    if (close === "backdrop")
      await page.locator(".modal-backdrop").click({ position: { x: 3, y: 3 } });
    if (close === "footer")
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "完成", exact: true })
        .click();
    if (close === "reload") await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    if (close !== "reload")
      await expect(input).toHaveValue("我的草稿 bleibt stehen");
  });

test("saving is independent, persists after reload, and cancel restores the most recent save", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await open(page);
  await page.locator("#settings-live-provider").selectOption("openai");
  await page.locator("#language-interfaceLanguage").selectOption("en");
  await page.locator("#language-instructionLanguage").selectOption("zh-CN");
  await page.locator("#language-targetLanguage").selectOption("ja");
  await page
    .getByRole("button", { name: "Save languages", exact: true })
    .click();
  await expect(
    page.locator(".language-settings").getByRole("status"),
  ).toContainText("Saved");
  expect(
    (await (await request.get("/api/settings")).json()).roles.live.provider,
  ).toBe("gemini");
  expect((await saved(request)).languages).toEqual({
    interfaceLanguage: "en",
    instructionLanguage: "zh-CN",
    targetLanguage: "ja",
  });
  await page.locator("#language-interfaceLanguage").selectOption("zh-CN");
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator(".topic-card")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await open(page);
  await expect(page.locator("#language-targetLanguage")).toHaveValue("ja");
  await expect(page.locator("#settings-live-provider")).toHaveValue("gemini");
  await page
    .locator(".language-settings")
    .getByRole("button", { name: "Defaults", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  expect((await saved(request)).languages.targetLanguage).toBe("ja");
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("failed saves retain the preview and a stale window cannot overwrite newer preferences", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await open(page);
  await page.locator("#language-interfaceLanguage").selectOption("zh-CN");
  await page.route("**/api/languages", async (route) => {
    if (route.request().method() === "POST")
      return route.fulfill({ status: 500, json: { code: "operationFailed" } });
    await route.continue();
  });
  await page.getByRole("button", { name: "保存语言设置", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("尚未保存");
  await expect(page.locator("#language-interfaceLanguage")).toHaveValue(
    "zh-CN",
  );
  expect((await saved(request)).languages).toEqual(defaults);
  await page.unroute("**/api/languages");
  await persist(request, { ...defaults, targetLanguage: "ko" });
  await page.getByRole("button", { name: "保存语言设置", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("另一个窗口");
  await page
    .getByRole("button", { name: "重新读取已保存设置", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.locator("#language-targetLanguage")).toHaveValue("ko");
  await page.locator("#language-interfaceLanguage").selectOption("en");
  await page.keyboard.press("Escape");
  expect((await saved(request)).languages.targetLanguage).toBe("ko");
});

test("an active classroom keeps its question, connection and frozen languages while settings change", async ({
  page,
  request,
}) => {
  await page.addInitScript(fakeMedia);
  const lesson = await (
    await request.post("/fixture/media-lesson", { data: { practice: true } })
  ).json();
  await page.goto("/");
  await page.getByRole("button", { name: "Stunde öffnen" }).click();
  await page.getByRole("button", { name: "Erneut verbinden" }).click();
  await expect(page.locator(".connection")).toHaveText("Verbunden");
  const before = await (await request.get(`/api/lessons/${lesson.id}`)).json();
  let connects = 0;
  page.on("request", (req) => {
    if (req.url().endsWith("/connect")) connects++;
  });
  await open(page);
  await page.locator("#language-interfaceLanguage").selectOption("zh-CN");
  await page.locator("#language-instructionLanguage").selectOption("en");
  await page.locator("#language-targetLanguage").selectOption("fr");
  await page.getByRole("button", { name: "保存语言设置", exact: true }).click();
  await expect(
    page.locator(".language-settings").getByRole("status"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  expect(connects).toBe(0);
  expect(await page.evaluate(() => window.fixtureMedia.stopped)).toBe(0);
  const after = await (await request.get(`/api/lessons/${lesson.id}`)).json();
  expect(after.state.question).toEqual(before.state.question);
  expect(after.state.question).toBeTruthy();
  expect(after.state.languages).toEqual({
    instructionLanguage: "de",
    targetLanguage: "en",
  });
  await request.post(`/api/lessons/${lesson.id}/end`, {
    data: { status: "interrupted" },
  });
});

test("three locales fit desktop and mobile settings", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [1440, 390])
    for (const locale of ["de", "en", "zh-CN"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await open(page);
      await page.locator("#language-interfaceLanguage").selectOption(locale);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await page
          .locator(".settings-modal")
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`languages-${locale}-${width}.png`),
        fullPage: true,
      });
      await page.keyboard.press("Escape");
    }
  expect(errors).toEqual([]);
});
