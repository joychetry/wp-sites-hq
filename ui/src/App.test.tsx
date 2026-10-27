import { render, screen, fireEvent, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import App, { SECTIONS } from "./App";
import { site } from "./test-fixtures";

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

test("shows every section in the rail, the sentence and the version", async () => {
  serve();
  render(<App />);
  const nav = screen.getByRole("navigation", { name: "Main" });
  for (const s of SECTIONS) {
    expect(within(nav).getByRole("button", { name: new RegExp(`^${s}`) })).toBeInTheDocument();
  }
  expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  expect(await screen.findByRole("heading", { name: "Both sites are healthy." })).toBeInTheDocument();
  expect(screen.getByText("Version 0.0.1")).toBeInTheDocument();
  expect(mockInvoke).toHaveBeenCalledWith("core_status");
});

test("switches section from the rail", async () => {
  serve();
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /^Sites/ }));
  expect(screen.getByRole("heading", { level: 1, name: /^Sites/ })).toBeInTheDocument();
  expect(await screen.findByRole("grid", { name: "Sites" })).toBeInTheDocument();
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
  await screen.findByRole("heading", { name: "Both sites are healthy." });
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  const input = screen.getByRole("combobox", { name: "Command" });
  fireEvent.change(input, { target: { value: "central test" } });
  expect(screen.getByRole("option", { name: /Monks Central Test/ })).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
  expect(screen.getByRole("complementary", { name: "Monks Central Test details" })).toBeInTheDocument();
});

test("the theme follows the system, then light, then dark", async () => {
  serve();
  render(<App />);
  const btn = screen.getByRole("button", { name: "Theme: same as my computer" });
  expect(document.documentElement.dataset.theme).toBe("light");
  fireEvent.click(btn);
  fireEvent.click(screen.getByRole("button", { name: "Theme: light" }));
  expect(screen.getByRole("button", { name: "Theme: dark" })).toBeInTheDocument();
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(localStorage.getItem("mc-theme")).toBe("dark");
});

test("the scope switcher narrows to a group", async () => {
  serve([site({ group: "Clients" }), site({ id: 2, name: "Own", url: "https://own.local" })]);
  render(<App />);
  await screen.findByRole("heading", { name: "Both sites are healthy." });
  fireEvent.change(screen.getByRole("combobox", { name: "Sites to show" }), { target: { value: "Clients" } });
  expect(screen.getByRole("heading", { name: "Your one site is healthy." })).toBeInTheDocument();
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
