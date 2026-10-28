// SPDX-License-Identifier: GPL-3.0-or-later
import { render, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { ChangeTile, PkgTile, pkgNamed, pkgOf } from "./PkgTile";
import type { Item } from "../api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
const mockInvoke = vi.mocked(invoke);

test("a plugin or theme on WordPress.org shows its picture, read once per version; others show a monogram", async () => {
  mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "package_icons") return { "plugin/akismet": 5, "theme/twentytwentyfive": 7 };
    const { kind, slug } = args as { kind: string; slug: string };
    return kind === "plugin" && slug === "akismet" ? "data:image/png;base64,AA==" : "data:image/png;base64,TT==";
  });
  const { container } = render(
    <>
      <PkgTile kind="plugin" slug="akismet" name="Akismet" />
      <PkgTile kind="plugin" slug="akismet" name="Akismet" size="lg" />
      <PkgTile kind="theme" slug="twentytwentyfive" name="Twenty Twenty-Five" size="xs" />
      <PkgTile kind="plugin" slug="bricks" name="Bricks" />
    </>,
  );
  await waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(3));
  const tiles = container.querySelectorAll(".ptile");
  expect(tiles[0]).toHaveClass("pic", "plugin");
  expect(tiles[0].querySelector("img")).toHaveAttribute("src", "data:image/png;base64,AA==");
  expect(tiles[2]).toHaveClass("pic", "theme", "xs");
  expect(tiles[3]).not.toHaveClass("pic");
  expect(tiles[3].textContent).toBe("B");
  for (const t of tiles) expect(t).toHaveAttribute("aria-hidden", "true");
  // The list once, each picture once, nothing asked for Bricks.
  expect(mockInvoke.mock.calls.map((c) => c[0])).toEqual(["package_icons", "package_icon", "package_icon"]);
  expect(mockInvoke).toHaveBeenCalledWith("package_icon", { kind: "plugin", slug: "akismet" });
});

test("a change names its plugin or theme; core and translations get their own tiles; content none", () => {
  const plugins: Item[] = [{ id: "woocommerce/woocommerce.php", name: "WooCommerce", version: "1", active: true, auto_update: null, update: null }];
  expect(pkgOf({ do: "update_plugin", plugin: "woocommerce/woocommerce.php" }, { plugins, themes: [] })).toEqual({ kind: "plugin", slug: "woocommerce", name: "WooCommerce" });
  expect(pkgOf({ do: "activate_theme", theme: "twentytwentyfive" })).toEqual({ kind: "theme", slug: "twentytwentyfive", name: "twentytwentyfive" });
  expect(pkgOf({ do: "install_plugin", source: "query-monitor", activate: true })?.slug).toBe("query-monitor");
  expect(pkgOf({ do: "install_plugin", source: "https://example.com/p.zip", activate: true })).toBeNull();
  expect(pkgOf({ do: "update_core" })).toBeNull();
  const { container } = render(
    <>
      <ChangeTile action={{ do: "update_core" }} />
      <ChangeTile action={{ do: "update_translations" }} size="xs" />
      <ChangeTile action={{ do: "trash_post", post_type: "post", post_id: 1, title: "Hi" }} />
    </>,
  );
  expect([...container.querySelectorAll(".ptile")].map((t) => t.className)).toEqual(["ptile ink", "ptile xs"]);
});

test("a sentence names the longest plugin or theme the sites run", () => {
  const item = (id: string, name: string): Item => ({ id, name, version: "1", active: true, auto_update: null, update: null });
  const runs = [{ plugins: [item("woocommerce/woocommerce.php", "WooCommerce"), item("woocommerce-subscriptions/w.php", "WooCommerce Subscriptions"), item("a/a.php", "A")], themes: [item("bricks", "Bricks")] }];
  expect(pkgNamed("Update WooCommerce Subscriptions", runs)?.slug).toBe("woocommerce-subscriptions");
  expect(pkgNamed("Update WooCommerce", runs)?.slug).toBe("woocommerce");
  expect(pkgNamed("Activate Bricks theme", runs)).toEqual({ kind: "theme", slug: "bricks", name: "Bricks" });
  expect(pkgNamed("Turned on AI agent access", runs)).toBeNull();
});
