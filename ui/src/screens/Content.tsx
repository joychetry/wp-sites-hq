// SPDX-License-Identifier: GPL-3.0-or-later
// Posts, pages and every post type a site lets us edit: list, filter, open, create (plan Phase 3).
import "../styles/screens/content.css";
import { Blocked, Empty, Skeleton, toast } from "../components/feedback";
import { Page, Toolbar } from "../components/page";
import { SearchInput, Segmented, Select } from "../components/controls";
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, contentBlocked, hasTool, type Action, type Listing, type PostType, type Site, type Summary, type Tone } from "../api";
import { JobSheet, type PlanRow } from "../components/JobSheet";
import { SiteTile } from "../components/SiteTile";
import { Button, Glyph, HeadActions, Icon } from "../components/ui";
import { Editor } from "./Editor";
import { PublishMany } from "./PublishMany";
import { day, dayTime } from "../format";

export const STATUS_LABEL: Record<string, string> = {
  publish: "Published",
  draft: "Draft",
  pending: "Pending review",
  private: "Private",
  future: "Scheduled",
  trash: "In the trash",
};

/** A status pill's tone: live is ok, scheduled is information (not a problem), the rest are neutral. */
const STATUS_TONE: Record<string, Tone | "info"> = { publish: "ok", future: "info" };

const FILTERS = [
  ["", "Everything but the trash"],
  ["publish", "Published"],
  ["future", "Scheduled"],
  ["draft", "Draft"],
  ["pending", "Pending review"],
  ["private", "Private"],
  ["trash", "In the trash"],
] as const;

/** "1 post", "5 posts": the type's own noun, never "entries". */
export const countOf = (n: number, type: PostType) => `${n} ${(n === 1 ? type.singular : type.label).toLowerCase()}`;

/** The first site whose content can be managed, so the screen opens on something useful. */
export function firstUsable(sites: Site[]): number | null {
  return (sites.find((s) => !contentBlocked(s)) ?? sites[0])?.id ?? null;
}

export function SitePick({ sites, value, onChange }: { sites: Site[]; value: number | null; onChange: (id: number) => void }) {
  // Usable sites first; the rest keep their order after them.
  const sorted = [...sites].sort((a, b) => Number(!!contentBlocked(a)) - Number(!!contentBlocked(b)));
  return (
    // No outside label: the box shows the site's tile and name (the same as the Site chips on Users and Comments).
    <label className="row pick pick-site" data-tip={sites.find((s) => s.id === value)?.name}>
      <Select className="input sm" aria-label="Site" value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))}>
        {sorted.map((s) => (
          <option key={s.id} value={s.id}>
            <SiteTile site={s} size="sm" />
            {s.name}
            {contentBlocked(s) && <small className="dim"> (not available)</small>}
          </option>
        ))}
      </Select>
    </label>
  );
}

type Open = { siteId: number; postId?: number };

type Bulk = "publish" | "draft" | "trash" | "untrash";
/** Each action's button, and its plan title as a whole sentence around "2 posts". */
const BULK: Record<Bulk, { button: string; title: (n: string, site: string) => string; danger?: boolean }> = {
  publish: { button: "Publish", title: (n, s) => `Publish ${n} on ${s}` },
  draft: { button: "Change to draft", title: (n, s) => `Change ${n} to draft on ${s}` },
  trash: { button: "Move to the trash", title: (n, s) => `Move ${n} to the trash on ${s}`, danger: true },
  untrash: { button: "Bring back from the trash", title: (n, s) => `Bring ${n} back from the trash on ${s}` },
};

/** The selected posts an action would change: publishing a published post is not a change. */
const changes = (posts: Summary[], what: Bulk) => (what === "publish" || what === "draft" ? posts.filter((p) => p.status !== what) : posts);

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
            : `Change \u201c${base.title}\u201d to draft`;
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
  useEffect(() => setOpen((o) => (o && o.siteId !== current ? null : o)), [current]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  // The entry the editor was opened from gets focus back when it closes.
  const back = useRef<number | null>(null);
  const [many, setMany] = useState(false);
  // Publish on several sites keeps its form (hidden) under its plan, so Back finds everything as typed.
  const [manyPlan, setManyPlan] = useState<{ title: string; rows: PlanRow[] } | null>(null);

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
  // A refresh after a save keeps the rows on screen, so nothing jumps under the pointer.
  const load = useCallback((keep = false) => {
    const n = ++asked.current;
    if (current == null || !typeKey) return;
    if (!keep) setList(null);
    api.posts(current, { post_type: typeKey, status: status || undefined, search: search || undefined, page }).then(
      (l) => {
        if (n !== asked.current) return;
        setList(l);
        setError(null);
      },
      (e) => n === asked.current && setError(String(e)),
    );
  }, [current, typeKey, status, search, page]);
  useEffect(() => load(), [load]);
  // Cleared in the same render as the new list: an effect would land after the rows show and drop fresh ticks.
  const [seen, setSeen] = useState(list);
  if (seen !== list) {
    setSeen(list);
    setPicked(new Set());
  }
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
      <Empty picture="sites" title="No sites yet">
        <p>Add a site on Sites, then its posts and pages show here.</p>
      </Empty>
    );
  }

  // Only on the site it was opened on: when that site leaves the list, the editor closes, and
  // never shows the same id on the next site.
  if (open && site && type && open.siteId === site.id) {
    return (
      <Editor
        key={open.postId ?? "new"}
        site={site}
        type={type}
        postId={open.postId}
        onClose={() => {
          back.current = open.postId ?? null;
          setOpen(null);
        }}
        onSaved={(msg, undo) => {
          const again = () =>
            undo!().then(
              () => {
                toast(`Brought back from the trash on ${site.name}.`);
                load(true);
              },
              (e) => toast(String(e), { tone: "danger" }),
            );
          toast(msg, undo ? { undo: again } : undefined);
          load(true);
        }}
      />
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
      <Blocked
        site={site!}
        reason={blocked}
        // Or go on with another site: the Site picker above opens.
        extra={<Button onClick={() => document.querySelector<HTMLElement>('.toolbar [aria-label="Site"]')?.click()}>Choose another site</Button>}
      />
    );
  } else if (error) {
    body = (
      <Empty alert title="The content didn't load" action={<Button onClick={() => (types ? load() : pickSite(site!.id))}>Try again</Button>}>
        <p>{error}</p>
      </Empty>
    );
  } else if (!types || !list || !type) {
    body = (
      <Skeleton label={`Reading ${site?.name}…`} />
    );
  } else if (list.posts.length === 0) {
    const noun = type.label.toLowerCase();
    const shown = FILTERS.find(([v]) => v === status)?.[1].toLowerCase();
    // Each case says what it is: the words found nothing, the filter is empty, or both.
    const title = search
      ? `No ${status && status !== "trash" ? `${shown} ` : ""}${noun} match \u201c${search}\u201d${status === "trash" ? " in the trash" : ""}`
      : status === "trash"
        ? "The trash is empty"
        : status
          ? `No ${shown} ${noun}`
          : `No ${noun} yet`;
    const clear = (
      <Button
        onClick={() => {
          setStatus("");
          setTyped("");
          setSearch("");
        }}
      >
        {search && status ? "Clear filters" : search ? "Clear search" : "Show everything but the trash"}
      </Button>
    );
    body = (
      <Empty picture={search || status ? "search" : undefined} title={title} action={(search || status) && clear}>
        {search ? <p>Try other words.</p> : !status && <p>Add the first one with New {type.singular.toLowerCase()}.</p>}
      </Empty>
    );
  } else {
    const rows = list.posts;
    const chosen = rows.filter((p) => picked.has(p.id));
    const inTrash = status === "trash";
    const canBack = site!.mode === "classic_monks" && hasTool(site!, "untrash-post");
    const actions: Bulk[] = inTrash ? (canBack ? ["untrash"] : []) : (["publish", "draft", ...(type.can_delete ? (["trash"] as Bulk[]) : [])] as Bulk[]);
    const bulk = (what: Bulk) => {
      const these = changes(chosen, what);
      onPlan?.(BULK[what].title(countOf(these.length, type), site!.name), bulkRows(site!, type, these, what), "confirm", BULK[what].danger);
    };
    const ticks = onPlan && actions.length > 0;
    const noun = type.label.toLowerCase();
    // Pages are the same size but the last, so the first post shown counts from either end.
    const first = list.page < list.pages ? (list.page - 1) * rows.length + 1 : list.total - rows.length + 1;
    body = (
      <>
        <p className={inTrash && !canBack ? "legend" : "sr-only"} id="content-legend">
          Select a title to open it, or select {noun} to change several at once. Dates are in the site's own time zone.
          {inTrash && !canBack && ` Bringing ${noun} back from the trash needs the WP Sites HQ plugin, Classic Monks or Classic Monks Pro on the site.`}
        </p>
        <table className="t" aria-label={type.label} aria-describedby="content-legend">
          <colgroup>
            {ticks && <col className="c-tick" />}
            <col className="c-fill" />
            {/* In the trash every row would say "In the trash". */}
            {!inTrash && <col className="c-status" />}
            <col className="c-text" />
            <col className="c-date" />
          </colgroup>
          <thead>
            <tr>
              {ticks && (
                <th scope="col" className="tick">
                  <input
                    type="checkbox"
                    aria-label={`Select every ${type.singular.toLowerCase()} on this page`}
                    checked={chosen.length === rows.length}
                    ref={(el) => {
                      if (el) el.indeterminate = chosen.length > 0 && chosen.length < rows.length;
                    }}
                    onChange={(e) => setPicked(new Set(e.target.checked ? rows.map((p) => p.id) : []))}
                  />
                </th>
              )}
              <th scope="col">Title</th>
              {!inTrash && <th scope="col">Status</th>}
              <th scope="col">Author</th>
              <th scope="col">Date</th>
            </tr>
          </thead>
          <tbody>
            {list.posts.map((p) => {
              const tone = STATUS_TONE[p.status] ?? "unknown";
              const when = p.date || p.modified;
              return (
                <tr key={p.id} className={picked.has(p.id) ? "sel" : undefined}>
                  {ticks && (
                    <td className="tick">
                      <input
                        type="checkbox"
                        aria-label={`Select ${p.title || "(no title)"}`}
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
                    <button
                      type="button"
                      className="linkish"
                      data-tip={p.title || "(no title)"}
                      ref={(el) => {
                        if (el && back.current === p.id) {
                          back.current = null;
                          el.focus();
                        }
                      }}
                      onClick={() => setOpen({ siteId: site!.id, postId: p.id })}
                    >
                      {p.title || "(no title)"}
                    </button>
                  </td>
                  {!inTrash && (
                    <td>
                      <span className={`st pill ${tone}`}>
                        <Icon tone={tone} />
                        {STATUS_LABEL[p.status] ?? p.status}
                      </span>
                    </td>
                  )}
                  <td className="who" data-tip={p.author || undefined}>
                    {p.author || "Not known"}
                  </td>
                  <td>
                    <span className="when" data-tip={dayTime(when) || undefined}>
                      {day(when) || when || "Not known"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {ticks && chosen.length > 0 && (
          <div className="selbar" role="group" aria-label={`Change the selected ${noun}`}>
            <b>{countOf(chosen.length, type)} selected</b>
            {actions.map((a) => {
              const n = changes(chosen, a).length;
              return (
                n > 0 && (
                  <Button key={a} small onClick={() => bulk(a)}>
                    {BULK[a].button}
                    {` (${n})`}
                    {a === "trash" && <Glyph name="trash" />}
                  </Button>
                )
              );
            })}
            <Button small keys="Esc" onClick={() => setPicked(new Set())}>
              Clear selection
            </Button>
          </div>
        )}
        <div className="card-foot">
          <span className="count">
            {list.pages <= 1 ? countOf(list.total, type) : `${first} to ${first + rows.length - 1} of ${countOf(list.total, type)}`}
          </span>
          {list.pages > 1 && (
            <>
              <Button small disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <Glyph name="arrow-left" />
                Previous page
              </Button>
              <Button small disabled={page >= list.pages} onClick={() => setPage(page + 1)}>
                Next page
                <Glyph name="arrow" />
              </Button>
            </>
          )}
        </div>
      </>
    );
  }

  return (
    <Page>
      <HeadActions>
        {onPlan && (
          <Button onClick={() => setMany(true)}>
            Publish on several sites
            <Glyph name="copy" />
          </Button>
        )}
        {type && !blocked && (
          <Button kind="primary" className="disc" onClick={() => setOpen({ siteId: site!.id })}>
            New {type.singular.toLowerCase()}
            <span className="btn-disc">
              <Glyph name="plus" />
            </span>
          </Button>
        )}
      </HeadActions>
      <form
        aria-label="What to show"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSearch(typed.trim());
        }}
      >
        <Toolbar>
          <SitePick sites={sites} value={current} onChange={pickSite} />
          {types && types.length > 0 && (
            <div className="row pick">
              <span className="label" aria-hidden="true">
                Type
              </span>
              <Segmented
                label="Post type"
                options={types.map((t) => ({ id: t.name, label: t.label }))}
                value={typeName}
                onChange={(t) => {
                  setTypeName(t);
                  setPage(1);
                }}
              />
            </div>
          )}
          {type && !blocked && (
            <>
              <label className="row pick">
                <span className="label">Show</span>
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
              {/* Enter searches; clearing the box shows everything again. */}
              <SearchInput
                className="end"
                aria-label={`Search ${type.label.toLowerCase()}`}
                placeholder={`Search ${type.label.toLowerCase()}`}
                value={typed}
                onChange={(e) => {
                  setTyped(e.target.value);
                  if (!e.target.value && search) {
                    setPage(1);
                    setSearch("");
                  }
                }}
              />
            </>
          )}
        </Toolbar>
      </form>
      <section
        className="card ctable"
        aria-label={type && site ? `${type.label} on ${site.name}` : "Posts"}
        onKeyDown={(e) => {
          if (e.key === "Escape" && picked.size > 0) {
            e.preventDefault();
            setPicked(new Set());
          }
        }}
      >
        {body}
      </section>
      {many && onPlan && (
        <div hidden={!!manyPlan}>
          <PublishMany sites={sites} first={current} onClose={() => setMany(false)} onPlan={(title, rows) => setManyPlan({ title, rows })} />
        </div>
      )}
      {manyPlan && (
        <JobSheet
          key={manyPlan.title}
          state={{ ...manyPlan, start: "confirm" }}
          onClose={() => {
            setManyPlan(null);
            setMany(false);
          }}
          onBack={() => setMany(true)}
          // Plain "Back": the plan's footer is narrow, and the longer label pushed the arrow off its edge.
          backLabel="Back"
        />
      )}
    </Page>
  );
}
