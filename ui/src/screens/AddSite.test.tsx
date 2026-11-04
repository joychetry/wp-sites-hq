// SPDX-License-Identifier: GPL-3.0-or-later
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { AddSite, addressProblem } from "./AddSite";
import { site } from "../test-fixtures";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);
afterEach(() => mockInvoke.mockReset());

test("Basic mode sends the address, user and application password", async () => {
  const onDone = vi.fn();
  mockInvoke.mockResolvedValue(site({ id: 9 }));
  render(<AddSite onClose={vi.fn()} onDone={onDone} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Site address" }), { target: { value: "mc-c.local" } });
  fireEvent.click(screen.getByRole("radio", { name: /^Basic mode/ }));
  fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
  expect(screen.getByRole("list", { name: "Steps" })).toHaveTextContent(/Address, done.*Sign in/);
  fireEvent.change(screen.getByRole("textbox", { name: "WordPress user name" }), { target: { value: "admin" } });
  fireEvent.change(screen.getByLabelText(/^Application password/), { target: { value: "abcd efgh" } });
  fireEvent.click(screen.getByRole("button", { name: /Add the site/ }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(mockInvoke).toHaveBeenCalledWith("site_add_basic", { url: "mc-c.local", username: "admin", password: "abcd efgh" });
});

test("Classic Monks waits for the browser and can be cancelled", async () => {
  let reject: (e: string) => void = () => {};
  mockInvoke.mockImplementation((cmd: string) =>
    cmd === "site_add_oauth" ? new Promise((_, r) => (reject = r)) : Promise.resolve(null),
  );
  const onClose = vi.fn();
  render(<AddSite onClose={onClose} onDone={vi.fn()} />);
  expect(screen.getByRole("dialog", { name: "Add a site" })).toHaveTextContent("This is my WP Sites HQ app");
  fireEvent.change(screen.getByRole("textbox", { name: "Site address" }), { target: { value: "https://mc-a.local" } });
  fireEvent.click(screen.getByRole("button", { name: /Open the sign-in page/ }));
  expect(await screen.findByText("Waiting for you in the browser")).toHaveAttribute("role", "status");
  // Nothing to press twice while the browser is open.
  expect(screen.queryByRole("button", { name: /Open the sign-in page/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cancel the sign-in" }));
  expect(mockInvoke).toHaveBeenCalledWith("sign_in_cancel");
  expect(onClose).toHaveBeenCalled();
  reject("Sign-in cancelled.");
});

test("a refusal is shown in plain words", async () => {
  mockInvoke.mockRejectedValue("This site runs WordPress 7.0.7. Update WordPress to 7.1 or newer first.");
  render(<AddSite onClose={vi.fn()} onDone={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Site address" }), { target: { value: "mc-b.local" } });
  fireEvent.click(screen.getByRole("button", { name: /Open the sign-in page/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Update WordPress to 7.1 or newer first.");
});

test("the plugin path is three numbered steps", () => {
  render(<AddSite onClose={vi.fn()} onDone={vi.fn()} />);
  const steps = within(screen.getByRole("dialog", { name: "Add a site" })).getAllByRole("listitem").filter((li) => li.closest(".callout"));
  expect(steps.map((li) => li.textContent)).toEqual([
    "Your browser opens the site. Sign in as an administrator.",
    "Choose what WP Sites HQ may do, and check This is my WP Sites HQ app.",
    "Press Connect. The site appears here on its own.",
  ]);
});

test("the address is checked when you leave the box or press the button, in words, and blocks adding", () => {
  render(<AddSite onClose={vi.fn()} onDone={vi.fn()} />);
  const box = screen.getByRole("textbox", { name: "Site address" });
  fireEvent.change(box, { target: { value: "my site" } });
  expect(screen.queryByText(/has no spaces/)).toBeNull();
  fireEvent.blur(box);
  expect(box).toHaveAttribute("aria-invalid", "true");
  expect(box).toHaveAccessibleDescription("An address has no spaces. Write it like https://example.com.");
  // The button stays pressable, so pressing it says what is wrong instead of doing nothing.
  fireEvent.change(box, { target: { value: "not a site" } });
  fireEvent.click(screen.getByRole("button", { name: /Open the sign-in page/ }));
  expect(screen.getByText(/has no spaces/)).toBeInTheDocument();
  expect(mockInvoke).not.toHaveBeenCalledWith("site_add_oauth", expect.anything());
  fireEvent.change(box, { target: { value: "example.com" } });
  expect(box).not.toHaveAttribute("aria-invalid");
  expect(screen.getByRole("button", { name: /Open the sign-in page/ })).toBeEnabled();
  expect(addressProblem("ftp://example.com")).toBe("Use an address that starts with https://.");
  expect(addressProblem("intranet")).toBe("Write the whole address, like https://example.com.");
  expect(addressProblem("http://localhost:8881")).toBeNull();
});

test("signing in again names the state, opens the browser at once and can be cancelled", async () => {
  mockInvoke.mockImplementation((cmd: string) => (cmd === "site_sign_in_again" ? new Promise(() => {}) : Promise.resolve(null)));
  const onClose = vi.fn();
  render(<AddSite again={site({ id: 3, name: "MC C", url: "https://mc-c.test", sign_in_again: true })} onClose={onClose} onDone={vi.fn()} />);
  const dialog = screen.getByRole("dialog", { name: "MC C: sign-in expired" });
  expect(dialog).toHaveTextContent("mc-c.test · Classic Monks");
  expect(dialog).toHaveTextContent("Until you sign in, MC C is left out of updates");
  expect(mockInvoke).toHaveBeenCalledWith("site_sign_in_again", expect.objectContaining({ id: 3 }));
  expect(await screen.findByText("Waiting for you in the browser")).toHaveAttribute("role", "status");
  fireEvent.click(screen.getByRole("button", { name: "Cancel the sign-in" }));
  expect(onClose).toHaveBeenCalled();
});
