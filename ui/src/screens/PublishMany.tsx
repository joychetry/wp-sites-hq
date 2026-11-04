// SPDX-License-Identifier: GPL-3.0-or-later
// One entry, written once, published on several sites as one plan (plan Phase 7).
import "../styles/screens/editor.css";
import { Select, DateInput } from "../components/controls";
import { useState } from "react";
import { askOpenSite, askSignIn } from "../components/feedback";
import { day, time } from "../format";
import { contentBlocked, type Change, type Site } from "../api";
import type { PlanRow } from "../components/JobSheet";
import { SiteTile } from "../components/SiteTile";
import { Button, Glyph } from "../components/ui";
import { Sheet } from "../components/Sheet";
import { siteDate, toBlocks } from "./Editor";

const KINDS = [
  ["post", "Post"],
  ["page", "Page"],
] as const;
const STATUSES = [
  ["publish", "Published"],
  ["draft", "Draft"],
  ["pending", "Pending review"],
] as const;

type Props = { sites: Site[]; first: number | null; onClose: () => void; onPlan: (title: string, rows: PlanRow[]) => void };

/** What one plan row says: the verb, the kind, the title, then the date, status and categories, so the review shows it all. */
export function planLabel(kind: "post" | "page", title: string, status: string, date: string, categories: string[]) {
  const when = date ? `${day(date)}, ${time(date)}` : "";
  const verb = when && status === "publish" ? "Schedule" : status === "publish" ? "Publish" : "Add";
  const how = status === "draft" ? " as a draft" : status === "pending" ? " for review" : "";
  const at = when ? (verb === "Schedule" ? ` for ${when}` : ` dated ${when}`) : "";
  const cats = kind === "post" && categories.length ? ` in ${categories.join(", ")}` : "";
  return { verb, label: `${verb} the ${kind} \u201c${title}\u201d${how}${at}${cats}` };
}

export function PublishMany({ sites, first, onClose, onPlan }: Props) {
  const usable = sites.filter((s) => !contentBlocked(s));
  const [kind, setKind] = useState<"post" | "page">("post");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("publish");
  const [date, setDate] = useState("");
  const [cats, setCats] = useState("");
  const [picked, setPicked] = useState<Set<number>>(() => new Set(first != null && usable.some((s) => s.id === first) ? [first] : []));

  const [tried, setTried] = useState(false);
  const categories = cats.split(",").map((c) => c.trim()).filter(Boolean);
  const review = () => {
    // The button stays on and says what is missing, instead of greying out without a reason.
    setTried(true);
    if (!title.trim() || picked.size === 0) return;
    const action: Change["action"] = {
      do: "publish_post",
      post_type: kind,
      title: title.trim(),
      body: toBlocks(body),
      status,
      ...(date ? { date: siteDate(date) } : {}),
      ...(kind === "post" && categories.length ? { terms: { category: categories } } : {}),
    };
    const { verb, label } = planLabel(kind, action.title, status, date, categories);
    const rows: PlanRow[] = usable.filter((s) => picked.has(s.id)).map((s) => ({ change: { site_id: s.id, action }, site: s.name, label }));
    onPlan(`${verb} “${action.title}” on ${rows.length === 1 ? "1 site" : `${rows.length} sites`}`, rows);
  };

  const footer = (
    <>
      <span className="sum">{picked.size === 1 ? "1 site" : `${picked.size} sites`} selected</span>
      <Button onClick={onClose}>Close without saving</Button>
      <Button kind="primary" className="disc" onClick={review}>
        Review the plan
        <span className="btn-disc">
          <Glyph name="arrow" />
        </span>
      </Button>
    </>
  );

  return (
    <Sheet title="Publish on several sites" intro="Write it once. Each site gets its own copy, made the same way." onClose={onClose} footer={footer}>
      <fieldset className="field">
        <legend>What to add</legend>
        <div className="segmented inline" role="group" aria-label="Kind">
          {KINDS.map(([v, l]) => (
            <button key={v} type="button" aria-pressed={kind === v} onClick={() => setKind(v)}>
              {l}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="field">
        <span>Title</span>
        <input className="input" aria-required="true" aria-invalid={(tried && !title.trim()) || undefined} aria-describedby={tried && !title.trim() ? "pm-title-err" : undefined} value={title} onChange={(e) => setTitle(e.target.value)} />
        {tried && !title.trim() && (
          <small className="err" id="pm-title-err">
            Add a title first.
          </small>
        )}
      </label>
      <label className="field">
        <span>Text</span>
        <textarea className="input" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
        <small>Leave a blank line between paragraphs.</small>
      </label>
      <label className="field">
        <span>Status</span>
        <Select className="input" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </label>
      <div className="field">
        <span>Publish date (each site's own time)</span>
        <DateInput type="datetime-local" aria-label="Publish date" value={date} onChange={(e) => setDate(e.target.value)} />
        <small>Empty means now. With Published, a date after now schedules it.</small>
      </div>
      {kind === "post" && (
        <label className="field">
          <span>Categories</span>
          <input className="input" placeholder="News, Events" value={cats} onChange={(e) => setCats(e.target.value)} />
          <small>Names, separated by commas. A site that doesn't have one yet gets it.</small>
        </label>
      )}
      <fieldset className="field pm-sites">
        <legend>Sites</legend>
        {tried && picked.size === 0 && <small className="err">Select at least one site.</small>}
        {sites.map((s) => {
          const why = contentBlocked(s);
          const signIn = s.sign_in_again || /sign in again/i.test(why ?? "");
          return (
            <label key={s.id} className={why ? "row check na" : "row check"}>
              <input
                type="checkbox"
                disabled={!!why}
                checked={picked.has(s.id)}
                onChange={(e) =>
                  setPicked((p) => {
                    const next = new Set(p);
                    if (e.target.checked) next.add(s.id);
                    else next.delete(s.id);
                    return next;
                  })
                }
              />
              <SiteTile site={s} size="sm" />
              <span className="pm-name">{s.name}</span>
              {why && (
                <small>
                  {why}{" "}
                  <button type="button" className="link" onClick={() => (signIn ? askSignIn(s.id) : askOpenSite(s.id))}>
                    {signIn ? "Sign in again" : "Open in Sites"}
                  </button>
                </small>
              )}
            </label>
          );
        })}
      </fieldset>
    </Sheet>
  );
}
