// SPDX-License-Identifier: GPL-3.0-or-later
// Preloading: a page's code and first reads start before the click, and a warmed read is never stale.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { api, cool, warm } from "./api";
import { prefetchIdle } from "./preload";
import { site } from "./test-fixtures";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
const mockInvoke = vi.mocked(invoke);
const calls = (cmd: string) => mockInvoke.mock.calls.filter(([c]) => c === cmd).length;

beforeEach(() => {
  cool();
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "core_status") return { version: "0.0.1", pid: 7, role: "operator", headless: false, home: "/data" };
    if (cmd === "sites_list") return [site()];
    if (cmd === "clients_list" || cmd === "costs_list") return [];
    return null;
  });
});
afterEach(() => {
  mockInvoke.mockReset();
  vi.useRealTimers();
});

test("a warmed read is used once, and only by the same call", async () => {
  warm(() => api.clients());
  expect(calls("clients_list")).toBe(1);
  // Warming again while it is fresh asks nothing more.
  warm(() => api.clients());
  expect(calls("clients_list")).toBe(1);
  await api.clients();
  expect(calls("clients_list")).toBe(1);
  // Used up: the next read asks the core.
  await api.clients();
  expect(calls("clients_list")).toBe(2);
});

test("any change drops the warmed reads, and they expire", async () => {
  warm(() => api.clients());
  await api.saveClient({ id: 0, name: "A", email: "", notes: "" });
  await api.clients();
  expect(calls("clients_list")).toBe(2);

  vi.useFakeTimers();
  warm(() => api.costs());
  vi.advanceTimersByTime(31_000);
  await api.costs();
  expect(calls("costs_list")).toBe(2);
});

test("hovering or focusing a nav item warms that page's reads once, and the page uses them", async () => {
  render(<App />);
  const nav = screen.getByRole("navigation", { name: "Main" });
  const clients = within(nav).getByRole("button", { name: /^Clients/ });
  fireEvent.pointerEnter(clients);
  fireEvent.focus(clients);
  expect(calls("clients_list")).toBe(1);
  fireEvent.click(clients);
  expect(await screen.findByRole("heading", { name: "Clients", level: 1 })).toBeInTheDocument();
  await screen.findByText(/No clients yet/);
  expect(calls("clients_list")).toBe(1);
});

test("after the first paint the next pages load one per idle moment", () => {
  const queued: (() => void)[] = [];
  vi.stubGlobal("requestIdleCallback", (f: () => void) => queued.push(f));
  vi.stubGlobal("cancelIdleCallback", () => {});
  try {
    const stop = prefetchIdle("Overview");
    expect(queued).toHaveLength(1);
    // Sites, Updates, Plugins, Content, Media, Users, Comments, Classic Monks, Monitoring, Security, then Clients.
    for (let i = 0; i < 11; i++) queued.shift()!();
    expect(calls("clients_list")).toBe(1);
    expect(queued).toHaveLength(1);
    stop();
  } finally {
    vi.unstubAllGlobals();
  }
});
