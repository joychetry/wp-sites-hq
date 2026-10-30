// SPDX-License-Identifier: GPL-3.0-or-later
// What the shell (App.tsx) needs from the screens, kept out of them so each screen loads as its own chunk.
import { blocked, NO_TOOLS, noTools, siteStatus, type Action, type Site, type SiteInventory } from "./api";
import type { PlanRow } from "./components/JobSheet";

/**
 * Leaving the editor with unsaved changes asks first. The editor sets `ask` while it has changes;
 * App runs a page change through it.
 */
export const leaveGuard: { ask: ((go: () => void) => void) | null } = { ask: null };

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const word = (n: number) => WORDS[n] ?? String(n);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Two sites are down. One needs a look." and the quieter rest. */
export function summary(sites: Site[]): { lead: string; rest: string } {
  const n = sites.length;
  if (n === 0) return { lead: "Welcome to Monks Central.", rest: "Add your first site to get started." };
  const tones = sites.map((s) => siteStatus(s).tone);
  const down = tones.filter((t) => t === "danger").length;
  const look = tones.filter((t) => t === "warning").length;
  const ok = tones.filter((t) => t === "ok").length;
  if (down === 0 && look === 0) {
    if (ok === 0) return { lead: "Checking your sites.", rest: "This takes a few seconds." };
    const lead = n === 1 ? "Your one site is healthy." : n === 2 ? "Both sites are healthy." : `All ${word(n)} sites are healthy.`;
    return { lead, rest: ok < n ? `${cap(word(n - ok))} not checked yet.` : "" };
  }
  const parts = [];
  if (down) parts.push(`${cap(word(down))} ${down === 1 ? "site is" : "sites are"} down.`);
  if (look) parts.push(`${cap(word(look))} ${look === 1 ? "needs" : "need"} a look.`);
  const rest = ok ? `The other ${word(ok)} ${ok === 1 ? "is" : "are"} fine.` : "";
  return { lead: parts.join(" "), rest };
}

export function attention(s: Site): string | null {
  if (s.sign_in_again) return "The saved sign-in can't be used. Sign in again.";
  if (s.health === "down" || s.health === "warning") return s.health_detail || "Needs a look.";
  if (noTools(s)) return NO_TOOLS;
  if (s.capabilities.degraded === true) return "This Classic Monks is older. Update it on the site for every feature.";
  return null;
}

export type Kind = "WordPress" | "Plugin" | "Theme" | "Translations";
export type Row = PlanRow & { key: string; kind: Kind; name: string; active?: boolean };

/** Every update a site has waiting, as plan rows. */
export function updatesOf(s: Site, inv: SiteInventory | undefined): Row[] {
  if (!inv || blocked(s, inv) || !inv.inventory.updates_known) return [];
  const i = inv.inventory;
  const row = (key: string, kind: Kind, name: string, action: Action, from: string | null, to: string | null, active?: boolean): Row => ({
    key: `${s.id}:${key}`,
    kind,
    name,
    site: s.name,
    icon: s.icon,
    label: kind === "Translations" ? name : `Update ${name}${kind === "Theme" ? " theme" : ""}`,
    from,
    to,
    active,
    change: { site_id: s.id, action },
  });
  return [
    ...(i.wordpress_update ? [row("core", "WordPress", "WordPress", { do: "update_core" }, i.wordpress, i.wordpress_update)] : []),
    ...i.plugins
      .filter((p) => p.update)
      .map((p) => row(`p:${p.id}`, "Plugin", p.name, { do: "update_plugin", plugin: p.id }, p.version, p.update, p.active)),
    ...i.themes
      .filter((t) => t.update)
      .map((t) => row(`t:${t.id}`, "Theme", t.name, { do: "update_theme", theme: t.id }, t.version, t.update, t.active)),
    ...(i.translations > 0
      ? [row("tr", "Translations", "Update translations", { do: "update_translations" }, null, null)]
      : []),
  ];
}

/** The plan's title for these updates, e.g. "Update WooCommerce on MC A". */
export function planTitle(list: (PlanRow & { name: string })[]): string {
  const sites = new Set(list.map((r) => r.change.site_id)).size;
  return `Update ${list.length === 1 ? list[0].name : `${list.length} things`} on ${sites === 1 ? list[0].site : `${sites} sites`}`;
}

