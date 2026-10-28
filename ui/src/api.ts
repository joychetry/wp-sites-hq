// SPDX-License-Identifier: GPL-3.0-or-later
// Typed calls to the core through Tauri commands (the window is the operator).
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type CoreStatus = {
  version: string;
  pid: number;
  role: "operator" | "agent";
  headless: boolean;
  home: string;
};

export type Health = "unknown" | "ok" | "warning" | "down";

export type Note = { id: number; body: string; added_at: number };

export type Site = {
  id: number;
  url: string;
  name: string;
  mode: "classic_monks" | "basic";
  api_url: string;
  username: string | null;
  wp_version: string | null;
  php_version: string | null;
  cm_version: string | null;
  capabilities: Record<string, unknown>;
  sign_in_again: boolean;
  health: Health;
  health_detail: string;
  checked_at: number | null;
  group: string | null;
  tags: string[];
  notes: Note[];
  added_at: number;
  /** AI agents may change this site, each change approved on the site. */
  agent_access: boolean;
  client_id: number | null;
  client: string | null;
};

export type Client = { id: number; name: string; email: string; notes: string };
export type Every = "month" | "year" | "once";
/** A cost (hosting, a domain, a licence) or a charge (what the client pays), in cents. */
export type Cost = {
  id: number;
  site_id: number | null;
  client_id: number | null;
  kind: "cost" | "charge";
  label: string;
  cents: number;
  currency: string;
  every: Every;
  renews_on: string | null;
};
export type AppSettings = {
  report_name: string;
  report_footer: string;
  report_accent: string;
  white_label: boolean;
  search_console: boolean;
  agentedseo: boolean;
};
export type BundlePlugin = { source: string; name: string };
export type Bundle = { id: number; name: string; plugins: BundlePlugin[] };
/** A zip kept in Monks Central for an install job. */
export type Staged = { file: string; name: string; size: number };
export type ContentHit = { site_id: number; post_type: string; id: number; title: string; status: string; link: string };
export type ContentFound = { hits: ContentHit[]; failed: [number, string][] };
export type Product = {
  id: number;
  name: string;
  type: string;
  status: string;
  sku: string;
  price: string;
  regular_price: string;
  sale_price: string;
  stock_status: string;
  manage_stock: boolean;
  stock_quantity: number | null;
  permalink: string;
};
export type Products = { products: Product[]; total: number; pages: number; currency: string };
export type ProductQuery = { search?: string; status?: string; stock_status?: string; page?: number };
export type StoreOverview = {
  currency: string;
  from: string;
  to: string;
  orders: number;
  revenue: string;
  average_order: string;
  by_status: Record<string, number>;
  low_stock: { id: number; name: string; stock_quantity: number }[];
  out_of_stock: number;
  processing: number;
};
type Count = { value: string; attempts: number };
/** Classic Monks' own reports, as the site gives them; null when it hasn't that report. */
export type CmReports = {
  not_found: { count: number; urls: { id: number; url: string; hits: number; last_seen: string; status: string; referrer: string }[] } | null;
  searches: { total_searches: number; zero_result_searches: number; top_searches: { query: string; searches: number }[]; zero_result_queries: { query: string; searches: number }[] } | null;
  unused_media: { has_results: boolean; scanned_at: string; counts: Record<string, number>; listed_size: number; items: { id: number; title: string; filename: string; size: number }[] } | null;
  logins: { lockdown_enabled: boolean; period: Record<string, number>; top_ips: Count[]; top_usernames: Count[] } | null;
  two_factor: { stats: { total_users: number; users_with_2fa: number }; enforcement: { enabled: boolean; roles: string[] }; roles: { role: string; users: number; with_2fa: number; enforced: boolean }[] } | null;
  failed: [string, string][];
};
export type ReportAsk = { client_id: number | null; site_ids: number[]; month: string };
export type SavedReport = { html: string; pdf: string; preview: string; sites: number; notes: string[] };
export type GscStatus = { on: boolean; client: boolean; connected: boolean };
export type Imported = { sites: number; clients: number; costs: number; not_connected: string[] };

export type Removed = { signed_out: boolean; message: string };

/** One plugin or theme on one site. `id` is the plugin file or the theme folder. */
export type Item = {
  id: string;
  name: string;
  version: string;
  active: boolean;
  auto_update: boolean | null;
  update: string | null;
};

export type Inventory = {
  wordpress: string | null;
  wordpress_update: string | null;
  plugins: Item[];
  themes: Item[];
  translations: number;
  updates_known: boolean;
  needs_credentials: boolean;
};

export type SiteInventory = { site_id: number; fetched_at: number; inventory: Inventory };

/** A change to one site, as the core runs it. */
export type Action =
  | { do: "update_plugin"; plugin: string }
  | { do: "rollback_plugin"; plugin: string; version: string }
  | { do: "activate_plugin"; plugin: string }
  | { do: "deactivate_plugin"; plugin: string }
  | { do: "delete_plugin"; plugin: string }
  | { do: "auto_update_plugin"; plugin: string; on: boolean }
  | { do: "install_plugin"; source: string; activate: boolean }
  | { do: "update_theme"; theme: string }
  | { do: "activate_theme"; theme: string }
  | { do: "delete_theme"; theme: string }
  | { do: "update_core" }
  | { do: "update_translations" }
  | { do: "install_zip"; file: string; name: string; kind: "plugin" | "theme"; activate: boolean; overwrite: boolean }
  | { do: "publish_post"; post_type: string; title: string; body: string; status: string; date?: string; terms?: Record<string, string[]> }
  | { do: "set_post_status"; post_type: string; post_id: number; title: string; status: string }
  | { do: "trash_post"; post_type: string; post_id: number; title: string }
  | { do: "untrash_post"; post_type: string; post_id: number; title: string }
  | { do: "update_product"; product_id: number; name: string; regular_price?: string; sale_price?: string; stock_quantity?: number };

export type Change = { site_id: number; action: Action };

export type JobItem = {
  id: number;
  site_id: number | null;
  site_name: string;
  action: Action;
  label: string;
  from_version: string | null;
  to_version: string | null;
  state: "waiting" | "running" | "done" | "failed" | "rolled_back";
  message: string;
};

export type Job = {
  id: number;
  title: string;
  created_at: number;
  finished_at: number | null;
  /** "agent" for a plan an AI agent proposed; it runs only after you confirm it. */
  proposed_by: "human" | "agent";
  confirmed_at: number | null;
  declined_at: number | null;
  /** An agent's plan nobody answered within 7 days. It never runs; you can only remove it. */
  expired: boolean;
  items: JobItem[];
};

/** Who started something done through Monks Central. */
export type Actor = "human" | "agent" | "agent_confirmed";
export type Entry = {
  id: number;
  at: number;
  actor: Actor;
  site_id: number | null;
  site_name: string;
  what: string;
  outcome: "done" | "failed" | "refused" | "waiting";
  detail: string;
};

export type Vulnerability = {
  kind: "plugin" | "theme" | "wordpress";
  id: string;
  name: string;
  installed: string;
  title: string;
  severity: string | null;
  fixed_in: string | null;
  link: string | null;
};
export type Abandoned = { id: string; name: string; version: string; last_updated: number | null; closed: boolean; reason: string | null };
export type Differs = { name: string; modified: string[]; missing: string[]; added: string[] };
export type SecurityReport = {
  site_id: number;
  checked_at: number;
  vulnerabilities: Vulnerability[];
  abandoned: Abandoned[];
  checksums: { checked: number; not_verifiable: string[]; changed: Differs[] } | null;
  notes: string[];
};

export type PageSpeed = { score: number; lcp: string; cls: string; tbt: string; at: number };
export type Monitor = {
  site_id: number;
  public: boolean;
  checked_at: number | null;
  up: boolean | null;
  status: number;
  ms: number;
  error: string;
  down_since: number | null;
  uptime_day: number | null;
  uptime_month: number | null;
  cert_expires: number | null;
  domain: string | null;
  domain_expires: number | null;
  domain_note: string;
  pagespeed: PageSpeed | null;
};

export type Found = { slug: string; name: string; version: string; active_installs: number; summary: string };

export type PluginVersions = { installed?: string; versions?: { version: string; current?: boolean }[]; notice?: string };

export type Taxonomy = { name: string; label: string; hierarchical: boolean; can_add: boolean; rest_base: string };

export type PostType = {
  name: string;
  label: string;
  singular: string;
  hierarchical: boolean;
  supports: string[];
  can_publish: boolean;
  can_delete: boolean;
  taxonomies: Taxonomy[];
  rest_base: string;
};

export type Summary = { id: number; title: string; status: string; date: string; modified: string; author: string; link: string };
export type Listing = { posts: Summary[]; total: number; page: number; pages: number };
export type Query = { post_type: string; status?: string; search?: string; page?: number };
export type Term = { id: number; name: string };

/** One block of a body. Editable blocks carry their text as HTML; others a short preview. */
export type Block = { index: number; name: string; depth: number; editable: boolean; html: string };

export type Post = {
  id: number;
  post_type: string;
  title: string;
  status: string;
  date: string;
  modified: string;
  link: string;
  featured_image: number;
  featured_url: string | null;
  terms: Record<string, Term[]>;
  /** Custom fields without an underscore (Classic Monks only). */
  meta: Record<string, unknown>;
  builder: string | null;
  blocks: Block[];
  locked: string | null;
};

/** A term picked by id, or typed by name (the site adds it). */
export type TermRef = number | string;

export type Draft = {
  title?: string;
  status?: string;
  terms?: Record<string, TermRef[]>;
  featured_image?: number;
  body?: string;
  edits?: { index: number; html: string }[];
  seen_modified?: string;
  /** "2026-11-02 09:30:00" in the site's time zone; a future date with publish schedules it. */
  date?: string;
  /** Custom fields to set; null removes one. */
  meta?: Record<string, unknown>;
};

export type Revision = { id: number; date: string; author: string; title: string };

export type Media = { id: number; title: string; url: string; mime: string; alt: string; date: string };

export type User = { id: number; username: string; email: string; name: string; role: string; registered: string };
export type Role = { id: string; name: string };
export type Users = { users: User[]; total: number; roles: Role[]; can_reset: boolean };
export type NewUser = { username: string; email: string; role: string };

export type CommentState = "pending" | "approved" | "spam" | "trash";
export type Comment = {
  id: number;
  post_id: number;
  post_title: string;
  author: string;
  email: string;
  content: string;
  date: string;
  status: CommentState;
  parent: number;
};
export type Comments = { comments: Comment[]; total: number };
export type Moderation = "approve" | "unapprove" | "spam" | "trash";

export type Toggle = { name: string; label: string; description: string; section: string; on: boolean; locked: boolean };
export type FeatureGroup = { key: string; label: string; toggles: Toggle[] };
export type Setting = {
  name: string;
  label: string;
  description: string;
  tab: string;
  section: string;
  control: string;
  options: string[];
  min: number | null;
  max: number | null;
  step: number | null;
  value: unknown;
};
export type ActivityRow = { id: number; time: string; who: string; tool: string; status: string; summary: string; can_undo: boolean };
export type Activity = { rows: ActivityRow[]; total: number; page: number; pages: number };
export type Approval = { id: number; tool: string; who: string; time: string; expires_in: number };

export const api = {
  status: () => invoke<CoreStatus>("core_status"),
  sites: () => invoke<Site[]>("sites_list"),
  addOAuth: (url: string) => invoke<Site>("site_add_oauth", { url }),
  addBasic: (url: string, username: string, password: string) =>
    invoke<Site>("site_add_basic", { url, username, password }),
  cancelSignIn: () => invoke<void>("sign_in_cancel"),
  signInAgain: (id: number, username?: string, password?: string) =>
    invoke<Site>("site_sign_in_again", { id, username, password }),
  remove: (id: number) => invoke<Removed>("site_remove", { id }),
  check: (id?: number) => invoke<void>("site_check", { id }),
  open: (id: number) => invoke<void>("site_open", { id }),
  setGroup: (id: number, group: string | null) => invoke<Site>("site_set_group", { id, group }),
  setTags: (id: number, tags: string[]) => invoke<Site>("site_set_tags", { id, tags }),
  addNote: (id: number, body: string) => invoke<Site>("site_add_note", { id, body }),
  deleteNote: (id: number, noteId: number) => invoke<Site>("site_delete_note", { id, noteId }),
  inventory: () => invoke<SiteInventory[]>("inventory_list"),
  refreshInventory: (id?: number) => invoke<void>("inventory_refresh", { id }),
  pluginVersions: (id: number, plugin: string) => invoke<PluginVersions>("plugin_versions", { id, plugin }),
  searchPlugins: (query: string) => invoke<Found[]>("plugin_search", { query }),
  security: () => invoke<SecurityReport[]>("security_list"),
  scanSecurity: (id?: number) => invoke<void>("security_scan", { id }),
  monitors: () => invoke<Monitor[]>("monitors_list"),
  checkMonitors: () => invoke<void>("monitors_check"),
  pageSpeed: (id: number) => invoke<PageSpeed>("pagespeed_run", { id }),
  /** Opens an https link from a feed in the browser. */
  /** `site`: the link came from that site, so it must point at it. */
  openLink: (url: string, site?: number) => invoke<void>("link_open", { url, site }),
  startJob: (title: string, changes: Change[]) => invoke<Job>("job_start", { title, changes }),
  job: (id: number) => invoke<Job>("job_get", { id }),
  postTypes: (id: number) => invoke<PostType[]>("content_types", { id }),
  posts: (id: number, query: Query) => invoke<Listing>("content_list", { id, query }),
  post: (id: number, postType: string, postId: number) => invoke<Post>("content_get", { id, postType, postId }),
  terms: (id: number, taxonomy: string, search = "") => invoke<Term[]>("content_terms", { id, taxonomy, search }),
  createPost: (id: number, postType: string, draft: Draft) => invoke<Post>("content_create", { id, postType, draft }),
  editPost: (id: number, postType: string, postId: number, draft: Draft) =>
    invoke<Post>("content_edit", { id, postType, postId, draft }),
  trashPost: (id: number, postType: string, postId: number) => invoke<void>("content_trash", { id, postType, postId }),
  revisions: (id: number, postId: number) => invoke<Revision[]>("content_revisions", { id, postId }),
  restoreRevision: (id: number, postId: number, revisionId: number) =>
    invoke<string>("content_restore_revision", { id, postId, revisionId }),
  untrash: (id: number, postId: number) => invoke<string>("content_untrash", { id, postId }),
  media: (id: number, page: number, search: string, images: boolean) => invoke<Media[]>("media_list", { id, page, search, images }),
  importMedia: (id: number, url: string, alt: string) => invoke<Media>("media_import", { id, url, alt }),
  users: (id: number, search: string, page = 1) => invoke<Users>("users_list", { id, search, page }),
  createUser: (id: number, user: NewUser) => invoke<User>("user_create", { id, user }),
  setRole: (id: number, userId: number, role: string) => invoke<void>("user_set_role", { id, userId, role }),
  deleteUser: (id: number, userId: number, reassign: number) => invoke<void>("user_delete", { id, userId, reassign }),
  sendReset: (id: number, userId: number) => invoke<string>("user_reset", { id, userId }),
  comments: (id: number, status: CommentState) => invoke<Comments>("comments_list", { id, status }),
  moderate: (id: number, commentId: number, action: Moderation) => invoke<void>("comment_moderate", { id, commentId, action }),
  reply: (id: number, commentId: number, postId: number, text: string) => invoke<void>("comment_reply", { id, commentId, postId, text }),
  login: (id: number) => invoke<void>("site_login", { id }),
  features: (id: number) => invoke<FeatureGroup[]>("cm_features", { id }),
  setFeature: (id: number, name: string, on: boolean) => invoke<number | null>("cm_set_feature", { id, name, on }),
  settings: (id: number) => invoke<Setting[]>("cm_settings", { id }),
  setSetting: (id: number, name: string, value: unknown) => invoke<number | null>("cm_set_setting", { id, name, value }),
  activity: (id: number, page: number) => invoke<Activity>("cm_activity", { id, page }),
  undo: (id: number, row: number) => invoke<void>("cm_undo", { id, row }),
  approvals: (id: number) => invoke<Approval[]>("cm_approvals", { id }),
  openApproval: (id: number, op: number) => invoke<void>("cm_approval_open", { id, op }),
  agentAccessOn: (id: number) => invoke<Site>("agent_access_on", { id }),
  agentAccessOff: (id: number) => invoke<Site>("agent_access_off", { id }),
  plansWaiting: () => invoke<Job[]>("plans_waiting"),
  confirmPlan: (id: number) => invoke<Job>("plan_confirm", { id }),
  declinePlan: (id: number) => invoke<Job>("plan_decline", { id }),
  activityLog: (before?: number) => invoke<Entry[]>("activity_list", { before }),
  clients: () => invoke<Client[]>("clients_list"),
  saveClient: (client: Client) => invoke<Client>("client_save", { client }),
  deleteClient: (id: number) => invoke<void>("client_delete", { id }),
  setClient: (id: number, client: number | null) => invoke<void>("site_set_client", { id, client }),
  costs: () => invoke<Cost[]>("costs_list"),
  saveCost: (cost: Cost) => invoke<Cost>("cost_save", { cost }),
  deleteCost: (id: number) => invoke<void>("cost_delete", { id }),
  appSettings: () => invoke<AppSettings>("app_settings_get"),
  /** The newer version on GitHub Releases, or null when this one is the newest. */
  updateCheck: () => invoke<string | null>("app_update_check"),
  /** Downloads, checks the signature, installs and restarts. */
  updateInstall: () => invoke<void>("app_update_install"),
  saveAppSettings: (settings: AppSettings) => invoke<AppSettings>("app_settings_save", { settings }),
  /** Saves into Downloads; returns the file's path. */
  exportSites: (csv: boolean) => invoke<string>("sites_export", { csv }),
  importSites: (text: string) => invoke<Imported>("sites_import", { text }),
  showFile: (path: string) => invoke<void>("file_show", { path }),
  bundles: () => invoke<Bundle[]>("bundles_list"),
  saveBundle: (bundle: Bundle) => invoke<Bundle>("bundle_save", { bundle }),
  deleteBundle: (id: number) => invoke<void>("bundle_delete", { id }),
  /** `data` is the file as base64. */
  stageZip: (name: string, data: string) => invoke<Staged>("zip_stage", { name, data }),
  searchContent: (query: string) => invoke<ContentFound>("content_search", { query }),
  products: (id: number, query: ProductQuery) => invoke<Products>("store_products", { id, query }),
  storeOverview: (id: number, days: number) => invoke<StoreOverview>("store_overview", { id, days }),
  cmReports: (id: number, days: number) => invoke<CmReports>("cm_reports", { id, days }),
  makeReport: (ask: ReportAsk) => invoke<SavedReport>("report_make", { ask }),
  openFile: (path: string) => invoke<void>("file_open", { path }),
  gscStatus: () => invoke<GscStatus>("gsc_status"),
  gscSetClient: (id: string, secret: string) => invoke<GscStatus>("gsc_set_client", { id, secret }),
  gscConnect: () => invoke<GscStatus>("gsc_connect"),
  gscForget: () => invoke<GscStatus>("gsc_forget"),
};

/** Whether this site's connection has this Classic Monks tool (Basic mode has none). */
export function hasTool(s: Site, tool: string): boolean {
  const tools = s.capabilities.abilities;
  return s.mode === "classic_monks" && Array.isArray(tools) && tools.includes(tool);
}

/** Why this site's users or comments can't be managed here now, or null. Basic mode uses core REST. */
export function peopleBlocked(s: Site, tool: string): string | null {
  if (s.sign_in_again) return "Sign in again first.";
  if (noTools(s)) return "This connection has no tools. Sign in again and tick the tool groups.";
  if (s.mode === "classic_monks" && !hasTool(s, tool)) return "This connection can't do this. Sign in again and tick the user and comment tool groups.";
  return null;
}

/** Why Classic Monks itself can't be managed on this site, or null. */
export function cmBlocked(s: Site): string | null {
  if (s.mode === "basic") return "This site doesn't have Classic Monks. It's connected in Basic mode.";
  if (s.sign_in_again) return "Sign in again first.";
  if (noTools(s)) return "This connection has no tools. Sign in again and tick the tool groups.";
  if (!hasTool(s, "get-features")) return "This connection can't change Classic Monks. Sign in again and tick its tool groups.";
  return null;
}

/** Why this site's content can't be managed here now, or null. */
export function contentBlocked(s: Site): string | null {
  if (s.sign_in_again) return "Sign in again first.";
  if (noTools(s)) return "This connection has no tools. Sign in again and tick the tool groups.";
  const tools = s.capabilities.abilities;
  if (s.mode === "classic_monks" && !(Array.isArray(tools) && tools.includes("list-post-types")))
    return "Classic Monks on this site is older. Update it, then check the site, to manage its content here.";
  return null;
}

/** A list from the core, loaded again whenever `event` fires. */
function useLive<T>(load: () => Promise<T>, event: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    load().then(
      (d) => {
        setData(d);
        setError(null);
      },
      (e) => setError(String(e)),
    );
  }, [load]);
  useEffect(() => {
    reload();
    const off = listen(event, reload);
    return () => {
      off.then((f) => f()).catch(() => {});
    };
  }, [reload, event]);
  return { data, error, reload };
}

/** Every site's monitors, as last measured. */
export function useMonitors() {
  const { data } = useLive(api.monitors, "monitors-changed");
  return data;
}

/** Every site's last security scan. */
export function useSecurity() {
  const { data, error, reload } = useLive(api.security, "security-changed");
  return { reports: data, error, reload };
}

/** What every site runs, by site id. */
export function useInventory() {
  const { data, error, reload } = useLive(api.inventory, "inventory-changed");
  const byId = useMemo(() => new Map((data ?? []).map((i) => [i.site_id, i])), [data]);
  return { inventory: data ? byId : null, error, reload };
}

/** AI agents' plans waiting for you, kept fresh. */
export function usePlans() {
  const { data, error, reload } = useLive(api.plansWaiting, "jobs-changed");
  return { plans: data, error, reload };
}

/** One job, kept fresh while it runs. */
export function useJob(id: number) {
  const load = useCallback(() => api.job(id), [id]);
  const [job, setJob] = useState<Job | null>(null);
  useEffect(() => {
    const reload = () => load().then(setJob, () => {});
    reload();
    const off = listen("jobs-changed", reload);
    return () => {
      off.then((f) => f()).catch(() => {});
    };
  }, [load]);
  return job;
}

const TOOL: Record<Action["do"], string> = {
  update_plugin: "update-plugin",
  rollback_plugin: "rollback-plugin",
  activate_plugin: "activate-plugin",
  deactivate_plugin: "deactivate-plugin",
  delete_plugin: "uninstall-plugin",
  auto_update_plugin: "set-plugin-auto-update",
  install_plugin: "install-plugin",
  update_theme: "update-theme",
  activate_theme: "activate-theme",
  delete_theme: "delete-theme",
  update_core: "update-core",
  update_translations: "update-translations",
  install_zip: "install-zip",
  publish_post: "create-post",
  set_post_status: "update-post",
  trash_post: "delete-post",
  untrash_post: "untrash-post",
  update_product: "update-products",
};
const BASIC: Action["do"][] = ["activate_plugin", "deactivate_plugin", "delete_plugin", "install_plugin", "publish_post", "set_post_status", "trash_post"];

/** Whether this site's connection can make this kind of change (the core checks again). */
export function can(s: Site, what: Action["do"], tool = TOOL[what]): boolean {
  if (s.mode === "basic") return BASIC.includes(what);
  const tools = s.capabilities.abilities;
  return Array.isArray(tools) && tools.includes(tool);
}

/** Sites that can't be changed now, and why, in a few words. */
export function blocked(s: Site, inv: SiteInventory | undefined): string | null {
  if (s.sign_in_again) return "Sign in again first.";
  if (s.health === "down") return "Down when last checked. Check the site first.";
  if (noTools(s)) return "This connection has no tools. Sign in again and tick the tool groups.";
  if (!inv) return "Not read yet. Check the site.";
  return null;
}

/** Fewer than 1000 as is; then "12k", "1.2M". */
export function count(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/** Every site, kept fresh when the core says something changed. */
export function useSites() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    api.sites().then(
      (s) => {
        setSites(s);
        setError(null);
      },
      (e) => setError(String(e)),
    );
  }, []);
  useEffect(() => {
    reload();
    const off = listen("sites-changed", reload);
    return () => {
      off.then((f) => f()).catch(() => {});
    };
  }, [reload]);
  return { sites, error, reload };
}

export type Tone = "ok" | "warning" | "danger" | "unknown";

/** Connected with Classic Monks, but the sign-in ticked no tool groups, so it can't do anything. */
export function noTools(s: Site): boolean {
  const tools = s.capabilities.abilities;
  return s.mode === "classic_monks" && !s.sign_in_again && Array.isArray(tools) && tools.length === 0;
}

export const NO_TOOLS = "Connected, but this connection can't do anything yet. Sign in again and tick the tool groups.";

/** Slow is a note on a healthy site, never a warning. */
export const slow = (s: Site) => s.health === "ok" && s.health_detail.startsWith("Slow");

/** What the status column says about a site. */
export function siteStatus(s: Site): { tone: Tone; label: string } {
  if (s.sign_in_again) return { tone: "warning", label: "Sign in again" };
  if (s.health === "down") return { tone: "danger", label: "Down" };
  if (noTools(s)) return { tone: "warning", label: "No tools yet" };
  switch (s.health) {
    case "ok":
      return { tone: "ok", label: "Healthy" };
    case "warning":
      return { tone: "warning", label: "Needs a look" };
    default:
      return { tone: "unknown", label: "Not checked" };
  }
}

export function connectionLabel(s: Site): string {
  if (s.mode === "basic") return "Basic mode";
  if (noTools(s)) return "Classic Monks, no tools";
  if (s.capabilities.degraded === true) return "Classic Monks, older";
  return s.capabilities.operator === true ? "Classic Monks, full access" : "Classic Monks";
}

/** "just now", "3 min ago", "2 hr ago", "4 days ago". */
export function ago(unix: number | null, now = Date.now() / 1000): string {
  if (unix == null) return "never";
  const s = Math.max(0, now - unix);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
