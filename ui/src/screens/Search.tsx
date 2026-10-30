// SPDX-License-Identifier: GPL-3.0-or-later
// Search everything: sites, plugins, themes and clients at once from what Monks
// Central already knows, then posts and pages on every site (plan Phase 7).
import "../styles/screens/search.css";
import { useEffect, useState } from "react";
import { api, contentBlocked, type Client, type ContentFound, type PostType, type Site, type SiteInventory } from "../api";
import { toast } from "../components/feedback";
import { Editor } from "./Editor";
import { SearchInput } from "../components/controls";
import { SiteTile } from "../components/SiteTile";
import { PkgTile, slugOf, type Pkg } from "../components/PkgTile";
import { Button, Glyph, Kbd } from "../components/ui";
import { STATUS_LABEL } from "./Content";

export type Local = { kind: "Sites" | "Plugins" | "Themes" | "Clients"; key: string; label: string; detail: string; siteId?: number; pkg?: Pkg };

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
      out.push({ kind: "Clients", key: `c${c.id}`, label: c.name, detail: [c.email, own.length ? `Sites: ${own.join(", ")}` : "No sites"].filter(Boolean).join(". ") });
    }
  }
  return out;
}

const GO: Record<Local["kind"], string> = { Sites: "Open on Sites", Plugins: "Show on Plugins", Themes: "Show on Themes", Clients: "Open Clients" };
const ONE: Record<Local["kind"], string> = { Sites: "Site", Plugins: "Plugin", Themes: "Theme", Clients: "Client" };
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

type Kind = "All" | "Pages" | "Posts" | Local["kind"];

/** The words with what was searched for picked out, as the design's results do. */
function Marked({ text, term }: { text: string; term: string }) {
  const at = text.toLowerCase().indexOf(term.toLowerCase());
  if (!term || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + term.length)}</mark>
      {text.slice(at + term.length)}
    </>
  );
}

type Props = {
  sites: Site[];
  inventory: Map<number, SiteInventory>;
  query: string;
  onGo: (section: "Sites" | "Plugins" | "Themes" | "Clients", siteId?: number) => void;
};

export function Search({ sites, inventory, query: first, onGo }: Props) {
  const [typed, setTyped] = useState(first);
  const [query, setQuery] = useState(first);
  const [show, setShow] = useState<Kind>("All");
  const [clients, setClients] = useState<Client[]>([]);
  const [found, setFound] = useState<ContentFound | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ site: Site; type: PostType; id: number } | null>(null);

  useEffect(() => {
    api.clients().then(setClients, () => setClients([]));
  }, []);
  useEffect(() => {
    setFound(null);
    setError(null);
    setShow("All");
    if (query.trim().length < 2) return;
    let live = true;
    setSearching(true);
    api.searchContent(query).then(
      (f) => live && setFound(f),
      (e) => live && setError(String(e)),
    ).finally(() => live && setSearching(false));
    return () => {
      live = false;
    };
  }, [query]);

  const local = localHits(query, sites, inventory, clients);
  const site = (id: number) => sites.find((s) => s.id === id);
  const name = (id: number) => site(id)?.name ?? "a removed site";
  const hits = (found?.hits ?? []).map((h) => ({ ...h, kind: (h.post_type === "page" ? "Pages" : "Posts") as Kind }));
  const count = (k: Kind) => [...hits, ...local].filter((h) => k === "All" || h.kind === k).length;
  const kinds = (["All", "Pages", "Posts", "Sites", "Plugins", "Themes", "Clients"] as Kind[]).filter((k) => k === "All" || count(k) > 0);
  const on = new Set([...hits.map((h) => h.site_id), ...local.flatMap((h) => (h.siteId ? [h.siteId] : []))]).size;
  const shown = (k: Kind) => show === "All" || show === k;
  const edit = async (s: Site, postType: string, id: number) => {
    const type = (await api.postTypes(s.id).catch(() => [])).find((t) => t.name === postType);
    if (type) setEditing({ site: s, type, id });
    else toast(`Couldn't open it here. Open it on Content for ${s.name}.`, { tone: "danger" });
  };

  // An entry opens on its own full page, in place of the results.
  if (editing) {
    return (
      <Editor
        site={editing.site}
        type={editing.type}
        postId={editing.id}
        back="Back to the results"
        onClose={() => setEditing(null)}
        onSaved={(msg, undo) =>
          toast(msg, undo ? { undo: () => undo().then(() => toast(`Brought it back from the trash on ${editing.site.name}.`), (e) => toast(String(e), { tone: "danger" })) } : undefined)
        }
      />
    );
  }

  return (
    <div className="scroll page search">
      <form
        className="srch-go"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(typed.trim());
        }}
      >
        <SearchInput aria-label="Search everything" placeholder="A site, plugin, theme, client, post or page" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <Button kind="primary" className="disc" type="submit" disabled={typed.trim().length < 2}>
          <span className="btn-disc">
            <Glyph name="arrow" />
          </span>
          Search
        </Button>
      </form>
      {query.trim().length < 2 ? (
        <div className="card">
          <div className="empty">
            <h2>Search every site at once.</h2>
            <p>Sites, plugins, themes and clients show straight away. Posts and pages are looked up on each site.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="filters">
            <div className="segmented inline" role="group" aria-label="Show results">
              {kinds.map((k) => (
                <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)}>
                  {k}
                  <small>{count(k)}</small>
                </button>
              ))}
            </div>
            <span className="end dim" id="search-legend">
              {plural(count("All"), "result")} on {plural(on, "site")}
            </span>
          </div>
          <section className="card" aria-label={`Results for ${query}`}>
            <ul className="fixes" aria-label="Results" aria-describedby="search-legend">
              {hits
                .filter((h) => shown(h.kind))
                .map((h) => (
                  <li key={`${h.site_id}-${h.id}`} className="fix">
                    <span className="tile neutral" aria-hidden="true">
                      <Glyph name={h.kind === "Pages" ? "file" : "edit"} />
                    </span>
                    <div>
                      <b>{h.title ? <Marked text={h.title} term={query} /> : "(no title)"}</b>
                      <span>
                        {h.kind === "Pages" ? "Page" : "Post"} · {name(h.site_id)} · {STATUS_LABEL[h.status] ?? h.status}
                      </span>
                    </div>
                    {site(h.site_id) && !contentBlocked(site(h.site_id)!) && (
                      <Button small className="ghost" aria-label={`Edit ${h.title || "it"} on ${name(h.site_id)}`} onClick={() => edit(site(h.site_id)!, h.post_type, h.id)}>
                        <Glyph name="edit" />
                        Edit
                      </Button>
                    )}
                    {h.link.startsWith("https://") && (
                      <Button small aria-label={`View on ${name(h.site_id)}: ${h.title || "(no title)"}`} onClick={() => api.openLink(h.link, h.site_id).catch(() => {})}>
                        <Glyph name="external" />
                        View on {name(h.site_id)}
                      </Button>
                    )}
                  </li>
                ))}
              {local
                .filter((h) => shown(h.kind))
                .map((h) => {
                  const s = h.siteId ? site(h.siteId) : undefined;
                  return (
                    <li key={h.key} className="fix">
                      {s ? (
                        <SiteTile site={s} />
                      ) : h.kind === "Clients" ? (
                        <span className="tile neutral" aria-hidden="true">
                          <Glyph name="briefcase" />
                        </span>
                      ) : h.pkg ? (
                        <PkgTile {...h.pkg} />
                      ) : null}
                      <div>
                        <b>
                          <Marked text={h.label} term={query} />
                        </b>
                        <span>
                          {ONE[h.kind]} · {h.detail}
                        </span>
                      </div>
                      <Button small aria-label={`${GO[h.kind]}: ${h.label}`} onClick={() => onGo(h.kind, h.siteId)}>
                        {GO[h.kind]}
                      </Button>
                    </li>
                  );
                })}
            </ul>
            <div role="status">{searching && <p className="quiet">Asking every site for posts and pages…</p>}</div>
            {error && (
              <p className="callout danger">
                <Glyph name="x-circle" />
                <span>{error}</span>
              </p>
            )}
            {found && found.hits.length === 0 && <p className="quiet">{local.length ? "No posts or pages match on any site." : "Nothing matches on any site: no sites, plugins, themes, clients, posts or pages."}</p>}
          </section>
          {found && found.failed.length > 0 && (
            <p className="callout warning">
              <Glyph name="alert" />
              <span>Not searched: {found.failed.map(([id, why]) => `${name(id)} (${why})`).join("; ")}</span>
            </p>
          )}
        </>
      )}
      <p className="callout">
        <Glyph name="command" />
        <span>
          <b>Faster from anywhere:</b> press <Kbd>Ctrl K</Kbd> to search sites, pages and actions without leaving the page you're on.
        </span>
      </p>
    </div>
  );
}
