// A stand-in for the Tauri core so Playwright can drive the UI in a plain
// browser (vite --mode mock). Pick the data with ?fixture=fleet|empty|loading|error.
import type { Action, ActivityRow, Change, Comment, FeatureGroup, Item, Job, Media, Post, PostType, Setting, Site, SiteInventory, Summary, User } from "../src/api";

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
  "list-post-types",
  "get-users",
  "create-user",
  "update-user",
  "delete-user",
  "send-password-reset",
  "get-comments",
  "moderate-comment",
  "reply-to-comment",
  "create-login-link",
  "get-features",
  "update-features",
  "get-settings-schema",
  "get-settings",
  "update-settings",
  "list-ai-activity",
  "undo-operation",
  "list-pending-approvals",
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
// Content: posts, pages and a custom post type, one page built with blocks and one with Elementor.
const tax = (name: string, label: string, hierarchical: boolean) => ({ name, label, hierarchical, can_add: true, rest_base: "" });
const ptype = (name: string, label: string, singular: string, taxonomies: PostType["taxonomies"] = []): PostType => ({
  name,
  label,
  singular,
  hierarchical: name === "page",
  supports: ["title", "editor", "thumbnail"],
  can_publish: true,
  can_delete: true,
  taxonomies,
  rest_base: "",
});
const TYPES = [
  ptype("post", "Posts", "Post", [tax("category", "Categories", true), tax("post_tag", "Tags", false)]),
  ptype("page", "Pages", "Page"),
  ptype("cm_book", "Books", "Book", [tax("cm_genre", "Genres", false)]),
];
const swatch = (fill: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="${fill}"/></svg>`)}`;
const MEDIA: Media[] = [
  { id: 31, title: "shop-front", url: swatch("#c8a27a"), mime: "image/jpeg", alt: "The bakery's shop front at dawn", date: "2026-10-20 08:10:00" },
  { id: 32, title: "sourdough", url: swatch("#8a6a4f"), mime: "image/jpeg", alt: "A sliced sourdough loaf", date: "2026-10-18 12:00:00" },
  { id: 33, title: "menu-board", url: swatch("#3d5a4c"), mime: "image/png", alt: "", date: "2026-10-11 16:30:00" },
  { id: 34, title: "price-list", url: "", mime: "application/pdf", alt: "", date: "2026-10-02 09:00:00" },
];
const post = (id: number, post_type: string, title: string, status: string, over: Partial<Post> = {}): Post => ({
  id,
  post_type,
  title,
  status,
  date: "2026-10-26 10:00:00",
  modified: "2026-10-27 15:42:00",
  link: `https://mc-a.local/?p=${id}`,
  featured_image: 0,
  featured_url: null,
  terms: {},
  builder: null,
  blocks: [],
  locked: null,
  ...over,
});
const POSTS: Post[] = [
  post(11, "page", "Our menu", "publish", {
    featured_image: 31,
    featured_url: MEDIA[0].url,
    blocks: [
      { index: 0, name: "core/heading", depth: 0, editable: true, html: "Fresh every morning" },
      { index: 1, name: "core/paragraph", depth: 0, editable: true, html: "Bread from 7, cakes from 9. Ask about <strong>gluten free</strong> loaves." },
      { index: 2, name: "core/columns", depth: 0, editable: false, html: "Columns" },
      { index: 3, name: "core/image", depth: 1, editable: false, html: "Image" },
      { index: 4, name: "core/paragraph", depth: 1, editable: true, html: "Open Tuesday to Sunday." },
      { index: 5, name: "core/buttons", depth: 0, editable: false, html: "Book a table" },
    ],
  }),
  post(12, "page", "Home", "publish", { builder: "elementor", locked: "This page is built with Elementor, so its body is edited in Elementor. You can still change its title, status and featured image here." }),
  post(13, "page", "Catering", "draft"),
  post(21, "post", "Autumn opening hours", "publish", { terms: { category: [{ id: 2, name: "News" }], post_tag: [] } }),
  post(22, "post", "Pumpkin loaf is back", "future"),
  post(23, "post", "Hiring a morning baker", "pending"),
  post(31, "cm_book", "Kind of Blue", "publish", { terms: { cm_genre: [{ id: 5, name: "Jazz" }] } }),
];
const TERMS: Record<string, { id: number; name: string }[]> = {
  category: [
    { id: 1, name: "Uncategorized" },
    { id: 2, name: "News" },
  ],
  post_tag: [{ id: 3, name: "seasonal" }],
  cm_genre: [
    { id: 5, name: "Jazz" },
    { id: 6, name: "Blues" },
  ],
};
const summary = (p: Post): Summary => ({ id: p.id, title: p.title, status: p.status, date: p.date, modified: p.modified, author: "Joy", link: p.link });

const user = (id: number, username: string, name: string, role: string): User => ({ id, username, email: `${username}@example.com`, name, role, registered: "2026-01-02 03:04:05" });
const USERS: Record<number, User[]> = {
  1: [user(1, "joy", "Joy Chetry", "administrator"), user(2, "sam", "Sam Okafor", "shop_manager"), user(3, "ana", "Ana Lima", "editor")],
  2: [user(1, "baker", "Rosa Baker", "administrator"), user(4, "till", "Front Till", "subscriber")],
  3: [user(1, "admin", "admin", "administrator"), user(5, "writer", "Guest Writer", "author")],
};
const ROLES = [
  { id: "administrator", name: "Administrator" },
  { id: "editor", name: "Editor" },
  { id: "author", name: "Author" },
  { id: "shop_manager", name: "Shop manager" },
  { id: "subscriber", name: "Subscriber" },
];
const comment = (id: number, author: string, post_title: string, content: string, date: string, status: Comment["status"] = "pending"): Comment => ({
  id,
  post_id: 5,
  post_title,
  author,
  email: `${author.toLowerCase().replace(/ .*/, "")}@example.com`,
  content,
  date,
  status,
  parent: 0,
});
let COMMENTS: Record<number, Comment[]> = {
  1: [
    comment(11, "Mira Patel", "Sourdough pancakes", "Made these on Sunday. Do you use <b>buttermilk</b> or plain milk?", "2026-10-28 09:41:00"),
    comment(12, "Tom", "Autumn opening hours", "Are you open on the bank holiday?", "2026-10-27 18:02:00"),
    comment(13, "Lena", "Sourdough pancakes", "Lovely recipe, thank you.", "2026-10-25 08:00:00", "approved"),
  ],
  3: [comment(14, "Guest", "Hello world", "First visit, nice blog &amp; photos.", "2026-10-28 07:15:00")],
};
let FEATURES: FeatureGroup[] = [
  {
    key: "performance",
    label: "Performance",
    toggles: [
      { name: "enable_svg_support", label: "SVG Support", description: "Allow SVG uploads to the media library, cleaned before saving.", section: "Media", on: false, locked: false },
      { name: "enable_lazy_load", label: "Lazy Loading", description: "Load images and videos as they scroll into view.", section: "Lazy Loading", on: true, locked: false },
    ],
  },
  {
    key: "security",
    label: "Security",
    toggles: [{ name: "enable_login_lockdown", label: "Login Lockdown", description: "Block an address after repeated failed logins.", section: "Login", on: true, locked: true }],
  },
];
const SETTINGS: Setting[] = [
  { name: "limit_post_revisions", label: "Limit Post Revisions", description: "", tab: "Performance", section: "Heartbeat", control: "select", options: ["default", "disable", "1", "2", "3"], min: null, max: null, step: null, value: "default" },
  { name: "auto_resize_quality", label: "Image Quality (%)", description: "JPEG and WebP quality, 1 to 100.", tab: "Performance", section: "Media", control: "number", options: [], min: 1, max: 100, step: 1, value: 82 },
];
let ACTIVITY: ActivityRow[] = [
  { id: 41, time: "2026-10-28 09:30:12", who: "Monks Central", tool: "update-features", status: "ok", summary: "", can_undo: true },
  { id: 40, time: "2026-10-28 09:12:40", who: "Claude", tool: "delete-post", status: "pending", summary: "", can_undo: false },
  { id: 39, time: "2026-10-27 21:53:28", who: "Monks Central", tool: "update-post", status: "ok", summary: "", can_undo: false },
  { id: 38, time: "2026-10-27 20:10:02", who: "WP-CLI", tool: "update-settings", status: "undone", summary: "", can_undo: false },
];

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
    case "content_types":
      return r(TYPES);
    case "content_list": {
      const q = args.query as { post_type: string; status?: string; search?: string };
      const rows = POSTS.filter((p) => p.post_type === q.post_type && (q.status ? p.status === q.status : p.status !== "trash") && (!q.search || p.title.toLowerCase().includes(q.search.toLowerCase())));
      return r({ posts: rows.map(summary), total: rows.length, page: 1, pages: 1 });
    }
    case "content_get":
      return r(POSTS.find((p) => p.id === args.postId));
    case "content_terms":
      return r(TERMS[args.taxonomy as string] ?? []);
    case "content_create":
    case "content_edit":
      await new Promise((ok) => setTimeout(ok, 300));
      return r(POSTS.find((p) => p.id === args.postId) ?? post(99, args.postType as string, "New entry", "draft"));
    case "content_trash":
      return r(null);
    case "media_list":
      return r(args.images ? MEDIA.filter((m) => m.mime.startsWith("image/")) : MEDIA);
    case "media_import":
      await new Promise((ok) => setTimeout(ok, 300));
      return r(MEDIA[0]);
    case "users_list": {
      const q = String(args.search ?? "").toLowerCase();
      const list = (USERS[id] ?? []).filter((u) => !q || `${u.name} ${u.username} ${u.email}`.toLowerCase().includes(q));
      return r({ users: list, total: list.length, roles: ROLES, can_reset: id !== 3 });
    }
    case "user_create":
      await new Promise((ok) => setTimeout(ok, 300));
      return r({ ...user(9, (args.user as { username: string }).username, "", (args.user as { role: string }).role) });
    case "user_set_role":
    case "user_delete":
      return r(null);
    case "user_reset":
      return r(`${(USERS[id] ?? []).find((u) => u.id === args.userId)?.username}@example.com`);
    case "comments_list": {
      const list = (COMMENTS[id] ?? []).filter((c) => c.status === args.status);
      return r({ comments: list, total: list.length });
    }
    case "comment_moderate": {
      const to = { approve: "approved", unapprove: "pending", spam: "spam", trash: "trash" }[args.action as string] as Comment["status"];
      COMMENTS = { ...COMMENTS, [id]: (COMMENTS[id] ?? []).map((c) => (c.id === args.commentId ? { ...c, status: to } : c)) };
      return r(null);
    }
    case "comment_reply":
    case "site_login":
    case "cm_approval_open":
      return r(null);
    case "cm_features":
      return r(FEATURES);
    case "cm_set_feature":
      FEATURES = FEATURES.map((g) => ({ ...g, toggles: g.toggles.map((t) => (t.name === args.name ? { ...t, on: args.on as boolean } : t)) }));
      ACTIVITY = [{ id: 42, time: "2026-10-28 10:00:00", who: "Monks Central", tool: "update-features", status: "ok", summary: "", can_undo: true }, ...ACTIVITY];
      return r(42);
    case "cm_settings":
      return r(SETTINGS);
    case "cm_set_setting":
      return r(43);
    case "cm_activity":
      return r({ rows: ACTIVITY, total: ACTIVITY.length, page: 1, pages: 1 });
    case "cm_undo":
      ACTIVITY = ACTIVITY.map((a) => (a.id === args.row ? { ...a, status: "undone", can_undo: false } : a));
      return r(null);
    case "cm_approvals":
      return r([
        { id: 40, tool: "delete-post", who: "Claude", time: "2026-10-28 09:12:40", expires_in: 540 },
        { id: 37, tool: "update-user", who: "Cursor", time: "2026-10-28 09:05:11", expires_in: 120 },
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
