// SPDX-License-Identifier: GPL-3.0-or-later
// A site's picture: its favicon, read and cached by the core, or a monogram tile in the design's colours.
import { useEffect, useState } from "react";
import { api, type Site } from "../api";

// One read per site and icon version for the whole app, shared by every tile that shows it.
const icons = new Map<string, Promise<string | null>>();

/** The first letter or digit of a site's name, for the monogram. */
export const initial = (name: string) => (name.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();

/** Up to two word initials for an avatar: "Sam Okafor" is "SO". */
export const initials = (name: string) => (name.match(/(?<![\p{L}\p{N}])[\p{L}\p{N}]/gu) ?? ["?"]).slice(0, 2).join("").toUpperCase();

export function SiteTile({ site, size }: { site: Pick<Site, "id" | "name"> & { icon?: string | null }; size?: "sm" | "lg" }) {
  const key = site.icon ? `${site.id}:${site.icon}` : null;
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!key) return;
    let read = icons.get(key);
    if (!read) {
      read = api.siteIcon(site.id).catch(() => null);
      icons.set(key, read);
    }
    let live = true;
    read.then((url) => live && setSrc(url));
    return () => {
      live = false;
    };
  }, [key, site.id]);
  return (
    <span className={["fav", size, src ? "pic" : `m${site.id % 4}`].filter(Boolean).join(" ")} aria-hidden="true">
      {src ? <img src={src} alt="" onError={() => setSrc(null)} /> : initial(site.name)}
    </span>
  );
}
