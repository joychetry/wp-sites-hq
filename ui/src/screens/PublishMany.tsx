// SPDX-License-Identifier: GPL-3.0-or-later
// One entry, written once, published on several sites as one plan (plan Phase 7).
import "../styles/screens/editor.css";
import { Select, DateInput } from "../components/controls";
import { useState } from "react";
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

export function PublishMany({ sites, first, onClose, onPlan }: Props) {
  const usable = sites.filter((s) => !contentBlocked(s));
  const [kind, setKind] = useState<"post" | "page">("post");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("publish");
  const [date, setDate] = useState("");
  const [cats, setCats] = useState("");
  const [picked, setPicked] = useState<Set<number>>(() => new Set(first != null && usable.some((s) => s.id === first) ? [first] : []));

  const categories = cats.split(",").map((c) => c.trim()).filter(Boolean);
  const review = () => {
    const action: Change["action"] = {
      do: "publish_post",
      post_type: kind,
      title: title.trim(),
      body: toBlocks(body),
      status,
      ...(date ? { date: siteDate(date) } : {}),
      ...(kind === "post" && categories.length ? { terms: { category: categories } } : {}),
    };
    const verb = date && status === "publish" ? "Schedule" : status === "publish" ? "Publish" : "Add";
    const label = `${verb} “${action.title}”${status === "publish" ? "" : ` as a ${status === "draft" ? "draft" : "pending review entry"}`}`;
    const rows: PlanRow[] = usable.filter((s) => picked.has(s.id)).map((s) => ({ change: { site_id: s.id, action }, site: s.name, label }));
    onPlan(`${verb} “${action.title}” on ${rows.length === 1 ? "1 site" : `${rows.length} sites`}`, rows);
  };

  const footer = (
    <>
      <span className="sum">{picked.size === 1 ? "1 site" : `${picked.size} sites`} picked</span>
      <Button onClick={onClose}>Close without publishing</Button>
      <Button kind="primary" className="disc" disabled={!title.trim() || picked.size === 0} onClick={review}>
        <span className="btn-disc">
          <Glyph name="arrow" />
        </span>
        Review the plan
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
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>Text</span>
        <textarea className="input" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
        <small>Each paragraph becomes a paragraph block. Leave a blank line between paragraphs.</small>
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
        {sites.map((s) => {
          const why = contentBlocked(s);
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
              {why && <small>{why}</small>}
            </label>
          );
        })}
      </fieldset>
    </Sheet>
  );
}
