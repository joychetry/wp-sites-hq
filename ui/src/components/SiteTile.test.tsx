// SPDX-License-Identifier: GPL-3.0-or-later
import { render, waitFor } from "@testing-library/react";
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
