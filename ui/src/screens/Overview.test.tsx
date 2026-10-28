// SPDX-License-Identifier: GPL-3.0-or-later
import { fireEvent, render, screen, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { Overview, said, summary } from "./Overview";
import { site } from "../test-fixtures";
import type { Entry, Job, SiteInventory } from "../api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
const mockInvoke = vi.mocked(invoke);
beforeEach(() => mockInvoke.mockResolvedValue([]));
afterEach(() => mockInvoke.mockReset());

test("the sentence counts down sites and sites that need a look", () => {
  expect(summary([])).toEqual({ lead: "Welcome to Monks Central.", rest: "Add your first site to get started." });
  expect(summary([site()]).lead).toBe("Your one site is healthy.");
  const many = [
    site({ id: 1, health: "down" }),
    site({ id: 2, health: "down" }),
    site({ id: 3, health: "warning" }),
    site({ id: 4, sign_in_again: true }),
    site({ id: 5 }),
  ];
  expect(summary(many)).toEqual({ lead: "Two sites are down. Two need a look.", rest: "The other one is fine." });
  expect(summary([site(), site({ id: 2 }), site({ id: 3 })]).lead).toBe("All three sites are healthy.");
  expect(summary([site({ health: "unknown", checked_at: null })]).lead).toBe("Checking your sites.");
});

test("needs attention offers the right next step", () => {
  const sites = [
    site({ id: 1, name: "Down site", health: "down", health_detail: "Couldn't reach this site." }),
    site({ id: 2, name: "Locked", sign_in_again: true }),
    site({ id: 3, name: "Old CM", capabilities: { degraded: true } }),
    site({ id: 4, name: "Fine" }),
  ];
  render(<Overview sites={sites} onOpen={vi.fn()} onCheck={vi.fn()} onSignInAgain={vi.fn()} onAdd={vi.fn()} />);
  const panel = screen.getByRole("region", { name: "Needs attention" });
  expect(panel).toHaveTextContent("Couldn't reach this site.");
  expect(panel).toHaveTextContent("Update it on the site for every feature");
  expect(panel).not.toHaveTextContent("Fine");
  expect(screen.getByRole("button", { name: "Check again" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
});

test("a connection with no tools says so and offers to sign in again; slow is only a note", () => {
  const onSignInAgain = vi.fn();
  const sites = [
    site({ id: 1, name: "Empty grant", capabilities: { abilities: [], hq_status: false, degraded: true } }),
    site({ id: 2, name: "Slow site", health_detail: "Slow: the home page took 4.2 s." }),
  ];
  render(<Overview sites={sites} onOpen={vi.fn()} onCheck={vi.fn()} onSignInAgain={onSignInAgain} onAdd={vi.fn()} />);
  const panel = screen.getByRole("region", { name: "Needs attention" });
  expect(panel).toHaveTextContent("Connected, but this connection can't do anything yet. Sign in again and tick the tool groups.");
  screen.getByRole("button", { name: "Sign in again" }).click();
  expect(onSignInAgain).toHaveBeenCalledWith(1);
  expect(panel).toHaveTextContent("Slow site. Slow: the home page took 4.2 s. It still works.");
});

test("a new user gets three steps, then next steps that can be hidden for good", () => {
  const onAdd = vi.fn();
  const onGo = vi.fn();
  const { rerender } = render(<Overview sites={[]} onOpen={vi.fn()} onCheck={vi.fn()} onSignInAgain={vi.fn()} onAdd={onAdd} onGo={onGo} />);
  const start = screen.getByRole("region", { name: "Getting started" });
  fireEvent.click(within(start).getByRole("button", { name: /^Add a site/ }));
  fireEvent.click(within(start).getByRole("button", { name: "open the command palette" }));
  expect(onAdd).toHaveBeenCalled();
  expect(onGo).toHaveBeenCalledWith("palette");

  localStorage.removeItem("mc-tips-hidden");
  rerender(<Overview sites={[site()]} onOpen={vi.fn()} onCheck={vi.fn()} onSignInAgain={vi.fn()} onAdd={onAdd} onGo={onGo} />);
  const next = screen.getByRole("region", { name: "Next steps" });
  expect(next).toHaveTextContent("Add more sites: not done yet");
  fireEvent.click(within(next).getByRole("button", { name: "Connect an AI app" }));
  expect(onGo).toHaveBeenCalledWith("AI");
  fireEvent.click(within(next).getByRole("button", { name: "Hide these steps" }));
  expect(screen.queryByRole("region", { name: "Next steps" })).toBeNull();
  expect(localStorage.getItem("mc-tips-hidden")).toBe("1");
  localStorage.removeItem("mc-tips-hidden");
  rerender(<Overview sites={[site(), site({ id: 2 }), site({ id: 3 })]} onOpen={vi.fn()} onCheck={vi.fn()} onSignInAgain={vi.fn()} onAdd={onAdd} onGo={onGo} />);
  expect(screen.queryByRole("region", { name: "Next steps" })).toBeNull();
});

test("updates, plans and vulnerabilities each get one fix, and the latest changes split by who", async () => {
  const entry = (id: number, actor: Entry["actor"], what: string): Entry => ({ id, at: 1, actor, site_id: 1, site_name: "Alpha", what, outcome: "done", detail: "" });
  mockInvoke.mockImplementation(async (cmd: string) => (cmd === "activity_list" ? [entry(2, "agent", "update-post"), entry(1, "human", "Turned on AI agent access")] : null));
  const onGo = vi.fn();
  const plan = { id: 9, title: "Update WooCommerce on 3 sites", created_at: 1, expired: false } as Job;
  const waiting = [{ kind: "Plugin", site: "Alpha", label: "Update Akismet", change: { site_id: 1, action: { do: "update_translations" } } }] as never;
  const reports = [{ site_id: 1, checked_at: 1, vulnerabilities: [{ kind: "plugin", id: "f", name: "Forms", installed: "2.3.1", title: "XSS", severity: null, fixed_in: "2.3.2", link: null }], abandoned: [], checksums: null, notes: [] }] as never;
  render(<Overview sites={[site({ name: "Alpha" })]} waiting={waiting} plans={[plan]} reports={reports} onOpen={vi.fn()} onCheck={vi.fn()} onSignInAgain={vi.fn()} onAdd={vi.fn()} onGo={onGo} />);
  const fixes = screen.getByRole("region", { name: "Needs attention" });
  expect(fixes).toHaveTextContent("Forms 2.3.1 has a known vulnerability");
  expect(fixes).toHaveTextContent("On Alpha. Fixed in 2.3.2.");
  fireEvent.click(within(fixes).getByRole("button", { name: "Review the plan" }));
  fireEvent.click(within(fixes).getByRole("button", { name: "Review updates" }));
  expect(onGo.mock.calls).toEqual([["AI"], ["Updates"]]);
  const feed = screen.getByRole("region", { name: "Latest changes" });
  expect(await within(feed).findByText("Update post")).toBeInTheDocument();
  fireEvent.click(within(feed).getByRole("button", { name: "You" }));
  expect(within(feed).queryByText("Update post")).toBeNull();
  expect(within(feed).getByText(/^You turned on AI agent access/)).toBeInTheDocument();
});

test("a change that names a plugin the site runs carries its tile, just before the name", () => {
  const inv: SiteInventory = {
    site_id: 1,
    fetched_at: 0,
    inventory: { wordpress: null, wordpress_update: null, plugins: [{ id: "classic-editor/classic-editor.php", name: "Classic Editor", version: "1", active: true, auto_update: null, update: null }], themes: [], translations: 0, updates_known: true, needs_credentials: false },
  };
  const entry = (what: string, site_id: number | null = 1): Entry => ({ id: 1, at: 0, actor: "human", site_id, site_name: "MC A", what, outcome: "done", detail: "" });
  const html = (e: Entry) => render(<p>{said(e, new Map([[1, inv]]))}</p>).container.innerHTML;
  expect(html(entry("Update Classic Editor"))).toMatch(/ran <span class="ptile xs"[^>]*>C<\/span><b>Update Classic Editor<\/b>/);
  expect(html(entry("Confirmed the plan: Update Classic Editor on MC A", null))).toMatch(/confirmed the plan: Update <span class="ptile xs"[^>]*>C<\/span>Classic Editor on MC A/);
  expect(html(entry("Update Yoast SEO"))).not.toContain("ptile");
});
