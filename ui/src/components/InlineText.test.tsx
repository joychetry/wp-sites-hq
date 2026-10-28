// SPDX-License-Identifier: GPL-3.0-or-later
// A text block's editor: busy while TinyMCE starts, says so when it can't, and leaves nothing behind
// when the block goes away first.
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InlineText } from "./RichText";

const init = vi.fn();
vi.mock("./tinymce", () => ({ default: { init: (o: unknown) => init(o) } }));
afterEach(() => init.mockReset());

test("a block whose editor can't start says so, and can try again", async () => {
  init.mockRejectedValueOnce(new Error("no editor"));
  render(<InlineText label="Paragraph 1" html="Hello" onChange={() => {}} />);
  const box = screen.getByRole("textbox", { name: "Paragraph 1" });
  fireEvent.focus(box);
  expect(box).toHaveAttribute("aria-busy", "true");
  expect(await screen.findByRole("alert")).toHaveTextContent("The editor didn't open: Error: no editor");
  expect(box).not.toHaveAttribute("aria-busy");
  init.mockResolvedValueOnce([]);
  fireEvent.focus(box);
  await waitFor(() => expect(init).toHaveBeenCalledTimes(2));
});

test("an editor that starts after its block went away is removed", async () => {
  let started: (v: unknown) => void = () => {};
  init.mockReturnValueOnce(new Promise((r) => (started = r)));
  const view = render(<InlineText label="Paragraph 1" html="Hello" onChange={() => {}} />);
  fireEvent.focus(screen.getByRole("textbox", { name: "Paragraph 1" }));
  await waitFor(() => expect(init).toHaveBeenCalled());
  view.unmount();
  const remove = vi.fn();
  started([{ remove }]);
  await waitFor(() => expect(remove).toHaveBeenCalled());
});
