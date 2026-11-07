// SPDX-License-Identifier: GPL-3.0-or-later
// Ctrl K / Cmd K: every action and page, and what is on your sites, by typing.
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Glyph, Kbd, type GlyphName } from "./ui";
import { SiteTile } from "./SiteTile";
import { PkgTile, type Pkg } from "./PkgTile";
import { api, type Client, type ContentFound, type ContentHit, type Site, type SiteInventory } from "../api";
import { localHits, type Local } from "../find";
import { STATUS_LABEL } from "../format";

export type Command = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  keys?: string;
  /** The row's 28px tile: an icon, or the site's own tile. */
  icon?: GlyphName;
  site?: Site;
  pkg?: Pkg;
  /** Runs without closing the palette (Show more). */
  keep?: boolean;
  run: () => void;
};

function Marked({ text, term }: { text: string; term: string }) {
  const i = term ? text.toLowerCase().indexOf(term) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + term.length)}</mark>
      {text.slice(i + term.length)}
    </>
  );
}

/** The palette's key in words: ⌘K on a Mac, Ctrl K elsewhere. */
export const PALETTE_KEYS = /Mac/.test(navigator.userAgent) ? "⌘K" : "Ctrl K";

// Each group of finds stays short; posts and pages can show the rest.
const CAP = 5;
const KINDS = ["Sites", "Plugins", "Themes", "Clients"] as const;
const POSTS = "Posts and pages";

type Props = {
  commands: Command[];
  onClose: () => void;
  /** With these, typing also finds sites, plugins, themes and clients, then posts and pages on every site. */
  sites?: Site[];
  inventory?: Map<number, SiteInventory>;
  onLocal?: (hit: Local) => void;
  onPost?: (hit: ContentHit) => void;
};

export function Palette({ commands, onClose, sites, inventory, onLocal, onPost }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [clients, setClients] = useState<Client[]>([]);
  const [found, setFound] = useState<ContentFound | null>(null);
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const term = query.trim().toLowerCase();
  const q = query.trim();
  const finds = !!(sites && inventory && onLocal);
  const posts = !!(sites && onPost);
  useEffect(() => {
    if (finds) api.clients().then((c) => setClients(c ?? []), () => setClients([]));
  }, [finds]);
  // Posts and pages are asked of every site, so only once typing pauses.
  useEffect(() => {
    setFound(null);
    setFailed(null);
    setMore(false);
    setAsking(false);
    if (!posts || q.length < 2) return;
    let live = true;
    setAsking(true);
    const t = setTimeout(
      () =>
        api.searchContent(q).then(
          (f) => live && (setFound(f), setAsking(false)),
          (e) => live && (setFailed(String(e)), setAsking(false)),
        ),
      250,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, posts]);
  // Finds across 300 sites trail the typing a moment, so a key never waits on them.
  const later = useDeferredValue(term);
  const local = useMemo(() => (finds && later ? localHits(later, sites!, inventory!, clients) : []), [finds, later, sites, inventory, clients]);
  const siteName = (id: number) => sites?.find((s) => s.id === id)?.name ?? "a removed site";
  const hits = useMemo(() => {
    const cmds = commands.filter((c) => !term || c.label.toLowerCase().includes(term) || c.hint?.toLowerCase().includes(term));
    // A site already listed as a command isn't listed twice.
    const listed = new Set(cmds.flatMap((c) => (c.site ? [c.site.id] : [])));
    const mine: Command[] = KINDS.flatMap((kind) =>
      local
        .filter((h) => h.kind === kind && !(h.siteId && listed.has(h.siteId)))
        .slice(0, CAP)
        .map((h) => ({ id: `l-${h.key}`, group: kind, label: h.label, hint: h.detail, site: sites!.find((s) => s.id === h.siteId), pkg: h.pkg, icon: kind === "Clients" ? ("briefcase" as const) : undefined, run: () => onLocal!(h) })),
    );
    const all = found?.hits ?? [];
    const rows: Command[] = (more ? all : all.slice(0, CAP)).map((h) => ({
      id: `p-${h.site_id}-${h.post_type}-${h.id}`,
      group: POSTS,
      label: h.title || "(no title)",
      hint: `${h.post_type === "page" ? "Page" : "Post"} · ${siteName(h.site_id)} · ${STATUS_LABEL[h.status] ?? h.status}`,
      icon: h.post_type === "page" ? ("file" as const) : ("edit" as const),
      run: () => onPost!(h),
    }));
    if (!more && all.length > CAP) rows.push({ id: "p-more", group: POSTS, label: `Show ${all.length - CAP} more`, icon: "chevron-down", keep: true, run: () => setMore(true) });
    // Finds join the commands' group of the same name (a site matched by its notes sits with the other sites).
    const list = [...cmds, ...mine, ...rows];
    const order = [...new Set(list.map((c) => c.group))];
    return list.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commands, term, local, found, more]);
  // Rows come sorted by group: each group is its name and its first row.
  const groups: [string, number][] = [];
  hits.forEach((c, i) => (i === 0 || hits[i - 1].group !== c.group) && groups.push([c.group, i]));
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => opener?.focus?.();
  }, []);
  useEffect(() => setActive(0), [term]);
  // Arrows can move past the bottom of the list: keep the chosen row in sight.
  useEffect(() => {
    // Only on a move: scrolling forces a layout, which every key would pay for on a long list.
    document.getElementById(`pal-${hits[active]?.id}`)?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    if (!c.keep) onClose();
    c.run();
  };

  return (
    <div className="palette" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pal" role="dialog" aria-modal="true" aria-label="Search or run a command">
        <div className="pal-search">
          <Glyph name="search" />
          <input
            ref={input}
            value={query}
            placeholder="Search sites, plugins, themes, clients, posts and pages, or run a command"
            aria-label="Search or run a command"
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-list"
            aria-activedescendant={hits[active] ? `pal-${hits[active].id}` : undefined}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => (hits.length ? (a + 1) % hits.length : 0));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => (hits.length ? (a - 1 + hits.length) % hits.length : 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(hits[active]);
              } else if (e.key === "Tab") {
                // The input is the palette's only stop; arrows move through the list.
                e.preventDefault();
              } else if (e.key === "Escape") {
                e.stopPropagation();
                onClose();
              }
            }}
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul id="pal-list" role="listbox" aria-label="Results">
          {hits.length === 0 && term && !asking && <li className="pal-empty">No matches. Try “add” or a site name.</li>}
          {groups.map(([g, at], n) => (
            <li key={g} role="group" aria-labelledby={`pal-g${n}`}>
              <span className="pal-group" id={`pal-g${n}`}>
                {g}
              </span>
              <ul role="presentation">
                {hits.slice(at, groups[n + 1]?.[1]).map((c, j) => {
                  const i = at + j;
                  return (
                    <li
                      key={c.id}
                      id={`pal-${c.id}`}
                      className="pal-row"
                      role="option"
                      aria-selected={i === active}
                      onMouseMove={() => setActive(i)}
                      onClick={() => run(c)}
                    >
                      {c.site ? (
                        <SiteTile site={c.site} size="sm" />
                      ) : c.pkg ? (
                        <PkgTile {...c.pkg} size="sm" />
                      ) : (
                        <span className="tile sm neutral" aria-hidden="true">
                          <Glyph name={c.icon ?? "arrow"} />
                        </span>
                      )}
                      <span className="pal-label">
                        <Marked text={c.label} term={term} />
                        {c.hint && <> <small>{c.hint}</small></>}
                      </span>
                      {(c.keys || i === active) && (
                        // The Enter on the chosen row is a hint for the eye; the list already says which one is chosen.
                        <span className="keys" aria-hidden={!c.keys || undefined}>
                          {(i === active ? "Enter" : c.keys!).split(" ").map((k) => (
                            <Kbd key={k}>{k}</Kbd>
                          ))}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
        <div className="pal-notes" role="status">
          {asking && <p>Looking for posts and pages on every site…</p>}
          {failed && <p className="danger">Couldn't search posts and pages: {failed}</p>}
          {found?.failed.map(([id, why]) => (
            <p key={id}>
              Could not search {siteName(id)}: {why}
            </p>
          ))}
        </div>
        <div className="foot">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move
          </span>
          <span>
            <Kbd>Enter</Kbd> to run
          </span>
          <span>
            <Kbd>Esc</Kbd> to close
          </span>
          <span className="grow">Every action and page, and what is on your sites</span>
        </div>
      </div>
    </div>
  );
}
