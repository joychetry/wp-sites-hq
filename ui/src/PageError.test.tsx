// SPDX-License-Identifier: GPL-3.0-or-later
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { site } from "./test-fixtures";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
const broken = { on: true };
vi.mock("./screens/Monitoring", () => ({
  Monitoring: () => {
    if (broken.on) throw new Error("monitors.map is not a function");
    return <p>Monitoring works</p>;
  },
}));

test("a screen that throws shows the message inside the shell, and another page clears it", async () => {
  vi.mocked(invoke).mockImplementation(async (cmd: string) =>
    cmd === "core_status" ? { version: "0.0.1", pid: 7, role: "operator", headless: false, home: "/data" } : cmd === "sites_list" ? [site()] : null,
  );
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const writeText = vi.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  render(<App />);
  const nav = screen.getByRole("navigation", { name: "Main" });
  fireEvent.click(within(nav).getByRole("button", { name: /^Monitoring/ }));
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByRole("heading", { name: "This page hit an error" })).toBeInTheDocument();
  expect(within(alert).getByText(/monitors\.map is not a function/)).toBeInTheDocument();
  expect(log).toHaveBeenCalledWith("A page hit an error:", expect.any(Error), expect.anything());
  fireEvent.click(within(alert).getByRole("button", { name: "Copy details" }));
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining("monitors.map is not a function"));

  // The sidebar still works, and the next page draws without the message.
  fireEvent.click(within(nav).getByRole("button", { name: /^Clients/ }));
  expect(await screen.findByRole("heading", { level: 1, name: "Clients" })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText("This page hit an error")).not.toBeInTheDocument());

  // Reload this page draws the screen again once it no longer throws.
  fireEvent.click(within(nav).getByRole("button", { name: /^Monitoring/ }));
  await screen.findByText("This page hit an error");
  broken.on = false;
  fireEvent.click(screen.getByRole("button", { name: "Reload this page" }));
  expect(await screen.findByText("Monitoring works")).toBeInTheDocument();
  log.mockRestore();
});
