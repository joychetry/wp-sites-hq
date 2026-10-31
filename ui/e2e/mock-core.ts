// SPDX-License-Identifier: GPL-3.0-or-later
// A stand-in for the Tauri core so Playwright can drive the UI in a plain
// browser (vite --mode mock). Pick the data with ?fixture=fleet|fleet300|first|empty|loading|error
// (first: one site, as just after adding it).
import { ACF_FIELDS } from "./acf-fixture";
import type { Action, ActivityRow, AppSettings, ReportAsk, Bundle, Change, Client, Comment, Cost, Entry, FeatureGroup, Item, Job, Media, Monitor, Post, PostType, Product, SecurityReport, Setting, Site, SiteInventory, Summary, User } from "../src/api";

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
  "install-zip",
  "update-theme",
  "activate-theme",
  "delete-theme",
  "update-core",
  "update-translations",
  "list-post-types",
  "get-post-meta",
  "list-revisions",
  "restore-revision",
  "untrash-post",
  "get-media",
  "upload-media",
  "update-media",
  "replace-media",
  "restore-replaced-media",
  "trash-media",
  "restore-media",
  "get-acf-fields",
  "update-acf-fields",
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
  "get-404-report",
  "get-search-report",
  "get-unused-media-report",
  "get-login-security-report",
  "get-2fa-report",
  "list-products",
  "get-store-overview",
  "update-products",
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
    capabilities: {
      operator: true,
      abilities: ABILITIES,
      hq_status: true,
      approvals: true,
      degraded: false,
      plugin: { name: "Classic Monks Pro", version: "2.6.0" },
      connector: { version: "1.1.0", hosts: [{ name: "Classic Monks Pro", version: "2.6.0", connector: "1.1.0" }] },
    },
    sign_in_again: false,
    health: "ok",
    health_detail: "Answered in 0.8 s.",
    checked_at: now - 120,
    group: null,
    tags: [],
    notes: [],
    added_at: 0,
    agent_access: false,
    client_id: null,
    client: null,
    icon: "v1",
    ...over,
  };
}

// A favicon per site: a coloured rounded square or circle with the name's first letter.
const ICON_COLOURS = ["#e4572e", "#2e86ab", "#3bb273", "#7768ae", "#f4a259", "#1b998b", "#c03221"];
function iconFor(s: Site): string {
  const fill = ICON_COLOURS[(s.id - 1) % ICON_COLOURS.length];
  const shape = s.id % 2 ? `<rect width="32" height="32" rx="7" fill="${fill}"/>` : `<circle cx="16" cy="16" r="16" fill="${fill}"/>`;
  const letter = (s.name.match(/[a-z0-9]/i)?.[0] ?? "W").toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${shape}<text x="16" y="22" font-family="sans-serif" font-size="17" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// WordPress.org pictures: plugin icons (square, their own colours) and theme screenshots (4:3, cropped
// in the tiles). Classic Monks, Bricks and the rest aren't in the directory, so their tiles show monograms.
const svg = (w: number, h: number, body: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>`)}`;
const mark = (fill: string, ink: string, letter: string) =>
  svg(128, 128, `<rect width="128" height="128" fill="${fill}"/><text x="64" y="${letter.length > 1 ? 80 : 86}" font-family="sans-serif" font-size="${letter.length > 1 ? 44 : 64}" font-weight="700" fill="${ink}" text-anchor="middle">${letter}</text>`);
const PACKAGE_ICONS: Record<string, string> = {
  "plugin/woocommerce": mark("#7f54b3", "#ffffff", "Woo"),
  "plugin/akismet": mark("#357b49", "#ffffff", "A"),
  "plugin/elementor": svg(128, 128, `<rect width="128" height="128" fill="#92003b"/><rect x="40" y="36" width="12" height="56" fill="#fff"/><rect x="62" y="36" width="28" height="12" fill="#fff"/><rect x="62" y="58" width="28" height="12" fill="#fff"/><rect x="62" y="80" width="28" height="12" fill="#fff"/>`),
  "plugin/wordpress-seo": mark("#a4286a", "#ffffff", "Y"),
  "plugin/seo-by-rank-math": mark("#e1e8f8", "#4b2ea8", "R"),
  "plugin/jetpack": svg(128, 128, `<rect width="128" height="128" fill="#ffffff"/><circle cx="64" cy="64" r="48" fill="#069e08"/><path d="M60 26v54H34zM68 102V48h26z" fill="#fff"/>`),
  "theme/twentytwentyfive": svg(1200, 900, `<rect width="1200" height="900" fill="#fbf7ee"/><rect width="1200" height="120" fill="#ffffff"/><text x="80" y="76" font-family="serif" font-size="40" fill="#111">Twenty Twenty-Five</text><text x="80" y="420" font-family="serif" font-size="140" fill="#111">A calm,</text><text x="80" y="580" font-family="serif" font-size="140" fill="#111">clear voice</text><rect x="80" y="660" width="1040" height="240" fill="#d9c9a8"/>`),
};

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
      plugin: { name: "Classic Monks Pro", version: "2.6.0" },
      connector: {
        version: "1.1.0",
        hosts: [
          { name: "Classic Monks Pro", version: "2.6.0", connector: "1.1.0" },
          { name: "WP Sites HQ", version: "0.2.0", connector: "1.1.0" },
        ],
      },
    },
    notes: [{ id: 1, body: "Client renews hosting in March.", added_at: now - 86400 * 3 }],
    agent_access: true,
    client_id: 1,
    client: "Corner Bakery",
  }),
  site({ id: 2, client_id: 1, client: "Corner Bakery", name: "Corner Bakery", url: "https://corner-bakery-and-cafe-downtown.local", group: "Clients", health: "down", health_detail: "The site didn't answer within 20 seconds.", checked_at: now - 60 }),
  site({ id: 3, name: "mc-c", url: "https://mc-c.local", mode: "basic", username: "admin", cm_version: null, capabilities: {}, health_detail: "Answered in 0.7 s." }),
  // 4 and 5 have no icon, so their tiles show the monogram.
  site({ id: 4, icon: null, name: "WP Sites HQ Test", url: "https://monks-central-test.local", cm_version: null, php_version: null, sign_in_again: true, capabilities: { abilities: [], hq_status: false, degraded: true }, checked_at: now - 10 }),
  site({ id: 5, icon: null, name: "Studio Blog", url: "https://studio-blog.local", wp_version: "7.1.2", php_version: "8.3.14", cm_version: null, capabilities: { abilities: [], hq_status: false, degraded: true }, health_detail: "Answered in 0.5 s." }),
  site({ id: 6, client_id: 2, client: "Studio North", name: "Portfolio", url: "https://portfolio.local", group: "Personal", tags: ["static"], php_version: "8.3.14", health: "ok", health_detail: "Slow: the home page took 4.2 s.", checked_at: now - 3600 * 2 }),
];

let sites: Site[] = fixture === "empty" ? [] : fixture === "first" ? [{ ...FLEET[0] }] : FLEET.map((s) => ({ ...s }));

let BUNDLES: Bundle[] = fixture === "empty" ? [] : [
  { id: 1, name: "New shop", plugins: [{ source: "woocommerce", name: "WooCommerce" }, { source: "wordpress-seo", name: "Yoast SEO" }, { source: "wp-mail-smtp", name: "" }] },
  { id: 2, name: "Blog basics", plugins: [{ source: "akismet", name: "Akismet" }, { source: "jetpack", name: "" }] },
];

let CLIENTS: Client[] = fixture === "empty" ? [] : [
  { id: 1, name: "Corner Bakery", email: "rosa@corner-bakery.test", notes: "Pays by bank transfer, 14 days." },
  { id: 2, name: "Studio North", email: "hello@studio-north.test", notes: "" },
];
const cost = (id: number, on: { site_id?: number; client_id?: number }, kind: Cost["kind"], label: string, cents: number, currency: string, every: Cost["every"], renews_on: string | null = null): Cost => ({
  id, site_id: on.site_id ?? null, client_id: on.client_id ?? null, kind, label, cents, currency, every, renews_on,
});
let COSTS: Cost[] = fixture === "empty" ? [] : [
  cost(1, { site_id: 1 }, "cost", "Hosting", 24000, "EUR", "year", "2027-03-01"),
  cost(2, { site_id: 2 }, "cost", "Domain", 1500, "EUR", "year", "2026-12-14"),
  cost(3, { site_id: 1 }, "cost", "WooCommerce Subscriptions licence", 27900, "USD", "year", "2027-05-20"),
  cost(4, { client_id: 1 }, "charge", "Care plan", 9900, "EUR", "month"),
  cost(5, { client_id: 2 }, "charge", "Care plan", 4900, "EUR", "month"),
  cost(6, { site_id: 6 }, "cost", "Hosting", 600, "EUR", "month", "2026-11-01"),
];

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
    proposed_by: "human",
    confirmed_at: now,
    declined_at: null,
    expired: false,
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
      // A safe update that broke the site: put back, with the reason.
      const back = !fail && it.action.do === "update_plugin" && it.action.plugin === "akismet/akismet.php";
      it.state = fail ? "failed" : back ? "rolled_back" : "done";
      it.message = fail
        ? "The site took too long to answer. Nothing was changed."
        : back
          ? "Rolled back to 5.3. The home page answered 500 after the update: PHP Fatal error: Uncaught Error: Call to undefined function akismet_boot() in ABSPATH/wp-content/plugins/akismet/akismet.php on line 41"
          : "Updated. The site works after the update.";
      if (i === job.items.length - 1) job.finished_at = now;
      changed();
    }, 250 + i * 200);
  });
  return job;
}
// AI: a plan an agent proposed, waiting for you, and who did what.
const planItem = (id: number, site_id: number, site_name: string, from: string) => ({
  id,
  site_id,
  site_name,
  action: { do: "update_plugin", plugin: WOO } as Action,
  label: "Update WooCommerce",
  from_version: from,
  to_version: "10.3.0",
  state: "waiting" as const,
  message: "",
});
let PLANS: Job[] =
  fixture === "empty"
    ? []
    : [
        {
          id: 49,
          title: "Turn off Akismet on Portfolio",
          created_at: now - 8 * 86400,
          finished_at: null,
          proposed_by: "agent",
          confirmed_at: null,
          declined_at: null,
          expired: true,
          items: [{ ...planItem(4, 6, "Portfolio", "5.5"), action: { do: "deactivate_plugin", plugin: "akismet/akismet.php" }, label: "Turn off Akismet Anti-spam: Spam Protection", to_version: null }],
        },
        {
          id: 50,
          title: "Update WooCommerce on 3 sites",
          created_at: now - 240,
          finished_at: null,
          proposed_by: "agent",
          confirmed_at: null,
          declined_at: null,
          expired: false,
          items: [planItem(1, 1, "MC A", "10.2.0"), planItem(2, 2, "Corner Bakery", "10.1.0"), planItem(3, 6, "Portfolio", "10.2.0")],
        },
      ];
const entry = (id: number, ago: number, actor: Entry["actor"], site_name: string, what: string, outcome: Entry["outcome"], detail = ""): Entry => ({
  id,
  at: now - ago,
  actor,
  site_id: site_name ? 1 : null,
  site_name,
  what,
  outcome,
  detail,
});
const ENTRIES: Entry[] =
  fixture === "empty"
    ? []
    : [
        entry(6, 240, "agent", "", "Proposed a plan: Update WooCommerce on 3 sites", "waiting", "3 changes on 3 sites. Waiting for you to confirm it under AI."),
        entry(5, 600, "agent", "MC A", "update-post", "done"),
        entry(4, 660, "agent", "MC A", "update-post", "waiting", "This change needs approval. Ask the user to open https://mc-a.local/wp-admin/admin.php?page=cm-ai-approve&op=44 and approve it, then call the same tool again with exactly the same arguments."),
        entry(3, 900, "agent", "Portfolio", "activate-plugin", "refused", "AI agents can only read this site: it has no AI agent access."),
        entry(2, 3600, "agent_confirmed", "Corner Bakery", "Update Yoast SEO", "failed", "The site took too long to answer."),
        entry(1, 7200, "human", "MC A", "Turned on AI agent access", "done"),
      ];

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
const media = (id: number, title: string, url: string, mime: string, alt: string, date: string, over: Partial<Media> = {}): Media => ({
  id,
  title,
  url,
  mime,
  alt,
  date,
  caption: "",
  description: "",
  file_name: `${title}.${mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg"}`,
  author: "Joy",
  width: mime.startsWith("image/") ? 1600 : 0,
  height: mime.startsWith("image/") ? 1200 : 0,
  size: 284_000,
  thumb: url,
  usage: null,
  ...over,
});
let MEDIA: Media[] = [
  media(31, "shop-front", swatch("#c8a27a"), "image/jpeg", "The bakery's shop front at dawn", "2026-10-20 08:10:00", { caption: "Open from 7 every day", size: 412_000 }),
  media(32, "sourdough", swatch("#8a6a4f"), "image/jpeg", "A sliced sourdough loaf", "2026-10-18 12:00:00"),
  media(33, "menu-board", swatch("#3d5a4c"), "image/png", "", "2026-10-11 16:30:00", { size: 96_000 }),
  media(34, "price-list", "", "application/pdf", "", "2026-10-02 09:00:00", { size: 1_240_000 }),
  media(35, "croissants", swatch("#d9b26f"), "image/webp", "Butter croissants on a tray", "2026-09-28 07:45:00"),
  media(36, "team-photo", swatch("#6b7f8e"), "image/jpeg", "", "2026-09-14 15:20:00", { author: "Sam Okafor" }),
];
let TRASHED: number[] = [];
const STOPS = new Set<string>();
/** Sends a fake upload's progress in four steps, unless Stop comes first. */
async function sendSteps(key: string, size: number) {
  for (let i = 0; i <= 4; i++) {
    if (STOPS.delete(key)) throw "Stopped. Nothing was added.";
    progress.forEach((f) => f({ payload: { key, sent: Math.round((size * i) / 4), total: size } }));
    await new Promise((ok) => setTimeout(ok, 150));
  }
}
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
  meta: {},
  builder: null,
  blocks: [],
  locked: null,
  preview_link: `https://mc-a.local/?p=${id}&preview=true`,
  slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  excerpt: "",
  author_id: 1,
  author: "Joy Chetry",
  parent: 0,
  menu_order: 0,
  template: "",
  password: "",
  page_fields: true,
  choices: {
    authors: [
      { id: 1, name: "Joy Chetry" },
      { id: 3, name: "Ana Lima" },
    ],
    parents: post_type === "page" ? [{ id: 13, title: "Catering" }] : [],
    templates: post_type === "page" ? { "page-wide.php": "Wide page", "page-no-title": "Page No Title" } : {},
  },
  ...over,
});
let APP: AppSettings = { report_name: "Studio North", report_footer: "hello@studio-north.test", report_accent: "#1f6feb", white_label: false, search_console: false, agentedseo: false, auto_update: false };
let GSC = { on: false, client: false, connected: false };
const product = (id: number, name: string, regular_price: string, sale_price: string, stock_status: string, stock_quantity: number | null, sku = "", type = "simple"): Product => ({
  id, name, type, status: "publish", sku, price: sale_price || regular_price, regular_price, sale_price, stock_status, manage_stock: stock_quantity != null, stock_quantity, permalink: `https://mc-a.local/product/${id}`,
});
const PRODUCTS: Product[] = [
  product(61, "Sourdough loaf", "6.50", "", "instock", 24, "SD-01"),
  product(62, "Rye loaf", "5.80", "4.90", "instock", 2, "RY-01"),
  product(63, "Cinnamon buns, box of 4", "9.00", "", "outofstock", 0, "CB-04"),
  product(64, "Gift card", "25.00", "", "instock", null, "", "variable"),
];
const POSTS: Post[] = [
  post(11, "page", "Our menu", "publish", {
    meta: { opening_hours: "7:00 to 18:00", menu_pdf: "menu-autumn.pdf", gallery: ["31", "32"] },
    featured_image: 31,
    featured_url: MEDIA[0].url,
    blocks: [
      { index: 0, name: "core/heading", depth: 0, editable: true, html: "Fresh every morning", level: 2 },
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
  post(24, "post", "Summer menu", "trash"),
  post(31, "cm_book", "Kind of Blue", "publish", { terms: { cm_genre: [{ id: 5, name: "Jazz" }] } }),
  post(25, "post", "Winter opening hours", "publish", {
    terms: { category: [{ id: 2, name: "News" }], post_tag: [] },
    excerpt: "Shorter days, the same bread.",
    blocks: [{ index: 0, name: "", depth: 0, editable: true, html: "From December we open at 8.\n\nWe are closed on <strong>Mondays</strong>, and the café shuts at 4.\n<ul>\n<li>Bread from 8</li>\n<li>Cakes from 10</li>\n</ul>" }],
  }),
  post(26, "post", "Monks test fields post", "publish", { terms: { category: [{ id: 1, name: "Uncategorized" }], post_tag: [] } }),
];
// The ACF group on "Monks test fields post": one field of every type.
let ACF = structuredClone(ACF_FIELDS) as { key: string; label: string; type: string; value?: unknown }[];
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

// Security: what each site's last scan found.
const SECURITY: SecurityReport[] =
  fixture === "empty"
    ? []
    : [
        {
          site_id: 1,
          checked_at: now - 3 * 3600,
          vulnerabilities: [
            { kind: "plugin", id: WOO, name: "WooCommerce", installed: "10.2.0", title: "WooCommerce < 10.3.0 - Authenticated (Shop Manager+) Stored Cross-Site Scripting via product reviews", severity: "high", fixed_in: "10.3.0", link: "https://www.wordfence.com/threat-intel/vulnerabilities/" },
            { kind: "plugin", id: "elementor/elementor.php", name: "Elementor", installed: "3.30.2", title: "Elementor <= 3.30.2 - Contributor+ DOM-Based Stored XSS", severity: "medium", fixed_in: null, link: null },
          ],
          abandoned: [{ id: "wp-postratings/wp-postratings.php", name: "WP-PostRatings", version: "1.91", last_updated: now - 86400 * 900, closed: false, reason: null }],
          checksums: { checked: 5, not_verifiable: ["Classic Monks"], changed: [{ name: "WordPress", modified: ["wp-includes/version.php"], missing: [], added: ["wp-admin/x-shell.php"] }] },
          notes: [],
        },
        {
          site_id: 3,
          checked_at: now - 3 * 3600,
          vulnerabilities: [],
          abandoned: [{ id: "hello-dolly/hello.php", name: "Hello Dolly", version: "1.7.2", last_updated: null, closed: true, reason: "author-request" }],
          checksums: null,
          notes: ["Checksums need the WP Sites HQ plugin, Classic Monks or Classic Monks Pro on the site."],
        },
        { site_id: 6, checked_at: now - 2 * 3600, vulnerabilities: [], abandoned: [], checksums: { checked: 3, not_verifiable: [], changed: [] }, notes: [] },
      ];

// Monitoring: home pages every 5 minutes, certificates, domains, PageSpeed.
const LOCAL_NOTE = "A local address: there's no domain to renew and PageSpeed can't reach it.";
const monitor = (site_id: number, over: Partial<Monitor> = {}): Monitor => ({
  site_id,
  public: false,
  checked_at: now - 90,
  up: true,
  status: 200,
  ms: 640,
  error: "",
  down_since: null,
  uptime_day: 100,
  uptime_month: 99.93,
  day: dayOf(site_id, over),
  cert_expires: now + 86400 * 61,
  domain: null,
  domain_expires: null,
  domain_note: LOCAL_NOTE,
  pagespeed: null,
  ...over,
});
// 24 hourly points around the site's response time, wobbling a little; a down site's last hours are down.
function dayOf(id: number, over: Partial<Monitor>): Monitor["day"] {
  if (over.uptime_day === null) return Array(24).fill(null);
  const base = over.up === false ? 520 : (over.ms ?? 640);
  const downFrom = over.up === false ? 22 : over.uptime_day != null && over.uptime_day < 100 ? 23 : 24;
  return Array.from({ length: 24 }, (_, h) => (h >= downFrom ? { ms: null, up: false } : { ms: Math.round(base * (1 + 0.05 * Math.sin(h * 0.6 + id) + 0.03 * Math.sin(h * 2.1 + id * 3))), up: true }));
}

let MONITORS: Monitor[] =
  fixture === "empty"
    ? []
    : [
        monitor(1, { ms: 412 }),
        monitor(2, { up: false, status: 0, ms: 20000, error: "The site didn't answer within 20 seconds.", down_since: now - 1500, uptime_day: 91.67, uptime_month: 99.42 }),
        monitor(3, { ms: 705, cert_expires: now + 86400 * 12 }),
        monitor(4, { checked_at: null, up: null, uptime_day: null, uptime_month: null, cert_expires: null, domain_note: "" }),
        monitor(5, { ms: 530 }),
        monitor(6, {
          public: true,
          ms: 4210,
          uptime_day: 98.96,
          domain: "portfolio.example.com",
          domain_expires: now + 86400 * 23,
          domain_note: "",
          pagespeed: { score: 72, lcp: "3.1 s", cls: "0.04", tbt: "180 ms", at: now - 86400 },
        }),
      ];

// ?fixture=fleet300: the fleet repeated to 300 sites, to check every list stays quick at that size.
if (fixture === "fleet300") {
  const n = FLEET.length;
  sites = Array.from({ length: 300 }, (_, i) => ({ ...FLEET[i % n], id: i + 1, name: `${FLEET[i % n].name} ${i + 1}`, url: `https://site-${i + 1}.local`, group: `Group ${i % 12}` }));
  inventory = sites.map((s, i) => ({ ...inventory[i % inventory.length], site_id: s.id }));
  MONITORS = sites.map((s, i) => ({ ...MONITORS[i % MONITORS.length], site_id: s.id }));
}

const listeners: Array<() => void> = [];
const progress: Array<(e: { payload: unknown }) => void> = [];
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
    case "site_icon": {
      const s = sites.find((x) => x.id === id);
      return r(s?.icon ? iconFor(s) : null);
    }
    case "package_icons":
      return r(Object.fromEntries(Object.keys(PACKAGE_ICONS).map((k) => [k, 1])));
    case "package_icon":
      return r(PACKAGE_ICONS[`${args.kind}/${args.slug}`] ?? null);
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
      return r({ signed_out: true, message: "Removed. WP Sites HQ signed out on the site." });
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
    case "content_acf": {
      if (args.postId !== 26) return r({ post_id: args.postId, groups: [], refs: {} });
      const pic = (id: number) => MEDIA.find((m) => m.id === id)!;
      const ref = (id: number) => ({ title: pic(id).title, url: pic(id).url, thumbnail: pic(id).url, mime_type: pic(id).mime });
      return r({
        post_id: 26,
        groups: [{ key: "group_monks_test_fields", title: "Monks test fields", fields: ACF }],
        refs: { media: { 31: ref(31), 32: ref(32) }, posts: { 21: { title: "Autumn opening hours", type: "post" }, 11: { title: "Our menu", type: "page" } }, terms: { 1: { name: "Uncategorized" } }, users: { 1: { name: "Joy Chetry" } } },
      });
    }
    case "content_acf_save": {
      await new Promise((ok) => setTimeout(ok, 300));
      const sent = args.fields as Record<string, unknown>;
      const mail = sent.field_monks_test_fields_email;
      if (typeof mail === "string" && mail.endsWith("@")) return Promise.reject(`Email: '${mail}' is not a valid email address`);
      ACF = ACF.map((f) => (f.key in sent ? { ...f, value: sent[f.key] } : f));
      return r({ values: sent, undo: 77 });
    }
    case "app_settings_get":
      return r(APP);
    case "app_update_status":
    case "app_update_check":
      return r({
        current: "0.1.0",
        checked_at: Math.floor(Date.now() / 1000) - 600,
        found: fixture === "update" ? { version: "0.2.0", notes: "### Media\n- Grid and list views.\n- Upload several files at once.", date: 1761696000 } : null,
        ready: false,
        progress: null,
      });
    case "app_update_install":
      return r(false);
    case "app_settings_save":
      APP = args.settings as AppSettings;
      GSC = { ...GSC, on: APP.search_console };
      return r(APP);
    case "gsc_status":
      return r(GSC);
    case "gsc_set_client":
      GSC = { ...GSC, client: true };
      return r(GSC);
    case "gsc_connect":
      await new Promise((ok) => setTimeout(ok, 300));
      GSC = { ...GSC, connected: true };
      return r(GSC);
    case "gsc_forget":
      GSC = { ...GSC, client: false, connected: false };
      return r(GSC);
    case "report_make": {
      await new Promise((ok) => setTimeout(ok, 400));
      const ask = args.ask as ReportAsk;
      const own = ask.site_ids.length ? sites.filter((s) => ask.site_ids.includes(s.id)) : sites.filter((s) => s.client_id === ask.client_id);
      const who = CLIENTS.find((c) => c.id === ask.client_id)?.name ?? "Website report";
      const preview = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${who}</title><style>body{font:15px/1.5 system-ui;max-width:760px;margin:40px auto;padding:0 24px;color:#1b1b1b}h2{color:#1f6feb;border-top:2px solid #1f6feb;padding-top:16px}dl{display:grid;grid-template-columns:200px 1fr}dt{color:#555}dd{margin:0}</style></head><body><p style="color:#1f6feb;font-weight:600">Studio North</p><h1>${who}: ${ask.month}</h1>${own
        .map((s) => `<h2>${s.name}</h2><p>${s.url}</p><dl><dt>Uptime</dt><dd>99.95% (2,880 checks)</dd><dt>Changes made</dt><dd>6</dd><dt>Security</dt><dd>No known problems</dd></dl><h3>Work done</h3><ul><li>Update WooCommerce to 10.3.0</li><li>Publish “Autumn menu”</li></ul>`)
        .join("")}<footer>hello@studio-north.test. Made with WP Sites HQ</footer></body></html>`;
      const stem = who.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      return r({ html: `/home/you/Downloads/${stem}-report-${ask.month}.html`, pdf: `/home/you/Downloads/${stem}-report-${ask.month}.pdf`, preview, sites: own.length, notes: ["Corner Bakery: store: The site didn't answer within 20 seconds."] });
    }
    case "file_open":
      return r(null);
    case "store_overview":
      return r({
        currency: "EUR", from: "2026-09-28", to: "2026-10-28", orders: 214, revenue: "6420.50", average_order: "30.00",
        by_status: { completed: 205, processing: 6, refunded: 3 }, low_stock: [{ id: 62, name: "Rye loaf", stock_quantity: 2 }], out_of_stock: 1, processing: 6,
      });
    case "store_products": {
      const q = args.query as { search?: string; stock_status?: string };
      const list = PRODUCTS.filter((p) => (!q.search || p.name.toLowerCase().includes(q.search.toLowerCase())) && (!q.stock_status || p.stock_status === q.stock_status));
      return r({ products: list, total: list.length, pages: 1, currency: "EUR" });
    }
    case "cm_reports":
      await new Promise((ok) => setTimeout(ok, 150));
      return r({
        not_found: { count: 3, urls: [
          { id: 1, url: "/old-menu", hits: 41, last_seen: "2026-10-27 18:02", status: "new", referrer: "https://www.google.com/" },
          { id: 2, url: "/wp-content/uploads/2023/05/cake.jpg", hits: 9, last_seen: "2026-10-26 08:15", status: "new", referrer: "" },
        ] },
        searches: { total_searches: 182, zero_result_searches: 14, top_searches: [{ query: "gluten free", searches: 38 }, { query: "opening hours", searches: 22 }], zero_result_queries: [{ query: "vegan cake", searches: 6 }] },
        unused_media: { has_results: true, scanned_at: "2026-10-20 09:00", counts: { unused: 27, used: 340 }, listed_size: 48_200_000, items: [] },
        logins: { lockdown_enabled: true, period: { attempts: 96, lockouts: 4 }, top_ips: [{ value: "203.0.113.9", attempts: 61 }], top_usernames: [{ value: "admin", attempts: 70 }] },
        two_factor: { stats: { total_users: 6, users_with_2fa: 4 }, enforcement: { enabled: true, roles: ["administrator"] }, roles: [{ role: "administrator", users: 2, with_2fa: 2, enforced: true }, { role: "editor", users: 4, with_2fa: 2, enforced: false }] },
        failed: [],
      });
    case "content_search": {
      await new Promise((ok) => setTimeout(ok, 200));
      const q = (args.query as string).toLowerCase();
      const own = POSTS.filter((p) => p.post_type !== "product" && p.status !== "trash" && p.title.toLowerCase().includes(q));
      const hits = [1, 6].flatMap((site_id) => own.map((p) => ({ site_id, post_type: p.post_type, id: p.id, title: p.title, status: p.status, link: p.link })));
      return r({ hits, failed: [[2, "The site didn't answer within 20 seconds."]] });
    }
    case "bundles_list":
      return r(BUNDLES);
    case "bundle_save": {
      const b = args.bundle as Bundle;
      const saved = { ...b, id: b.id || BUNDLES.length + 1 };
      BUNDLES = [...BUNDLES.filter((x) => x.id !== saved.id), saved];
      return r(saved);
    }
    case "bundle_delete":
      BUNDLES = BUNDLES.filter((b) => b.id !== id);
      return r(null);
    case "zip_stage":
      await new Promise((ok) => setTimeout(ok, 200));
      return r({ file: `${"a".repeat(64)}.zip`, name: args.name, size: 2_400_000 });
    case "clients_list":
      return r(CLIENTS);
    case "client_save": {
      const c = args.client as Client;
      const saved = { ...c, id: c.id || CLIENTS.length + 1 };
      CLIENTS = [...CLIENTS.filter((x) => x.id !== saved.id), saved];
      return r(saved);
    }
    case "client_delete":
      CLIENTS = CLIENTS.filter((c) => c.id !== id);
      return r(null);
    case "site_set_client":
      edit(id, { client_id: args.client as number | null, client: CLIENTS.find((c) => c.id === args.client)?.name ?? null });
      return r(null);
    case "costs_list":
      return r(COSTS);
    case "cost_save": {
      const c = args.cost as Cost;
      const saved = { ...c, id: c.id || COSTS.length + 1 };
      COSTS = [...COSTS.filter((x) => x.id !== saved.id), saved];
      return r(saved);
    }
    case "cost_delete":
      COSTS = COSTS.filter((c) => c.id !== id);
      return r(null);
    case "sites_export":
      return r(`/home/you/Downloads/wp-sites-hq-sites-2026-10-28.${args.csv ? "csv" : "json"}`);
    case "sites_import":
      return r({ sites: 2, clients: 1, costs: 3, not_connected: ["https://old-shop.example"] });
    case "file_show":
      return r(null);
    case "content_revisions":
      return r([
        { id: 81, date: "2026-10-27 15:42:00", author: "Joy", title: "Our menu" },
        { id: 80, date: "2026-10-20 09:10:00", author: "Sam Okafor", title: "Menu" },
      ]);
    case "content_restore_revision":
      return r("Restored the revision.");
    case "content_untrash":
      return r("draft");
    case "media_list": {
      const q = args.query as { page?: number; search?: string; kind?: string; month?: string };
      const list = MEDIA.filter((m) => !TRASHED.includes(m.id) && m.mime.startsWith(q.kind ?? "") && m.date.startsWith(q.month ?? "") && m.title.includes(q.search ?? ""));
      const page = q.page ?? 1;
      return r({ items: list.slice((page - 1) * 30, page * 30), total: list.length, allowed: { "jpg|jpeg|jpe": "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf", mp4: "video/mp4" }, limit: 64 * 1024 * 1024 });
    }
    case "media_get":
      return r({ ...MEDIA.find((m) => m.id === args.mediaId), usage: args.mediaId === 31 ? 3 : 0 });
    case "media_upload": {
      const name = args.name as string;
      const d = args.details as { alt?: string; title?: string; caption?: string };
      await sendSteps(args.key as string, 300_000);
      const ext = name.split(".").pop() ?? "jpg";
      const m = media(Math.max(...MEDIA.map((x) => x.id)) + 1, d.title || name.replace(/\.[^.]+$/, ""), swatch("#9bb59a"), ext === "pdf" ? "application/pdf" : `image/${ext === "jpg" ? "jpeg" : ext}`, d.alt ?? "", "2026-10-29 10:00:00", { caption: d.caption ?? "", file_name: name, size: 300_000 });
      MEDIA = [m, ...MEDIA];
      return r(m);
    }
    case "media_replace": {
      await sendSteps(args.key as string, 500_000);
      MEDIA = MEDIA.map((m) => (m.id === args.mediaId ? { ...m, size: 500_000, url: args.keepName ? m.url.replace(/[^/]*$/, args.name as string) : m.url } : m));
      return r(MEDIA.find((m) => m.id === args.mediaId));
    }
    case "media_stop":
      STOPS.add(args.key as string);
      return r(null);
    case "media_update":
      MEDIA = MEDIA.map((m) => (m.id === args.mediaId ? { ...m, ...(args.details as Partial<Media>) } : m));
      return r(MEDIA.find((m) => m.id === args.mediaId));
    case "media_restore_file":
      MEDIA = MEDIA.map((m) => (m.id === args.mediaId ? { ...m, size: 284_000 } : m));
      return r(MEDIA.find((m) => m.id === args.mediaId));
    case "media_trash": {
      const ids = args.ids as number[];
      TRASHED = args.back ? TRASHED.filter((i) => !ids.includes(i)) : [...TRASHED, ...ids];
      return r({ done: ids, skipped: [] });
    }
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
      ACTIVITY = [{ id: 42, time: "2026-10-28 10:00:00", who: "WP Sites HQ", tool: "update-features", status: "ok", summary: "", can_undo: true }, ...ACTIVITY];
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
    case "plans_waiting":
      return r(PLANS);
    case "plan_confirm": {
      const plan = PLANS.find((p) => p.id === id)!;
      PLANS = PLANS.filter((p) => p.id !== id);
      return r(startJob(plan.title, plan.items.map((i) => ({ site_id: i.site_id!, action: i.action }))));
    }
    case "plan_decline":
      PLANS = PLANS.filter((p) => p.id !== id);
      changed();
      return r(null);
    case "agent_access_on":
      await new Promise((ok) => setTimeout(ok, 300));
      return r(edit(id, { agent_access: true }));
    case "agent_access_off":
      return r(edit(id, { agent_access: false }));
    case "activity_list":
      return r(args.before ? [] : ENTRIES);
    case "security_list":
      return r(SECURITY);
    case "security_scan":
      await new Promise((ok) => setTimeout(ok, 300));
      return r(null);
    case "link_open":
      return r(null);
    case "plugin_download":
      await new Promise((ok) => setTimeout(ok, 300));
      return r({ version: "1.2.0", path: "/home/joy/Downloads/wp-sites-hq-1.2.0.zip" });
    case "site_connect_plugin": {
      const s = sites.find((x) => x.id === id)!;
      Object.assign(s, { mode: "classic_monks", cm_version: "1.2.0", capabilities: { ...FLEET[0].capabilities, plugin: { name: "WP Sites HQ", version: "1.2.0" } } });
      return r({ ...s });
    }
    case "monitors_list":
      return r(MONITORS);
    case "monitors_check":
      await new Promise((ok) => setTimeout(ok, 300));
      return r(null);
    case "pagespeed_run": {
      await new Promise((ok) => setTimeout(ok, 300));
      const ps = { score: 81, lcp: "2.2 s", cls: "0.02", tbt: "90 ms", at: now };
      MONITORS = MONITORS.map((m) => (m.site_id === id ? { ...m, pagespeed: ps } : m));
      changed();
      return r(ps);
    }
    default:
      // Adding and signing in need a real site.
      return new Promise<T>(() => {});
  }
}

export async function listen(event: string, f: (e: { payload: unknown }) => void) {
  const to = event === "media-progress" ? progress : listeners;
  to.push(f as () => void);
  return () => to.splice(to.indexOf(f as () => void), 1);
}
