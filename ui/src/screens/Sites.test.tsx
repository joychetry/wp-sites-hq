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
  expect(screen.getByRole("complementary", { name: "Alpha details" })).toHaveTextContent("Yes, ticked on the site");
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
  expect(screen.getByRole("textbox", { name: "Filter sites" })).toHaveFocus();
  fireEvent.change(screen.getByRole("textbox", { name: "Filter sites" }), { target: { value: "gam" } });
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
  const tag = screen.getByRole("textbox", { name: "Tags" });
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
