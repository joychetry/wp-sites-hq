import { render, screen, fireEvent } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import App, { SECTIONS } from "./App";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);

afterEach(() => mockInvoke.mockReset());

test("shows every section in the rail and the operator status", async () => {
  mockInvoke.mockResolvedValue({ version: "0.0.1", pid: 7, role: "operator", home: "/data" });
  render(<App />);

  const nav = screen.getByRole("navigation", { name: "Main" });
  for (const s of SECTIONS) {
    expect(nav).toContainElement(screen.getByRole("button", { name: s }));
  }
  expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  expect(await screen.findByText("operator")).toBeInTheDocument();
  expect(screen.getByText("/data")).toBeInTheDocument();
  expect(mockInvoke).toHaveBeenCalledWith("core_status");
});

test("switches section from the rail", async () => {
  mockInvoke.mockResolvedValue({ version: "0.0.1", pid: 7, role: "operator", home: "/data" });
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Sites" }));
  expect(screen.getByRole("heading", { level: 1, name: "Sites" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sites" })).toHaveAttribute("aria-current", "page");
});

test("shows the core error in plain words", async () => {
  mockInvoke.mockRejectedValue("Monks Central is already running (pid 42).");
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("already running (pid 42)");
});
