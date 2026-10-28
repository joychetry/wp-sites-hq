// Search everything: sites, plugins, themes and clients at once from what Monks
// Central already knows, then posts and pages on every site (plan Phase 7).
import { useEffect, useState } from "react";
import { api, type Client, type ContentFound, type Site, type SiteInventory } from "../api";
import { Button } from "../components/ui";
import { STATUS_LABEL } from "./Content";

export type Local = { kind: "Sites" | "Plugins" | "Themes" | "Clients"; key: string; label: string; detail: string; siteId?: number };

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
      out.push({ kind: kind === "plugins" ? "Plugins" : "Themes", key: `${kind}${id}`, label: f.name, detail: `On ${f.on.join(", ")}` });
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

type Props = {
  sites: Site[];
  inventory: Map<number, SiteInventory>;
  query: string;
  onGo: (section: "Sites" | "Plugins" | "Themes" | "Clients", siteId?: number) => void;
};

export function Search({ sites, inventory, query: first, onGo }: Props) {
  const [typed, setTyped] = useState(first);
  const [query, setQuery] = useState(first);
  const [clients, setClients] = useState<Client[]>([]);
  const [found, setFound] = useState<ContentFound | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.clients().then(setClients, () => setClients([]));
  }, []);
  useEffect(() => {
    setFound(null);
    setError(null);
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
  const name = (id: number) => sites.find((s) => s.id === id)?.name ?? "a removed site";
  const groups = (["Sites", "Plugins", "Themes", "Clients"] as const).map((k) => [k, local.filter((h) => h.kind === k)] as const).filter(([, l]) => l.length);

  return (
    <div className="scroll">
      <form
        className="bar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(typed.trim());
        }}
      >
        <input className="input" aria-label="Search everything" placeholder="A site, plugin, theme, client, post or page" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <Button kind="primary" type="submit" disabled={typed.trim().length < 2}>
          Search
        </Button>
      </form>
      {query.trim().length < 2 ? (
        <div className="empty">
          <h2>Search every site at once.</h2>
          <p>Sites, plugins, themes and clients show straight away. Posts and pages are looked up on each site.</p>
        </div>
      ) : (
        <>
          <p className="legend" id="search-legend">
            Results for <b>{query}</b>. Plugins and themes are as last read from each site.
          </p>
          {groups.length === 0 && <p className="dim">No sites, plugins, themes or clients match.</p>}
          {groups.map(([kind, list]) => (
            <section key={kind} aria-label={kind}>
              <h2 className="sect">{kind}</h2>
              <ul className="plain">
                {list.map((h) => (
                  <li key={h.key} className="row">
                    <span className="grow">
                      <b>{h.label}</b> <span className="dim">{h.detail}</span>
                    </span>
                    <Button small aria-label={`${GO[kind]}: ${h.label}`} onClick={() => onGo(kind, h.siteId)}>
                      {GO[kind]}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <section aria-label="Posts and pages">
            <h2 className="sect">Posts and pages</h2>
            <div role="status">{searching && <p className="dim">Asking every site…</p>}</div>
            {error && <p className="alert danger">{error}</p>}
            {found && found.hits.length === 0 && <p className="dim">No posts or pages match on any site.</p>}
            {found && found.hits.length > 0 && (
              <table className="t" aria-label="Posts and pages found" aria-describedby="search-legend">
                <thead>
                  <tr>
                    <th scope="col">Title</th>
                    <th scope="col">Site</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {found.hits.map((h) => (
                    <tr key={`${h.site_id}-${h.id}`}>
                      <td className="name cut" title={h.title}>
                        {h.title || "(no title)"}
                      </td>
                      <td>{name(h.site_id)}</td>
                      <td>{h.post_type === "page" ? "Page" : "Post"}</td>
                      <td>
                        <span className="tag">{STATUS_LABEL[h.status] ?? h.status}</span>
                      </td>
                      <td>
                        {h.link.startsWith("https://") && (
                          <Button small aria-label={`View ${h.title || "it"} on ${name(h.site_id)}`} onClick={() => api.openLink(h.link).catch(() => {})}>
                            View
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {found && found.failed.length > 0 && (
              <p className="alert">
                Not searched: {found.failed.map(([id, why]) => `${name(id)} (${why})`).join("; ")}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
