// SPDX-License-Identifier: GPL-3.0-or-later
// One-row tabs and segmented filters: what doesn't fit goes into a keyboard-reachable "More" menu.
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { fit, Segmented, Tabs } from "./controls";

test("fit keeps every item when they fit, else the first ones plus the chosen one", () => {
  expect(fit([100, 100, 100], 300, 96, 0)).toEqual([0, 1, 2]);
  // 96 for More + 100 for the chosen one leaves room for one more.
  expect(fit([100, 100, 100, 100, 100], 350, 96, 0)).toEqual([0, 1]);
  expect(fit([100, 100, 100, 100, 100], 350, 96, 4)).toEqual([0, 4]);
  expect(fit([100, 100, 100, 100, 100], 150, 96, 3)).toEqual([3]);
  expect(fit([100, 100, 100], 250, 96, -1)).toEqual([0]);
});

const TABS = ["Features", "Settings", "Activity", "Undo", "Approvals"].map((t) => ({ id: t.toLowerCase(), label: t }));

function Five() {
  const [v, setV] = useState("features");
  return (
    <>
      <Tabs label="Show" idBase="t" tabs={TABS} value={v} onChange={setV} />
      <p>Now: {v}</p>
    </>
  );
}

// jsdom has no layout: every item is 100px wide and the row 350px.
function narrow() {
  const rect = Element.prototype.getBoundingClientRect;
  const client = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth")!;
  Element.prototype.getBoundingClientRect = () => ({ width: 100 }) as DOMRect;
  Object.defineProperty(Element.prototype, "clientWidth", { configurable: true, get: () => 350 });
  return () => {
    Element.prototype.getBoundingClientRect = rect;
    Object.defineProperty(Element.prototype, "clientWidth", client);
  };
}

test("tabs that don't fit go into More; picking one there brings it onto the row", () => {
  const restore = narrow();
  try {
    render(<Five />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Features", "Settings"]);
    const more = screen.getByRole("button", { name: /More/ });
    expect(more).toHaveTextContent("3");
    fireEvent.click(more);
    fireEvent.click(screen.getByRole("menuitem", { name: "Approvals" }));
    expect(screen.getByText("Now: approvals")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Approvals" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  } finally {
    restore();
  }
});

test("arrows move through every tab, hidden ones too, and More opens with the keyboard", () => {
  const restore = narrow();
  try {
    render(<Five />);
    const first = screen.getByRole("tab", { name: "Features" });
    fireEvent.keyDown(first, { key: "End" });
    expect(screen.getByRole("tab", { name: "Approvals" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Approvals" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Undo" })).toHaveAttribute("aria-selected", "true");
    const more = screen.getByRole("button", { name: /More/ });
    fireEvent.keyDown(more, { key: "ArrowDown" });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Settings", "Activity", "Approvals"]);
  } finally {
    restore();
  }
});

test("tabs all show when the row has room (no More)", () => {
  render(<Five />);
  expect(screen.getAllByRole("tab")).toHaveLength(5);
  expect(screen.queryByRole("button", { name: /More/ })).toBeNull();
});

test("a segmented filter keeps one row with More", () => {
  const restore = narrow();
  try {
    function Types() {
      const [v, setV] = useState("post");
      const opts = ["post", "page", "product", "event", "recipe"].map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) }));
      return <Segmented label="Post type" options={opts} value={v} onChange={setV} />;
    }
    render(<Types />);
    expect(screen.getByRole("group", { name: "Post type" }).querySelectorAll("button")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Recipe" }));
    expect(screen.getByRole("button", { name: "Recipe" })).toHaveAttribute("aria-pressed", "true");
  } finally {
    restore();
  }
});
