// SPDX-License-Identifier: GPL-3.0-or-later
// Phase 7 installs: a zip from this computer (plugin or theme) and bundles.
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { Install, cannot, missing, parseBundle } from "./Install";
import { site } from "../test-fixtures";
import type { Bundle, Item, SiteInventory } from "../api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);
afterEach(() => mockInvoke.mockReset());

const TOOLS = ["install-plugin", "install-zip"];
const A = site({ id: 1, name: "Alpha", capabilities: { operator: true, abilities: TOOLS } });
const OLD = site({ id: 2, name: "Older", capabilities: { operator: true, abilities: ["install-plugin"] } });
const BASIC = site({ id: 3, name: "Basic", mode: "basic", capabilities: {} });
const item = (id: string): Item => ({ id, name: id, version: "1.0", active: true, auto_update: false, update: null });
const inv = (site_id: number, plugins: string[]): SiteInventory => ({
  site_id,
  fetched_at: 0,
  inventory: { wordpress: "7.1.3", wordpress_update: null, plugins: plugins.map(item), themes: [], translations: 0, updates_known: true, needs_credentials: false },
});
const INV = new Map([
  [1, inv(1, ["woocommerce/woocommerce.php"])],
  [2, inv(2, [])],
  [3, inv(3, [])],
]);
const SHOP: Bundle = { id: 1, name: "New shop", plugins: [{ source: "woocommerce", name: "WooCommerce" }, { source: "wp-mail-smtp", name: "" }] };

function core(over: Record<string, (a: Record<string, unknown>) => unknown> = {}) {
  const calls: [string, Record<string, unknown>][] = [];
  mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    const a = (args ?? {}) as Record<string, unknown>;
    calls.push([cmd, a]);
    if (over[cmd]) return over[cmd](a);
    if (cmd === "bundles_list") return [SHOP];
    if (cmd === "zip_stage") return { file: `${"a".repeat(64)}.zip`, name: a.name, size: 2097152 };
    if (cmd === "bundle_save") return a.bundle;
    return null;
  });
  return calls;
}

test("which sites can take a zip or a bundle", () => {
  const zip = { zip: { file: "f", name: "x.zip", size: 1 }, kind: "plugin" as const, overwrite: false, name: "x.zip" };
  expect(cannot(A, INV.get(1), zip)).toBeNull();
  expect(cannot(OLD, INV.get(2), zip)).toBe("Update Classic Monks here to install zips.");
  expect(cannot(BASIC, INV.get(3), zip)).toBe("Zips need Classic Monks on the site.");
  const bundle = { bundle: SHOP, name: SHOP.name };
  expect(missing(SHOP, INV.get(1)).map((p) => p.source)).toEqual(["wp-mail-smtp"]);
  expect(cannot(A, INV.get(1), { bundle: { ...SHOP, plugins: [SHOP.plugins[0]] }, name: "x" })).toBe("Has them all.");
  expect(cannot(BASIC, INV.get(3), bundle)).toBeNull();
  expect(cannot(BASIC, INV.get(3), { bundle: { ...SHOP, plugins: [{ source: "https://x.test/a.zip", name: "" }] }, name: "x" })).toContain("WordPress.org only");
  expect(parseBundle(" akismet \n\nhttps://x.test/a.zip")).toEqual([
    { source: "akismet", name: "" },
    { source: "https://x.test/a.zip", name: "" },
  ]);
});

test("a theme zip is sent once, then planned without switching to it", async () => {
  const calls = core();
  const onPlan = vi.fn();
  render(<Install sites={[A, OLD, BASIC]} inventory={INV} onClose={vi.fn()} onPlan={onPlan} />);
  fireEvent.click(screen.getByRole("button", { name: "A theme" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Replace it where it's already installed/ }));
  const file = new File(["PK\x03\x04"], "bricks-child.zip", { type: "application/zip" });
  fireEvent.change(screen.getByLabelText("Choose a zip file"), { target: { files: [file] } });
  expect(await screen.findByText(/theme, 2.0 MB, replaces an installed copy/)).toBeInTheDocument();
  expect(calls.find((c) => c[0] === "zip_stage")?.[1]).toEqual({ name: "bricks-child.zip", data: "UEsDBA==" });
  expect(screen.getByRole("checkbox", { name: "Install on Older" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "Use it as the site's theme after installing" })).toHaveAttribute("aria-checked", "false");
  fireEvent.click(screen.getByRole("button", { name: "Review 1 site" }));
  expect(onPlan).toHaveBeenCalledWith("Install bricks-child.zip on Alpha", [
    {
      site: "Alpha",
      label: "Install bricks-child.zip, replacing it",
      change: { site_id: 1, action: { do: "install_zip", file: `${"a".repeat(64)}.zip`, name: "bricks-child.zip", kind: "theme", activate: false, overwrite: true } },
    },
  ]);
});

test("a zip the core refuses says why", async () => {
  core({ zip_stage: () => Promise.reject("notes.txt isn't a zip file.") });
  render(<Install sites={[A]} inventory={INV} onClose={vi.fn()} onPlan={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Choose a zip file"), { target: { files: [new File(["x"], "notes.txt")] } });
  expect(await screen.findByRole("alert")).toHaveTextContent("isn't a zip file");
});

test("a bundle installs only what each site is missing", async () => {
  core();
  const onPlan = vi.fn();
  render(<Install sites={[A, BASIC]} inventory={INV} onClose={vi.fn()} onPlan={onPlan} />);
  fireEvent.click(await screen.findByRole("button", { name: "Install New shop" }));
  fireEvent.click(screen.getByRole("button", { name: "Review 2 sites" }));
  const [title, rows] = onPlan.mock.calls[0];
  expect(title).toBe("Install the New shop bundle on 2 sites");
  expect(rows.map((r: { site: string; label: string }) => `${r.site}: ${r.label}`)).toEqual([
    "Alpha: Install wp-mail-smtp and activate it",
    "Basic: Install WooCommerce and activate it",
    "Basic: Install wp-mail-smtp and activate it",
  ]);
});

test("bundles are made and edited in the sheet", async () => {
  const calls = core();
  render(<Install sites={[A]} inventory={INV} onClose={vi.fn()} onPlan={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit the New shop bundle" }));
  const box = screen.getByRole("group", { name: "Or a bundle" });
  expect(within(box).getByRole("textbox", { name: /^Plugins, one a line/ })).toHaveValue("woocommerce\nwp-mail-smtp");
  fireEvent.change(within(box).getByRole("textbox", { name: /^Plugins, one a line/ }), { target: { value: "woocommerce\nakismet" } });
  fireEvent.click(within(box).getByRole("button", { name: "Save the bundle" }));
  await waitFor(() =>
    expect(calls.find((c) => c[0] === "bundle_save")?.[1]).toEqual({
      bundle: { id: 1, name: "New shop", plugins: [{ source: "woocommerce", name: "" }, { source: "akismet", name: "" }] },
    }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "New bundle" }));
  fireEvent.click(within(box).getByRole("button", { name: "Close without saving" }));
  expect(within(box).getByRole("button", { name: "New bundle" })).toBeInTheDocument();
});

test("deleting a bundle asks first, and a failed delete keeps it open", async () => {
  const calls = core({
    bundle_delete: () => {
      throw new Error("The database is busy.");
    },
  });
  render(<Install sites={[A]} inventory={INV} onClose={vi.fn()} onPlan={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit the New shop bundle" }));
  const box = screen.getByRole("group", { name: "Or a bundle" });
  fireEvent.click(within(box).getByRole("button", { name: "Delete the bundle" }));
  expect(calls.some((c) => c[0] === "bundle_delete")).toBe(false);
  expect(within(box).getByText(/Delete the New shop bundle\?/)).toBeInTheDocument();
  fireEvent.click(within(box).getByRole("button", { name: "Keep it" }));
  fireEvent.click(within(box).getByRole("button", { name: "Delete the bundle" }));
  fireEvent.click(within(box).getByRole("button", { name: "Delete the bundle" }));
  expect(await screen.findByText(/The database is busy/)).toBeInTheDocument();
  expect(within(box).getByRole("textbox", { name: "Bundle name" })).toHaveValue("New shop");
});
