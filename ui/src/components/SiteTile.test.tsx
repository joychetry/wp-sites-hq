// SPDX-License-Identifier: GPL-3.0-or-later
import { fireEvent, render, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { SiteTile } from "./SiteTile";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);
afterEach(() => mockInvoke.mockReset());

test("a site with an icon shows the core's favicon, read once per version", async () => {
  mockInvoke.mockResolvedValue("data:image/png;base64,AA==");
  const { container } = render(
    <>
      <SiteTile site={{ id: 1, name: "MC A", icon: "v1" }} />
      <SiteTile site={{ id: 1, name: "MC A", icon: "v1" }} size="lg" />
    </>,
  );
  await waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(2));
  expect(container.querySelector("img")).toHaveAttribute("src", "data:image/png;base64,AA==");
  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect(mockInvoke).toHaveBeenCalledWith("site_icon", { id: 1 });
});

test("a site without an icon, or whose icon can't be read, shows its monogram", async () => {
  mockInvoke.mockRejectedValue("gone");
  const { container } = render(
    <>
      <SiteTile site={{ id: 2, name: "studio blog", icon: null }} />
      <SiteTile site={{ id: 3, name: "Corner Bakery", icon: "v9" }} />
    </>,
  );
  await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1));
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toBe("SC");
  expect(container.querySelector(".fav")).toHaveClass("m2");
});

test("an icon smaller than its tile gives way to the monogram", async () => {
  mockInvoke.mockResolvedValue("data:image/png;base64,BB==");
  const { container } = render(<SiteTile site={{ id: 5, name: "Tiny", icon: "v2" }} />);
  await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
  const img = container.querySelector("img")!;
  Object.defineProperty(img, "naturalWidth", { value: 16 });
  Object.defineProperty(img, "width", { value: 24 });
  fireEvent.load(img);
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toBe("T");
});
