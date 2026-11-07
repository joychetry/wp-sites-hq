// SPDX-License-Identifier: GPL-3.0-or-later
// What the palette finds from what the window already has: sites, plugins, themes and clients.
import type { Client, Site, SiteInventory } from "./api";
import { slugOf, type Pkg } from "./components/PkgTile";

export type Local = { kind: "Sites" | "Plugins" | "Themes" | "Clients"; key: string; label: string; detail: string; siteId?: number; clientId?: number; pkg?: Pkg };

const has = (term: string, ...fields: (string | null | undefined)[]) => fields.some((f) => f?.toLowerCase().includes(term));

/** Matches from what the window already has: no site is asked. */
export function localHits(query: string, sites: Site[], inventory: Map<number, SiteInventory>, clients: Client[]): Local[] {
  const term = query.trim().toLowerCase();
  if (!term) return [];
  const out: Local[] = [];
  for (const s of sites) {
    if (has(term, s.name, s.url, s.group, s.client, ...s.tags, ...s.notes.map((n) => n.body))) {
      out.push({ kind: "Sites", key: `s${s.id}`, label: s.name, detail: [s.url.replace(/^https?:\/\//, ""), s.group, s.client].filter(Boolean).join(", "), siteId: s.id });
    }
  }
  for (const kind of ["plugins", "themes"] as const) {
    const found = new Map<string, { name: string; on: string[] }>();
    for (const s of sites) {
      for (const p of inventory.get(s.id)?.inventory[kind] ?? []) {
        if (!has(term, p.name, p.id)) continue;
        const f = found.get(p.id) ?? { name: p.name, on: [] };
        f.on.push(`${s.name} (${p.version}${p.active ? "" : ", off"})`);
        found.set(p.id, f);
      }
    }
    for (const [id, f] of found) {
      const pkg: Pkg = kind === "plugins" ? { kind: "plugin", slug: slugOf(id), name: f.name } : { kind: "theme", slug: id, name: f.name };
      out.push({ kind: kind === "plugins" ? "Plugins" : "Themes", key: `${kind}${id}`, label: f.name, detail: `On ${f.on.join(", ")}`, pkg });
    }
  }
  for (const c of clients) {
    if (has(term, c.name, c.email, c.notes)) {
      const own = sites.filter((s) => s.client_id === c.id).map((s) => s.name);
      out.push({ kind: "Clients", key: `c${c.id}`, clientId: c.id, label: c.name, detail: [c.email, own.length ? `Sites: ${own.join(", ")}` : "No sites"].filter(Boolean).join(". ") });
    }
  }
  return out;
}
