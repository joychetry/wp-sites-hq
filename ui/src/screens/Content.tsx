// Posts, pages and every post type a site lets us edit: list, filter, open, create (plan Phase 3).
import { useCallback, useEffect, useState } from "react";
import { api, contentBlocked, type Listing, type PostType, type Site } from "../api";
import { Button } from "../components/ui";
import { Editor } from "./Editor";

export const STATUS_LABEL: Record<string, string> = {
  publish: "Published",
  draft: "Draft",
  pending: "Pending review",
  private: "Private",
  future: "Scheduled",
  trash: "In the trash",
};

const FILTERS = [
  ["", "All but the trash"],
  ["publish", "Published"],
  ["draft", "Drafts"],
  ["pending", "Pending review"],
  ["private", "Private"],
  ["trash", "Trash"],
] as const;

/** The first site whose content can be managed, so the screen opens on something useful. */
export function firstUsable(sites: Site[]): number | null {
  return (sites.find((s) => !contentBlocked(s)) ?? sites[0])?.id ?? null;
}

export function SitePick({ sites, value, onChange }: { sites: Site[]; value: number | null; onChange: (id: number) => void }) {
  return (
    <label className="row pick">
      <span>Site</span>
      <select className="input sm" aria-label="Site" value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))}>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {contentBlocked(s) ? " (not available)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

type Open = { postId?: number };

export function Content({ sites }: { sites: Site[] }) {
  const [siteId, setSiteId] = useState<number | null>(() => firstUsable(sites));
  // The group filter can hide the picked site: fall back to the first one shown.
  const site = sites.find((s) => s.id === siteId) ?? sites.find((s) => s.id === firstUsable(sites)) ?? null;
  const current = site?.id ?? null;
  const blocked = site ? contentBlocked(site) : null;
  const [types, setTypes] = useState<PostType[] | null>(null);
  const [typeName, setTypeName] = useState("post");
  const [status, setStatus] = useState("");
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    setTypes(null);
    setError(null);
    if (!site || blocked) return;
    api.postTypes(site.id).then(
      (t) => {
        setTypes(t);
        setTypeName((n) => (t.some((x) => x.name === n) ? n : (t[0]?.name ?? "post")));
      },
      (e) => setError(String(e)),
    );
    // Only a new site (or one that became usable) needs its types read again.
  }, [current, blocked]);

  const type = types?.find((t) => t.name === typeName) ?? null;

  const typeKey = type?.name;
  const load = useCallback(() => {
    if (current == null || !typeKey) return;
    setList(null);
    api.posts(current, { post_type: typeKey, status: status || undefined, search: search || undefined, page }).then(
      (l) => {
        setList(l);
        setError(null);
      },
      (e) => setError(String(e)),
    );
  }, [current, typeKey, status, search, page]);
  useEffect(load, [load]);

  if (sites.length === 0) {
    return (
      <div className="empty">
        <h2>No sites yet.</h2>
        <p>Add a site on Sites, then its posts and pages show here.</p>
      </div>
    );
  }

  const pickSite = (id: number) => {
    setSiteId(id);
    setTypes(null);
    setPage(1);
    setList(null);
  };

  let body;
  if (blocked) {
    body = (
      <div className="empty">
        <h2>{site!.name}'s content isn't available here.</h2>
        <p>{blocked}</p>
      </div>
    );
  } else if (error) {
    body = (
      <div className="empty" role="alert">
        <h2>The content didn't load.</h2>
        <p>{error}</p>
        <Button onClick={() => (types ? load() : pickSite(site!.id))}>Try again</Button>
      </div>
    );
  } else if (!types || !list || !type) {
    body = (
      <p className="empty" role="status">
        Reading {site?.name}…
      </p>
    );
  } else if (list.posts.length === 0) {
    body = (
      <div className="empty">
        <h2>{search || status ? "Nothing matches." : `No ${type.label.toLowerCase()} yet.`}</h2>
        <p>{search || status ? "Try other words, or show everything but the trash." : `Add the first one with New ${type.singular.toLowerCase()}.`}</p>
        {(search || status) && (
          <Button
            onClick={() => {
              setStatus("");
              setTyped("");
              setSearch("");
            }}
          >
            Clear the filters
          </Button>
        )}
      </div>
    );
  } else {
    body = (
      <>
        <p className="legend" id="content-legend">
          Select a title to open it. Dates are in the site's own time zone.
        </p>
        <table className="t" aria-label={type.label} aria-describedby="content-legend">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Status</th>
              <th scope="col">Author</th>
              <th scope="col">Last changed</th>
            </tr>
          </thead>
          <tbody>
            {list.posts.map((p) => (
              <tr key={p.id}>
                <td className="name">
                  <button type="button" className="linkish" title={p.title || "(no title)"} onClick={() => setOpen({ postId: p.id })}>
                    {p.title || "(no title)"}
                  </button>
                </td>
                <td>
                  <span className="tag">{STATUS_LABEL[p.status] ?? p.status}</span>
                </td>
                <td>{p.author || "not known"}</td>
                <td className="num">{p.modified || p.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="pager">
          <span>
            Page {list.page} of {list.pages}, {list.total} {list.total === 1 ? "entry" : "entries"}
          </span>
          <Button small disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous page
          </Button>
          <Button small disabled={page >= list.pages} onClick={() => setPage(page + 1)}>
            Next page
          </Button>
        </div>
      </>
    );
  }

  return (
    <div className="scroll">
      <div className="bar">
        <SitePick sites={sites} value={current} onChange={pickSite} />
        {types && types.length > 0 && (
          <div className="segmented types" role="group" aria-label="Post type">
            {types.map((t) => (
              <button
                key={t.name}
                type="button"
                aria-pressed={t.name === typeName}
                onClick={() => {
                  setTypeName(t.name);
                  setPage(1);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {type && !blocked && (
        <form
          className="bar"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(typed.trim());
          }}
        >
          <label className="row pick">
            <span>Show</span>
            <select
              className="input sm"
              aria-label="Show"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              {FILTERS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <input className="input sm" aria-label={`Search ${type.label.toLowerCase()}`} placeholder={`Search ${type.label.toLowerCase()}`} value={typed} onChange={(e) => setTyped(e.target.value)} />
          <Button small type="submit">
            Search
          </Button>
          <span className="grow" />
          <Button kind="primary" small onClick={() => setOpen({})}>
            New {type.singular.toLowerCase()}
          </Button>
        </form>
      )}
      <div role="status" className="notice">
        {note && <p className="alert ok">{note}</p>}
      </div>
      {body}
      {open && site && type && (
        <Editor
          key={open.postId ?? "new"}
          site={site}
          type={type}
          postId={open.postId}
          onClose={() => setOpen(null)}
          onSaved={(msg) => {
            setNote(msg);
            load();
          }}
        />
      )}
    </div>
  );
}
