// SPDX-License-Identifier: GPL-3.0-or-later
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { Sites } from "./Sites";
import { Select } from "../components/controls";
import { site } from "../test-fixtures";
import { connectorInfo, pluginName } from "../api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
const mockInvoke = vi.mocked(invoke);
afterEach(() => mockInvoke.mockReset());
// The inventory read (useInventory) and anything a test does not set up answer with nothing.
beforeEach(() => mockInvoke.mockImplementation(async () => []));

const SITES = [
  site({ id: 1, name: "Alpha" }),
  site({ id: 2, name: "Beta", mode: "basic", username: "admin", cm_version: null, capabilities: {} }),
  site({ id: 3, name: "Gamma", sign_in_again: true }),
];

function Harness() {
  return <Sites sites={SITES} groups={[]} focusId={null} setFocusId={vi.fn()} onAdd={vi.fn()} onSignInAgain={vi.fn()} />;
}

test("table, statuses and the inspector for the focused site", () => {
  render(<Harness />);
  expect(screen.getAllByRole("row")).toHaveLength(4);
  expect(screen.getByRole("grid", { name: "Sites" })).toHaveTextContent("Basic");
  expect(screen.getAllByText("Sign in again").length).toBeGreaterThan(0);
  expect(screen.getByRole("complementary", { name: "Alpha details" })).toHaveTextContent("Full, ticked on the site");
});

test("keys: j moves, x selects, / filters, a adds", () => {
  const onAdd = vi.fn();
  const moves: number[] = [];
  const { rerender } = render(
    <Sites sites={SITES} groups={[]} focusId={null} setFocusId={(id) => moves.push(id!)} onAdd={onAdd} onSignInAgain={vi.fn()} />,
  );
  fireEvent.keyDown(document, { key: "j" });
  expect(moves).toEqual([2]);
  rerender(<Sites sites={SITES} groups={[]} focusId={2} setFocusId={vi.fn()} onAdd={onAdd} onSignInAgain={vi.fn()} />);
  expect(screen.getByRole("complementary", { name: "Beta details" })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: "x" });
  expect(screen.getByRole("region", { name: "Selection" })).toHaveTextContent("1 site ticked");
  fireEvent.keyDown(document, { key: "/" });
  expect(screen.getByRole("searchbox", { name: "Filter sites" })).toHaveFocus();
  fireEvent.change(screen.getByRole("searchbox", { name: "Filter sites" }), { target: { value: "gam" } });
  expect(screen.getAllByRole("row")).toHaveLength(2);
  (document.activeElement as HTMLElement).blur();
  fireEvent.keyDown(document, { key: "a" });
  expect(onAdd).toHaveBeenCalled();
});

test("remove asks first, then reports what happened on the site", async () => {
  mockInvoke.mockImplementation(async (c) => (c === "inventory_list" ? [] : { signed_out: true, message: "Removed. WP Sites HQ signed out of the site." }));
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Remove from WP Sites HQ" }));
  expect(screen.getByRole("alertdialog", { name: "Remove Alpha" })).toHaveTextContent("signs out on the site");
  fireEvent.click(screen.getByRole("button", { name: "Remove Alpha" }));
  await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("site_remove", { id: 1 }));
  expect(await screen.findByRole("status")).toHaveTextContent("signed out of the site");
});

test("tags, notes and group go to the core", async () => {
  mockInvoke.mockImplementation(async (c) => (c === "inventory_list" ? [] : SITES[0]));
  render(<Harness />);
  const tag = screen.getByRole("combobox", { name: "Tags" });
  fireEvent.change(tag, { target: { value: "woo" } });
  fireEvent.keyDown(tag, { key: "Enter" });
  expect(mockInvoke).toHaveBeenCalledWith("site_set_tags", { id: 1, tags: ["woo"] });
  fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), { target: { value: "Ask first" } });
  fireEvent.click(screen.getByRole("button", { name: "Add the note" }));
  expect(mockInvoke).toHaveBeenCalledWith("site_add_note", { id: 1, body: "Ask first" });
  const group = screen.getByRole("combobox", { name: "Group" });
  fireEvent.change(group, { target: { value: "Clients" } });
  fireEvent.keyDown(group, { key: "Enter" });
  expect(mockInvoke).toHaveBeenCalledWith("site_set_group", { id: 1, group: "Clients" });
});

test("a site that needs a sign-in offers it", () => {
  const onSignInAgain = vi.fn();
  render(<Sites sites={SITES} groups={[]} focusId={3} setFocusId={vi.fn()} onAdd={vi.fn()} onSignInAgain={onSignInAgain} />);
  fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: "Sign in again" }));
  expect(onSignInAgain).toHaveBeenCalledWith(SITES[2]);
});

test("a connection with no tools says so in the table and offers Sign in again", () => {
  const onSignInAgain = vi.fn();
  const empty = site({ id: 4, name: "Empty", capabilities: { abilities: [], hq_status: false, degraded: true } });
  render(<Sites sites={[empty]} groups={[]} focusId={4} setFocusId={vi.fn()} onAdd={vi.fn()} onSignInAgain={onSignInAgain} />);
  expect(screen.getByRole("grid", { name: "Sites" })).toHaveTextContent("No tools yet");
  const insp = screen.getByRole("complementary", { name: "Empty details" });
  expect(insp).toHaveTextContent("Connected, but this connection can't do anything yet. Sign in again and tick the tool groups.");
  expect(insp).not.toHaveTextContent("older");
  fireEvent.click(within(insp).getByRole("button", { name: "Sign in again" }));
  expect(onSignInAgain).toHaveBeenCalledWith(empty);
});

test("the table's foot says how many show and which keys work", () => {
  render(<Harness />);
  expect(screen.getByRole("grid", { name: "Sites" })).toHaveAccessibleDescription(/Showing 3 of 3 sites.*move.*tick.*filter.*check the open site.*add a site/);
});

test("Space on a row's checkbox is left to that checkbox; rows say selected only when they are", () => {
  render(<Harness />);
  const beta = screen.getByRole("checkbox", { name: "Select Beta" });
  fireEvent.keyDown(beta, { key: " " });
  expect(screen.queryByRole("region", { name: "Selection" })).not.toBeInTheDocument();
  expect(screen.queryAllByRole("row", { selected: true })).toHaveLength(0);
  fireEvent.click(beta);
  expect(screen.getByRole("row", { selected: true })).toHaveTextContent("Beta");
  fireEvent.keyDown(screen.getByRole("grid", { name: "Sites" }), { key: " " });
  expect(screen.getByRole("region", { name: "Selection" })).toHaveTextContent("2 sites ticked");
});

test("one-click login shows only where the connection can make a login link", async () => {
  mockInvoke.mockImplementation(async (c) => (c === "inventory_list" ? [] : null));
  const login = site({ id: 4, name: "Delta", capabilities: { operator: true, abilities: ["create-login-link"] } });
  const { rerender } = render(<Sites sites={[...SITES, login]} groups={[]} focusId={4} setFocusId={vi.fn()} onAdd={vi.fn()} onSignInAgain={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Log in to the dashboard" }));
  await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("site_login", { id: 4 }));
  for (const id of [1, 2, 3]) {
    rerender(<Sites sites={[...SITES, login]} groups={[]} focusId={id} setFocusId={vi.fn()} onAdd={vi.fn()} onSignInAgain={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Log in to the dashboard" })).toBeNull();
  }
});

test("deleting a note offers Undo, which writes it again", async () => {
  mockInvoke.mockImplementation(async (c) => (c === "inventory_list" ? [] : undefined));
  const noted = [{ ...SITES[0], notes: [{ id: 7, body: "Renews in March", added_at: 0 }] }, ...SITES.slice(1)];
  render(
    <Sites sites={noted} groups={[]} focusId={null} setFocusId={vi.fn()} onAdd={vi.fn()} onSignInAgain={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete note" }));
  expect(await screen.findByText("Deleted the note on Alpha.")).toBeInTheDocument();
  expect(mockInvoke).toHaveBeenCalledWith("site_delete_note", { id: 1, noteId: 7 });
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("site_add_note", { id: 1, body: "Renews in March" }));
});

test("keys typed in the kit's own controls are theirs, not the table's", () => {
  const onAdd = vi.fn();
  render(
    <>
      <Select aria-label="Sites to show" value="" onChange={vi.fn()}>
        <option value="">All sites</option>
        <option value="Acme">Acme</option>
      </Select>
      <Sites sites={SITES} groups={[]} focusId={null} setFocusId={vi.fn()} onAdd={onAdd} onSignInAgain={vi.fn()} />
    </>,
  );
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Sites to show" }), { key: "a" });
  expect(onAdd).not.toHaveBeenCalled();
});

test("Enter in an empty group box leaves the selection's groups alone; a name moves them and says so", async () => {
  mockInvoke.mockImplementation(async (c) => (c === "inventory_list" ? [] : null));
  render(<Harness />);
  fireEvent.keyDown(document, { key: "x" });
  const box = screen.getByRole("combobox", { name: "Group for the selected sites" });
  fireEvent.keyDown(box, { key: "Enter" });
  expect(mockInvoke).not.toHaveBeenCalledWith("site_set_group", expect.anything());
  fireEvent.change(box, { target: { value: "Shops" } });
  fireEvent.keyDown(box, { key: "Enter" });
  expect(await screen.findByText("Put 1 site in Shops.")).toBeInTheDocument();
});

test("the inspector names the plugin running the connector and the spare copies", () => {
  const sites = [
    site({
      id: 7,
      name: "Both",
      capabilities: {
        operator: true,
        abilities: ["get-hq-status"],
        plugin: { name: "Classic Monks", version: "1.9.0" },
        connector: { version: "1.1.0", hosts: [{ name: "Classic Monks", version: "1.9.0" }, { name: "WP Sites HQ", version: "0.2.0" }] },
      },
      cm_version: "1.9.0",
    }),
    site({ id: 8, name: "Old", cm_version: "2.5.0", capabilities: { operator: true, abilities: ["get-hq-status"], plugin: { version: "2.5.0" } } }),
  ];
  const { rerender } = render(<Sites sites={sites} groups={[]} focusId={7} setFocusId={vi.fn()} onAdd={vi.fn()} onSignInAgain={vi.fn()} />);
  let insp = screen.getByRole("complementary", { name: "Both details" });
  expect(insp).toHaveTextContent("PluginClassic Monks Free 1.9.0, connector 1.1.0");
  expect(insp).toHaveTextContent("Also on the siteWP Sites HQ 0.2.0, not running");
  expect(insp).toHaveTextContent("Classic Monks Free, full access");
  rerender(<Sites sites={sites} groups={[]} focusId={8} setFocusId={vi.fn()} onAdd={vi.fn()} onSignInAgain={vi.fn()} />);
  insp = screen.getByRole("complementary", { name: "Old details" });
  expect(insp).toHaveTextContent("PluginClassic Monks 2.5.0, built-in connector");
  expect(insp).not.toHaveTextContent("Also on the site");
  // Classic Monks 2.5.0 has no get-hq-status, so no version.
  const older = site({ id: 9, name: "Older", cm_version: null, capabilities: { operator: null, abilities: ["get-posts"], degraded: true } });
  rerender(<Sites sites={[older]} groups={[]} focusId={9} setFocusId={vi.fn()} onAdd={vi.fn()} onSignInAgain={vi.fn()} />);
  expect(screen.getByRole("complementary", { name: "Older details" })).toHaveTextContent("PluginClassic Monks, built-in connector");
});

test("Basic mode: install WP Sites HQ for me saves the checked zip, opens the upload page, then connects", async () => {
  mockInvoke.mockImplementation(async (c) =>
    c === "plugin_download"
      ? { version: "1.2.0", path: "/home/me/Downloads/wp-sites-hq-1.2.0.zip" }
      : c === "site_connect_plugin"
        ? site({ id: 2, name: "Beta" })
        : c === "link_open"
          ? null
          : [],
  );
  render(<Sites sites={SITES} groups={[]} focusId={2} setFocusId={vi.fn()} onAdd={vi.fn()} onSignInAgain={vi.fn()} />);
  const insp = screen.getByRole("complementary", { name: "Beta details" });
  expect(insp).toHaveTextContent("the WP Sites HQ plugin, Classic Monks or Classic Monks Pro. Any of them works.");
  fireEvent.click(within(insp).getByRole("button", { name: "Install the WP Sites HQ plugin for me" }));
  await waitFor(() => expect(insp).toHaveTextContent("The WP Sites HQ plugin 1.2.0 is saved as /home/me/Downloads/wp-sites-hq-1.2.0.zip, checked against the SHA-256"));
  expect(mockInvoke).toHaveBeenCalledWith("plugin_download", { id: 2 });
  expect(mockInvoke).toHaveBeenCalledWith("link_open", { url: "https://mc-a.local/wp-admin/plugin-install.php?tab=upload", site: 2 });
  fireEvent.click(within(insp).getByRole("button", { name: "Connect through the plugin" }));
  await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("site_connect_plugin", { id: 2 }));
});

test("the plugin shows under its old and new names, also mid-move with both on the site", () => {
  const old = site({ cm_version: "0.1.3", capabilities: { plugin: { name: "Monks Central", version: "0.1.3" }, connector: { version: "1.1.0" } } });
  expect(pluginName(old)).toBe("Monks Central");
  const moving = site({
    cm_version: "0.2.0",
    capabilities: {
      plugin: { name: "WP Sites HQ", version: "0.2.0" },
      connector: { version: "1.2.0", hosts: [{ name: "WP Sites HQ", version: "0.2.0" }, { name: "Monks Central (old)", version: "0.1.4" }] },
    },
  });
  expect(connectorInfo(moving)).toEqual({ running: "WP Sites HQ 0.2.0, connector 1.2.0", spare: ["Monks Central (old) 0.1.4"] });
});
