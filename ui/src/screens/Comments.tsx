// SPDX-License-Identifier: GPL-3.0-or-later
// One comment inbox for every site shown: approve, unapprove, spam, trash and reply (plan Phase 4).
import "../styles/screens/comments.css";
import { askSignIn, Blocked, Empty, Skeleton, toast } from "../components/feedback";
import { Page, Toolbar } from "../components/page";
import { Menu, Segmented } from "../components/controls";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, peopleBlocked, type Comment, type CommentState, type Moderation, type Site } from "../api";
import { initials, SiteTile } from "../components/SiteTile";
import { Button, Glyph } from "../components/ui";
import { dayTime } from "../format";

const SHOW: [CommentState, string][] = [
  ["pending", "Waiting for approval"],
  ["approved", "Approved"],
  ["spam", "Spam"],
  ["trash", "Trash"],
];

const EMPTY: Record<CommentState, string> = {
  pending: "No comments are waiting",
  approved: "No approved comments",
  spam: "No spam",
  trash: "Nothing in the trash",
};

const DONE: Record<Moderation, string> = {
  approve: "Approved",
  unapprove: "Moved back to waiting",
  spam: "Marked as spam",
  trash: "Moved to the trash",
};

type Row = { site: Site; c: Comment };
type Loaded = { rows: Row[]; totals: Record<number, number>; partial: { site: Site; shown: number; total: number }[]; failed: { site: Site; error: string }[] };

/** Comments arrive as HTML from the site: show the words only. */
export const plainText = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .trim();

export function Comments({ sites }: { sites: Site[] }) {
  const usable = sites.filter((s) => !peopleBlocked(s, "get-comments"));
  const blocked = sites.filter((s) => peopleBlocked(s, "get-comments"));
  const [show, setShow] = useState<CommentState>("pending");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [replying, setReplying] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // The Site filter works on the comments already read.
  const [siteF, setSiteF] = useState<number | null>(null);
  // How many wait for approval per site, from the last time that list was read: its count shows on every tab.
  const [waiting, setWaiting] = useState<Record<number, number> | null>(null);
  const ids = usable.map((s) => s.id).join(",");

  // Only the newest request's answer is shown, so a slow older search or tab can't replace it.
  const asked = useRef(0);
  // A refresh after an action keeps the rows on screen, so nothing jumps under the pointer.
  const load = useCallback((keep = false) => {
    const n = ++asked.current;
    if (!keep) setLoaded(null);
    Promise.all(
      usable.map((site) =>
        api.comments(site.id, show).then(
          (c) => ({ site, c }),
          (e) => ({ site, error: String(e) }),
        ),
      ),
    ).then((all) => {
      const out: Loaded = { rows: [], totals: {}, partial: [], failed: [] };
      for (const r of all) {
        if ("error" in r) out.failed.push({ site: r.site, error: r.error });
        else {
          out.rows.push(...r.c.comments.map((c) => ({ site: r.site, c })));
          out.totals[r.site.id] = r.c.total;
          if (r.c.total > r.c.comments.length) out.partial.push({ site: r.site, shown: r.c.comments.length, total: r.c.total });
        }
      }
      out.rows.sort((a, b) => b.c.date.localeCompare(a.c.date));
      if (n !== asked.current) return;
      setLoaded(out);
      if (show === "pending") setWaiting(out.totals);
    });
    // `ids` stands for the usable sites.
  }, [ids, show]);
  useEffect(() => load(), [load]);
  // Undo can run after a tab change, so it reads whichever list is showing then.
  const latest = useRef(load);
  latest.current = load;
  const refresh = () => latest.current(true);

  if (sites.length === 0) {
    return (
      <Page>
        <Empty picture="sites" title="No sites yet">
          <p>Add a site on Sites, then its comments show here.</p>
        </Empty>
      </Page>
    );
  }

  const key = (r: Row) => `${r.site.id}-${r.c.id}`;
  const act = async (r: Row, action: Moderation) => {
    setBusy(key(r));
    // A reload already on its way left before this change; its list would bring the comment back.
    asked.current++;
    // Optimistic: every action moves the comment out of this list, so it goes at once and comes back if the site says no.
    // A keyboard user's focus goes on to the comment that takes its place, not back to the top of the page.
    const item = (document.activeElement as HTMLElement | null)?.closest(".inbox > li");
    const next = item?.nextElementSibling ?? item?.previousElementSibling;
    setLoaded((l) => l && { ...l, rows: l.rows.filter((x) => key(x) !== key(r)) });
    requestAnimationFrame(() => next?.querySelector<HTMLElement>("button")?.focus());
    try {
      await api.moderate(r.site.id, r.c.id, action);
      // Undo puts it back in the list it came from (approved or waiting); a comment from spam or the trash has no way back here.
      const back: Moderation | null = r.c.status === "approved" ? "approve" : r.c.status === "pending" ? "unapprove" : null;
      toast(`${DONE[action]}: ${r.c.author || "a visitor"}'s comment on ${r.site.name}.`, {
        undo: back ? () => api.moderate(r.site.id, r.c.id, back).then(refresh, (e) => toast(String(e), { tone: "danger" })) : undefined,
      });
      refresh();
    } catch (e) {
      toast(String(e), { tone: "danger" });
      refresh();
    } finally {
      setBusy(null);
    }
  };
  const send = async (r: Row) => {
    setBusy(key(r));
    // A reply goes up at once, so a waiting comment is approved first, or the reply would show under a hidden comment (as wp-admin does).
    const approve = r.c.status === "pending";
    try {
      if (approve) await api.moderate(r.site.id, r.c.id, "approve");
      await api.reply(r.site.id, r.c.id, r.c.post_id, reply);
      toast(`${approve ? "Approved and replied" : "Replied"} to ${r.c.author || "the comment"} on ${r.site.name}.`);
      setReplying(null);
      setReply("");
      refresh();
    } catch (e) {
      toast(String(e), { tone: "danger" });
      // The approve may have gone through before the reply failed.
      if (approve) refresh();
    } finally {
      setBusy(null);
    }
  };

  const label = SHOW.find(([v]) => v === show)![1].toLowerCase();
  const rows = (loaded?.rows ?? []).filter((r) => siteF == null || r.site.id === siteF);
  // Counts follow the Site filter; the waiting count shows on every tab, the others only on their own.
  const sum = (t: Record<number, number>) => Object.entries(t).reduce((n, [id, c]) => (siteF == null || Number(id) === siteF ? n + c : n), 0);
  const count = (v: CommentState) => (v === show && loaded ? sum(loaded.totals) : v === "pending" && waiting ? sum(waiting) : undefined);
  // The only site, and it can't list comments: the blocked state with its fix.
  const lone = usable.length === 0 && blocked.length === 1 ? blocked[0] : null;
  let body;
  if (lone) {
    body = (
      <section className="card">
        <Blocked site={lone} reason={peopleBlocked(lone, "get-comments")!} title={`${lone.name}'s comments aren't available here`} />
      </section>
    );
  } else if (!loaded) {
    body = (
      <Skeleton label={`Reading comments on ${usable.length} ${usable.length === 1 ? "site" : "sites"}…`} />
    );
  } else if (rows.length === 0) {
    body = (
      <section className="card">
        <Empty picture="inbox" title={EMPTY[show]}>
          <p>{siteF != null ? "None on this site. Pick another site, or any site." : show === "pending" ? "New comments that need approval show here, from every site." : "Pick another list above."}</p>
        </Empty>
      </section>
    );
  } else {
    body = (
      <>
        <p className="sr-only" id="comments-legend">
          Newest first, from every site shown. Dates are in each site's own time zone.
        </p>
        <ul className="stack inbox" aria-label={`Comments, ${label}`} aria-describedby="comments-legend">
          {rows.map((r) => {
            const k = key(r);
            const who = r.c.author || "A visitor";
            const open = replying === k;
            return (
              <li key={k} className="card">
                <div className="card-body">
                  <div className="cwho">
                    <span className="av lg well" aria-hidden="true">
                      {initials(who)}
                    </span>
                    <div>
                      <b data-tip={r.c.email || undefined}>{who}</b>
                      <span className="on">
                        <SiteTile site={r.site} size="sm" />
                        <b>{r.site.name}</b> · <span data-tip={r.c.post_title}>{r.c.post_title || "A page with no title"}</span>
                      </span>
                    </div>
                    <span className="when">{dayTime(r.c.date) || r.c.date}</span>
                  </div>
                  <p className="said">{plainText(r.c.content) || "(empty)"}</p>
                  <div className="rowacts">
                    {show !== "approved" && (
                      <Button small kind="soft" disabled={busy === k} aria-label={`Approve ${who}'s comment on ${r.site.name}`} onClick={() => act(r, "approve")}>
                        Approve
                        <Glyph name="check" />
                      </Button>
                    )}
                    {show === "approved" && (
                      <Button small disabled={busy === k} aria-label={`Unapprove ${who}'s comment on ${r.site.name}`} onClick={() => act(r, "unapprove")}>
                        Unapprove
                      </Button>
                    )}
                    {(show === "pending" || show === "approved") && (
                      <Button
                        small
                        aria-label={`Reply to ${who} on ${r.site.name}`}
                        aria-expanded={open}
                        onClick={() => {
                          setReplying(open ? null : k);
                          setReply("");
                        }}
                      >
                        Reply
                        <Glyph name="reply" />
                      </Button>
                    )}
                    {show !== "spam" && (
                      <Button small disabled={busy === k} aria-label={`Mark as spam: ${who}'s comment on ${r.site.name}`} onClick={() => act(r, "spam")}>
                        Mark as spam
                      </Button>
                    )}
                    {show !== "trash" && (
                      <Button small disabled={busy === k} aria-label={`Move to the trash: ${who}'s comment on ${r.site.name}`} onClick={() => act(r, "trash")}>
                        Move to the trash
                        <Glyph name="trash" />
                      </Button>
                    )}
                  </div>
                  {open && (
                    <form
                      className="reply"
                      onSubmit={(e) => {
                        e.preventDefault();
                        send(r);
                      }}
                    >
                      <label className="field">
                        <span>Your reply to {who}</span>
                        <textarea className="input" rows={3} autoFocus value={reply} onChange={(e) => setReply(e.target.value)} />
                        <small>{r.c.status === "pending" ? `It goes up at once, as you, on ${r.site.name}, and their comment is approved with it.` : `It goes up at once, as you, on ${r.site.name}.`}</small>
                      </label>
                      <div className="rowacts">
                        <Button small className="ghost" onClick={() => setReplying(null)}>
                          Close without sending
                        </Button>
                        <Button small kind="primary" className="disc" type="submit" disabled={busy === k || !reply.trim()}>
                          {busy === k ? "Sending…" : r.c.status === "pending" ? "Approve and reply" : "Send the reply"}
                          <span className="btn-disc">
                            <Glyph name="arrow" />
                          </span>
                        </Button>
                      </div>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </>
    );
  }
  const siteName = usable.find((s) => s.id === siteF)?.name;

  return (
    <Page className="comments">
      <Toolbar>
        <Segmented label="Show" options={SHOW.map(([id, l]) => ({ id, label: l, count: count(id) || undefined }))} value={show} onChange={setShow} />
        <span className="end" />
        <Menu label="Site" className={siteF == null ? "chip" : "chip on"} items={[{ label: "Any", checked: siteF == null, run: () => setSiteF(null) }, ...usable.map((s) => ({ label: s.name, checked: siteF === s.id, run: () => setSiteF(s.id) }))]}>
          Site: <b>{siteName ?? "Any"}</b>
        </Menu>
      </Toolbar>
      {body}
      {loaded && (loaded.partial.length > 0 || loaded.failed.length > 0 || (blocked.length > 0 && !lone)) && (
        <ul className="pnotes" aria-label="Sites not fully shown">
          {loaded.partial.map((p) => (
            <li key={p.site.id} className="callout">
              <Glyph name="info" />
              <span>
                {p.site.name}: showing the newest {p.shown} of {p.total}. Deal with these to see the rest.
              </span>
            </li>
          ))}
          {loaded.failed.map((f) => (
            <li key={f.site.id} className="callout warning">
              <Glyph name="alert" />
              <span>
                {f.site.name}: the comments didn't load. {f.error}
              </span>
            </li>
          ))}
          {!lone && blocked.map((s) => (
            <li key={s.id} className="callout go">
              <Glyph name="lock" />
              <span>
                {s.name}: {peopleBlocked(s, "get-comments")}
              </span>
              <Button small onClick={() => askSignIn(s.id)}>
                Sign in again
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
