import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { Sites } from "./Sites";
import { site } from "../test-fixtures";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);
afterEach(() => mockInvoke.mockReset());

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
  expect(screen.getByText("Basic mode")).toBeInTheDocument();
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
  expect(screen.getByRole("region", { name: "Selection" })).toHaveTextContent("1 selected");
  fireEvent.keyDown(document, { key: "/" });
  expect(screen.getByRole("searchbox", { name: "Filter sites" })).toHaveFocus();
  fireEvent.change(screen.getByRole("searchbox", { name: "Filter sites" }), { target: { value: "gam" } });
  expect(screen.getAllByRole("row")).toHaveLength(2);
  (document.activeElement as HTMLElement).blur();
  fireEvent.keyDown(document, { key: "a" });
  expect(onAdd).toHaveBeenCalled();
});

test("remove asks first, then reports what happened on the site", async () => {
  mockInvoke.mockResolvedValue({ signed_out: true, message: "Removed. Monks Central signed out of the site." });
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Remove from Monks Central" }));
  expect(screen.getByRole("alertdialog", { name: "Remove Alpha" })).toHaveTextContent("signs out on the site");
  fireEvent.click(screen.getByRole("button", { name: "Remove Alpha" }));
  await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("site_remove", { id: 1 }));
  expect(await screen.findByRole("status")).toHaveTextContent("signed out of the site");
});

test("tags, notes and group go to the core", async () => {
  mockInvoke.mockResolvedValue(SITES[0]);
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
  fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
  expect(onSignInAgain).toHaveBeenCalledWith(empty);
});

test("the legend explains the status shapes and the columns", () => {
  render(<Harness />);
  expect(screen.getByRole("grid", { name: "Sites" })).toHaveAccessibleDescription(/Healthy.*Down.*Not checked yet.*Last checked is when/);
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
  expect(screen.getByRole("region", { name: "Selection" })).toHaveTextContent("2 selected");
});

test("one-click login shows only where the connection can make a login link", async () => {
  mockInvoke.mockResolvedValue(null);
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
  mockInvoke.mockResolvedValue(undefined);
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
