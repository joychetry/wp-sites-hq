// No control on any screen draws in the OS look: every button, input, textarea, select, progress
// and meter has a computed appearance of "none", and the controls a browser always draws itself
// (select, datalist, date, time, month, colour, number spinners, visible file inputs, title tooltips)
// are not used at all. Popups are opened too, so listboxes, calendars and menus are checked.
import { expect, test, type Page } from "@playwright/test";
import { SCREENS, show } from "./screens";

async function nativeControls(page: Page) {
  return page.evaluate(() => {
    const name = (el: Element) => `${el.tagName.toLowerCase()}${el.getAttribute("type") ? `[type=${el.getAttribute("type")}]` : ""} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}"`;
    const out: string[] = [];
    for (const el of document.querySelectorAll("select, datalist")) out.push(`${name(el)} is a native ${el.tagName.toLowerCase()}`);
    for (const el of document.querySelectorAll<HTMLInputElement>("input")) {
      if (["date", "datetime-local", "month", "week", "time", "color", "number"].includes(el.type)) out.push(`${name(el)} is a native picker`);
      if (el.type === "file" && getComputedStyle(el).display !== "none") out.push(`${name(el)} is a visible native file input`);
    }
    for (const el of document.querySelectorAll("button, input, textarea, select, progress, meter")) {
      const cs = getComputedStyle(el);
      const look = cs.appearance || cs.getPropertyValue("-webkit-appearance");
      if (cs.display !== "none" && look !== "none") out.push(`${name(el)} has appearance ${look}`);
    }
    for (const el of document.querySelectorAll("[title]:not(iframe)")) out.push(`${name(el)} uses a native title tooltip`);
    return out;
  });
}

for (const s of SCREENS) {
  test(`no native controls: ${s.name}`, async ({ page }) => {
    await show(page, s, "light");
    expect(await nativeControls(page)).toEqual([]);
    // Open the first closed listbox, if the screen has one, and look again. With a sheet or the
    // palette open, look inside it, since the page behind can't be clicked.
    const dialogs = page.locator('[role="dialog"]');
    const scope = (await dialogs.count()) ? dialogs.last() : page.locator("body");
    const select = scope.locator('button[role="combobox"][aria-expanded="false"]:visible').first();
    if (await select.count()) {
      await select.click();
      await expect(page.getByRole("listbox").first()).toBeVisible();
      expect(await nativeControls(page)).toEqual([]);
    }
  });
}

test("the computed-appearance check catches a native control", async ({ page }) => {
  await show(page, SCREENS[0], "light");
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = ".probe { appearance: auto !important; -webkit-appearance: auto !important; }";
    document.head.append(style);
    const b = document.createElement("button");
    b.className = "probe";
    b.textContent = "Probe";
    document.body.append(b);
    document.body.append(document.createElement("select"));
  });
  expect(await nativeControls(page)).toEqual(['select "" is a native select', 'button "Probe" has appearance auto']);
});
