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
};

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
  | { do: "update_translations" };

export type Change = { site_id: number; action: Action };

export type JobItem = {
  id: number;
  site_id: number | null;
  site_name: string;
  action: Action;
  label: string;
  from_version: string | null;
  to_version: string | null;
  state: "waiting" | "running" | "done" | "failed";
  message: string;
};

export type Job = { id: number; title: string; created_at: number; finished_at: number | null; items: JobItem[] };

export type Found = { slug: string; name: string; version: string; active_installs: number; summary: string };

export type PluginVersions = { installed?: string; versions?: { version: string; current?: boolean }[]; notice?: string };

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
  startJob: (title: string, changes: Change[]) => invoke<Job>("job_start", { title, changes }),
  job: (id: number) => invoke<Job>("job_get", { id }),
};

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

/** What every site runs, by site id. */
export function useInventory() {
  const { data, error, reload } = useLive(api.inventory, "inventory-changed");
  const byId = useMemo(() => new Map((data ?? []).map((i) => [i.site_id, i])), [data]);
  return { inventory: data ? byId : null, error, reload };
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
};
const BASIC: Action["do"][] = ["activate_plugin", "deactivate_plugin", "delete_plugin", "install_plugin"];

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
