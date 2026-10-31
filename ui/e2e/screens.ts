// SPDX-License-Identifier: GPL-3.0-or-later
// Every screen the UI has, as a URL plus the steps that open it.
import type { Locator, Page } from "@playwright/test";

export type Screen = { name: string; fixture?: string; open?: (page: Page) => Promise<unknown> };

/** Picks an option in a custom Select (components/controls.tsx) by its words or its value. */
export async function choose(select: Locator, by: { name: string } | { value: string }) {
  await select.click();
  const page = select.page();
  await ("name" in by ? page.getByRole("option", { name: by.name, exact: true }) : page.locator(`[role="option"][data-value="${by.value}"]`)).click();
}

// Each page is a lazy chunk: wait until it is drawn, so its own keys are listening before the next step.
const nav = (name: string) => async (page: Page) => {
  // Under 900px wide (200% zoom) the nav is behind the Menu button.
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await page.locator(".body > :not(.phead):not(.page-loading)").first().waitFor();
  await page.locator(".page-loading").waitFor({ state: "detached" });
};

export const SCREENS: Screen[] = [
  { name: "overview" },
  { name: "overview-empty", fixture: "empty" },
  { name: "overview-first-site", fixture: "first" },
  { name: "sites", open: nav("Sites") },
  {
    name: "sites-selected",
    open: async (page) => {
      await nav("Sites")(page);
      await page.getByRole("checkbox", { name: "Select MC A" }).click();
      await page.getByRole("checkbox", { name: "Select Portfolio" }).click();
    },
  },
  {
    name: "sites-sign-in-again",
    open: async (page) => {
      await nav("Sites")(page);
      await page.getByRole("gridcell", { name: /^WP Sites HQ Test / }).click();
    },
  },
  {
    name: "sites-no-tools",
    open: async (page) => {
      await nav("Sites")(page);
      await page.getByRole("gridcell", { name: /^Studio Blog / }).click();
    },
  },
  {
    name: "sites-basic-get-plugin",
    open: async (page) => {
      await nav("Sites")(page);
      await page.getByRole("gridcell", { name: /^mc-c / }).click();
      await page.getByRole("complementary").getByRole("button", { name: "Install the WP Sites HQ plugin for me" }).click();
      await page.getByRole("complementary").getByText(/is saved as/).waitFor();
    },
  },
  { name: "add-site", open: (page) => nav("Sites")(page).then(() => page.keyboard.press("a")) },
  {
    name: "add-site-basic",
    open: async (page) => {
      await nav("Sites")(page);
      await page.keyboard.press("a");
      await page.getByRole("textbox", { name: "Site address" }).fill("https://mc-e.test");
      // The radio sits inside its card; the card is what you click.
      await page.locator("label.choice", { hasText: "Basic mode" }).click();
      await page.getByRole("button", { name: /^Next/ }).click();
    },
  },
  {
    name: "sign-in-again",
    open: async (page) => {
      await nav("Sites")(page);
      await page.getByRole("gridcell", { name: /^WP Sites HQ Test / }).click();
      await page.getByRole("complementary").getByRole("button", { name: "Sign in again" }).click();
    },
  },
  { name: "palette", open: (page) => page.keyboard.press("Control+k") },
  { name: "settings", open: nav("Settings") },
  { name: "reports", open: nav("Reports") },
  {
    name: "reports-made",
    open: async (page) => {
      await nav("Reports")(page);
      await page.getByRole("button", { name: "Make the report" }).click();
      await page.getByRole("button", { name: "Open the PDF" }).waitFor();
    },
  },
  {
    name: "settings-search-console",
    open: async (page) => {
      await nav("Settings")(page);
      await page.getByRole("switch", { name: /Google Search Console/ }).check();
      await page.getByRole("textbox", { name: "Client ID" }).waitFor();
    },
  },  { name: "store", open: (page) => nav("Store")(page).then(() => page.getByRole("table", { name: "Products" }).waitFor()) },
  {
    name: "store-change",
    open: async (page) => {
      await nav("Store")(page);
      await page.getByRole("button", { name: "Change price or stock of Rye loaf" }).click();
      await page.getByRole("textbox", { name: "Sale price" }).fill("");
      await page.getByRole("textbox", { name: "Stock" }).fill("30");
    },
  },
  {
    name: "store-confirm",
    open: async (page) => {
      await nav("Store")(page);
      await page.getByRole("button", { name: "Change price or stock of Rye loaf" }).click();
      // The same edit as store-change, so the review shows the sale price going too.
      await page.getByRole("textbox", { name: "Sale price" }).fill("");
      await page.getByRole("textbox", { name: "Stock" }).fill("30");
      await page.getByRole("button", { name: "Review the change" }).click();
    },
  },
  {
    name: "classic-monks-reports",
    open: async (page) => {
      await nav("Classic Monks")(page);
      await page.getByRole("tablist", { name: "Show" }).getByRole("tab", { name: "Reports", exact: true }).click();
      await page.getByRole("table", { name: "Pages not found" }).waitFor();
    },
  },
  { name: "clients", open: nav("Clients") },
  { name: "clients-empty", fixture: "empty", open: nav("Clients") },
  {
    name: "client-edit",
    open: async (page) => {
      await nav("Clients")(page);
      await page.getByRole("button", { name: "Corner Bakery" }).click();
    },
  },
  {
    name: "cost-add",
    open: async (page) => {
      await nav("Clients")(page);
      await page.getByRole("button", { name: "Add a cost or charge" }).click();
      await choose(page.getByRole("combobox", { name: "On" }), { name: "MC A" });
      await page.getByRole("textbox", { name: "What it is" }).fill("Backups");
      await page.getByRole("textbox", { name: "Amount" }).fill("5.50");
    },
  },
  {
    name: "cost-calendar",
    open: async (page) => {
      await nav("Clients")(page);
      await page.getByRole("button", { name: "Add a cost or charge" }).click();
      await page.getByRole("button", { name: "Choose the renews on from a calendar" }).click();
      await page.getByRole("grid").waitFor();
    },
  },
  {
    name: "settings-exported",
    open: async (page) => {
      await nav("Settings")(page);
      await page.getByRole("button", { name: "Export as JSON" }).click();
      await page.getByRole("button", { name: "Show in folder" }).waitFor();
    },
  },
  { name: "security", open: nav("Security") },
  { name: "monitoring", open: nav("Monitoring") },
  { name: "monitoring-empty", fixture: "empty", open: nav("Monitoring") },
  { name: "security-empty", fixture: "empty", open: nav("Security") },
  { name: "users", open: nav("Users") },
  {
    name: "users-add",
    open: async (page) => {
      await nav("Users")(page);
      await page.getByRole("button", { name: "Add a user" }).click();
      await choose(page.getByRole("combobox", { name: "Role" }), { value: "administrator" });
    },
  },
  {
    name: "users-delete",
    open: async (page) => {
      await nav("Users")(page);
      await page.getByRole("button", { name: "Delete Sam Okafor from MC A" }).click();
      await page.getByRole("combobox", { name: "Give their posts and pages to" }).waitFor();
    },
  },
  { name: "comments", open: nav("Comments") },
  {
    name: "comments-reply",
    open: async (page) => {
      await nav("Comments")(page);
      await page.getByRole("button", { name: "Reply to Mira Patel on MC A" }).click();
      await page.getByRole("textbox", { name: "Your reply to Mira Patel" }).fill("Plain milk, and a spoon of yoghurt.");
    },
  },
  { name: "classic-monks", open: nav("Classic Monks") },
  {
    name: "classic-monks-undo",
    open: async (page) => {
      await nav("Classic Monks")(page);
      await page.getByRole("switch", { name: "SVG Support" }).click();
      await page.getByRole("button", { name: "Undo", exact: true }).waitFor();
    },
  },
  {
    name: "classic-monks-settings",
    open: async (page) => {
      await nav("Classic Monks")(page);
      await page.getByRole("tablist", { name: "Show" }).getByRole("tab", { name: "Settings", exact: true }).click();
      await page.getByRole("list", { name: "Settings" }).waitFor();
    },
  },
  {
    name: "classic-monks-activity",
    open: async (page) => {
      await nav("Classic Monks")(page);
      await page.getByRole("tablist", { name: "Show" }).getByRole("tab", { name: "Activity", exact: true }).click();
      await page.getByRole("list", { name: "Activity" }).waitFor();
    },
  },
  {
    name: "classic-monks-undo-ask",
    open: async (page) => {
      await nav("Classic Monks")(page);
      await page.getByRole("tablist", { name: "Show" }).getByRole("tab", { name: "Activity", exact: true }).click();
      await page.getByRole("list", { name: "Activity" }).getByRole("button", { name: /^Undo/ }).first().click();
      await page.getByRole("dialog", { name: /^Undo this change/ }).waitFor();
    },
  },
  {
    name: "classic-monks-approvals",
    open: async (page) => {
      await nav("Classic Monks")(page);
      await page.getByRole("tablist", { name: "Show" }).getByRole("tab", { name: "Waiting for approval", exact: true }).click();
      await page.getByRole("list", { name: "Waiting for approval" }).waitFor();
    },
  },
  {
    name: "classic-monks-basic",
    open: async (page) => {
      await nav("Classic Monks")(page);
      await choose(page.getByRole("combobox", { name: "Site", exact: true }), { name: "mc-c (no Classic Monks)" });
    },
  },
  { name: "ai", open: nav("AI") },
  { name: "ai-none", fixture: "empty", open: nav("AI") },
  {
    name: "ai-access",
    open: async (page) => {
      await nav("AI")(page);
      await page.getByRole("tab", { name: "Agent access", exact: true }).click();
      await page.getByRole("tabpanel").getByRole("list", { name: "Agent access" }).waitFor();
    },
  },
  {
    name: "ai-activity",
    open: async (page) => {
      await nav("AI")(page);
      await page.getByRole("tablist", { name: "Show" }).getByRole("tab", { name: "Activity", exact: true }).click();
      await page.getByRole("list", { name: "Activity" }).waitFor();
    },
  },
  {
    name: "ai-connect",
    open: async (page) => {
      await nav("AI")(page);
      await page.getByRole("button", { name: "Connect an AI app", exact: true }).click();
      await page.getByRole("dialog", { name: "Connect an AI app" }).waitFor();
    },
  },
  {
    name: "ai-confirmed",
    open: async (page) => {
      await nav("AI")(page);
      await page.getByRole("button", { name: "Confirm and run 3 changes: Update WooCommerce on 3 sites" }).click();
      await page.getByText(/^Finished\./).waitFor();
    },
  },
  { name: "content", open: nav("Content") },
  {
    name: "content-show-list",
    open: async (page) => {
      await nav("Content")(page);
      await page.getByRole("combobox", { name: "Show", exact: true }).press("ArrowDown");
      await page.getByRole("listbox", { name: "Show" }).waitFor();
    },
  },
  {
    name: "content-editor",
    open: async (page) => {
      await nav("Content")(page);
      await page.getByRole("button", { name: "Pages", exact: true }).click();
      await page.getByRole("button", { name: "Our menu" }).click();
      await page.getByRole("list", { name: "Blocks" }).waitFor();
    },
  },
  {
    name: "content-classic",
    open: async (page) => {
      await nav("Content")(page);
      await page.getByRole("button", { name: "Winter opening hours" }).click();
      await page.locator(".rte .tox-toolbar__group").first().waitFor();
      await page.getByRole("textbox", { name: "Body" }).getByText("Mondays").waitFor();
    },
  },
  {
    name: "content-classic-text",
    open: async (page) => {
      await nav("Content")(page);
      await page.getByRole("button", { name: "Winter opening hours" }).click();
      await page.locator(".rte .tox-toolbar__group").first().waitFor();
      await page.getByRole("tab", { name: "Text" }).click();
      await page.getByRole("textbox", { name: "Body, as HTML" }).waitFor();
    },
  },
  {
    name: "content-block-text",
    open: async (page) => {
      await nav("Content")(page);
      await page.getByRole("button", { name: "Pages", exact: true }).click();
      await page.getByRole("button", { name: "Our menu" }).click();
      await page.getByRole("textbox", { name: "Paragraph (block 2)" }).click();
      await page.locator(".tox-tinymce-inline .tox-toolbar__group").first().waitFor();
    },
  },
  {
    name: "content-acf",
    open: async (page) => {
      await nav("Content")(page);
      await page.getByRole("button", { name: "Monks test fields post" }).click();
      await page.getByRole("region", { name: "Monks test fields" }).evaluate((e) => {
        const s = e.closest(".page-main, .page")!;
        s.scrollTop += e.getBoundingClientRect().top - s.getBoundingClientRect().top;
      });
      await page.getByRole("textbox", { name: "Email" }).waitFor();
    },
  },
  {
    name: "content-leave",
    open: async (page) => {
      await nav("Content")(page);
      await page.getByRole("button", { name: "Pages", exact: true }).click();
      await page.getByRole("button", { name: "Our menu" }).click();
      await page.getByRole("textbox", { name: "Title" }).fill("Our winter menu");
      await page.getByRole("button", { name: "Back to pages" }).click();
      await page.getByRole("dialog", { name: "Leave without saving?" }).waitFor();
    },
  },
  {
    name: "content-builder",
    open: async (page) => {
      await nav("Content")(page);
      await page.getByRole("button", { name: "Pages", exact: true }).click();
      await page.getByRole("button", { name: "Home" }).click();
      await page.getByText(/built with Elementor/).waitFor();
    },
  },
  {
    name: "content-new",
    open: async (page) => {
      await nav("Content")(page);
      await page.getByRole("button", { name: "Books", exact: true }).click();
      await page.getByRole("button", { name: "New book" }).click();
      await page.getByRole("button", { name: "Choose an image" }).click();
      await page.getByRole("button", { name: "Use shop-front" }).waitFor();
    },
  },
  {
    name: "content-trash",
    open: async (page) => {
      await nav("Content")(page);
      await page.getByRole("button", { name: "Autumn opening hours" }).click();
      await page.getByRole("region", { name: "Publish" }).getByRole("button", { name: "Move to the trash" }).click();
      await page.getByRole("dialog", { name: /to the trash\?$/ }).waitFor();
    },
  },
  {
    name: "content-history",
    open: async (page) => {
      await nav("Content")(page);
      await page.getByRole("button", { name: "Pages", exact: true }).click();
      await page.getByRole("button", { name: "Our menu" }).click();
      await page.getByRole("button", { name: "Show earlier versions" }).click();
      await page.getByRole("button", { name: /^Put back the version from .*20.*9:10/ }).click();
    },
  },
  {
    name: "content-bulk",
    open: async (page) => {
      await nav("Content")(page);
      await page.getByRole("checkbox", { name: "Tick Autumn opening hours" }).check();
      await page.getByRole("checkbox", { name: "Tick Hiring a morning baker" }).check();
    },
  },
  {
    name: "content-bulk-plan",
    open: async (page) => {
      await nav("Content")(page);
      await page.getByRole("checkbox", { name: "Tick Autumn opening hours" }).check();
      await page.getByRole("checkbox", { name: "Tick Hiring a morning baker" }).check();
      await page.getByRole("button", { name: "Make drafts (2)" }).click();
    },
  },
  {
    name: "content-trashed",
    open: async (page) => {
      await nav("Content")(page);
      await choose(page.getByRole("combobox", { name: "Show", exact: true }), { value: "trash" });
      await page.getByRole("button", { name: "Summer menu" }).click();
      await page.getByRole("button", { name: "Bring it back from the trash" }).waitFor();
    },
  },
  {
    name: "publish-many",
    open: async (page) => {
      await nav("Content")(page);
      await page.getByRole("button", { name: "Publish on several sites" }).click();
      await page.getByRole("textbox", { name: "Title" }).fill("Open on Sunday");
      await page.getByRole("textbox", { name: /^Text/ }).fill("We open at 9 on Sundays from November.");
      await page.getByRole("checkbox", { name: /mc-c/ }).check();
    },
  },
  {
    name: "publish-many-plan",
    open: async (page) => {
      await nav("Content")(page);
      await page.getByRole("button", { name: "Publish on several sites" }).click();
      await page.getByRole("textbox", { name: "Title" }).fill("Open on Sunday");
      await page.getByRole("checkbox", { name: /mc-c/ }).check();
      await page.getByRole("button", { name: "Review the plan" }).click();
    },
  },
  {
    name: "content-unavailable",
    open: async (page) => {
      await nav("Content")(page);
      await choose(page.getByRole("combobox", { name: "Site", exact: true }), { name: "WP Sites HQ Test (not available)" });
    },
  },
  { name: "media", open: nav("Media") },
  {
    name: "media-list",
    open: async (page) => {
      await nav("Media")(page);
      await page.getByRole("button", { name: "List", exact: true }).click();
      await page.getByRole("checkbox", { name: "Tick sourdough" }).check();
      await page.getByRole("checkbox", { name: "Tick menu-board" }).check();
      await page.getByRole("button", { name: /^shop-front/ }).waitFor();
    },
  },
  {
    name: "media-upload",
    open: async (page) => {
      await nav("Media")(page);
      await page.getByRole("button", { name: "Upload files" }).click();
      const jpg = (name: string) => ({ name, mimeType: "image/jpeg", buffer: Buffer.alloc(180_000) });
      await page.getByLabel("Choose files").setInputFiles([jpg("rye-loaf.jpg"), jpg("bakery-team.jpg"), { name: "setup.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") }]);
      await page.getByRole("list", { name: "Files to upload" }).getByRole("textbox", { name: "Alt text" }).first().fill("A dark rye loaf on a board");
    },
  },
  {
    name: "media-replaced",
    open: async (page) => {
      await nav("Media")(page);
      await page.getByLabel("Choose the new file").setInputFiles({ name: "shop-front-2026.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(500_000) });
      await page.getByRole("button", { name: "Undo the replace" }).waitFor();
    },
  },
  {
    name: "media-picker",
    open: async (page) => {
      await nav("Content")(page);
      await page.getByRole("button", { name: "Pages", exact: true }).click();
      await page.getByRole("button", { name: "Our menu" }).click();
      await page.getByRole("region", { name: "Featured image" }).getByRole("button", { name: /^(Choose|Change) the image$/ }).click();
      await page.getByRole("list", { name: "Images" }).waitFor();
      await page.getByRole("region", { name: "Featured image" }).evaluate((e) => e.scrollIntoView({ block: "start" }));
    },
  },
  { name: "updates", open: nav("Updates") },
  {
    name: "updates-plan",
    open: async (page) => {
      await nav("Updates")(page);
      await page.getByRole("button", { name: /^Update all/ }).click();
    },
  },
  {
    name: "updates-confirm",
    open: async (page) => {
      await nav("Updates")(page);
      await page.getByRole("button", { name: /^Update all/ }).click();
      await page.getByRole("checkbox", { name: "Update Akismet Anti-spam: Spam Protection on MC A", exact: true }).click();
      await page.getByRole("button", { name: /^Review/ }).click();
    },
  },
  {
    name: "updates-progress",
    open: async (page) => {
      await nav("Updates")(page);
      await page.getByRole("button", { name: /^Update all/ }).click();
      await page.getByRole("button", { name: /^Review/ }).click();
      await page.getByRole("button", { name: /^Make these/ }).click();
      await page.getByText(/^Finished\./).waitFor();
    },
  },
  { name: "plugins", open: nav("Plugins") },
  {
    name: "plugins-inspector",
    open: async (page) => {
      await nav("Plugins")(page);
      await page.getByRole("button", { name: /^WooCommerce on MC A/ }).click();
    },
  },
  {
    name: "plugins-rollback",
    open: async (page) => {
      await nav("Plugins")(page);
      await page.getByRole("button", { name: /^WooCommerce on MC A/ }).click();
      await page.getByRole("button", { name: "Choose an older version" }).click();
      await page.getByRole("radio", { name: "10.1.0" }).check();
    },
  },
  { name: "themes", open: nav("Themes") },
  {
    name: "install",
    open: async (page) => {
      await nav("Plugins")(page);
      await page.getByRole("button", { name: "Install a plugin" }).click();
      await page.getByRole("searchbox", { name: "Search WordPress.org plugins" }).fill("seo");
      await page.keyboard.press("Enter");
      await page.getByRole("list", { name: "Plugins found" }).waitFor();
    },
  },
  {
    name: "install-sites",
    open: async (page) => {
      await nav("Plugins")(page);
      await page.getByRole("button", { name: "Install a plugin" }).click();
      await page.getByRole("searchbox", { name: "Search WordPress.org plugins" }).fill("seo");
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Choose Rank Math SEO" }).click();
    },
  },
  {
    name: "install-zip",
    open: async (page) => {
      await nav("Plugins")(page);
      await page.getByRole("button", { name: "Install a plugin" }).click();
      await page.getByLabel("Choose a zip file").setInputFiles({ name: "acme-bookings-3.2.zip", mimeType: "application/zip", buffer: Buffer.from("PK\x03\x04") });
      await page.getByRole("checkbox", { name: "Install on MC A" }).waitFor();
    },
  },
  {
    name: "install-bundle-edit",
    open: async (page) => {
      await nav("Plugins")(page);
      await page.getByRole("button", { name: "Install a plugin" }).click();
      await page.getByRole("button", { name: "Edit the New shop bundle" }).click();
    },
  },
  {
    name: "install-bundle",
    open: async (page) => {
      await nav("Plugins")(page);
      await page.getByRole("button", { name: "Install a plugin" }).click();
      await page.getByRole("button", { name: "Install New shop" }).click();
    },
  },
  {
    name: "search",
    open: async (page) => {
      await page.keyboard.press("Control+k");
      await page.getByRole("combobox", { name: "Command" }).fill("menu");
      await page.getByRole("option", { name: /^Search everything for/ }).click();
      await page.getByRole("list", { name: "Results" }).getByRole("button", { name: /^View / }).first().waitFor();
    },
  },
  { name: "loading", fixture: "loading" },
  { name: "error", fixture: "error" },
];

/** Load the app with a theme and density already chosen, then open the screen. */
export async function show(page: Page, s: Screen, theme: string, density = "comfortable") {
  await page.addInitScript(
    ([t, d]) => {
      localStorage.setItem("mc-theme", t);
      localStorage.setItem("mc-density", d);
    },
    [theme, density],
  );
  await page.goto(`/?fixture=${s.fixture ?? "fleet"}`);
  await page.locator(".app").waitFor();
  if (s.fixture !== "loading" && s.fixture !== "error") await page.locator(".body > *").first().waitFor();
  await s.open?.(page);
  // A page's code loads as its own chunk; its stand-in goes once the page is drawn.
  if (s.fixture !== "loading" && s.fixture !== "error") await page.locator(".body > :not(.phead):not(.page-loading)").first().waitFor();
  await page.locator(".page-loading").waitFor({ state: "detached" });
  await page.evaluate(() => document.fonts.ready);
}
