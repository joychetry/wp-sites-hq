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
  { name: "later", open: nav("Security") },
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
