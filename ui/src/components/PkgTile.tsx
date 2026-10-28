// SPDX-License-Identifier: GPL-3.0-or-later
// A plugin's icon or a theme's screenshot from WordPress.org, read and cached by the core, or a
// monogram tile in the design's style (premium, custom and zip installs).
import { useEffect, useState, useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type Action, type Item } from "../api";
import { initial } from "./SiteTile";
import { Glyph } from "./ui";

export type PkgKind = "plugin" | "theme";
export type Pkg = { kind: PkgKind; slug: string; name: string };

/** A plugin's directory slug from its file: `akismet/akismet.php` is `akismet`. WordPress ships Hello Dolly as a lone file. */
export const slugOf = (file: string) => (file === "hello.php" ? "hello-dolly" : file.split("/")[0].replace(/\.php$/, ""));

// Which images the core has (`plugin/akismet` to when saved), one list for the whole app,
// read again whenever plugins and themes change (the core says so after it saves new ones).
let known: Record<string, number> = {};
let started = false;
const subs = new Set<() => void>();
const load = () =>
  Promise.resolve()
    .then(api.packageIcons)
    .then(
      (k) => {
        known = k ?? {};
        subs.forEach((f) => f());
      },
      () => {},
    );
function subscribe(f: () => void) {
  subs.add(f);
  if (!started) {
    started = true;
    load();
    listen("inventory-changed", load).catch(() => {});
  }
  return () => subs.delete(f);
}

// One read per image and version, shared by every tile that shows it.
const reads = new Map<string, Promise<string | null>>();

export function PkgTile({ kind, slug, name, size }: Pkg & { size?: "xs" | "sm" | "lg" }) {
  const at = useSyncExternalStore(subscribe, () => known[`${kind}/${slug}`]);
  const key = at ? `${kind}/${slug}:${at}` : null;
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!key) return;
    let read = reads.get(key);
    if (!read) {
      read = Promise.resolve()
        .then(() => api.packageIcon(kind, slug))
        .catch(() => null);
      reads.set(key, read);
    }
    let live = true;
    read.then((url) => live && setSrc(url));
    return () => {
      live = false;
    };
  }, [key, kind, slug]);
  return (
    <span className={["ptile", size, src && `pic ${kind}`].filter(Boolean).join(" ")} aria-hidden="true">
      {src ? <img src={src} alt="" onError={() => setSrc(null)} /> : initial(name)}
    </span>
  );
}

/** The plugin or theme a change is about, named as the site's inventory names it. */
export function pkgOf(action: Action, items?: { plugins: Item[]; themes: Item[] }): Pkg | null {
  const named = (list: Item[] | undefined, id: string) => list?.find((x) => x.id === id)?.name;
  if ("plugin" in action) return { kind: "plugin", slug: slugOf(action.plugin), name: named(items?.plugins, action.plugin) ?? slugOf(action.plugin) };
  if ("theme" in action) return { kind: "theme", slug: action.theme, name: named(items?.themes, action.theme) ?? action.theme };
  // A link or a zip is not in the directory.
  if (action.do === "install_plugin" && !action.source.includes("/")) return { kind: "plugin", slug: action.source, name: action.source };
  if (action.do === "install_zip") return { kind: action.kind, slug: "", name: action.name };
  return null;
}

/** A change's tile: the plugin or theme, WordPress's "W" for core, a globe for translations; none for content. */
export function ChangeTile({ action, name, size }: { action: Action; name?: string; size?: "xs" | "sm" }) {
  const pkg = pkgOf(action);
  if (pkg) return <PkgTile {...pkg} name={name ?? pkg.name} size={size} />;
  if (action.do !== "update_core" && action.do !== "update_translations") return null;
  return (
    <span className={["ptile", size, action.do === "update_core" && "ink"].filter(Boolean).join(" ")} aria-hidden="true">
      {action.do === "update_core" ? "W" : <Glyph name="globe" />}
    </span>
  );
}

/** The plugin or theme a sentence names ("Update WooCommerce on MC A"), longest name first, from what the sites run. */
export function pkgNamed(text: string, items: { plugins: Item[]; themes: Item[] }[]): Pkg | null {
  let best: Pkg | null = null;
  for (const inv of items)
    for (const [kind, list] of [["plugin", inv.plugins], ["theme", inv.themes]] as const)
      for (const x of list)
        if (x.name.length > (best?.name.length ?? 2) && text.includes(x.name))
          best = { kind, slug: kind === "plugin" ? slugOf(x.id) : x.id, name: x.name };
  return best;
}
