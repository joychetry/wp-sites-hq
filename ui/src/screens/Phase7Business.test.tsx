// SPDX-License-Identifier: GPL-3.0-or-later
// Phase 7 business: clients, costs and charges, and the site list in and out.
import { render as draw, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { Clients, money, perMonth, sums, toCents } from "./Clients";
import { Settings, importNote } from "./Settings";
import { site, choose } from "../test-fixtures";
import { HeadSlot } from "../components/ui";
import type { ReactElement, ReactNode } from "react";

// The page head's action slot, as App gives it: the screen's main actions render there.
const head = document.body.appendChild(document.createElement("div"));
const InHead = ({ children }: { children: ReactNode }) => <HeadSlot.Provider value={head}>{children}</HeadSlot.Provider>;
const render = (ui: ReactElement) => draw(ui, { wrapper: InHead });
import type { Cost } from "../api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
const mockInvoke = vi.mocked(invoke);
afterEach(() => mockInvoke.mockReset());

const A = site({ id: 1, name: "Alpha", client_id: 1, client: "Rosa" });
const B = site({ id: 2, name: "Beta" });
const cost = (over: Partial<Cost>): Cost => ({ id: 1, site_id: 1, client_id: null, kind: "cost", label: "Hosting", cents: 24000, currency: "EUR", every: "year", renews_on: "2027-03-01", ...over });
const COSTS = [cost({}), cost({ id: 2, site_id: null, client_id: 1, kind: "charge", label: "Care plan", cents: 9900, every: "month", renews_on: null }), cost({ id: 3, site_id: 2, label: "Domain", cents: 1500, currency: "USD", every: "once", renews_on: "2026-12-01" })];

function core(over: Record<string, (a: Record<string, unknown>) => unknown> = {}) {
  const calls: [string, Record<string, unknown>][] = [];
  mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    const a = (args ?? {}) as Record<string, unknown>;
    calls.push([cmd, a]);
    if (over[cmd]) return over[cmd](a);
    switch (cmd) {
      case "clients_list":
        return [{ id: 1, name: "Rosa", email: "rosa@x.test", notes: "" }];
      case "costs_list":
        return COSTS;
      case "client_save":
        return { ...(a.client as object), id: 7 };
      case "cost_save":
        return a.cost;
      default:
        return null;
    }
  });
  return calls;
}

test("money sums by month and currency", () => {
  expect(money(1250, "EUR")).toBe("€12.50");
  expect(money(100, "ZZ")).toBe("ZZ 1.00");
  expect(COSTS.map(perMonth)).toEqual([2000, 9900, 0]);
  expect([...sums(COSTS)]).toEqual([
    ["EUR", { cost: 2000, charge: 9900 }],
    ["USD", { cost: 0, charge: 0 }],
  ]);
  expect([toCents("12"), toCents("12.5"), toCents("12,05"), toCents("1.234"), toCents("-1"), toCents("")]).toEqual([1200, 1250, 1205, null, null, null]);
});

test("lists clients with their sites and what is left each month", async () => {
  core();
  render(<Clients sites={[A, B]} />);
  const table = await screen.findByRole("table", { name: "Clients" });
  const rosa = within(table).getByRole("button", { name: "Rosa" }).closest("tr")!;
  expect(within(rosa).getByText("Alpha")).toBeInTheDocument();
  expect(within(rosa).getByText("€20.00")).toBeInTheDocument();
  expect(within(rosa).getByText("€99.00")).toBeInTheDocument();
  expect(within(rosa).getByText("€79.00")).toBeInTheDocument();
  const none = within(table).getByText("No client yet").closest("tr")!;
  expect(within(none).getByText("Beta")).toBeInTheDocument();
  // Each cost or charge is a row under its client, with how often and when it renews or is due.
  expect(within(table).getByRole("button", { name: "Domain" }).closest("tr")).toHaveTextContent("Cost · once · due 1 Dec 2026$15.00");
  expect(within(table).getByRole("button", { name: "Care plan" }).closest("tr")).toHaveTextContent("Charge · monthly€99.00");
  // What renews soon, in date order.
  const soon = screen.getByRole("region", { name: "Renewing soon" });
  expect(within(soon).getAllByRole("listitem").map((li) => li.querySelector("b")!.textContent)).toEqual(["Domain · Beta", "Hosting · Alpha"]);
});

test("adds a client with their sites, and a cost on a site", async () => {
  const calls = core();
  render(<Clients sites={[A, B]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Add a client" }));
  let sheet = screen.getByRole("dialog", { name: "Add a client" });
  fireEvent.change(within(sheet).getByRole("textbox", { name: "Name" }), { target: { value: "Studio North" } });
  const theirs = within(sheet).getByRole("combobox", { name: "Their sites" });
  fireEvent.change(theirs, { target: { value: "a" } });
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Alpha (now with Rosa)", "Beta"]);
  fireEvent.change(theirs, { target: { value: "bet" } });
  expect(screen.getByRole("option", { name: "Beta" })).toHaveAttribute("aria-selected", "false");
  fireEvent.keyDown(theirs, { key: "Enter" });
  expect(within(sheet).getByRole("button", { name: "Remove Beta" })).toBeInTheDocument();
  fireEvent.click(within(sheet).getByRole("button", { name: "Add the client" }));
  await waitFor(() => expect(calls.some((c) => c[0] === "site_set_client" && c[1].id === 2 && c[1].client === 7)).toBe(true));
  expect(await screen.findByText("Added Studio North.")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Add a cost or charge" }));
  sheet = screen.getByRole("dialog", { name: "Add a cost or charge" });
  choose(within(sheet).getByRole("combobox", { name: "On" }), "s2");
  fireEvent.change(within(sheet).getByRole("textbox", { name: "What it is" }), { target: { value: "Backups" } });
  fireEvent.change(within(sheet).getByRole("textbox", { name: "Amount" }), { target: { value: "abc" } });
  expect(within(sheet).getByText(/Write the amount as a number/)).toBeInTheDocument();
  expect(within(sheet).getByRole("button", { name: "Add it" })).toBeDisabled();
  fireEvent.change(within(sheet).getByRole("textbox", { name: "Amount" }), { target: { value: "5,50" } });
  choose(within(sheet).getByRole("combobox", { name: "How often" }), "month");
  fireEvent.click(within(sheet).getByRole("button", { name: "A charge to the client" }));
  fireEvent.click(within(sheet).getByRole("button", { name: "Add it" }));
  await waitFor(() =>
    expect(calls.find((c) => c[0] === "cost_save")?.[1].cost).toEqual({ id: 0, site_id: 2, client_id: null, kind: "charge", label: "Backups", cents: 550, currency: "USD", every: "month", renews_on: null }),
  );
});

test("deleting a client asks first; site errors show in the sheet", async () => {
  const calls = core({ client_save: () => Promise.reject("There is already a client called Rosa.") });
  render(<Clients sites={[A, B]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Rosa" }));
  const sheet = screen.getByRole("dialog", { name: "Edit Rosa" });
  expect(within(sheet).getByRole("list", { name: "Their sites: chosen" })).toHaveTextContent("Alpha");
  fireEvent.click(within(sheet).getByRole("button", { name: "Save changes" }));
  expect(await within(sheet).findByRole("alert")).toHaveTextContent("already a client");
  fireEvent.click(within(sheet).getByRole("button", { name: "Delete the client" }));
  expect(within(sheet).getByText(/Their sites stay/)).toBeInTheDocument();
  fireEvent.click(within(sheet).getAllByRole("button", { name: "Delete the client" }).at(-1)!);
  await waitFor(() => expect(calls.some((c) => c[0] === "client_delete" && c[1].id === 1)).toBe(true));
});

test("an empty list explains what clients are for", async () => {
  core({ clients_list: () => [], costs_list: () => [] });
  render(<Clients sites={[]} />);
  expect(await screen.findByText("No clients yet.")).toBeInTheDocument();
});

test("exports into Downloads and imports a file, saying what was left out", async () => {
  const calls = core({
    sites_export: (a) => `/home/you/Downloads/sites.${a.csv ? "csv" : "json"}`,
    sites_import: () => ({ sites: 1, clients: 1, costs: 2, not_connected: ["https://gone.test"] }),
  });
  render(<Settings theme="system" setTheme={() => {}} density="comfortable" setDensity={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Export as CSV" }));
  expect(await screen.findByText("Saved /home/you/Downloads/sites.csv")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show in folder" }));
  await waitFor(() => expect(calls.some((c) => c[0] === "file_show")).toBe(true));
  const file = new File(['{"monks_central":1}'], "sites.json", { type: "application/json" });
  fireEvent.change(screen.getByLabelText("Import a JSON or CSV file"), { target: { files: [file] } });
  expect(await screen.findByText(/Imported: 1 site updated, 1 client added, 2 costs and charges added\. Not connected here, so left out: https:\/\/gone.test/)).toBeInTheDocument();
  expect(calls.find((c) => c[0] === "sites_import")?.[1]).toEqual({ text: '{"monks_central":1}' });
  expect(importNote({ sites: 0, clients: 0, costs: 1, not_connected: [] })).toBe("Imported: 0 sites updated, 0 clients added, 1 cost or charge added.");
});

test("text size is a slider that scales the whole app and is remembered", () => {
  core();
  render(<Settings theme="system" setTheme={() => {}} density="comfortable" setDensity={() => {}} />);
  const slider = screen.getByRole("slider", { name: "Text size" });
  expect(slider).toHaveAttribute("aria-valuetext", "100%");
  fireEvent.change(slider, { target: { value: "120" } });
  expect(document.documentElement.style.fontSize).toBe("120%");
  expect(localStorage.getItem("mc-text-size")).toBe("120");
  fireEvent.change(slider, { target: { value: "100" } });
  expect(document.documentElement.style.fontSize).toBe("");
});

test("Monks Central checks for a new version on request and installs only on a click", async () => {
  const status = (found: object | null) => ({ current: "0.1.0", checked_at: 1761696000, found, ready: false, progress: null as number[] | null });
  let now = status(null);
  const calls = core({
    app_settings_get: () => ({ report_name: "", report_footer: "", report_accent: "", white_label: false, search_console: false, agentedseo: false, auto_update: false }),
    app_update_status: () => now,
    app_update_check: () => now,
    app_update_install: () => Promise.reject("Couldn't install the new version: offline. This version keeps working."),
  });
  render(<Settings theme="system" setTheme={() => {}} density="comfortable" setDensity={() => {}} />);
  expect(await screen.findByText("0.1.0")).toBeInTheDocument();
  expect(screen.getByText("None, you have the newest")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Check now" }));
  expect(await screen.findByText("You have the newest version of Monks Central.")).toBeInTheDocument();
  // Notes are shown as text: markup in latest.json stays words on the screen.
  now = { ...status({ version: "0.2.0", notes: "### Media\n- Grid view <img src=x onerror=alert(1)>", date: 1761696000 }), progress: [3145728, 10485760] };
  fireEvent.click(screen.getByRole("button", { name: "Check now" }));
  const notes = await screen.findByRole("region", { name: "What's new in 0.2.0" });
  expect(notes).toHaveTextContent("Media - Grid view <img src=x onerror=alert(1)>");
  expect(notes.querySelector("img")).toBeNull();
  expect(screen.getByText(/^0\.2\.0, released/)).toBeInTheDocument();
  expect(screen.getByText(/Downloading 0\.2\.0: 3\.0 MB of 10\.0 MB/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Install 0.2.0 now" })).toBeDisabled();
  now = { ...now, progress: null };
  fireEvent.click(screen.getByRole("button", { name: "Check now" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Install 0.2.0 now" })).toBeEnabled());
  expect(calls.some(([c]) => c === "app_update_install")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Install 0.2.0 now" }));
  expect(await screen.findByText(/This version keeps working\./)).toBeInTheDocument();
  expect(calls.find(([c]) => c === "app_update_install")?.[1]).toEqual({ whenIdle: false });
});

test("installing updates automatically is off until switched on, then saved and the download starts", async () => {
  let saved: Record<string, unknown> | null = null;
  const calls = core({
    app_settings_get: () => ({ report_name: "", report_footer: "", report_accent: "", white_label: false, search_console: false, agentedseo: false, auto_update: false }),
    app_settings_save: (a) => (saved = a.settings as Record<string, unknown>),
    app_update_status: () => ({ current: "0.1.0", checked_at: null, found: null, ready: false, progress: null }),
    app_update_check: () => ({ current: "0.1.0", checked_at: 1, found: null, ready: false, progress: null }),
  });
  render(<Settings theme="system" setTheme={() => {}} density="comfortable" setDensity={() => {}} />);
  const auto = await screen.findByRole("switch", { name: "Install updates automatically" });
  expect(auto).not.toBeChecked();
  expect(screen.getByText("Not yet")).toBeInTheDocument();
  fireEvent.click(auto);
  await waitFor(() => expect(saved?.auto_update).toBe(true));
  expect(await screen.findByText("New versions now install by themselves when nothing is running.")).toBeInTheDocument();
  await waitFor(() => expect(calls.some(([c]) => c === "app_update_check")).toBe(true));
  expect(screen.getByRole("switch", { name: "Install updates automatically" })).toBeChecked();
});
