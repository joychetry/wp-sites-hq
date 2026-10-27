// A stand-in for the Tauri core so Playwright can drive the UI in a plain
// browser (vite --mode mock). Pick the data with ?fixture=fleet|empty|loading|error.
import type { Action, Change, Item, Job, Site, SiteInventory } from "../src/api";

const now = Math.floor(Date.now() / 1000);
// Real tool names first, so the screens offer the actions a Classic Monks site has.
const TOOLS = [
  "get-hq-status",
  "get-site-snapshot",
  "update-plugin",
  "rollback-plugin",
  "list-plugin-versions",
  "activate-plugin",
  "deactivate-plugin",
  "uninstall-plugin",
  "set-plugin-auto-update",
  "install-plugin",
  "update-theme",
  "activate-theme",
  "delete-theme",
  "update-core",
  "update-translations",
];
const ABILITIES = [...TOOLS, ...Array(184 - TOOLS.length).fill("x")];
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
    capabilities: { operator: true, abilities: ABILITIES, hq_status: true, approvals: true, degraded: false },
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
      abilities: ABILITIES,
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

const item = (id: string, name: string, version: string, over: Partial<Item> = {}): Item => ({
  id,
  name,
  version,
  active: true,
  auto_update: false,
  update: null,
  ...over,
});
const CM = item("classic-monks/classic-monks.php", "Classic Monks", "2.6.0");
const WOO = "woocommerce/woocommerce.php";
const TT5 = item("twentytwentyfive", "Twenty Twenty-Five", "1.2");
const inv = (site_id: number, over: Partial<SiteInventory["inventory"]>): SiteInventory => ({
  site_id,
  fetched_at: now - 300,
  inventory: {
    wordpress: "7.1.3",
    wordpress_update: null,
    plugins: [],
    themes: [TT5],
    translations: 0,
    updates_known: true,
    needs_credentials: false,
    ...over,
  },
});
let inventory: SiteInventory[] =
  fixture === "empty"
    ? []
    : [
        inv(1, {
          wordpress_update: "7.1.4",
          translations: 2,
          plugins: [
            CM,
            item(WOO, "WooCommerce", "10.2.0", { update: "10.3.0" }),
            item("elementor/elementor.php", "Elementor", "3.30.2", { active: false }),
            item("akismet/akismet.php", "Akismet Anti-spam: Spam Protection", "5.3", { update: "5.5", auto_update: true }),
          ],
          themes: [TT5, item("bricks", "Bricks", "2.4.3", { active: false, auto_update: null })],
        }),
        inv(2, {
          plugins: [item(WOO, "WooCommerce", "10.1.0", { update: "10.3.0" }), item("wordpress-seo/wp-seo.php", "Yoast SEO", "26.1", { update: "26.2" })],
        }),
        inv(3, {
          updates_known: false,
          plugins: [item(WOO, "WooCommerce", "10.3.0", { auto_update: null }), item("elementor/elementor.php", "Elementor", "3.30.2", { auto_update: null })],
        }),
        inv(6, {
          plugins: [CM, item("akismet/akismet.php", "Akismet Anti-spam: Spam Protection", "5.5")],
          themes: [{ ...TT5, update: "1.3" }],
        }),
      ];

const jobs: Job[] = [];
const label = (a: Action) => a.do.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
/** Runs the job a step at a time; the second change fails, so the screens show both. */
function startJob(title: string, changes: Change[]): Job {
  const job: Job = {
    id: jobs.length + 1,
    title,
    created_at: now,
    finished_at: null,
    items: changes.map((c, i) => ({
      id: i + 1,
      site_id: c.site_id,
      site_name: sites.find((s) => s.id === c.site_id)?.name ?? "a site",
      action: c.action,
      label: label(c.action),
      from_version: "10.2.0",
      to_version: "10.3.0",
      state: "waiting",
      message: "",
    })),
  };
  jobs.push(job);
  job.items.forEach((it, i) => {
    setTimeout(() => {
      it.state = "running";
      changed();
    }, 100 + i * 200);
    setTimeout(() => {
      const fail = i === 1;
      it.state = fail ? "failed" : "done";
      it.message = fail ? "The site took too long to answer. Nothing was changed." : "Updated.";
      if (i === job.items.length - 1) job.finished_at = now;
      changed();
    }, 250 + i * 200);
  });
  return job;
}
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
    case "inventory_list":
      return r(inventory);
    case "inventory_refresh":
      await new Promise((ok) => setTimeout(ok, 300));
      inventory = inventory.map((i) => ({ ...i, fetched_at: Math.floor(Date.now() / 1000) }));
      changed();
      return r(null);
    case "plugin_versions":
      return r({ installed: "10.2.0", versions: ["10.3.0", "10.2.0", "10.1.0", "10.0.4"].map((version) => ({ version })) });
    case "plugin_search":
      return r([
        { slug: "wordpress-seo", name: "Yoast SEO – Advanced SEO with real-time guidance", version: "26.2", active_installs: 10000000, summary: "Improve your SEO with real-time feedback and schema." },
        { slug: "seo-by-rank-math", name: "Rank Math SEO", version: "1.0.250", active_installs: 3000000, summary: "SEO made easy for everyone." },
      ]);
    case "job_start":
      return r(startJob(args.title as string, args.changes as Change[]));
    case "job_get":
      return r(structuredClone(jobs[(args.id as number) - 1]));
    default:
      // Adding and signing in need a real site.
      return new Promise<T>(() => {});
  }
}

export async function listen(_event: string, f: () => void) {
  listeners.push(f);
  return () => listeners.splice(listeners.indexOf(f), 1);
}
