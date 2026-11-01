// SPDX-License-Identifier: GPL-3.0-or-later
// The design beside the app, page by page: COMPARE=1 npx playwright test compare
// Writes ui/screenshots/compare/<page>-<theme>.png (not committed): the design board on the left
// ($DESIGN_DIR/<theme>-<board>-full.png), the app on the right at the same width.
import { test } from "@playwright/test";
import fs from "node:fs";
import { SCREENS, show } from "./screens";

const designDir = process.env.DESIGN_DIR ?? "";
test.skip(!process.env.COMPARE || !designDir, "set COMPARE=1 and DESIGN_DIR=<folder of design boards> to write the side-by-side pages");

const PAGES: [page: string, board: string, screens: string[]][] = [
  ["01-overview", "01-overview", ["overview"]],
  ["02-sites", "02-sites", ["sites-selected"]],
  ["03-updates", "03-updates", ["updates"]],
  ["04-plugins", "04-plugins", ["plugins-inspector"]],
  ["05-themes", "05-themes", ["themes"]],
  ["06-content", "06-content", ["content"]],
  ["07-media", "07-media", ["media"]],
  ["08-users", "08-users", ["users"]],
  ["09-comments", "09-comments", ["comments"]],
  ["10-classic-monks", "10-classic-monks", ["classic-monks"]],
  ["11-monitoring", "11-monitoring", ["monitoring"]],
  ["12-security", "12-security", ["security"]],
  ["13-clients", "13-clients", ["clients"]],
  ["14-store", "14-store", ["store"]],
  ["15-reports", "15-reports", ["reports"]],
  ["16-ai", "16-ai", ["ai"]],
  ["17-settings", "17-settings", ["settings"]],
  ["18-search", "18-search-everything", ["search"]],
  ["sidebar", "component-sidebar", ["overview"]],
  ["d01-empty-error", "d01-overview-empty-and-error", ["overview-empty", "error"]],
  ["d02-add-site", "d02-sites-add-a-site-sign-in-again", ["add-site", "add-site-basic", "sign-in-again"]],
  ["d03-updates-flow", "d03-updates-pick-review-run", ["updates-plan", "updates-confirm", "updates-progress"]],
  ["d04-plugins-install", "d04-plugins-install-bundles-roll-back", ["install", "install-bundle", "plugins-rollback"]],
  ["d05-content-flows", "d05-content-editors-history-bulk-trash-publish", ["content-editor", "content-history", "content-bulk", "content-trash", "publish-many"]],
  ["d06-users-clients", "d06-users-and-clients-add-delete-edit", ["users-add", "users-delete", "client-edit"]],
  ["d07-classic-monks-tabs", "d07-classic-monks-settings-activity-approvals-reports", ["classic-monks-settings", "classic-monks-activity", "classic-monks-undo-ask", "classic-monks-approvals", "classic-monks-reports"]],
  ["d08-ai-states", "d08-ai-running-empty-activity-connect", ["ai-confirmed", "ai-none", "ai-activity", "ai-connect"]],
  ["d09-store-settings", "d09-store-and-settings-product-change-search-console-toasts", ["store-change", "settings-search-console", "classic-monks-undo"]],
  ["d10-palette", "d10-anywhere-command-palette", ["palette"]],
];

const only = process.env.COMPARE?.split(",").filter((p) => p !== "1") ?? [];
const out = "screenshots/compare";
const png = (file: string) => `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;

for (const [name, board, screens] of PAGES) {
  for (const theme of ["light", "dark"]) {
    test(`${name}-${theme}`, async ({ page }) => {
      test.skip(only.length > 0 && !only.some((o) => name.startsWith(o)));
      test.skip(board === "component-sidebar" && theme === "dark", "the sidebar board is light only");
      const design = `${designDir}/${theme}-${board}-full.png`;
      // Pages render as tall as their design board, so the whole page compares, not just the first 900px.
      const tall = /^\d|sidebar/.test(board) ? 1320 : 900;
      await page.setViewportSize({ width: 1440, height: tall });
      const shots: string[] = [];
      for (const s of screens) {
        const screen = SCREENS.find((x) => x.name === s)!;
        await show(page, screen, theme === "light" ? "light" : "dark");
        await page.waitForTimeout(300);
        const buf = board === "component-sidebar" ? await page.locator("nav.rail").screenshot({ animations: "disabled" }) : await page.screenshot({ animations: "disabled" });
        shots.push(`data:image/png;base64,${buf.toString("base64")}`);
      }
      const ground = theme === "light" ? "#e9ecea" : "#050505";
      const ink = theme === "light" ? "#0d1411" : "#ededed";
      await page.setViewportSize({ width: 2940, height: 900 });
      await page.setContent(`<body style="margin:0;background:${ground};color:${ink};font:600 20px system-ui">
        <div style="display:flex;gap:20px;padding:20px;align-items:flex-start">
          <figure style="margin:0;width:1440px"><figcaption style="padding:0 0 10px">Design: ${board} (${theme})</figcaption><img style="width:1440px;display:block" src="${png(design)}"></figure>
          <figure style="margin:0;width:1440px;display:grid;gap:20px"><figcaption>App: ${screens.join(", ")}</figcaption>${shots
            .map((src) => `<img style="max-width:1440px;display:block" src="${src}">`)
            .join("")}</figure>
        </div></body>`);
      await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
      await page.screenshot({ path: `${out}/${name}-${theme}.png`, fullPage: true });
    });
  }
}
