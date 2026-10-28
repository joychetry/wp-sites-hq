// Posts, pages and every post type a site lets us edit: list, filter, open, create (plan Phase 3).
import { Skeleton } from "../components/feedback";
import { Select } from "../components/controls";
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, contentBlocked, hasTool, type Action, type Listing, type PostType, type Site, type Summary } from "../api";
import type { PlanRow } from "../components/JobSheet";
import { Button } from "../components/ui";
import { Editor } from "./Editor";
import { PublishMany } from "./PublishMany";

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
      <Select className="input sm" aria-label="Site" value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))}>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {contentBlocked(s) ? " (not available)" : ""}
          </option>
        ))}
      </Select>
    </label>
  );
}

type Open = { postId?: number };

type Bulk = "publish" | "draft" | "trash" | "untrash";
const BULK: Record<Bulk, { button: string; title: string; danger?: boolean }> = {
  publish: { button: "Publish", title: "Publish" },
  draft: { button: "Make drafts", title: "Make drafts of" },
  trash: { button: "Move to the trash", title: "Move to the trash", danger: true },
  untrash: { button: "Bring back from the trash", title: "Bring back from the trash" },
};

/** One change per picked entry, as a plan for one site. */
export function bulkRows(site: Site, type: PostType, posts: Summary[], what: Bulk): PlanRow[] {
  return posts.map((p) => {
    const base = { post_type: type.name, post_id: p.id, title: p.title || "(no title)" };
    const action: Action =
      what === "trash"
        ? { do: "trash_post", ...base }
        : what === "untrash"
          ? { do: "untrash_post", ...base }
          : { do: "set_post_status", ...base, status: what };
    const label =
      what === "trash"
        ? `Move \u201c${base.title}\u201d to the trash`
        : what === "untrash"
          ? `Bring \u201c${base.title}\u201d back from the trash`
          : what === "publish"
            ? `Publish \u201c${base.title}\u201d`
            : `Make \u201c${base.title}\u201d a draft`;
    return { change: { site_id: site.id, action }, site: site.name, label };
  });
}

type Props = { sites: Site[]; onPlan?: (title: string, rows: PlanRow[], start?: "plan" | "confirm", danger?: boolean) => void };

export function Content({ sites, onPlan }: Props) {
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
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [many, setMany] = useState(false);

  useEffect(() => {
    setTypes(null);
    setError(null);
    if (!site || blocked) return;
    let live = true;
    api.postTypes(site.id).then(
      (t) => {
        if (!live) return;
        setTypes(t);
        setTypeName((n) => (t.some((x) => x.name === n) ? n : (t[0]?.name ?? "post")));
      },
      (e) => live && setError(String(e)),
    );
    return () => {
      live = false;
    };
    // Only a new site (or one that became usable) needs its types read again.
  }, [current, blocked]);

  const type = types?.find((t) => t.name === typeName) ?? null;

  const typeKey = type?.name;
  // Only the newest request's answer is shown: a slow site's list must never appear under
  // another site, where ticking its entries would change that site's posts with the same ids.
  const asked = useRef(0);
  const load = useCallback(() => {
    const n = ++asked.current;
    if (current == null || !typeKey) return;
    setList(null);
    api.posts(current, { post_type: typeKey, status: status || undefined, search: search || undefined, page }).then(
      (l) => {
        if (n !== asked.current) return;
        setList(l);
        setError(null);
      },
      (e) => n === asked.current && setError(String(e)),
    );
  }, [current, typeKey, status, search, page]);
  useEffect(load, [load]);
  useEffect(() => setPicked(new Set()), [list]);
  // A bulk job changed entries: read the page again, quietly.
  useEffect(() => {
    if (current == null || !typeKey) return;
    const off = listen("jobs-changed", () => {
      const n = ++asked.current;
      api.posts(current, { post_type: typeKey, status: status || undefined, search: search || undefined, page }).then(
        (l) => n === asked.current && setList(l),
        () => {},
      );
    });
    return () => {
      off.then((f) => f()).catch(() => {});
    };
  }, [current, typeKey, status, search, page]);

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
      <Skeleton label={`Reading ${site?.name}…`} />
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
    const rows = list.posts;
    const chosen = rows.filter((p) => picked.has(p.id));
    const inTrash = status === "trash";
    const canBack = site!.mode === "classic_monks" && hasTool(site!, "untrash-post");
    const actions: Bulk[] = inTrash ? (canBack ? ["untrash"] : []) : (["publish", "draft", ...(type.can_delete ? (["trash"] as Bulk[]) : [])] as Bulk[]);
    const bulk = (what: Bulk) => {
      const n = chosen.length;
      onPlan?.(`${BULK[what].title} ${n === 1 ? "1 entry" : `${n} entries`} on ${site!.name}`, bulkRows(site!, type, chosen, what), "confirm", BULK[what].danger);
    };
    body = (
      <>
        <p className="legend" id="content-legend">
          Select a title to open it, or tick entries to change several at once. Dates are in the site's own time zone.
          {inTrash && !canBack && " Bringing entries back from the trash needs Classic Monks on the site."}
        </p>
        {onPlan && actions.length > 0 && (
          <div className="bar" role="group" aria-label="Change the ticked entries">
            <span className="dim">{chosen.length === 0 ? "None ticked" : `${chosen.length} ticked`}</span>
            {actions.map((a) => (
              <Button key={a} small kind={BULK[a].danger ? "danger" : undefined} disabled={chosen.length === 0} onClick={() => bulk(a)}>
                {BULK[a].button}
                {chosen.length > 0 && ` (${chosen.length})`}
              </Button>
            ))}
          </div>
        )}
        <table className="t" aria-label={type.label} aria-describedby="content-legend">
          <thead>
            <tr>
              {onPlan && actions.length > 0 && (
                <th scope="col" className="tick">
                  <input
                    type="checkbox"
                    aria-label="Tick every entry on this page"
                    checked={chosen.length === rows.length}
                    onChange={(e) => setPicked(new Set(e.target.checked ? rows.map((p) => p.id) : []))}
                  />
                </th>
              )}
              <th scope="col">Title</th>
              <th scope="col">Status</th>
              <th scope="col">Author</th>
              <th scope="col">Last changed</th>
            </tr>
          </thead>
          <tbody>
            {list.posts.map((p) => (
              <tr key={p.id}>
                {onPlan && actions.length > 0 && (
                  <td className="tick">
                    <input
                      type="checkbox"
                      aria-label={`Tick ${p.title || "(no title)"}`}
                      checked={picked.has(p.id)}
                      onChange={(e) =>
                        setPicked((was) => {
                          const next = new Set(was);
                          if (e.target.checked) next.add(p.id);
                          else next.delete(p.id);
                          return next;
                        })
                      }
                    />
                  </td>
                )}
                <td className="name">
                  <button type="button" className="linkish" data-tip={p.title || "(no title)"} onClick={() => setOpen({ postId: p.id })}>
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
            <Select
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
            </Select>
          </label>
          <input className="input sm" aria-label={`Search ${type.label.toLowerCase()}`} placeholder={`Search ${type.label.toLowerCase()}`} value={typed} onChange={(e) => setTyped(e.target.value)} />
          <Button small type="submit">
            Search
          </Button>
          <span className="grow" />
          {onPlan && (
            <Button small onClick={() => setMany(true)}>
              Publish on several sites
            </Button>
          )}
          <Button kind="primary" small onClick={() => setOpen({})}>
            New {type.singular.toLowerCase()}
          </Button>
        </form>
      )}
      <div role="status" className="notice">
        {note && <p className="alert ok">{note}</p>}
      </div>
      {body}
      {many && onPlan && (
        <PublishMany
          sites={sites}
          first={current}
          onClose={() => setMany(false)}
          onPlan={(t, r) => {
            setMany(false);
            onPlan(t, r, "confirm");
          }}
        />
      )}
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
