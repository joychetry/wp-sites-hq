// SPDX-License-Identifier: GPL-3.0-or-later
// Search in the Ctrl K palette: local matches at once, then posts and pages from every site.
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { localHits } from "../find";
import { Palette } from "./Palette";
import { site } from "../test-fixtures";
import type { SiteInventory } from "../api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);
afterEach(() => {
  mockInvoke.mockReset();
  vi.useRealTimers();
});

const A = site({ id: 1, name: "Alpha", client_id: 1, client: "Rosa" });
const B = site({ id: 2, name: "Beta", url: "https://beta.test" });
const plugin = (id: string, name: string, version: string, active = true) => ({ id, name, version, active, update: null, auto_update: false });
const inv = new Map<number, SiteInventory>([
  [1, { site_id: 1, fetched_at: 0, inventory: { plugins: [plugin("woocommerce/woocommerce.php", "WooCommerce", "10.2.0")], themes: [] } } as unknown as SiteInventory],
  [2, { site_id: 2, fetched_at: 0, inventory: { plugins: [plugin("woocommerce/woocommerce.php", "WooCommerce", "10.3.0", false)], themes: [] } } as unknown as SiteInventory],
]);
const ROSA = { id: 1, name: "Rosa", email: "rosa@x.test", notes: "" };
const hit = (id: number, title: string, site_id = 1, post_type = "post") => ({ site_id, post_type, id, title, status: "publish", link: `https://alpha.test/${id}` });

function serve(content: () => Promise<unknown> = async () => ({ hits: [], failed: [] })) {
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "clients_list") return [ROSA];
    if (cmd === "content_search") return content();
    throw new Error(cmd);
  });
}

const open = (props: Partial<Parameters<typeof Palette>[0]> = {}) => {
  const onLocal = vi.fn();
  const onPost = vi.fn();
  const onClose = vi.fn();
  render(<Palette commands={[]} onClose={onClose} sites={[A, B]} inventory={inv} onLocal={onLocal} onPost={onPost} {...props} />);
  return { box: screen.getByRole("combobox", { name: "Search or run a command" }), onLocal, onPost, onClose };
};

test("local matches come from sites, inventory and clients, one row per plugin", () => {
  const hits = localHits("WOO", [A, B], inv, [ROSA]);
  expect(hits).toEqual([{ kind: "Plugins", key: "pluginswoocommerce/woocommerce.php", label: "WooCommerce", detail: "On Alpha (10.2.0), Beta (10.3.0, off)", pkg: { kind: "plugin", slug: "woocommerce", name: "WooCommerce" } }]);
  expect(localHits("rosa", [A, B], inv, [ROSA]).map((h) => `${h.kind}:${h.label}`)).toEqual(["Sites:Alpha", "Clients:Rosa"]);
  expect(localHits("  ", [A], inv, [ROSA])).toEqual([]);
});

test("the empty palette says what it can find", () => {
  serve();
  const { box } = open();
  expect(box).toHaveAttribute("placeholder", "Search sites, plugins, themes, clients, posts and pages, or run a command");
});

test("finds show under their own group, and Enter opens the one chosen", async () => {
  serve();
  const { box, onLocal, onClose } = open({ commands: [{ id: "go-Sites", group: "Pages", label: "Go to Sites", run: () => {} }] });
  fireEvent.change(box, { target: { value: "rosa" } });
  const clients = await screen.findByRole("group", { name: "Clients" });
  expect(within(clients).getByRole("option", { name: /Rosa/ })).toBeInTheDocument();
  expect(within(screen.getByRole("group", { name: "Sites" })).getByRole("option", { name: /Alpha/ })).toHaveAttribute("aria-selected", "true");
  // Arrows move across groups: from the site down to the client.
  fireEvent.keyDown(box, { key: "ArrowDown" });
  fireEvent.keyDown(box, { key: "Enter" });
  expect(onLocal).toHaveBeenCalledWith(expect.objectContaining({ kind: "Clients", clientId: 1 }));
  expect(onClose).toHaveBeenCalled();
});

test("a plugin found on two sites is one row", async () => {
  serve();
  const { box, onLocal } = open();
  fireEvent.change(box, { target: { value: "woo" } });
  const plugins = await screen.findByRole("group", { name: "Plugins" });
  fireEvent.click(within(plugins).getByRole("option", { name: /WooCommerce On Alpha \(10.2.0\), Beta \(10.3.0, off\)/ }));
  expect(onLocal).toHaveBeenCalledWith(expect.objectContaining({ kind: "Plugins", label: "WooCommerce" }));
});

test("posts and pages are asked once typing pauses, from two letters", async () => {
  vi.useFakeTimers();
  serve(async () => ({ hits: [hit(7, "Beta launch", 1, "page")], failed: [[2, "No answer."]] }));
  const { box, onPost } = open();
  fireEvent.change(box, { target: { value: "b" } });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(mockInvoke).not.toHaveBeenCalledWith("content_search", expect.anything());
  fireEvent.change(box, { target: { value: "be" } });
  fireEvent.change(box, { target: { value: "beta launch" } });
  expect(screen.getByText("Looking for posts and pages on every site…")).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(250));
  expect(mockInvoke.mock.calls.filter(([c]) => c === "content_search")).toEqual([["content_search", { query: "beta launch" }]]);
  const posts = screen.getByRole("group", { name: "Posts and pages" });
  fireEvent.click(within(posts).getByRole("option", { name: /Beta launch Page · Alpha · Published/ }));
  expect(onPost).toHaveBeenCalledWith(expect.objectContaining({ id: 7, post_type: "page" }));
  expect(screen.getByText("Could not search Beta: No answer.")).toBeInTheDocument();
});

test("a long list of posts shows five, then the rest on Show more", async () => {
  vi.useFakeTimers();
  serve(async () => ({ hits: [1, 2, 3, 4, 5, 6, 7].map((n) => hit(n, `Menu ${n}`)), failed: [] }));
  const { box, onClose } = open();
  fireEvent.change(box, { target: { value: "menu" } });
  await act(() => vi.advanceTimersByTimeAsync(250));
  const posts = screen.getByRole("group", { name: "Posts and pages" });
  expect(within(posts).getAllByRole("option")).toHaveLength(6);
  fireEvent.click(within(posts).getByRole("option", { name: "Show 2 more" }));
  expect(onClose).not.toHaveBeenCalled();
  expect(within(posts).getAllByRole("option")).toHaveLength(7);
});

test("a failed search says why", async () => {
  vi.useFakeTimers();
  serve(() => Promise.reject("Type at least two letters."));
  const { box } = open();
  fireEvent.change(box, { target: { value: "ab" } });
  await act(() => vi.advanceTimersByTimeAsync(250));
  expect(screen.getByText("Couldn't search posts and pages: Type at least two letters.")).toBeInTheDocument();
});
