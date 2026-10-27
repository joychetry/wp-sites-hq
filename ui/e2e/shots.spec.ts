// Screenshots of every screen for docs/ux: SHOTS=after npx playwright test shots
import { test } from "@playwright/test";
import { SCREENS, show } from "./screens";

const dir = process.env.SHOTS;
test.skip(!dir, "set SHOTS=<folder> to take screenshots");

for (const s of SCREENS) {
  for (const theme of ["dark", "light"]) {
    for (const density of ["comfortable", "compact"]) {
      if (density === "compact" && (dir === "before" || !s.name.startsWith("sites"))) continue;
      const file = `${s.name}-${theme}${density === "compact" ? "-compact" : ""}.png`;
      test(file, async ({ page }) => {
        await show(page, s, theme, density);
        await page.screenshot({ path: `../docs/ux/phase-1-ux/${dir}/${file}` });
      });
    }
  }
}
