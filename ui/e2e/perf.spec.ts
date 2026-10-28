// 300 sites: every list opens and answers keys, clicks and typing without a long freeze.
// A long task is the browser busy for over 50 ms; none may pass the budget below.
import { expect, test, type Page } from "@playwright/test";

// shortcut: fixed budgets on the test machine's Chromium, not WebKitGTK; tighten if the real app ever feels slow.
// Opening a screen draws every row once (about 100 to 130 ms for 300 rows here, more with other tests running);
// after that, keys, ticks and typing must each answer within 100 ms, under what a person notices.
const OPEN = 300;
const ACT = 100;

async function watch(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { longest: number };
    w.longest = 0;
    new PerformanceObserver((l) => l.getEntries().forEach((e) => (w.longest = Math.max(w.longest, e.duration)))).observe({ type: "longtask" });
  });
}
const longest = (page: Page) => page.evaluate(() => (window as unknown as { longest: number }).longest);

async function open(page: Page, section: string) {
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: new RegExp(`^${section}`) }).click();
  await page.locator(".body > *").first().waitFor();
}

// One at a time, so other tests' work doesn't count as this page's.
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.goto("/?fixture=fleet300");
  await page.locator(".app").waitFor();
  await page.locator(".body > *").first().waitFor();
});

test("Sites with 300 sites: moving, ticking and filtering stay quick", async ({ page }) => {
  await open(page, "Sites");
  await expect(page.getByRole("grid", { name: "Sites" }).getByRole("row")).toHaveCount(301);
  await watch(page);
  await page.getByRole("grid", { name: "Sites" }).focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press("j");
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("x");
    await page.keyboard.press("j");
  }
  await expect(page.getByRole("region", { name: "Selection" })).toBeVisible();
  await page.keyboard.press("/");
  await page.keyboard.type("Portfolio 1");
  await expect(page.getByRole("grid", { name: "Sites" }).getByRole("row").nth(1)).toContainText("Portfolio");
  await page.keyboard.press("Escape");
  expect(await longest(page)).toBeLessThan(ACT);
});

test("Updates, Plugins, Monitoring, Overview and the palette with 300 sites stay quick", async ({ page }) => {
  await watch(page);
  for (const s of ["Updates", "Plugins", "Themes", "Monitoring", "Security", "Overview"]) await open(page, s);
  expect(await longest(page)).toBeLessThan(OPEN);
  await watch(page);
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Corner Bakery 2");
  await expect(page.getByRole("dialog", { name: "Command palette" }).getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await longest(page)).toBeLessThan(ACT);
});

test("the rail's Sites to show list and the Clients site picker with 300 sites stay quick", async ({ page }) => {
  await watch(page);
  const scope = page.getByRole("combobox", { name: "Sites to show" });
  await scope.focus();
  await page.keyboard.press("ArrowDown");
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  expect(await longest(page)).toBeLessThan(ACT);
  await open(page, "Clients");
  await page.getByRole("button", { name: "Add a client" }).first().click();
  const pick = page.getByRole("combobox", { name: "Their sites" });
  await pick.focus();
  await watch(page);
  for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Portfolio");
  expect(await longest(page)).toBeLessThan(ACT);
});
