// axe on every screen, in both themes and both row heights, plus the
// keyboard and zoom checks axe can't do. Serious and critical issues fail.
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { SCREENS, show } from "./screens";

for (const s of SCREENS) {
  for (const theme of ["light", "dark"]) {
    for (const density of ["comfortable", "compact"]) {
      test(`axe: ${s.name}, ${theme}, ${density}`, async ({ page }) => {
        await show(page, s, theme, density);
        const { violations } = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
          .analyze();
        const bad = violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
        expect(bad).toEqual([]);
      });
    }
  }
}

test("Tab reaches the skip link first, and it moves focus to the content", async ({ page }) => {
  await show(page, SCREENS[0], "light");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("#content")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Check again" })).toBeFocused();
});

test("every focusable control shows a focus ring", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "sites")!, "light");
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      // Focus leaves the page for the browser between the last control and the first.
      if (el === document.body) return { name: "the browser", shown: true };
      const box = el.closest(".scope") ?? el;
      const cs = getComputedStyle(box);
      const own = getComputedStyle(el);
      return {
        name: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30),
        shown: (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2) || (own.outlineStyle !== "none" && parseFloat(own.outlineWidth) >= 2),
      };
    });
    expect(ring, `focus ring on ${ring.name}`).toMatchObject({ shown: true });
  }
});

test("the Sites table works from the keyboard", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "sites")!, "light");
  await page.getByRole("grid", { name: "Sites" }).focus();
  await page.keyboard.press("j");
  await expect(page.getByRole("complementary", { name: "Corner Bakery details" })).toBeVisible();
  await page.keyboard.press("x");
  await expect(page.getByRole("region", { name: "Selection" })).toContainText("1 selected");
  await page.keyboard.press("Escape");
  await page.keyboard.press("/");
  await expect(page.getByRole("textbox", { name: "Filter sites" })).toBeFocused();
});

test("the Plugins matrix is one Tab stop, arrow keys move and Enter opens a cell", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "plugins")!, "light");
  await page.getByRole("button", { name: /^Update \d+ plugins/ }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /^WooCommerce on MC A/ })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: /^WooCommerce on mc-c/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("complementary", { name: "WooCommerce on mc-c" })).toBeVisible();
  // The next Tab leaves the grid instead of walking every cell.
  await page.getByRole("button", { name: /^WooCommerce on mc-c/ }).focus();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.closest("[role=grid]"))).toBeNull();
});

test("Tab stays inside the job sheet, and Esc gives focus back", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "updates")!, "light");
  const open = page.getByRole("button", { name: /^Update all/ });
  await open.click();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest(".sheet"))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(open).toBeFocused();
});

test("Tab stays inside the Add a site sheet", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "add-site")!, "light");
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest(".sheet"))).toBe(true);
  }
});

test("the palette gives focus back when it closes", async ({ page }) => {
  await show(page, SCREENS[0], "light");
  const search = page.getByRole("button", { name: /^Search or run/ });
  await search.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("combobox", { name: "Command" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(search).toBeFocused();
});

test.describe("200% zoom", () => {
  test.use({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 });
  for (const name of ["overview", "sites", "settings", "add-site", "updates", "plugins", "updates-plan", "install"]) {
    test(`${name} loses nothing sideways`, async ({ page }) => {
      await show(page, SCREENS.find((s) => s.name === name)!, "light");
      const wide = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(wide).toBeLessThanOrEqual(720);
    });
  }
});

test("text grows with the browser's text size", async ({ page }) => {
  await show(page, SCREENS[0], "light");
  const at = (px: number) =>
    page.evaluate((px) => {
      document.documentElement.style.fontSize = `${px}px`;
      return parseFloat(getComputedStyle(document.querySelector(".kpi .l")!).fontSize);
    }, px);
  expect(await at(16)).toBe(13);
  expect(await at(24)).toBe(19.5);
});
