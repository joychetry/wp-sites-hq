// SPDX-License-Identifier: GPL-3.0-or-later
// Each screen is its own chunk. A page's code and first data load before the click: on a nav item's
// hover or focus, and, after the first paint, the likely next pages one per idle moment.
import { lazy, type ComponentType } from "react";
import { api, peopleBlocked, warm, type Site } from "./api";

const LOAD = {
  Overview: () => import("./screens/Overview"),
  Sites: () => import("./screens/Sites"),
  Updates: () => import("./screens/Updates"),
  Matrix: () => import("./screens/Matrix"),
  Content: () => import("./screens/Content"),
  Media: () => import("./screens/Media"),
  Users: () => import("./screens/Users"),
  Comments: () => import("./screens/Comments"),
  ClassicMonks: () => import("./screens/ClassicMonks"),
  Monitoring: () => import("./screens/Monitoring"),
  Security: () => import("./screens/Security"),
  Clients: () => import("./screens/Clients"),
  Store: () => import("./screens/Store"),
  Reports: () => import("./screens/Reports"),
  Search: () => import("./screens/Search"),
  Ai: () => import("./screens/Ai"),
  Settings: () => import("./screens/Settings"),
};
type Chunk = keyof typeof LOAD;

// lazy() takes a component of any props; each keeps its own through M[K].
const screen = <M, K extends keyof M>(load: () => Promise<M>, k: K) => lazy(() => load().then((m) => ({ default: m[k] as Extract<M[K], ComponentType<any>> })));

/** The screens as lazy components. */
export const SCREENS = {
  Overview: screen(LOAD.Overview, "Overview"),
  Sites: screen(LOAD.Sites, "Sites"),
  Updates: screen(LOAD.Updates, "Updates"),
  Matrix: screen(LOAD.Matrix, "Matrix"),
  Content: screen(LOAD.Content, "Content"),
  Media: screen(LOAD.Media, "Media"),
  Users: screen(LOAD.Users, "Users"),
  Comments: screen(LOAD.Comments, "Comments"),
  ClassicMonks: screen(LOAD.ClassicMonks, "ClassicMonks"),
  Monitoring: screen(LOAD.Monitoring, "Monitoring"),
  Security: screen(LOAD.Security, "Security"),
  Clients: screen(LOAD.Clients, "Clients"),
  Store: screen(LOAD.Store, "Store"),
  Reports: screen(LOAD.Reports, "Reports"),
  Search: screen(LOAD.Search, "Search"),
  Ai: screen(LOAD.Ai, "Ai"),
  Settings: screen(LOAD.Settings, "Settings"),
};

// Sidebar names to chunks.
const CHUNK: Record<string, Chunk> = { Plugins: "Matrix", Themes: "Matrix", "Classic Monks": "ClassicMonks", AI: "Ai" };
const chunkOf = (section: string) => CHUNK[section] ?? (section as Chunk);

// What each page reads first, the same calls with the same arguments, so its first answer is waiting.
const DATA: Partial<Record<string, (sites: Site[]) => unknown>> = {
  Overview: () => api.activityLog(),
  AI: () => api.activityLog(),
  Users: (sites) => sites.filter((s) => !peopleBlocked(s, "get-users")).map((s) => api.users(s.id, "")),
  Comments: (sites) => sites.filter((s) => !peopleBlocked(s, "get-comments")).map((s) => api.comments(s.id, "pending")),
  Clients: () => [api.clients(), api.costs()],
  Reports: () => [api.appSettings(), api.clients()],
  Settings: () => [api.appSettings(), api.gscStatus()],
};

const started = new Set<string>();

/** Loads a page's code (once) and warms its first reads. */
export function preload(section: string, sites: Site[] = []) {
  const chunk = chunkOf(section);
  if (!started.has(chunk)) {
    started.add(chunk);
    LOAD[chunk]?.().catch(() => started.delete(chunk));
  }
  const data = DATA[section];
  if (data) warm(() => Promise.all([data(sites)].flat()));
}

// The pages people go to next, most likely first; the rest follow.
const NEXT = ["Sites", "Updates", "Plugins", "Content", "Media", "Users", "Comments", "Classic Monks", "Monitoring", "Security", "Clients", "Store", "Reports", "AI", "Settings", "Search", "Overview"];

/** After the first paint, loads the other pages' code one per idle moment. Returns a stop function. */
export function prefetchIdle(current: string): () => void {
  const idle: (f: () => void) => number = window.requestIdleCallback ?? ((f) => window.setTimeout(f, 200));
  const stop: (n: number) => void = window.cancelIdleCallback ?? window.clearTimeout;
  const queue = NEXT.filter((s) => s !== current);
  let handle = 0;
  const next = () => {
    const s = queue.shift();
    if (!s) return;
    preload(s);
    handle = idle(next);
  };
  handle = idle(next);
  return () => stop(handle);
}
