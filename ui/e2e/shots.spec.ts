// Screenshots of every screen into docs/ux/<SHOTS>: SHOTS=phase-2 npx playwright test shots
import { test } from "@playwright/test";
import { SCREENS, show } from "./screens";

const dir = process.env.SHOTS ?? "";
test.skip(!dir, "set SHOTS=<folder under docs/ux> to take screenshots");

for (const s of SCREENS) {
  for (const theme of ["dark", "light"]) {
    for (const density of ["comfortable", "compact"]) {
      if (density === "compact" && (dir.endsWith("before") || !s.name.startsWith("sites"))) continue;
      const file = `${s.name}-${theme}${density === "compact" ? "-compact" : ""}.png`;
      test(file, async ({ page }) => {
        await show(page, s, theme, density);
        await page.screenshot({ path: `../docs/ux/${dir}/${file}` });
      });
    }
  }
}

// 200% zoom on a 1440 x 900 window is a 720 x 450 viewport at twice the pixels.
test.describe("200% zoom", () => {
  test.use({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 });
  for (const name of ["overview", "sites", "updates", "plugins"]) {
    for (const theme of ["dark", "light"]) {
      test(`${name}-${theme}-zoom200.png`, async ({ page }) => {
        test.skip(dir.endsWith("before"));
        await show(page, SCREENS.find((s) => s.name === name)!, theme);
        await page.screenshot({ path: `../docs/ux/${dir}/${name}-${theme}-zoom200.png`, fullPage: true });
      });
    }
  }
});
