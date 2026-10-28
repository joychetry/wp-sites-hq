// SPDX-License-Identifier: GPL-3.0-or-later
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Overview, summary } from "./Overview";
import { site } from "../test-fixtures";

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
  expect(screen.getByRole("heading", { level: 2, name: "One site is down. One needs a look. The other two are fine." })).toBeInTheDocument();
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
  expect(screen.getByRole("heading", { level: 2, name: "One needs a look. The other one is fine." })).toBeInTheDocument();
});

test("a new user gets three steps, then next steps that can be hidden for good", () => {
  const onAdd = vi.fn();
  const onGo = vi.fn();
  const { rerender } = render(<Overview sites={[]} onOpen={vi.fn()} onCheck={vi.fn()} onSignInAgain={vi.fn()} onAdd={onAdd} onGo={onGo} />);
  const start = screen.getByRole("region", { name: "Getting started" });
  fireEvent.click(within(start).getByRole("button", { name: /^Add a site/ }));
  fireEvent.click(within(start).getByRole("button", { name: "Open the command palette" }));
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
