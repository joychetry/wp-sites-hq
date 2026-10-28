// SPDX-License-Identifier: GPL-3.0-or-later
// Updates, the Plugins and Themes matrix, Install and the job sheet.
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { Updates, updatesOf } from "./Updates";
import { Matrix, cellOf, olderStable } from "./Matrix";
import { Install } from "./Install";
import { JobSheet, type PlanRow } from "../components/JobSheet";
import { HeadSlot } from "../components/ui";
import { site } from "../test-fixtures";
import type { Item, Job, SiteInventory } from "../api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
const mockInvoke = vi.mocked(invoke);
afterEach(() => mockInvoke.mockReset());

const TOOLS = ["get-site-snapshot", "update-plugin", "rollback-plugin", "list-plugin-versions", "activate-plugin", "deactivate-plugin", "uninstall-plugin", "set-plugin-auto-update", "install-plugin", "update-theme", "update-core"];
const WOO = "woocommerce/woocommerce.php";
const item = (over: Partial<Item> = {}): Item => ({ id: WOO, name: "WooCommerce", version: "10.2.0", active: true, auto_update: false, update: "10.3.0", ...over });
const inv = (site_id: number, over: Partial<SiteInventory["inventory"]> = {}): SiteInventory => ({
  site_id,
  fetched_at: Math.floor(Date.now() / 1000) - 60,
  inventory: { wordpress: "7.1.3", wordpress_update: null, plugins: [item()], themes: [], translations: 0, updates_known: true, needs_credentials: false, ...over },
});

const A = site({ id: 1, name: "Alpha", capabilities: { operator: true, abilities: TOOLS } });
const B = site({ id: 2, name: "Beta", capabilities: { operator: true, abilities: TOOLS } });
const BASIC = site({ id: 3, name: "Basic", mode: "basic", capabilities: {} });
const DOWN = site({ id: 4, name: "Down", health: "down", capabilities: { abilities: TOOLS } });
const INV = new Map([
  [1, inv(1, { wordpress_update: "7.1.4", translations: 3 })],
  [2, inv(2)],
  [3, inv(3, { updates_known: false, plugins: [item({ update: null, auto_update: null })] })],
  [4, inv(4)],
]);

test("Updates lists every waiting update, says which sites are left out, and plans them", () => {
  const onPlan = vi.fn();
  render(<Updates sites={[B, A, BASIC, DOWN]} inventory={INV} onPlan={onPlan} />);
  const table = screen.getByRole("table", { name: "Updates waiting" });
  // Alpha: WordPress, WooCommerce, translations; Beta: WooCommerce. Sorted by site.
  expect(within(table).getAllByRole("row")).toHaveLength(5);
  expect(within(table).getByText("7.1.4")).toBeInTheDocument();
  const out = screen.getByRole("region", { name: "Sites not in this list" });
  expect(out).toHaveTextContent("Basic mode can't see updates");
  expect(out).toHaveTextContent("Down when last checked");
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Update WooCommerce on Beta" }));
  fireEvent.click(screen.getByRole("button", { name: "Update 1 selected" }));
  expect(onPlan).toHaveBeenLastCalledWith("Update WooCommerce on Beta", [
    expect.objectContaining({ site: "Beta", from: "10.2.0", to: "10.3.0", change: { site_id: 2, action: { do: "update_plugin", plugin: WOO } } }),
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Update all 4" }));
  expect(onPlan.mock.calls[1][1]).toHaveLength(4);
  expect(onPlan.mock.calls[1][0]).toBe("Update 4 things on 2 sites");
});

test("Updates: nothing waiting, and reading every site again", async () => {
  mockInvoke.mockResolvedValue(null);
  render(<Updates sites={[BASIC]} inventory={INV} onPlan={vi.fn()} />);
  expect(screen.getByText("No updates waiting.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Read every site again" }));
  expect(mockInvoke).toHaveBeenCalledWith("inventory_refresh", { id: undefined });
  await waitFor(() => expect(screen.getByRole("button", { name: "Read every site again" })).toBeEnabled());
});

test("updatesOf skips sites that need a sign-in or can't see updates", () => {
  expect(updatesOf(site({ sign_in_again: true }), INV.get(1))).toEqual([]);
  expect(updatesOf(BASIC, INV.get(3))).toEqual([]);
  expect(updatesOf(A, undefined)).toEqual([]);
  expect(updatesOf(A, INV.get(1)).map((r) => r.kind)).toEqual(["WordPress", "Plugin", "Translations"]);
});

function matrix(over: Partial<Omit<React.ComponentProps<typeof Matrix>, "onPlan" | "onRun">> = {}) {
  const props = { kind: "plugins" as const, sites: [A, B, BASIC], inventory: INV, onPlan: vi.fn(), onRun: vi.fn(), onInstall: vi.fn(), ...over };
  // The page head's action slot (App.tsx), where the screen puts Install and Update.
  const slot = document.createElement("div");
  document.body.append(slot);
  render(
    <HeadSlot.Provider value={slot}>
      <Matrix {...props} />
    </HeadSlot.Provider>,
  );
  return props;
}

test("the matrix has a row per plugin and a column per site, and arrow keys move between them", () => {
  const extra = new Map(INV);
  extra.set(2, inv(2, { plugins: [item(), item({ id: "akismet/akismet.php", name: "Akismet", version: "5.3", update: null, active: false })] }));
  matrix({ inventory: extra });
  const grid = screen.getByRole("grid", { name: "Plugins on every site" });
  expect(within(grid).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Plugin", "Alpha", "Basic", "Beta"]);
  expect(within(grid).getAllByRole("rowheader").map((h) => h.querySelector("b")!.textContent)).toEqual(["WooCommerce", "Akismet"]);
  const cell = screen.getByRole("button", { name: /^WooCommerce on Alpha: 10.2.0, Update to 10.3.0/ });
  expect(cell).toHaveAttribute("tabindex", "0");
  expect(screen.getByRole("button", { name: /^Akismet on Alpha: Not installed/ })).toHaveAttribute("tabindex", "-1");
  expect(screen.getByRole("button", { name: /^Akismet on Beta: 5.3, Inactive/ })).toBeInTheDocument();
  cell.focus();
  fireEvent.keyDown(grid, { key: "ArrowDown" });
  expect(screen.getByRole("button", { name: /^Akismet on Alpha/ })).toHaveFocus();
  fireEvent.keyDown(grid, { key: "ArrowRight" });
  expect(screen.getByRole("button", { name: /^Akismet on Basic/ })).toHaveFocus();
  fireEvent.keyDown(grid, { key: "End" });
  expect(screen.getByRole("button", { name: /^Akismet on Beta/ })).toHaveFocus();
  fireEvent.keyDown(grid, { key: "ArrowUp" });
  expect(screen.getByRole("button", { name: /^WooCommerce on Beta/ })).toHaveFocus();
  fireEvent.keyDown(grid, { key: "Home" });
  expect(screen.getByRole("button", { name: /^WooCommerce on Alpha/ })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Show: Every site" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Only sites with updates" }));
  expect(screen.queryByRole("button", { name: /on Basic/ })).not.toBeInTheDocument();
});

test("the matrix finds a plugin by name and filters by status", () => {
  const extra = new Map(INV);
  extra.set(2, inv(2, { plugins: [item({ update: null }), item({ id: "akismet/akismet.php", name: "Akismet", version: "5.3", update: null, active: false })] }));
  matrix({ inventory: extra });
  fireEvent.change(screen.getByRole("searchbox", { name: "Find a plugin" }), { target: { value: "akis" } });
  expect(screen.queryByRole("button", { name: /^WooCommerce on/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox", { name: "Find a plugin" }), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Status: Any" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Update ready" }));
  expect(screen.queryByRole("button", { name: /^Akismet on/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^WooCommerce on Alpha/ })).toHaveAttribute("tabindex", "0");
});

test("a cell says what state it is in, in words", () => {
  const vuln = { kind: "plugin" as const, id: WOO, name: "WooCommerce", installed: "10.2.0", title: "XSS", severity: "high", fixed_in: "10.3.0", link: null };
  expect(cellOf("plugins", item(), vuln)).toEqual({ tone: "vuln", word: "Vulnerable · fix ready" });
  expect(cellOf("plugins", item({ update: null }), vuln)).toEqual({ tone: "vuln", word: "Vulnerable" });
  expect(cellOf("plugins", item({ active: false }))).toEqual({ tone: "up", word: "Update to 10.3.0 · inactive" });
  expect(cellOf("themes", item())).toEqual({ tone: "up", word: "Update to 10.3.0 · active" });
  expect(cellOf("plugins", item({ update: null }))).toEqual({ tone: "on", word: "Active" });
  expect(cellOf("themes", item({ update: null, active: false }))).toEqual({ tone: "idle", word: "Installed" });
  expect(cellOf("plugins", undefined)).toEqual({ tone: "none", word: "Not installed" });
});

test("the inspector updates, deactivates and turns automatic updates on for one site", () => {
  const p = matrix();
  fireEvent.click(screen.getByRole("button", { name: /^WooCommerce on Alpha/ }));
  const insp = screen.getByRole("complementary", { name: "WooCommerce on Alpha" });
  fireEvent.click(within(insp).getByRole("button", { name: "Update to 10.3.0" }));
  expect(p.onRun).toHaveBeenLastCalledWith("Update WooCommerce on Alpha", [{ site_id: 1, action: { do: "update_plugin", plugin: WOO } }]);
  fireEvent.click(within(insp).getByRole("switch", { name: "Automatic updates" }));
  expect(p.onRun.mock.calls[1][1][0].action).toEqual({ do: "auto_update_plugin", plugin: WOO, on: true });
  fireEvent.click(within(insp).getByRole("button", { name: "Deactivate" }));
  expect(p.onPlan).toHaveBeenLastCalledWith("Deactivate WooCommerce on Alpha", [expect.objectContaining({ label: "Deactivate WooCommerce" })], "confirm", true);
  fireEvent.click(within(insp).getByRole("button", { name: "Update WooCommerce on 2 sites" }));
  expect(p.onPlan.mock.lastCall![1]).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Update 2 plugins" }));
  expect(p.onPlan.mock.lastCall![2]).toBe("plan");
});

test("olderStable: only stable releases below the installed one", () => {
  expect(olderStable("11.1.2", "11.2.1")).toBe(true);
  expect(olderStable("11.2", "11.2.1")).toBe(true);
  expect(olderStable("11.2.1", "11.2.1")).toBe(false);
  expect(olderStable("11.3.0", "11.2.1")).toBe(false);
  expect(olderStable("11.1.0-rc.1", "11.2.1")).toBe(false);
  expect(olderStable("11.2.1", "11.3.0-beta.1")).toBe(true);
  expect(olderStable("11.3.0", "11.3.0-beta.1")).toBe(false);
  expect(olderStable("1.0", "")).toBe(false);
});

test("rolling back asks the site for older versions, then confirms as a risky change", async () => {
  const offered = ["10.3.0-beta.1", "10.3.0", "10.2.0", "10.2.0-rc.1", "10.1.0"].map((version) => ({ version }));
  mockInvoke.mockResolvedValue({ installed: "10.2.0", versions: offered });
  const p = matrix();
  fireEvent.click(screen.getByRole("button", { name: /^WooCommerce on Alpha/ }));
  fireEvent.click(screen.getByRole("button", { name: "Choose an older version" }));
  expect(mockInvoke).toHaveBeenCalledWith("plugin_versions", { id: 1, plugin: WOO });
  const sheet = await screen.findByRole("dialog", { name: "Roll back WooCommerce on Alpha" });
  fireEvent.click(await within(sheet).findByRole("radio", { name: "10.1.0" }));
  // Only older stable releases: not the installed one, not newer ones, not betas or release candidates.
  expect(within(sheet).getAllByRole("radio").map((b) => b.closest("label")!.textContent)).toEqual(["10.1.0"]);
  expect(within(sheet).queryByRole("checkbox", { name: /automatic updates/ })).not.toBeInTheDocument();
  fireEvent.click(within(sheet).getByRole("button", { name: "Roll back WooCommerce" }));
  expect(p.onPlan).toHaveBeenLastCalledWith(
    "Roll back WooCommerce on Alpha",
    [expect.objectContaining({ from: "10.2.0", to: "10.1.0", change: { site_id: 1, action: { do: "rollback_plugin", plugin: WOO, version: "10.1.0" } } })],
    "confirm",
    true,
  );
});

test("rolling back where automatic updates are on turns them off first", async () => {
  mockInvoke.mockResolvedValue({ installed: "10.2.0", versions: [{ version: "10.1.0" }] });
  const p = matrix({ inventory: new Map([[1, inv(1, { plugins: [item({ auto_update: true })] })]]), sites: [A] });
  fireEvent.click(screen.getByRole("button", { name: /^WooCommerce on Alpha/ }));
  fireEvent.click(screen.getByRole("button", { name: "Choose an older version" }));
  const sheet = await screen.findByRole("dialog", { name: "Roll back WooCommerce on Alpha" });
  expect(await within(sheet).findByRole("radio", { name: "10.1.0" })).toBeChecked();
  expect(within(sheet).getByRole("checkbox", { name: /^Turn automatic updates off/ })).toBeChecked();
  fireEvent.click(within(sheet).getByRole("button", { name: "Roll back WooCommerce" }));
  expect(p.onPlan.mock.lastCall![1].map((r: PlanRow) => r.change.action)).toEqual([
    { do: "auto_update_plugin", plugin: WOO, on: false },
    { do: "rollback_plugin", plugin: WOO, version: "10.1.0" },
  ]);
});

test("Basic mode: activate and delete only, and an active plugin is deactivated first", () => {
  matrix();
  fireEvent.click(screen.getByRole("button", { name: /^WooCommerce on Basic/ }));
  const insp = screen.getByRole("complementary", { name: "WooCommerce on Basic" });
  expect(within(insp).getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
  expect(within(insp).queryByRole("button", { name: /Update to|Delete|automatic|older/ })).not.toBeInTheDocument();
});

test("themes: a site's active theme can't be deleted", () => {
  const themed = new Map([[1, inv(1, { themes: [item({ id: "twentytwentyfive", name: "Twenty Twenty-Five", version: "1.2", update: null })] })]]);
  const withThemes = site({ id: 1, name: "Alpha", capabilities: { abilities: [...TOOLS, "delete-theme", "activate-theme"] } });
  matrix({ kind: "themes", sites: [withThemes], inventory: themed, onInstall: undefined });
  expect(screen.queryByRole("button", { name: "Install a plugin" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "No theme updates" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /^Twenty Twenty-Five on Alpha/ }));
  expect(screen.getByText(/This is the theme the site uses/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
});

test("Install searches WordPress.org, skips sites that have it, then plans the install", async () => {
  mockInvoke.mockImplementation(async (cmd: string) => (cmd === "plugin_search" ? [{ slug: "woocommerce", name: "WooCommerce", version: "10.3.0", active_installs: 7000000, summary: "Sell online." }] : []));
  const onPlan = vi.fn();
  render(<Install sites={[A, site({ id: 5, name: "Fresh", capabilities: { abilities: TOOLS } })]} inventory={new Map([...INV, [5, inv(5, { plugins: [] })]])} onClose={vi.fn()} onPlan={onPlan} />);
  fireEvent.change(screen.getByRole("searchbox", { name: "Search WordPress.org plugins" }), { target: { value: "woo" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(await screen.findByText("7M sites use it")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Choose WooCommerce" }));
  expect(screen.getByRole("checkbox", { name: "Install on Alpha" })).toBeDisabled();
  expect(screen.getByText("Already installed.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "Activate it after installing" }));
  fireEvent.click(screen.getByRole("button", { name: "Review 1 site" }));
  expect(onPlan).toHaveBeenCalledWith("Install WooCommerce on Fresh", [
    expect.objectContaining({ label: "Install WooCommerce", change: { site_id: 5, action: { do: "install_plugin", source: "woocommerce", activate: false } } }),
  ]);
});

test("Install from a link needs a full address", () => {
  mockInvoke.mockResolvedValue([]);
  render(<Install sites={[A]} inventory={INV} onClose={vi.fn()} onPlan={vi.fn()} />);
  fireEvent.change(screen.getByPlaceholderText("https://example.com/my-plugin.zip"), { target: { value: "not a link" } });
  fireEvent.click(screen.getByRole("button", { name: "Use this link" }));
  expect(screen.getByRole("alert")).toHaveTextContent("full link");
});

const ROWS: PlanRow[] = [
  { site: "Alpha", label: "Update WooCommerce", from: "10.2.0", to: "10.3.0", change: { site_id: 1, action: { do: "update_plugin", plugin: WOO } } },
  { site: "Beta", label: "Update WooCommerce", from: "10.2.0", to: "10.3.0", change: { site_id: 2, action: { do: "update_plugin", plugin: WOO } } },
];

function job(over: Partial<Job> = {}): Job {
  return {
    id: 9,
    title: "Update WooCommerce on 2 sites",
    created_at: 0,
    finished_at: 1,
    proposed_by: "human",
    confirmed_at: 0,
    declined_at: null,
    expired: false,
    items: [
      { id: 1, site_id: 1, site_name: "Alpha", action: ROWS[0].change.action, label: "Update WooCommerce", from_version: "10.2.0", to_version: "10.3.0", state: "done", message: "Updated." },
      { id: 2, site_id: 2, site_name: "Beta", action: ROWS[1].change.action, label: "Update WooCommerce", from_version: "10.2.0", to_version: "10.3.0", state: "failed", message: "The site took too long to answer." },
    ],
    ...over,
  };
}

test("a safe update that broke a site says it was rolled back and why, and isn't offered again", async () => {
  const reason = "Rolled back to 10.2.0. The home page answered 500 after the update: PHP Fatal error: Uncaught Error.";
  mockInvoke.mockImplementation(async () => job({ items: [{ ...job().items[1], state: "rolled_back", message: reason }] }));
  render(<JobSheet state={{ title: "Update WooCommerce", jobId: 9 }} onClose={vi.fn()} />);
  expect(await screen.findByText("Finished. 0 changes done, 1 rolled back.")).toBeInTheDocument();
  expect(screen.getByText("Rolled back")).toHaveClass("warning");
  expect(screen.getByText(reason)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Try the/ })).toBeNull();
});

test("the job sheet goes plan, confirm, progress and only sends what stayed ticked", async () => {
  mockInvoke.mockImplementation(async (cmd: string) => (cmd === "job_start" ? job({ finished_at: null }) : job()));
  render(<JobSheet state={{ title: "Update WooCommerce on 2 sites", rows: ROWS, start: "plan" }} onClose={vi.fn()} />);
  expect(screen.getByText("1. Plan")).toHaveAttribute("aria-current", "step");
  fireEvent.click(screen.getByRole("checkbox", { name: "Update WooCommerce on Beta" }));
  expect(screen.getByRole("checkbox", { name: "Every change on Beta" })).toHaveAttribute("aria-checked", "false");
  fireEvent.click(screen.getByRole("button", { name: "Review 1 change" }));
  expect(screen.getByText("2. Confirm")).toHaveAttribute("aria-current", "step");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Every change on Beta" }));
  fireEvent.click(screen.getByRole("button", { name: "Review 2 changes" }));
  fireEvent.click(screen.getByRole("button", { name: "Make these 2 changes" }));
  expect(mockInvoke).toHaveBeenCalledWith("job_start", { title: "Update WooCommerce on 2 sites", changes: ROWS.map((r) => r.change) });
  expect(await screen.findByText("Finished. 1 change done, 1 failed.")).toBeInTheDocument();
  expect(screen.getByText("The site took too long to answer.")).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Changes finished" })).toHaveAttribute("aria-valuenow", "2");
  mockInvoke.mockImplementation(async (cmd: string) => (cmd === "job_start" ? job({ id: 10, finished_at: null }) : new Promise(() => {})));
  fireEvent.click(screen.getByRole("button", { name: "Try the 1 failed change again" }));
  await waitFor(() =>
    expect(mockInvoke).toHaveBeenCalledWith("job_start", { title: "Try again: Update WooCommerce on 2 sites", changes: [ROWS[1].change] }),
  );
  // The retry button is gone, so focus must not fall out of the sheet.
  await waitFor(() => expect(screen.getByRole("button", { name: "Hide this panel" })).toHaveFocus());
});

test("a finished job of one change says so in words", async () => {
  mockInvoke.mockResolvedValue(job({ items: [job().items[0]] }));
  render(<JobSheet state={{ title: "Update WooCommerce on Alpha", jobId: 1 }} onClose={vi.fn()} />);
  expect(await screen.findByText("Finished. The change is done.")).toBeInTheDocument();
});

test("a risky single change starts at confirm with a red button, and a refused start says why", async () => {
  mockInvoke.mockRejectedValue("That site isn't in Monks Central any more.");
  render(<JobSheet state={{ title: "Roll back WooCommerce on Alpha", rows: [ROWS[0]], start: "confirm", danger: true }} onClose={vi.fn()} />);
  expect(screen.getByText("This runs on the site as soon as you confirm.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  const go = screen.getByRole("button", { name: "Update WooCommerce" });
  expect(go).toHaveClass("danger");
  fireEvent.click(go);
  expect(await screen.findByRole("alert")).toHaveTextContent("any more");
});

test("a running job can be hidden and says it keeps going", async () => {
  mockInvoke.mockResolvedValue(job({ finished_at: null, items: [{ ...job().items[0], state: "running" }] }));
  const onClose = vi.fn();
  render(<JobSheet state={{ title: "Update WooCommerce on Alpha", jobId: 9 }} onClose={onClose} />);
  expect(await screen.findByText(/0 of 1 finished\. You can close this panel/)).toBeInTheDocument();
  expect(screen.getByText("Running")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Hide this panel" }));
  expect(onClose).toHaveBeenCalled();
});
