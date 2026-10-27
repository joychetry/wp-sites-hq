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
  { name: "later", open: nav("Plugins") },
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
