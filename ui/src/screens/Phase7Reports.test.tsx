// SPDX-License-Identifier: GPL-3.0-or-later
// Phase 7: monthly client reports, and report and search settings.
import { render, screen, fireEvent, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { Reports, lastMonth } from "./Reports";
import { Settings } from "./Settings";
import { site } from "../test-fixtures";
import type { AppSettings } from "../api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
const mockInvoke = vi.mocked(invoke);
afterEach(() => mockInvoke.mockReset());

const A = site({ id: 1, name: "Alpha", client_id: 1, client: "Rosa" });
const B = site({ id: 2, name: "Beta", client_id: 1, client: "Rosa" });
const C = site({ id: 3, name: "Gamma" });
const SAVED = { html: "/d/rosa-report-2026-09.html", pdf: "/d/rosa-report-2026-09.pdf", preview: "<h1>Rosa</h1>", sites: 2, notes: ["Beta: store: Timed out."] };

function core(clients = [{ id: 1, name: "Rosa", email: "", notes: "" }]) {
  const calls: [string, Record<string, unknown>][] = [];
  let app: AppSettings = { report_name: "", report_footer: "", report_accent: "", white_label: false, search_console: false, agentedseo: false };
  let gsc = { on: false, client: false, connected: false };
  mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    const a = (args ?? {}) as Record<string, unknown>;
    calls.push([cmd, a]);
    switch (cmd) {
      case "clients_list":
        return clients;
      case "report_make":
        return SAVED;
      case "file_open":
      case "file_show":
        return null;
      case "app_settings_get":
        return app;
      case "app_settings_save":
        app = a.settings as AppSettings;
        gsc = { ...gsc, on: app.search_console };
        return app;
      case "gsc_status":
        return gsc;
      case "gsc_set_client":
        gsc = { ...gsc, client: true };
        return gsc;
      case "gsc_connect":
        gsc = { ...gsc, connected: true };
        return gsc;
    }
    throw new Error(cmd);
  });
  return calls;
}

test("last month is the one before today's, across a year", () => {
  expect(lastMonth(new Date(2026, 9, 28))).toBe("2026-09");
  expect(lastMonth(new Date(2027, 0, 5))).toBe("2026-12");
});

test("a client's report is made, opened and its gaps named", async () => {
  const calls = core();
  render(<Reports sites={[A, B, C]} />);
  expect(await screen.findByRole("combobox", { name: "Client" })).toHaveTextContent("Rosa (2 sites)");
  fireEvent.click(screen.getByRole("button", { name: "Make the report" }));
  fireEvent.click(await screen.findByRole("button", { name: "Open the PDF" }));
  expect(calls).toContainEqual(["report_make", { ask: { client_id: 1, site_ids: [], month: lastMonth() } }]);
  expect(calls).toContainEqual(["file_open", { path: SAVED.pdf }]);
  expect(screen.getByText("Beta: store: Timed out.")).toBeInTheDocument();
  expect(screen.getByTitle("Report preview")).toHaveAttribute("sandbox", "allow-same-origin");
});

test("without clients, sites are picked one by one", async () => {
  const calls = core([]);
  render(<Reports sites={[A, C]} />);
  const make = screen.getByRole("button", { name: "Make the report" });
  fireEvent.click(await screen.findByRole("checkbox", { name: "Gamma" }));
  expect(make).toBeEnabled();
  fireEvent.click(make);
  await screen.findByRole("button", { name: "Open the HTML" });
  expect(calls.find(([c]) => c === "report_make")![1]).toEqual({ ask: { client_id: null, site_ids: [3], month: lastMonth() } });
});

test("report branding saves, and Search Console asks for a client, then connects", async () => {
  const calls = core();
  render(<Settings theme="system" setTheme={() => {}} density="comfortable" setDensity={() => {}} />);
  fireEvent.change(await screen.findByRole("textbox", { name: "Your business name" }), { target: { value: "Studio North" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /White label/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save report settings" }));
  expect(await screen.findByText("Saved.")).toBeInTheDocument();
  expect(calls.find(([c]) => c === "app_settings_save")![1].settings).toMatchObject({ report_name: "Studio North", white_label: true, search_console: false });

  fireEvent.click(screen.getByRole("switch", { name: /Google Search Console/ }));
  const id = await screen.findByRole("textbox", { name: "Client ID" });
  fireEvent.change(id, { target: { value: "1.apps.googleusercontent.com" } });
  fireEvent.change(screen.getByLabelText("Client secret"), { target: { value: "s" } });
  fireEvent.click(screen.getByRole("button", { name: "Save the client" }));
  fireEvent.click(await screen.findByRole("button", { name: "Connect your Google account" }));
  expect(await screen.findByText("Your Google account is connected, read only.")).toBeInTheDocument();
  expect(calls).toContainEqual(["gsc_set_client", { id: "1.apps.googleusercontent.com", secret: "s" }]);
  const status = screen.getAllByRole("status").find((s) => within(s).queryByText("Connected to Search Console."));
  expect(status).toBeTruthy();
});
