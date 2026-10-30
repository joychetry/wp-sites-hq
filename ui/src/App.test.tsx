// SPDX-License-Identifier: GPL-3.0-or-later
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import App, { SECTIONS, shortAgo } from "./App";
import { site, choose } from "./test-fixtures";
import { leaveGuard } from "./fleet";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
const mockInvoke = vi.mocked(invoke);

const STATUS = { version: "0.0.1", pid: 7, role: "operator", headless: false, home: "/data" };

function serve(sites = [site(), site({ id: 2, name: "Monks Central Test", url: "https://monks-central-test.local" })]) {
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "core_status") return STATUS;
    if (cmd === "sites_list") return sites;
    return null;
  });
}

afterEach(() => {
  mockInvoke.mockReset();
  localStorage.clear();
});

test("shows every section in the sidebar, the sentence and the version", async () => {
  serve();
  render(<App />);
  const nav = screen.getByRole("navigation", { name: "Main" });
  for (const s of SECTIONS) {
    expect(within(nav).getByRole("button", { name: new RegExp(`^${s}`) })).toBeInTheDocument();
  }
  expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  expect(await screen.findByText("Both sites are healthy.", undefined, { timeout: 5000 })).toBeInTheDocument();
  expect(screen.getByText("v0.0.1")).toBeInTheDocument();
  expect(mockInvoke).toHaveBeenCalledWith("core_status");
});

const upd = (over: object = {}) => ({ current: "0.1.0", checked_at: 1, found: null, ready: false, progress: null, ...over });
const found = (version: string) => ({ version, notes: "- Faster", date: 1761696000 });

test("a new version is announced once, stays until closed, however often the app checks", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  serve();
  const base = mockInvoke.getMockImplementation()!;
  let status = upd({ found: found("0.2.0") });
  mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => (cmd === "app_update_status" ? status : base(cmd, args as never)));
  render(<App />);
  const note = "Monks Central 0.2.0 is out.";
  // App mounts its own toast region next to the test setup's, so the note shows in both.
  const shown = (await screen.findAllByText(note)).length;
  expect(screen.getAllByRole("button", { name: "See what's new" }).length).toBeGreaterThan(0);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(screen.getAllByText(note).length).toBe(shown);
  // The six-hourly check finds the same version again: no second note.
  const recheck = vi.mocked(listen).mock.calls.filter(([e]) => e === "app-update").at(-1)![1] as () => void;
  await act(async () => recheck());
  await act(async () => recheck());
  expect(screen.getAllByText(note).length).toBe(shown);
  status = upd({ found: found("0.3.0") });
  await act(async () => recheck());
  expect((await screen.findAllByText("Monks Central 0.3.0 is out.")).length).toBe(shown);
  vi.useRealTimers();
});

test("installing by itself waits while the editor has unsaved changes, then tries each minute", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  serve();
  const base = mockInvoke.getMockImplementation()!;
  mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "app_update_status") return upd({ found: found("0.2.0"), ready: true });
    if (cmd === "app_update_install") return false;
    return base(cmd, args as never);
  });
  const installs = () => mockInvoke.mock.calls.filter(([c]) => c === "app_update_install");
  leaveGuard.ask = () => {};
  render(<App />);
  await screen.findAllByText("Monks Central 0.2.0 is out.");
  await vi.advanceTimersByTimeAsync(120_000);
  expect(installs()).toHaveLength(0);
  leaveGuard.ask = null;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(installs()).toEqual([["app_update_install", { whenIdle: true }]]);
  // The core said not now (a job runs): it asks again a minute later.
  await vi.advanceTimersByTimeAsync(60_000);
  expect(installs()).toHaveLength(2);
  vi.useRealTimers();
});

test("switches section from the rail", async () => {
  serve();
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /^Sites/ }));
  expect(screen.getByRole("heading", { level: 1, name: /^Sites/ })).toBeInTheDocument();
  expect(await screen.findByRole("grid", { name: "Sites" })).toBeInTheDocument();
});

test("the top bar says when sites were checked and how many need attention, as pills", async () => {
  serve([site(), site({ id: 2, health: "down", health_detail: "No answer." })]);
  render(<App />);
  expect(await screen.findByText("Checked 2 min ago")).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByText(/^Last checked at /)).toHaveClass("sr-only");
  const go = screen.getByRole("button", { name: "1 site needs attention, open Sites" });
  expect(go).toHaveTextContent("1 needs attention");
  fireEvent.click(go);
  expect(screen.getByRole("heading", { level: 1, name: /^Sites/ })).toBeInTheDocument();
});

test("short relative time: just now, minutes, hours, yesterday, then a date", () => {
  const now = 1_800_000_000;
  expect(shortAgo(now - 30, now)).toBe("just now");
  expect(shortAgo(now - 300, now)).toBe("5 min ago");
  expect(shortAgo(now - 3 * 3600, now)).toBe("3 h ago");
  expect(shortAgo(now - 30 * 3600, now)).toBe("yesterday");
  expect(shortAgo(now - 5 * 86400, now)).toMatch(/^on \S/);
});

test("shows the core error in plain words", async () => {
  mockInvoke.mockRejectedValue("Monks Central is already running (pid 42).");
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Monks Central couldn't start." })).toBeInTheDocument();
  expect(screen.getAllByRole("alert")[0]).toHaveTextContent("already running (pid 42)");
});

test("Ctrl K opens the palette and runs a command", async () => {
  serve();
  render(<App />);
  await screen.findByText("Both sites are healthy.");
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  const input = screen.getByRole("combobox", { name: "Command" });
  fireEvent.change(input, { target: { value: "central test" } });
  expect(screen.getByRole("option", { name: /Monks Central Test/ })).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
  expect(screen.getByRole("complementary", { name: "Monks Central Test details" })).toBeInTheDocument();
});

test("the theme is the system's until light or dark is picked", async () => {
  serve();
  render(<App />);
  expect(screen.getByRole("button", { name: "Theme: same as my computer" })).toHaveAttribute("aria-pressed", "true");
  expect(document.documentElement.dataset.theme).toBe("light");
  fireEvent.click(screen.getByRole("button", { name: "Theme: dark" }));
  expect(screen.getByRole("button", { name: "Theme: dark" })).toHaveAttribute("aria-pressed", "true");
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(localStorage.getItem("mc-theme")).toBe("dark");
});

test("the scope switcher narrows to a group", async () => {
  serve([site({ group: "Clients" }), site({ id: 2, name: "Own", url: "https://own.local" })]);
  render(<App />);
  await screen.findByText("Both sites are healthy.");
  choose(screen.getByRole("combobox", { name: "Sites to show" }), "Clients");
  expect(screen.getByText("Your one site is healthy.")).toBeInTheDocument();
});

test("rows are comfortable until Settings picks compact, and it is remembered", async () => {
  serve();
  const { unmount } = render(<App />);
  expect(document.documentElement.dataset.density).toBe("comfortable");
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(await screen.findByRole("button", { name: "Compact" }));
  expect(document.documentElement.dataset.density).toBe("compact");
  unmount();
  render(<App />);
  expect(document.documentElement.dataset.density).toBe("compact");
});

test("the palette logs in to a site's dashboard where the connection can", async () => {
  serve([site({ capabilities: { operator: true, abilities: ["create-login-link"] } }), site({ id: 2, name: "Plain" })]);
  render(<App />);
  await screen.findByText("Both sites are healthy.");
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  const input = screen.getByRole("combobox", { name: "Command" });
  fireEvent.change(input, { target: { value: "dashboard" } });
  expect(screen.queryByRole("option", { name: /Plain's dashboard/ })).toBeNull();
  fireEvent.click(screen.getByRole("option", { name: /Log in to MC A's dashboard/ }));
  expect(mockInvoke).toHaveBeenCalledWith("site_login", { id: 1 });
});
