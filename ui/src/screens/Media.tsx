// SPDX-License-Identifier: GPL-3.0-or-later
// A site's media library: browse, search, and import an image from a link (plan Phase 3).
import "../styles/screens/media.css";
import { dayLabel, SearchInput } from "../components/controls";
import { Skeleton, toast } from "../components/feedback";
import { useCallback, useEffect, useState } from "react";
import { api, contentBlocked, type Media as Item, type Site } from "../api";
import { Button, Glyph } from "../components/ui";
import { firstUsable, SitePick } from "./Content";

const PAGE = 30;

/** "image/jpeg" -> "JPEG", "application/pdf" -> "PDF". */
const kind = (mime: string) => (mime.split("/")[1] ?? mime).replace(/^x-/, "").toUpperCase();

/** An item's picture: the image itself, or a file glyph for anything else. */
function Pic({ m, alt = "" }: { m: Item; alt?: string }) {
  return (
    <span className="mthumb-img">{m.mime.startsWith("image/") && m.url ? <img src={m.url} alt={alt} loading="lazy" /> : <Glyph name="file" />}</span>
  );
}

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
  const [picked, setPicked] = useState<number | null>(null);

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

  // The picked item, or the newest one, shows its details beside the library.
  const chosen = items?.find((m) => m.id === picked) ?? items?.[0] ?? null;

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
    body = <Skeleton label={`Reading ${site?.name}'s media library…`} />;
  } else if (items.length === 0) {
    body = (
      <div className="empty">
        <h2>{search ? "Nothing matches." : "The media library is empty."}</h2>
        <p>{search ? "Try other words." : "Import an image from a link."}</p>
      </div>
    );
  } else {
    body = (
      <>
        <p className="sr-only" id="media-legend">
          Newest first. Pick one to see its alt text, which screen readers read out, and its details.
        </p>
        <ul className="mthumbs" aria-label={`${site?.name} media`} aria-describedby="media-legend">
          {items.map((m) => (
            <li key={m.id}>
              <button type="button" className="mthumb" aria-pressed={m.id === chosen?.id} onClick={() => setPicked(m.id)}>
                <Pic m={m} />
                <b data-tip={m.title}>{m.title || "No title"}</b>
                <small>
                  {kind(m.mime)}
                  {m.date && ` · ${dayLabel(m.date) || m.date}`}
                </small>
              </button>
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <div className="scroll page">
      <div className={blocked ? "stack" : "split-r"}>
        <section className="card mlib" aria-label={site ? `Media library of ${site.name}` : "Media library"}>
          <form
            className="card-head"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(typed.trim());
            }}
          >
            <SitePick sites={sites} value={current} onChange={setSiteId} />
            {!blocked && (
              <>
                <SearchInput className="sm" aria-label="Search the media library" placeholder="Search the media library" value={typed} onChange={(e) => setTyped(e.target.value)} />
                <Button small type="submit">
                  Search
                </Button>
              </>
            )}
          </form>
          {body}
          {items && items.length > 0 && !blocked && !error && (
            <div className="card-foot">
              <span className="count">
                {items.length === 1 ? "1 item" : `${items.length} items`}
                {more && " so far"}
              </span>
              {more && (
                <Button small onClick={() => load(page + 1)}>
                  Load more
                </Button>
              )}
            </div>
          )}
        </section>
        {!blocked && (
          <div className="stack mside">
            <form
              className="card"
              aria-labelledby="media-import"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <div className="card-head">
                <h2 id="media-import">
                  <Glyph name="link" />
                  Import an image
                </h2>
              </div>
              <div className="card-body">
                <label className="field">
                  <span>Image link</span>
                  <input className="input" type="url" spellCheck={false} placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
                </label>
                <div className="field">
                  <label htmlFor="media-alt">Alt text</label>
                  <input id="media-alt" className="input" aria-describedby="media-alt-help" placeholder="Describe the image for people who can't see it" value={alt} onChange={(e) => setAlt(e.target.value)} />
                  <small id="media-alt-help">Screen readers read this aloud. Leave it empty only for decoration.</small>
                </div>
                <div>
                  <Button kind="primary" className="disc" type="submit" disabled={importing || !link.trim()}>
                    {importing ? "Importing…" : "Import the image"}
                    <span className="btn-disc">
                      <Glyph name="download" />
                    </span>
                  </Button>
                </div>
              </div>
            </form>
            {chosen && (
              <section className="card" aria-label={`Selected: ${chosen.title || "No title"}`}>
                <div className="card-body">
                  <div className="mpicked">
                    <Pic m={chosen} alt={chosen.alt} />
                    <div>
                      <b>{chosen.title || "No title"}</b>
                      <span className="mono dim">{chosen.mime}</span>
                    </div>
                  </div>
                  <dl className="dl">
                    <div>
                      <dt>Alt text</dt>
                      <dd className={chosen.alt ? undefined : "dim"}>{chosen.alt || "No alt text"}</dd>
                    </div>
                    <div>
                      <dt>Uploaded</dt>
                      <dd>{dayLabel(chosen.date) || chosen.date || "not known"}</dd>
                    </div>
                    {chosen.url && (
                      <div>
                        <dt>File</dt>
                        <dd>
                          <button type="button" className="link" onClick={() => api.openLink(chosen.url).catch((e) => toast(String(e), { tone: "danger" }))}>
                            Open the file
                          </button>
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
