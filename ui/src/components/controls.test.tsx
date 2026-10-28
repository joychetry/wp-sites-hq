import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { Combobox, ColorInput, DateInput, Menu, MultiSelect, NumberInput, parseDate, parseTime, SearchInput, Select, Slider, Tabs, TagInput } from "./controls";
import { Tooltips, toast } from "./feedback";

function Pick({ start = "b", onChange = () => {} }: { start?: string; onChange?: (v: string) => void }) {
  const [v, setV] = useState(start);
  return (
    <Select
      aria-label="Fruit"
      value={v}
      onChange={(e) => {
        setV(e.target.value);
        onChange(e.target.value);
      }}
    >
      <option value="a">Apple</option>
      <option value="b">Banana</option>
      <option value="c" disabled>
        Cherry
      </option>
      {[<option key="d" value="d">Date</option>]}
    </Select>
  );
}

test("select: a listbox opens from the keyboard, skips disabled options and chooses with Enter", () => {
  const seen: string[] = [];
  render(<Pick onChange={(v) => seen.push(v)} />);
  const box = screen.getByRole("combobox", { name: "Fruit" });
  expect(box).toHaveTextContent("Banana");
  expect(box).toHaveAttribute("aria-expanded", "false");
  fireEvent.keyDown(box, { key: "ArrowDown" });
  expect(box).toHaveAttribute("aria-expanded", "true");
  const list = screen.getByRole("listbox", { name: "Fruit" });
  expect(within(list).getAllByRole("option")).toHaveLength(4);
  expect(box.getAttribute("aria-activedescendant")).toBe(within(list).getByRole("option", { name: "Banana" }).id);
  fireEvent.keyDown(box, { key: "ArrowDown" });
  expect(box.getAttribute("aria-activedescendant")).toBe(within(list).getByRole("option", { name: "Date" }).id);
  fireEvent.keyDown(box, { key: "Enter" });
  expect(seen).toEqual(["d"]);
  expect(box).toHaveTextContent("Date");
  expect(screen.queryByRole("listbox")).toBeNull();
});

test("select: Escape closes without choosing, typing jumps, a click chooses, disabled can't be chosen", () => {
  const seen: string[] = [];
  render(<Pick onChange={(v) => seen.push(v)} />);
  const box = screen.getByRole("combobox", { name: "Fruit" });
  fireEvent.click(box);
  fireEvent.keyDown(box, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.keyDown(box, { key: "a" });
  expect(seen).toEqual(["a"]);
  fireEvent.click(box);
  fireEvent.click(screen.getByRole("option", { name: "Cherry" }));
  expect(seen).toEqual(["a"]);
  fireEvent.click(screen.getByRole("option", { name: "Banana" }));
  expect(seen).toEqual(["a", "b"]);
});

test("combobox: suggestions filter as you type and Enter fills the box", () => {
  function T() {
    const [v, setV] = useState("");
    return <Combobox aria-label="Group" suggestions={["Clients", "Personal", "Shops"]} value={v} onChange={(e) => setV(e.target.value)} />;
  }
  render(<T />);
  const input = screen.getByRole("combobox", { name: "Group" });
  fireEvent.change(input, { target: { value: "s" } });
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Clients", "Personal", "Shops"]);
  fireEvent.change(input, { target: { value: "sh" } });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input).toHaveValue("Shops");
});

test("multi-select: tick with Enter, remove with the chip or Backspace", () => {
  function T() {
    const [v, setV] = useState<number[]>([]);
    return <MultiSelect label="Sites" options={[{ value: 1, label: "MC A" }, { value: 2, label: "MC B" }]} value={v} onChange={setV} />;
  }
  render(<T />);
  const input = screen.getByRole("combobox", { name: "Sites" });
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByRole("option", { name: "MC A" })).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByRole("list", { name: "Sites: chosen" })).toHaveTextContent("MC A×MC B×");
  fireEvent.click(screen.getByRole("button", { name: "Remove MC A" }));
  fireEvent.keyDown(input, { key: "Backspace" });
  expect(screen.queryByRole("list", { name: "Sites: chosen" })).toBeNull();
});

test("date: the calendar opens on the value, arrows move a day, Enter picks, Escape closes", () => {
  const seen: string[] = [];
  function T() {
    const [v, setV] = useState("2026-10-28");
    return <DateInput type="date" aria-label="Paid on" value={v} onChange={(e) => (setV(e.target.value), seen.push(e.target.value))} />;
  }
  render(<T />);
  expect(screen.getByRole("textbox", { name: "Paid on: date" })).toHaveValue("28 Oct 2026");
  const open = screen.getByRole("button", { name: "Choose the paid on from a calendar" });
  fireEvent.click(open);
  const dialog = screen.getByRole("dialog", { name: "October 2026" });
  expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "28 October 2026" }));
  fireEvent.keyDown(within(dialog).getByRole("grid"), { key: "ArrowRight" });
  expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "29 October 2026" }));
  fireEvent.keyDown(within(dialog).getByRole("grid"), { key: "PageDown" });
  expect(screen.getByRole("dialog", { name: "November 2026" })).toBeInTheDocument();
  fireEvent.click(document.activeElement!);
  expect(seen).toEqual(["2026-11-29"]);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("textbox", { name: "Paid on: date" })).toHaveValue("29 Nov 2026");
  fireEvent.click(open);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("date and time: the time box takes 9:30, keeps the date and refuses nonsense", () => {
  const seen: string[] = [];
  render(<DateInput type="datetime-local" aria-label="Publish" value="2026-10-28T08:00" onChange={(e) => seen.push(e.target.value)} />);
  const time = screen.getByRole("textbox", { name: "Publish: time" });
  fireEvent.change(time, { target: { value: "9:30" } });
  fireEvent.blur(time);
  expect(seen).toEqual(["2026-10-28T09:30"]);
  fireEvent.change(time, { target: { value: "08:00" } });
  fireEvent.blur(time);
  fireEvent.change(time, { target: { value: "25:00" } });
  fireEvent.blur(time);
  expect(time).toHaveAttribute("aria-invalid", "true");
  const day = screen.getByRole("textbox", { name: "Publish: date" });
  fireEvent.change(day, { target: { value: "1 December 2026" } });
  fireEvent.blur(day);
  expect(seen.at(-1)).toBe("2026-12-01T08:00");
  fireEvent.change(day, { target: { value: "31 Feb 2026" } });
  fireEvent.blur(day);
  expect(screen.getByText("Write a date like 1 Dec 2026")).toBeInTheDocument();
  expect(parseDate("2026-2-3")).toBe("2026-02-03");
  expect(parseDate("3 sept 2026")).toBe("2026-09-03");
  expect(parseDate("3 ju 2026")).toBeNull();
  expect(parseTime("0930")).toBe("09:30");
  expect(parseTime("21:5")).toBe("21:05");
  expect(parseTime("noon")).toBeNull();
});

test("month: a year of months, later ones off past the limit", () => {
  const seen: string[] = [];
  render(<DateInput type="month" aria-label="Month" value="2026-09" max="2026-10" onChange={(e) => seen.push(e.target.value)} />);
  fireEvent.click(screen.getByRole("button", { name: "Month: September 2026. Choose a month" }));
  expect(screen.getByRole("button", { name: "November 2026" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "October 2026" }));
  expect(seen).toEqual(["2026-10"]);
});

test("number: buttons and arrows step within the limits", () => {
  const seen: string[] = [];
  render(<NumberInput aria-label="Stock" type="number" value="9" max={10} onChange={(e) => seen.push(e.target.value)} />);
  const box = screen.getByRole("spinbutton", { name: "Stock" });
  expect(box).not.toHaveAttribute("type", "number");
  fireEvent.keyDown(box, { key: "ArrowUp" });
  fireEvent.click(screen.getByRole("button", { name: "More Stock" }));
  fireEvent.click(screen.getByRole("button", { name: "Less Stock" }));
  expect(seen).toEqual(["10", "10", "8"]);
});

test("search: Escape and the clear button empty it", () => {
  const seen: string[] = [];
  render(<SearchInput aria-label="Filter" value="mc" onChange={(e) => seen.push(e.target.value)} />);
  fireEvent.keyDown(screen.getByRole("searchbox", { name: "Filter" }), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Clear the filter" }));
  expect(seen).toEqual(["", ""]);
});

test("tags: Enter and comma add, Backspace and the chip remove, no doubles", () => {
  function T() {
    const [v, setV] = useState(["shop"]);
    return <TagInput label="Add a tag" value={v} onChange={setV} />;
  }
  render(<T />);
  const input = screen.getByRole("combobox", { name: "Add a tag" });
  fireEvent.change(input, { target: { value: "static" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.change(input, { target: { value: "shop," } });
  fireEvent.change(input, { target: { value: "client," } });
  expect(screen.getAllByRole("button", { name: /^Remove tag/ }).map((b) => b.getAttribute("aria-label"))).toEqual(["Remove tag shop", "Remove tag static", "Remove tag client"]);
  fireEvent.keyDown(input, { key: "Backspace" });
  fireEvent.click(screen.getByRole("button", { name: "Remove tag shop" }));
  expect(screen.getAllByRole("button", { name: /^Remove tag/ })).toHaveLength(1);
});

test("colour: a hex code is checked as you type; presets pick at once", () => {
  const seen: string[] = [];
  render(<ColorInput label="Accent" value="#111111" onChange={(c) => seen.push(c)} />);
  const hex = screen.getByRole("textbox", { name: "Accent as a hex code" });
  fireEvent.change(hex, { target: { value: "#12" } });
  expect(hex).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByText("Use six hex digits, like #111111")).toBeInTheDocument();
  fireEvent.change(hex, { target: { value: "1F4E79" } });
  fireEvent.click(screen.getByRole("button", { name: "Accent: choose from preset colours" }));
  fireEvent.click(screen.getByRole("button", { name: "#b42318" }));
  expect(seen).toEqual(["#1f4e79", "#b42318"]);
});

test("slider: says its value in words", () => {
  const seen: number[] = [];
  render(<Slider label="Text size" value={100} min={90} max={130} step={10} format={(n) => `${n}%`} onChange={(n) => seen.push(n)} />);
  const s = screen.getByRole("slider", { name: "Text size" });
  expect(s).toHaveAttribute("aria-valuetext", "100%");
  fireEvent.change(s, { target: { value: "110" } });
  expect(seen).toEqual([110]);
});

test("menu: arrows move, Enter runs, Escape gives focus back", () => {
  const ran: string[] = [];
  render(<Menu label="More for MC A" items={[{ label: "Export", run: () => ran.push("export") }, { label: "Remove", danger: true, run: () => ran.push("remove") }]} />);
  const btn = screen.getByRole("button", { name: "More for MC A" });
  fireEvent.click(btn);
  const items = screen.getAllByRole("menuitem");
  expect(document.activeElement).toBe(items[0]);
  fireEvent.keyDown(items[0], { key: "ArrowDown" });
  expect(document.activeElement).toBe(items[1]);
  fireEvent.keyDown(items[1], { key: "Enter" });
  expect(ran).toEqual(["remove"]);
  expect(document.activeElement).toBe(btn);
  fireEvent.click(btn);
  fireEvent.keyDown(screen.getAllByRole("menuitem")[0], { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
});

test("tabs: one Tab stop, arrows choose", () => {
  function T() {
    const [t, setT] = useState<"a" | "b">("a");
    return <Tabs label="Parts" idBase="p" tabs={[{ id: "a", label: "One" }, { id: "b", label: "Two" }]} value={t} onChange={setT} />;
  }
  render(<T />);
  const [one, two] = screen.getAllByRole("tab");
  expect(one).toHaveAttribute("tabindex", "0");
  expect(two).toHaveAttribute("tabindex", "-1");
  fireEvent.keyDown(one, { key: "ArrowRight" });
  expect(screen.getByRole("tab", { name: "Two" })).toHaveAttribute("aria-selected", "true");
});

test("toast: says it in a live region, Undo runs once and closes it", () => {
  let undone = 0;
  act(() => {
    toast("Moved to the trash.", { undo: () => undone++ });
  });
  const region = screen.getByRole("status");
  expect(region).toHaveTextContent("Moved to the trash.");
  fireEvent.click(within(region).getByRole("button", { name: "Undo" }));
  expect(undone).toBe(1);
  expect(region).not.toHaveTextContent("Moved to the trash.");
});

test("tooltip: shows on keyboard focus and is tied to its element", () => {
  render(
    <>
      <Tooltips />
      <button type="button" data-tip="Full name of a long site">
        Full name…
      </button>
    </>,
  );
  const b = screen.getByRole("button");
  // jsdom has no :focus-visible.
  b.matches = ((s: string) => s === ":focus-visible" || Element.prototype.matches.call(b, s)) as typeof b.matches;
  act(() => b.focus());
  expect(screen.getByRole("tooltip")).toHaveTextContent("Full name of a long site");
  expect(b).toHaveAccessibleDescription("Full name of a long site");
  fireEvent.keyDown(b, { key: "Escape" });
  expect(b).not.toHaveAttribute("aria-describedby");
});
