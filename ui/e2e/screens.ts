// Every screen the UI has, as a URL plus the steps that open it.
import type { Page } from "@playwright/test";

export type Screen = { name: string; fixture?: string; open?: (page: Page) => Promise<unknown> };

const nav = (name: string) => (page: Page) => page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: new RegExp(`^${name}`) }).click();

export const SCREENS: Screen[] = [
  { name: "overview" },
  { name: "overview-empty", fixture: "empty" },
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
      await page.getByRole("gridcell", { name: "Monks Central Test", exact: true }).click();
    },
  },
  {
    name: "sites-no-tools",
    open: async (page) => {
      await nav("Sites")(page);
      await page.getByRole("gridcell", { name: "Studio Blog", exact: true }).click();
    },
  },
  { name: "add-site", open: (page) => nav("Sites")(page).then(() => page.keyboard.press("a")) },
  {
    name: "add-site-basic",
    open: async (page) => {
      await nav("Sites")(page);
      await page.keyboard.press("a");
      await page.getByRole("button", { name: /^Basic mode/ }).click();
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
      await page.getByRole("checkbox", { name: /Google Search Console/ }).check();
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
      await page.getByRole("textbox", { name: "Stock" }).fill("30");
      await page.getByRole("button", { name: "Review the change" }).click();
    },
  },
  {
    name: "classic-monks-reports",
    open: async (page) => {
      await nav("Classic Monks")(page);
      await page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Reports", exact: true }).click();
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
      await page.getByRole("combobox", { name: "On" }).selectOption({ label: "MC A" });
      await page.getByRole("textbox", { name: "What it is" }).fill("Backups");
      await page.getByRole("textbox", { name: "Amount" }).fill("5.50");
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
      await page.getByRole("combobox", { name: "Role" }).selectOption("administrator");
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
      await page.getByRole("button", { name: "Turn on SVG Support" }).click();
      await page.getByRole("button", { name: "Undo", exact: true }).waitFor();
    },
  },
  {
    name: "classic-monks-settings",
    open: async (page) => {
      await nav("Classic Monks")(page);
      await page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("list", { name: "Settings" }).waitFor();
    },
  },
  {
    name: "classic-monks-activity",
    open: async (page) => {
      await nav("Classic Monks")(page);
      await page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Activity", exact: true }).click();
      await page.getByRole("table", { name: "Activity" }).waitFor();
    },
  },
  {
    name: "classic-monks-approvals",
    open: async (page) => {
      await nav("Classic Monks")(page);
      await page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Waiting for approval", exact: true }).click();
      await page.getByRole("table", { name: "Waiting for approval" }).waitFor();
    },
  },
  {
    name: "classic-monks-basic",
    open: async (page) => {
      await nav("Classic Monks")(page);
      await page.getByRole("combobox", { name: "Site", exact: true }).selectOption({ label: "mc-c (no Classic Monks)" });
    },
  },
  { name: "ai", open: nav("AI") },
  { name: "ai-none", fixture: "empty", open: nav("AI") },
  {
    name: "ai-access",
    open: async (page) => {
      await nav("AI")(page);
      await page.getByRole("button", { name: "Agent access", exact: true }).click();
      await page.getByRole("table", { name: "Agent access" }).waitFor();
    },
  },
  {
    name: "ai-activity",
    open: async (page) => {
      await nav("AI")(page);
      await page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Activity", exact: true }).click();
      await page.getByRole("table", { name: "Activity" }).waitFor();
    },
  },
  {
    name: "ai-connect",
    open: async (page) => {
      await nav("AI")(page);
      await page.getByRole("button", { name: "Connect an AI app", exact: true }).click();
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
    name: "content-editor",
    open: async (page) => {
      await nav("Content")(page);
      await page.getByRole("button", { name: "Pages", exact: true }).click();
      await page.getByRole("button", { name: "Our menu" }).click();
      await page.getByRole("list", { name: "Blocks" }).waitFor();
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
      await page.getByRole("button", { name: "Move to the trash" }).click();
    },
  },
  {
    name: "content-history",
    open: async (page) => {
      await nav("Content")(page);
      await page.getByRole("button", { name: "Pages", exact: true }).click();
      await page.getByRole("button", { name: "Our menu" }).click();
      await page.getByRole("button", { name: "Show earlier versions" }).click();
      await page.getByRole("button", { name: "Put this version back, from 2026-10-20 09:10:00" }).click();
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
      await page.getByRole("combobox", { name: "Show", exact: true }).selectOption("trash");
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
      await page.getByRole("combobox", { name: "Site", exact: true }).selectOption({ label: "Monks Central Test (not available)" });
    },
  },
  { name: "media", open: nav("Media") },
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
      await page.getByRole("button", { name: "Roll back to 10.1.0" }).click();
    },
  },
  { name: "themes", open: nav("Themes") },
  {
    name: "install",
    open: async (page) => {
      await nav("Plugins")(page);
      await page.getByRole("button", { name: "Install a plugin" }).click();
      await page.getByRole("textbox", { name: "Search WordPress.org plugins" }).fill("seo");
      await page.keyboard.press("Enter");
      await page.getByRole("list", { name: "Plugins found" }).waitFor();
    },
  },
  {
    name: "install-sites",
    open: async (page) => {
      await nav("Plugins")(page);
      await page.getByRole("button", { name: "Install a plugin" }).click();
      await page.getByRole("textbox", { name: "Search WordPress.org plugins" }).fill("seo");
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
      await page.getByRole("table", { name: "Posts and pages found" }).waitFor();
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
  await page.evaluate(() => document.fonts.ready);
}
