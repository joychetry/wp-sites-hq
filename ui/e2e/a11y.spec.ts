// SPDX-License-Identifier: GPL-3.0-or-later
// axe on every screen, in both themes and both row heights, plus the
// keyboard and zoom checks axe can't do. Serious and critical issues fail.
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { choose, SCREENS, show } from "./screens";

for (const s of SCREENS) {
  for (const theme of ["light", "dark"]) {
    for (const density of ["comfortable", "compact"]) {
      test(`axe: ${s.name}, ${theme}, ${density}`, async ({ page }) => {
        await show(page, s, theme, density);
        const { violations } = await new AxeBuilder({ page })
          // The report preview runs no scripts, so axe can't go inside it.
          .exclude("iframe.preview")
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
  await expect(page.getByRole("button", { name: /^Add a site/ })).toBeFocused();
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
  await expect(page.getByRole("region", { name: "Selection" })).toContainText("1 site ticked");
  await page.keyboard.press("Escape");
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox", { name: "Filter sites" })).toBeFocused();
});

test("the Plugins matrix is one Tab stop, arrow keys move and Enter opens a cell", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "plugins")!, "light");
  await page.getByRole("button", { name: /^Status:/ }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /^WooCommerce on MC A/ })).toBeFocused();
  await page.keyboard.press("ArrowRight");
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

// Next swaps the step's content under the focused button; focus must land on the new step, not the page behind.
test("focus stays in the Add a site sheet at step 2", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "add-site-basic")!, "light");
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest(".sheet"))).toBe(true);
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
  await page.getByRole("button", { name: "Our menu" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Edit page on MC A" })).toBeVisible();
  // Tab from the title reaches the slug, then the first text block, which starts its editor.
  await page.getByRole("textbox", { name: "Title" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("textbox", { name: "Slug" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("textbox", { name: "Heading, H2 (block 1)" })).toBeFocused();
  await page.keyboard.press("Tab");
  const text = page.getByRole("textbox", { name: "Paragraph (block 2)" });
  await expect(text).toBeFocused();
  await expect(text).toHaveAttribute("contenteditable", "true");
  await page.keyboard.press("End");
  await page.keyboard.type(" Closed Mondays.");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  // Ctrl+S saves from inside the editor.
  await page.keyboard.press("Control+s");
  await expect(page.getByText('Saved "Our menu" on MC A.')).toBeVisible();
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  await page.getByRole("button", { name: "Back to pages" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Our menu" })).toBeFocused();
});

test("leaving with unsaved changes asks, from Back and from the rail", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "content-leave")!, "light");
  const ask = page.getByRole("dialog", { name: "Leave without saving?" });
  await page.keyboard.press("Escape");
  await expect(ask).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Our winter menu");
  // The rail's Sites to show filter could hide the entry's site: it asks too, and Keep editing keeps both.
  const scope = page.getByRole("combobox", { name: "Sites to show" });
  await choose(scope, { name: "Group: Personal" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Keep editing" }).click();
  await expect(scope).toContainText("All sites");
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Our winter menu");
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Media/ }).click();
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Leave without saving" }).click();
  await expect(page.getByRole("heading", { name: "Media", exact: true })).toBeVisible();
});

test("saving and its messages never move the page: title, a body edit and an ACF error", async ({ page }) => {
  const y = async (l: ReturnType<typeof page.locator>) => (await l.boundingBox())!.y;
  await show(page, SCREENS.find((s) => s.name === "content-classic")!, "light");
  const title = page.getByRole("textbox", { name: "Title" });
  const top = await y(title);
  await page.getByRole("textbox", { name: "Body" }).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" New line.");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  expect(await y(title)).toBe(top);
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await expect(page.getByText('Saved "Winter opening hours" on MC A.')).toBeVisible();
  expect(await y(title)).toBe(top);

  await show(page, SCREENS.find((s) => s.name === "content-acf")!, "light");
  const mail = page.getByRole("textbox", { name: "Email" });
  await mail.fill("baker@");
  const at = await y(mail);
  await page.keyboard.press("Control+s");
  await expect(page.getByText(/Nothing was saved/)).toBeVisible();
  await expect(mail).toHaveAttribute("aria-invalid", "true");
  expect(await y(mail)).toBe(at);
});

test("site HTML with position: fixed stays inside the editor, never over the window", async ({ page }) => {
  // A fixed box put inside an editor fills that editor's padding box, not the viewport.
  const fill = (el: Element) => {
    const d = document.createElement("div");
    d.style.cssText = "position: fixed; inset: 0; z-index: 99999";
    el.append(d);
    const r = d.getBoundingClientRect(), b = el.getBoundingClientRect();
    d.remove();
    return [r.x - b.x - el.clientLeft, r.y - b.y - el.clientTop, r.width - el.clientWidth, r.height - el.clientHeight];
  };
  await show(page, SCREENS.find((s) => s.name === "content-classic")!, "light");
  await expect(page.getByRole("textbox", { name: "Body" })).toHaveAttribute("contenteditable", "true");
  expect(await page.getByRole("textbox", { name: "Body" }).evaluate(fill)).toEqual([0, 0, 0, 0]);
  await show(page, SCREENS.find((s) => s.name === "content-block-text")!, "light");
  expect(await page.locator(".blk-text").first().evaluate(fill)).toEqual([0, 0, 0, 0]);
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

test("export is two buttons from the keyboard; the import picker is the next Tab stop with a focus ring", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "settings")!, "light");
  await page.getByRole("button", { name: "Export as JSON" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Export as CSV" })).toBeFocused();
  await page.keyboard.press("Tab");
  const pick = page.getByRole("button", { name: "Import a JSON or CSV file" });
  await expect(pick).toBeFocused();
  expect(await pick.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
});

test("a client is added from the keyboard", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "clients")!, "light");
  await page.getByRole("button", { name: "Add a client" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Name" })).toBeFocused();
  await page.keyboard.type("Hill Farm");
  // Their sites: a multi-select, typed into and ticked with Enter, focus stays in the box.
  const theirs = page.getByRole("combobox", { name: "Their sites" });
  await theirs.focus();
  await page.keyboard.type("mc-c");
  await expect(page.getByRole("option", { name: "mc-c" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option", { name: "mc-c" })).toHaveAttribute("aria-selected", "true");
  await expect(theirs).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add a client" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove mc-c" })).toBeVisible();
  await page.getByRole("button", { name: "Add the client" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Added Hill Farm.")).toBeVisible();
});

test("a comment is answered from the keyboard", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "comments")!, "light");
  const reply = page.getByRole("button", { name: "Reply to Mira Patel on MC A" });
  await reply.focus();
  await page.keyboard.press("Enter");
  const box = page.getByRole("textbox", { name: "Your reply to Mira Patel" });
  await expect(box).toBeFocused();
  await page.keyboard.type("Plain milk.");
  // Cancel, then Send the reply: the design's order, the primary last.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Send the reply" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").getByText("Replied to Mira Patel on MC A.")).toBeVisible();
});

test("a feature is turned on and undone from the keyboard", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "classic-monks")!, "light");
  await page.getByRole("switch", { name: "SVG Support" }).focus();
  await page.keyboard.press("Space");
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
  await expect(page.getByRole("heading", { name: "Update WooCommerce on 3 sites" })).toHaveCount(0);
  // An expired plan has no Confirm: it only goes away.
  await expect(page.getByRole("button", { name: /^Confirm and run .*Turn off Akismet/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Remove Turn off Akismet on Portfolio" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "No plans waiting" })).toBeVisible();
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

test("the palette searches everything, and a result opens its site from the keyboard", async ({ page }) => {
  await show(page, SCREENS[0], "light");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("bakery");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("table", { name: "Posts and pages found" }).or(page.getByText("No posts or pages match on any site."))).toBeVisible();
  const open = page.getByRole("button", { name: "Open on Sites: Corner Bakery" });
  for (let i = 0; i < 40 && !(await open.evaluate((b) => b === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(open).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Sites/ })).toHaveAttribute("aria-current", "page");
});

test("a product's stock is changed from the keyboard, ending at the confirm step", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "store")!, "light");
  await page.getByRole("button", { name: "Change price or stock of Sourdough loaf" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Change Sourdough loaf" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Price", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  // Tab selects the field's text, so typing replaces it.
  await page.keyboard.type("30");
  await expect(page.getByText("Change \u201cSourdough loaf\u201d: stock 30")).toBeVisible();
  for (let i = 0; i < 4 && !(await page.getByRole("button", { name: "Review the change" }).evaluate((b) => b === document.activeElement)); i++) await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Change \u201cSourdough loaf\u201d: stock 30" })).toBeVisible();
});

test("a monthly report is made and opened from the keyboard", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "reports")!, "light");
  await page.getByRole("button", { name: "Make the report" }).focus();
  await page.keyboard.press("Enter");
  const pdf = page.getByRole("button", { name: "Open the PDF" });
  await expect(pdf).toBeVisible();
  await pdf.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTitle("Report preview")).toBeVisible();
});

test("AI agent access is turned on from the keyboard", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "ai-access")!, "light");
  const access = page.getByRole("tabpanel").getByRole("switch", { name: "Access for Portfolio" });
  await access.focus();
  await page.keyboard.press("Space");
  await expect(page.getByText(/leave "This is my WP Sites HQ app \(operator\)" \(older plugins say Monks Central app\) unticked/)).toBeVisible();
  await expect(page.getByText("AI agents can change Portfolio now. The site asks you to approve each change.")).toBeVisible();
  await expect(access).toBeChecked();
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
  for (const name of ["overview", "sites", "settings", "add-site", "updates", "plugins", "updates-plan", "install", "content", "content-editor", "content-classic", "content-acf", "media", "users", "users-add", "comments", "classic-monks", "classic-monks-activity", "ai", "ai-access", "ai-activity", "ai-connect", "security", "updates-progress", "monitoring", "content-history", "content-bulk", "publish-many", "clients", "client-edit", "cost-add", "settings-exported", "install-zip", "install-bundle-edit", "search", "store", "store-change", "classic-monks-reports", "reports", "reports-made", "settings-search-console"]) {
    test(`${name} loses nothing sideways`, async ({ page }) => {
      await show(page, SCREENS.find((s) => s.name === name)!, "light");
      const wide = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(wide).toBeLessThanOrEqual(720);
    });
  }
});

test("the Sites table fits beside the site panel without scrolling sideways", async ({ page }) => {
  for (const [width, density] of [[1440, "comfortable"], [1301, "comfortable"], [1200, "comfortable"], [1200, "compact"]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await show(page, SCREENS.find((s) => s.name === "sites-selected")!, "light", density);
    const [scroll, client] = await page.locator(".page-main").evaluate((e) => [e.scrollWidth, e.clientWidth]);
    expect(scroll, `${width}px, ${density}`).toBeLessThanOrEqual(client);
  }
});

test("a finished job lists every change under the progress bar", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "updates-progress")!, "light");
  for (const row of await page.getByRole("dialog").getByRole("listitem").all()) await expect(row).toBeInViewport();
});

test("a vulnerable plugin is fixed from the keyboard, through the plan", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "security")!, "light");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Security 2 known vulnerabilities" })).toBeVisible();
  await page.getByRole("button", { name: "Read more about WooCommerce < 10.3.0 - Authenticated (Shop Manager+) Stored Cross-Site Scripting via product reviews" }).focus();
  // The update comes first in the card, Read more after it.
  await page.keyboard.press("Shift+Tab");
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
  await expect(row.getByText(/^81 · /)).toBeVisible();
  await expect(run).toBeFocused();
});

test("a rolled back update shows why, and only the failed change is offered again", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "updates-progress")!, "light");
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Rolled back", { exact: true })).toBeVisible();
  await expect(sheet.getByText("Rolled back to 5.3 because the update broke the site.")).toBeVisible();
  await sheet.getByText("Show the details").click();
  await expect(sheet.getByText(/^Rolled back to 5\.3\. The home page answered 500/)).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Try the 1 failed change again" })).toBeVisible();
});

test("a long reason in the activity log wraps, so Result stays in view", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "ai-activity")!, "light");
  const sideways = await page.evaluate(() => {
    let el = document.querySelector('ul[aria-label="Activity"]')!.parentElement;
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
      return parseFloat(getComputedStyle(document.querySelector(".stat .label")!).fontSize);
    }, px);
  expect(await at(16)).toBe(12);
  expect(await at(24)).toBe(18);
});

test("results never move the rows: ticking sites, a check, a feature and its Undo", async ({ page }) => {
  const y = async (l: ReturnType<typeof page.locator>) => (await l.boundingBox())!.y;
  await show(page, SCREENS.find((s) => s.name === "sites")!, "light");
  const portfolio = page.getByRole("checkbox", { name: "Select Portfolio" });
  const before = await y(portfolio);
  await page.getByRole("checkbox", { name: "Select MC A" }).click();
  await expect(page.getByRole("region", { name: "Selection" })).toContainText("1 site ticked");
  expect(await y(portfolio)).toBe(before);
  await portfolio.click();
  await expect(page.getByRole("region", { name: "Selection" })).toContainText("2 sites ticked");
  await page.getByRole("region", { name: "Selection" }).getByRole("button", { name: /Check them now/ }).click();
  expect(await y(portfolio)).toBe(before);

  await show(page, SCREENS.find((s) => s.name === "classic-monks")!, "light");
  const first = page.getByRole("switch").first();
  const top = await y(first);
  await page.getByRole("switch", { name: "SVG Support" }).click();
  await expect(page.getByText("Turned on SVG Support on MC A.")).toBeVisible();
  expect(await y(first)).toBe(top);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText(/^Undone: Turned on SVG Support/)).toBeVisible();
  expect(await y(first)).toBe(top);
});

test("approving from the keyboard moves focus to the next comment, and a new screen clears the messages", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "comments")!, "light");
  await page.getByRole("button", { name: "Approve Mira Patel's comment on MC A" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Approved: Mira Patel's comment on MC A.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Approve Guest's comment/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Approve Tom's comment/ })).toBeFocused();
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Sites/ }).click();
  await expect(page.getByText(/^Approved: /)).toHaveCount(0);
});

test("custom field boxes are as tall as the other fields, and Remove lines up with its box", async ({ page }) => {
  await show(page, SCREENS.find((s) => s.name === "content-editor")!, "light");
  const sheet = page.getByRole("region", { name: "Custom fields" });
  const fields = sheet.getByRole("group", { name: "Custom fields" });
  const title = (await fields.getByRole("textbox", { name: "New field value" }).boundingBox())!;
  for (const name of ["New field name", "New field value", "opening_hours"]) {
    const box = (await fields.getByRole("textbox", { name }).boundingBox())!;
    expect(box.height, name).toBe(title.height);
  }
  const value = (await fields.getByRole("textbox", { name: "opening_hours" }).boundingBox())!;
  const remove = (await fields.getByRole("button", { name: "Remove the field opening_hours" }).boundingBox())!;
  expect(remove.y).toBe(value.y);
  expect(remove.height).toBe(value.height);
  const add = (await fields.getByRole("button", { name: "Add the field" }).boundingBox())!;
  expect(add.height).toBe(title.height);
});

test("plugins and themes show their WordPress.org pictures in tiles the size of the monograms", async ({ page }) => {
  const tile = (name: RegExp) => page.getByRole("rowheader", { name }).locator(".ptile");
  const size = async (l: ReturnType<typeof tile>) => {
    const b = (await l.boundingBox())!;
    return [b.width, b.height];
  };
  await show(page, SCREENS.find((s) => s.name === "plugins")!, "light");
  const row = page.getByRole("rowheader", { name: /^WooCommerce/ });
  const top = (await row.boundingBox())!;
  await expect(tile(/^WooCommerce/).locator("img")).toBeVisible();
  await expect(tile(/^Classic Monks/)).toHaveText("C");
  expect(await size(tile(/^WooCommerce/))).toEqual(await size(tile(/^Classic Monks/)));
  expect((await row.boundingBox())!).toEqual(top);
  await show(page, SCREENS.find((s) => s.name === "themes")!, "light");
  await expect(tile(/^Twenty Twenty-Five/).locator("img")).toBeVisible();
  await expect(tile(/^Bricks/)).toHaveText("B");
  expect(await size(tile(/^Twenty Twenty-Five/))).toEqual(await size(tile(/^Bricks/)));
});
