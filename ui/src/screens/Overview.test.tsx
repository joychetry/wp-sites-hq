import { render, screen } from "@testing-library/react";
import { Overview, summary } from "./Overview";
import { site } from "../test-fixtures";

test("the sentence counts down sites and sites that need a look", () => {
  expect(summary([])).toEqual({ lead: "No sites yet.", rest: "Add one to see how it is doing." });
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
  expect(panel).toHaveTextContent("Update it for every feature");
  expect(panel).not.toHaveTextContent("Fine");
  expect(screen.getByRole("button", { name: "Check again" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 2, name: "One site is down. One needs a look. The other two are fine." })).toBeInTheDocument();
});
