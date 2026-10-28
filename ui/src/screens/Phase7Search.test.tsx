// SPDX-License-Identifier: GPL-3.0-or-later
// Phase 7 global search: local matches at once, posts and pages from every site.
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { Search, localHits } from "./Search";
import { Palette } from "../components/Palette";
import { site } from "../test-fixtures";
import type { SiteInventory } from "../api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);
afterEach(() => mockInvoke.mockReset());

const A = site({ id: 1, name: "Alpha", client_id: 1, client: "Rosa" });
const B = site({ id: 2, name: "Beta", url: "https://beta.test" });
const plugin = (id: string, name: string, version: string, active = true) => ({ id, name, version, active, update: null, auto_update: false });
const inv = new Map<number, SiteInventory>([
  [1, { site_id: 1, fetched_at: 0, inventory: { plugins: [plugin("woocommerce/woocommerce.php", "WooCommerce", "10.2.0")], themes: [] } } as unknown as SiteInventory],
  [2, { site_id: 2, fetched_at: 0, inventory: { plugins: [plugin("woocommerce/woocommerce.php", "WooCommerce", "10.3.0", false)], themes: [] } } as unknown as SiteInventory],
]);
const ROSA = { id: 1, name: "Rosa", email: "rosa@x.test", notes: "" };

test("local matches come from sites, inventory and clients, one row per plugin", () => {
  const hits = localHits("WOO", [A, B], inv, [ROSA]);
  expect(hits).toEqual([{ kind: "Plugins", key: "pluginswoocommerce/woocommerce.php", label: "WooCommerce", detail: "On Alpha (10.2.0), Beta (10.3.0, off)" }]);
  expect(localHits("rosa", [A, B], inv, [ROSA]).map((h) => `${h.kind}:${h.label}`)).toEqual(["Sites:Alpha", "Clients:Rosa"]);
  expect(localHits("  ", [A], inv, [ROSA])).toEqual([]);
});

test("search shows local results and posts from each site, and names sites it could not search", async () => {
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "clients_list") return [ROSA];
    if (cmd === "content_search")
      return { hits: [{ site_id: 1, post_type: "page", id: 7, title: "Beta launch", status: "future", link: "https://alpha.test/beta" }], failed: [[2, "No answer."]] };
    if (cmd === "link_open") return null;
    throw new Error(cmd);
  });
  const go = vi.fn();
  render(<Search sites={[A, B]} inventory={inv} query="beta" onGo={go} />);
  const table = await screen.findByRole("table", { name: "Posts and pages found" });
  const row = within(table).getByRole("row", { name: /Beta launch/ });
  expect(within(row).getByText("Page")).toBeInTheDocument();
  expect(within(row).getByText("Scheduled")).toBeInTheDocument();
  fireEvent.click(within(row).getByRole("button", { name: "View Beta launch on Alpha" }));
  expect(mockInvoke).toHaveBeenCalledWith("link_open", { url: "https://alpha.test/beta", site: 1 });
  expect(screen.getByText("Not searched: Beta (No answer.)")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open on Sites: Beta" }));
  expect(go).toHaveBeenCalledWith("Sites", 2);
  expect(mockInvoke).toHaveBeenCalledWith("content_search", { query: "beta" });
});

test("a new search runs on submit, and a short one asks for more", async () => {
  mockInvoke.mockImplementation(async (cmd: string) => (cmd === "clients_list" ? [] : { hits: [], failed: [] }));
  render(<Search sites={[A]} inventory={inv} query="" onGo={() => {}} />);
  expect(screen.getByRole("heading", { name: "Search every site at once." })).toBeInTheDocument();
  const box = screen.getByRole("textbox", { name: "Search everything" });
  fireEvent.change(box, { target: { value: "a" } });
  expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
  fireEvent.change(box, { target: { value: "zz" } });
  fireEvent.submit(box.closest("form")!);
  expect(await screen.findByText("No posts or pages match on any site.")).toBeInTheDocument();
  expect(screen.getByText("No sites, plugins, themes or clients match.")).toBeInTheDocument();
});

test("the palette offers to search everything once two letters are typed", () => {
  const onSearch = vi.fn();
  render(<Palette commands={[]} onClose={() => {}} onSearch={onSearch} />);
  const box = screen.getByRole("combobox", { name: "Command" });
  fireEvent.change(box, { target: { value: "m" } });
  expect(screen.queryByRole("option")).toBeNull();
  fireEvent.change(box, { target: { value: "menu " } });
  fireEvent.keyDown(box, { key: "Enter" });
  expect(onSearch).toHaveBeenCalledWith("menu");
});

test("a failed search says why", async () => {
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "clients_list") return [];
    throw "Type at least two letters.";
  });
  render(<Search sites={[A]} inventory={inv} query="ab" onGo={() => {}} />);
  await waitFor(() => expect(screen.getByText("Type at least two letters.")).toBeInTheDocument());
});
