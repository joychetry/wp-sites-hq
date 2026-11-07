// SPDX-License-Identifier: GPL-3.0-or-later
// The Classic Monks page's states at 1440 and 1280, light and dark: CM_SHOTS=<folder> npx playwright test cm-shots
import { test } from "@playwright/test";
import { SCREENS, show } from "./screens";

const dir = process.env.CM_SHOTS ?? "";
test.skip(!dir, "set CM_SHOTS=<folder> to take the Classic Monks screenshots");

const NAMES = ["classic-monks", "classic-monks-settings", "classic-monks-undo", "classic-monks-search", "classic-monks-reports", "classic-monks-activity", "classic-monks-approvals"];
for (const width of [1440, 1280]) {
  test.describe(`${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    for (const name of NAMES)
      for (const theme of ["light", "dark"])
        test(`${name}-${theme}-${width}`, async ({ page }) => {
          await show(page, SCREENS.find((s) => s.name === name)!, theme);
          await page.screenshot({ path: `${dir}/${name}-${theme}-${width}.png`, animations: "disabled" });
        });
  });
}
