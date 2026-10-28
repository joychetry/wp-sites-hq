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

test("the content editor works from the keyboard and gives focus back", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "content")!, "light");
  await page.getByRole("button", { name: "Pages", exact: true }).click();
  const open = page.getByRole("button", { name: "Our menu" });
  await open.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: /^Edit page/ });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("textbox", { name: "Paragraph 2" }).focus();
  await page.keyboard.type(" Closed Mondays.");
  await expect(sheet.getByRole("button", { name: "Save changes" })).toBeEnabled();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest(".sheet"))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(open).toBeFocused();
});

test("entries are ticked and changed in bulk from the keyboard", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "content")!, "light");
  await page.getByRole("checkbox", { name: "Tick Autumn opening hours" }).focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Make drafts (1)" }).focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Make drafts of 1 entry on MC A" });
  await expect(sheet.getByText("Make \u201cAutumn opening hours\u201d a draft").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Make drafts (1)" })).toBeFocused();
});

test("a comment is answered from the keyboard", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "comments")!, "light");
  const reply = page.getByRole("button", { name: "Reply to Mira Patel on MC A" });
  await reply.focus();
  await page.keyboard.press("Enter");
  const box = page.getByRole("textbox", { name: "Your reply to Mira Patel" });
  await expect(box).toBeFocused();
  await page.keyboard.type("Plain milk.");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Send the reply" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").getByText("Replied to Mira Patel on MC A.")).toBeVisible();
});

test("a feature is turned on and undone from the keyboard", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "classic-monks")!, "light");
  await page.getByRole("button", { name: "Turn on SVG Support" }).focus();
  await page.keyboard.press("Enter");
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(page.getByText("Turned on SVG Support on MC A.")).toBeVisible();
  await undo.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/^Undone: Turned on SVG Support/)).toBeVisible();
});

test("an AI agent's plan is confirmed from the keyboard and its progress shows", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "ai")!, "light");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "AI 1 to confirm" })).toBeVisible();
  await page.getByRole("button", { name: "Decline Update WooCommerce on 3 sites" }).focus();
  await page.keyboard.press("Tab");
  const confirm = page.getByRole("button", { name: "Confirm and run 3 changes: Update WooCommerce on 3 sites" });
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: /^Update WooCommerce on 3 sites/ });
  await expect(sheet.getByText(/^Finished\./)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "No plans are waiting." })).toBeVisible();
});

test("the palette opens an agent's plan with focus on it, two Tabs from Confirm", async ({ page }) => {
  await show(page, SCREENS[0], "light");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Review the AI");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Update WooCommerce on 3 sites" })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Confirm and run 3 changes: Update WooCommerce on 3 sites" })).toBeFocused();
});

test("AI agent access is turned on from the keyboard", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "ai-access")!, "light");
  await page.getByRole("button", { name: "Turn on access for Portfolio" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/leave "This is my Monks Central app \(operator\)" unticked/)).toBeVisible();
  await expect(page.getByText("AI agents can change Portfolio now. The site asks you to approve each change.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn off access for Portfolio" })).toBeVisible();
});

test("Tab stays inside the Add a user sheet, and Esc gives focus back", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "users")!, "light");
  const add = page.getByRole("button", { name: "Add a user" });
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Add a user" })).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest(".sheet"))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(add).toBeFocused();
});

test.describe("200% zoom", () => {
  test.use({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 });
  for (const name of ["overview", "sites", "settings", "add-site", "updates", "plugins", "updates-plan", "install", "content", "content-editor", "media", "users", "users-add", "comments", "classic-monks", "classic-monks-activity", "ai", "ai-access", "ai-activity", "ai-connect", "security", "updates-progress", "monitoring", "content-history", "content-bulk", "publish-many"]) {
    test(`${name} loses nothing sideways`, async ({ page }) => {
      await show(page, SCREENS.find((s) => s.name === name)!, "light");
      const wide = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(wide).toBeLessThanOrEqual(720);
    });
  }
});

test("a vulnerable plugin is fixed from the keyboard, through the plan", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "security")!, "light");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Security 2 known vulnerabilities" })).toBeVisible();
  await page.getByRole("button", { name: "Read more about WooCommerce < 10.3.0 - Authenticated (Shop Manager+) Stored Cross-Site Scripting via product reviews" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Update to 10.3.0 on MC A" })).toBeFocused();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: /^Update WooCommerce on MC A/ });
  await expect(sheet.getByRole("checkbox", { name: "Update WooCommerce on MC A" })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("PageSpeed runs from the keyboard and the result shows in its row", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "monitoring")!, "light");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Monitoring 1 down" })).toBeVisible();
  await expect(page.getByText(/^1 site is down: Corner Bakery\./)).toBeVisible();
  const run = page.getByRole("button", { name: "Run PageSpeed again on Portfolio" });
  await run.focus();
  await page.keyboard.press("Enter");
  const row = page.getByRole("row").filter({ hasText: "Portfolio" });
  await expect(row.getByText("81")).toBeVisible();
  await expect(run).toBeFocused();
});

test("a rolled back update shows why, and only the failed change is offered again", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "updates-progress")!, "light");
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Rolled back", { exact: true })).toBeVisible();
  await expect(sheet.getByText(/^Rolled back to 5\.3\. The home page answered 500/)).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Try the 1 failed change again" })).toBeVisible();
});

test("a long reason in the activity log wraps, so Result stays in view", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "ai-activity")!, "light");
  const sideways = await page.evaluate(() => {
    let el = document.querySelector('table[aria-label="Activity"]')!.parentElement;
    while (el && el.scrollWidth <= el.clientWidth) el = el.parentElement;
    return el?.tagName ?? null;
  });
  expect(sideways).toBeNull();
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
