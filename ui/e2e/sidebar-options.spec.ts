// SPDX-License-Identifier: GPL-3.0-or-later
// Light mode with each rail palette: SHOTS=1 npx playwright test sidebar-options
import { test } from "@playwright/test";
import { SCREENS, show } from "./screens";
import { OPTIONS } from "./sidebar-options";

test.skip(!process.env.SHOTS, "set SHOTS=1 to take screenshots");

for (const [name, vars] of Object.entries(OPTIONS)) {
  for (const screen of ["overview", "sites"]) {
    test(`${name} ${screen}`, async ({ page }) => {
      await show(page, SCREENS.find((s) => s.name === screen)!, "light");
      const css = Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join(" ");
      await page.addStyleTag({ content: `:root { ${css} }` });
      await page.screenshot({ path: `../docs/ux/phase-1-ux/sidebar-options/${name}-${screen}.png` });
    });
  }
}
