// Typed calls to the core through Tauri commands (the window is the operator).
import { useCallback, useEffect, useState } from "react";
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
};

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

/** What the status column says about a site. */
export function siteStatus(s: Site): { tone: Tone; label: string } {
  if (s.sign_in_again) return { tone: "warning", label: "Sign in again" };
  switch (s.health) {
    case "ok":
      return { tone: "ok", label: "Healthy" };
    case "warning":
      return { tone: "warning", label: "Needs a look" };
    case "down":
      return { tone: "danger", label: "Down" };
    default:
      return { tone: "unknown", label: "Not checked" };
  }
}

export function connectionLabel(s: Site): string {
  if (s.mode === "basic") return "Basic mode";
  if (s.capabilities.degraded === true) return "Classic Monks (update it)";
  return s.capabilities.operator === true ? "Classic Monks, operator" : "Classic Monks";
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
