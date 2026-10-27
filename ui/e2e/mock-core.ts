// A stand-in for the Tauri core so Playwright can drive the UI in a plain
// browser (vite --mode mock). Pick the data with ?fixture=fleet|empty|loading|error.
import type { Site } from "../src/api";

const now = Math.floor(Date.now() / 1000);
const fixture = new URLSearchParams(location.search).get("fixture") ?? "fleet";

function site(over: Partial<Site>): Site {
  return {
    id: 1,
    url: "https://mc-a.local",
    name: "MC A",
    mode: "classic_monks",
    api_url: "",
    username: null,
    wp_version: "7.1.3",
    php_version: "8.4.26",
    cm_version: "2.6.0",
    capabilities: { operator: true, abilities: Array(184).fill("x"), hq_status: true, approvals: true, degraded: false },
    sign_in_again: false,
    health: "ok",
    health_detail: "Answered in 0.8 s.",
    checked_at: now - 120,
    group: null,
    tags: [],
    notes: [],
    added_at: 0,
    ...over,
  };
}

const FLEET: Site[] = [
  site({
    group: "Clients",
    tags: ["shop", "woocommerce"],
    capabilities: {
      operator: true,
      abilities: Array(184).fill("x"),
      hq_status: true,
      approvals: true,
      degraded: false,
      pending_approvals: 2,
      modules: { ai: true, woocommerce: true, security: false },
    },
    notes: [{ id: 1, body: "Client renews hosting in March.", added_at: now - 86400 * 3 }],
  }),
  site({ id: 2, name: "Corner Bakery", url: "https://corner-bakery-and-cafe-downtown.local", group: "Clients", health: "down", health_detail: "The site didn't answer within 20 seconds.", checked_at: now - 60 }),
  site({ id: 3, name: "mc-c", url: "https://mc-c.local", mode: "basic", username: "admin", cm_version: null, capabilities: {}, health_detail: "Answered in 0.7 s." }),
  site({ id: 4, name: "Monks Central Test", url: "https://monks-central-test.local", cm_version: null, php_version: null, sign_in_again: true, capabilities: { abilities: [], hq_status: false, degraded: true }, checked_at: now - 10 }),
  site({ id: 5, name: "Studio Blog", url: "https://studio-blog.local", wp_version: "7.1.2", php_version: "8.3.14", cm_version: null, capabilities: { abilities: [], hq_status: false, degraded: true }, health_detail: "Answered in 0.5 s." }),
  site({ id: 6, name: "Portfolio", url: "https://portfolio.local", group: "Personal", tags: ["static"], php_version: "8.3.14", health: "ok", health_detail: "Slow: the home page took 4.2 s.", checked_at: now - 3600 * 2 }),
];

let sites: Site[] = fixture === "empty" ? [] : FLEET.map((s) => ({ ...s }));
const listeners: Array<() => void> = [];
const changed = () => listeners.forEach((f) => f());
const edit = (id: number, over: Partial<Site>) => {
  sites = sites.map((s) => (s.id === id ? { ...s, ...over } : s));
  changed();
  return sites.find((s) => s.id === id);
};

export async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const id = args.id as number;
  const r = (v: unknown) => v as T;
  switch (cmd) {
    case "core_status":
      if (fixture === "error") throw "The core didn't start: another copy is still closing.";
      return r({ version: "0.0.1", pid: 1, role: "operator", headless: false, home: "" });
    case "sites_list":
      if (fixture === "loading") return new Promise<T>(() => {});
      return r(sites);
    case "site_check":
      await new Promise((ok) => setTimeout(ok, 300));
      return r(null);
    case "site_set_group":
      return r(edit(id, { group: args.group as string | null }));
    case "site_set_tags":
      return r(edit(id, { tags: args.tags as string[] }));
    case "site_add_note":
      return r(edit(id, { notes: [...sites.find((s) => s.id === id)!.notes, { id: Date.now(), body: args.body as string, added_at: now }] }));
    case "site_delete_note":
      return r(edit(id, { notes: sites.find((s) => s.id === id)!.notes.filter((n) => n.id !== args.noteId) }));
    case "site_remove":
      sites = sites.filter((s) => s.id !== id);
      changed();
      return r({ signed_out: true, message: "Removed. Monks Central signed out on the site." });
    case "sign_in_cancel":
    case "site_open":
      return r(null);
    default:
      // Adding and signing in need a real site.
      return new Promise<T>(() => {});
  }
}

export async function listen(_event: string, f: () => void) {
  listeners.push(f);
  return () => listeners.splice(listeners.indexOf(f), 1);
}
