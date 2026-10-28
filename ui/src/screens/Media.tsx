// SPDX-License-Identifier: GPL-3.0-or-later
// A site's media library: browse, search, and import an image from a link (plan Phase 3).
import { SearchInput } from "../components/controls";
import { Skeleton, toast } from "../components/feedback";
import { useCallback, useEffect, useState } from "react";
import { api, contentBlocked, type Media as Item, type Site } from "../api";
import { Button } from "../components/ui";
import { firstUsable, SitePick } from "./Content";

const PAGE = 30;

export function Media({ sites }: { sites: Site[] }) {
  const [siteId, setSiteId] = useState<number | null>(() => firstUsable(sites));
  // The group filter can hide the picked site: fall back to the first one shown.
  const site = sites.find((s) => s.id === siteId) ?? sites.find((s) => s.id === firstUsable(sites)) ?? null;
  const current = site?.id ?? null;
  const blocked = site ? contentBlocked(site) : null;
  const [items, setItems] = useState<Item[] | null>(null);
  const [more, setMore] = useState(false);
  const [page, setPage] = useState(1);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [alt, setAlt] = useState("");
  const [importing, setImporting] = useState(false);

  const load = useCallback(
    (p: number, keep = false) => {
      if (current == null || blocked) return;
      if (p === 1 && !keep) setItems(null);
      api.media(current, p, search, false).then(
        (m) => {
          setItems((old) => (p === 1 ? m : [...(old ?? []), ...m]));
          setMore(m.length === PAGE);
          setPage(p);
          setError(null);
        },
        (e) => setError(String(e)),
      );
    },
    [current, blocked, search],
  );
  useEffect(() => load(1), [load]);

  if (sites.length === 0) {
    return (
      <div className="empty">
        <h2>No sites yet.</h2>
        <p>Add a site on Sites, then its media library shows here.</p>
      </div>
    );
  }

  const add = async () => {
    if (!site) return;
    setImporting(true);
    try {
      const m = await api.importMedia(site.id, link, alt);
      toast(`Added ${m.title || "the image"} to ${site.name}'s media library.`);
      setLink("");
      setAlt("");
      load(1, true);
    } catch (e) {
      toast(String(e), { tone: "danger" });
    } finally {
      setImporting(false);
    }
  };

  let body;
  if (blocked) {
    body = (
      <div className="empty">
        <h2>{site!.name}'s media isn't available here.</h2>
        <p>{blocked}</p>
      </div>
    );
  } else if (error) {
    body = (
      <div className="empty" role="alert">
        <h2>The media library didn't load.</h2>
        <p>{error}</p>
        <Button onClick={() => load(1)}>Try again</Button>
      </div>
    );
  } else if (!items) {
    body = (
      <Skeleton label={`Reading ${site?.name}'s media library…`} />
    );
  } else if (items.length === 0) {
    body = (
      <div className="empty">
        <h2>{search ? "Nothing matches." : "The media library is empty."}</h2>
        <p>{search ? "Try other words." : "Import an image from a link above."}</p>
      </div>
    );
  } else {
    body = (
      <>
        <p className="legend" id="media-legend">
          Newest first. The text under each image is its alt text, which screen readers read out.
        </p>
        <ul className="media" aria-label={`${site?.name} media`} aria-describedby="media-legend">
          {items.map((m) => (
            <li key={m.id}>
              {m.mime.startsWith("image/") ? <img src={m.url} alt={m.alt} loading="lazy" /> : <span className="file mono">{m.mime}</span>}
              <b className="cut" data-tip={m.title}>
                {m.title || "No title"}
              </b>
              <span className={m.alt ? "" : "dim"}>{m.alt || "No alt text"}</span>
            </li>
          ))}
        </ul>
        {more && (
          <div className="pager">
            <Button small onClick={() => load(page + 1)}>
              Show more
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="scroll">
      <div className="bar">
        <SitePick sites={sites} value={current} onChange={setSiteId} />
        {!blocked && (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(typed.trim());
            }}
          >
            <SearchInput className="sm" aria-label="Search the media library" placeholder="Search the media library" value={typed} onChange={(e) => setTyped(e.target.value)} />
            <Button small type="submit">
              Search
            </Button>
          </form>
        )}
      </div>
      {!blocked && (
        <form
          className="bar import"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <label className="row pick grow">
            <span>Image link</span>
            <input className="input sm" placeholder="https://example.com/photo.jpg" value={link} onChange={(e) => setLink(e.target.value)} />
          </label>
          <label className="row pick">
            <span>Alt text</span>
            <input className="input sm" placeholder="What the image shows" value={alt} onChange={(e) => setAlt(e.target.value)} />
          </label>
          <Button kind="primary" small type="submit" disabled={importing || !link.trim()}>
            {importing ? "Importing…" : "Import the image"}
          </Button>
        </form>
      )}
      {body}
    </div>
  );
}
