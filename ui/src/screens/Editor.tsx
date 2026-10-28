// SPDX-License-Identifier: GPL-3.0-or-later
// One entry in a side sheet: title, status, terms, featured image, and the body
// through the block-safe editor (only text blocks change; every other block stays).
import "../styles/screens/media.css";
import "../styles/screens/editor.css";
import { Combobox, DateInput, Select } from "../components/controls";
import { useEffect, useState } from "react";
import { api, hasTool, type Block, type Draft, type Post, type PostType, type Revision, type Site, type Taxonomy, type TermRef } from "../api";
import { Button, Glyph } from "../components/ui";
import { toast } from "../components/feedback";
import { Sheet } from "../components/Sheet";
import { MediaPicker } from "../components/MediaPicker";
import { STATUS_LABEL } from "./Content";

const STATUSES = ["publish", "draft", "pending", "private"];

/** "core/paragraph" -> "Paragraph", "acme/map" -> "Map (acme)", "" -> "Text". */
export function blockLabel(name: string): string {
  if (!name) return "Text";
  const [ns, rest] = name.includes("/") ? name.split("/") : ["core", name];
  const words = rest.replace(/-/g, " ");
  const label = words.charAt(0).toUpperCase() + words.slice(1);
  return ns === "core" ? label : `${label} (${ns})`;
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Plain text to paragraph blocks: a blank line starts a new paragraph. */
export function toBlocks(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<!-- wp:paragraph -->\n<p>${escape(p).replace(/\n/g, "<br>")}</p>\n<!-- /wp:paragraph -->`)
    .join("\n\n");
}

type Pick = { id?: number; name: string };

/** "Sam Okafor" -> "SO", "joy" -> "J", "" -> "?": the avatar on a version. */
const initials = (name: string) => (name.match(/(?<![\p{L}\p{N}])[\p{L}\p{N}]/gu) ?? ["?"]).slice(0, 2).join("").toUpperCase();

/** A datetime-local value ("2026-11-02T09:30" or with seconds) as the site takes it. */
export function siteDate(local: string): string {
  const [day, time = ""] = local.split("T");
  return `${day} ${time.length === 5 ? `${time}:00` : time}`;
}

/** Custom fields: text values can change; lists and other values stay as they are. */
function FieldsEdit({ meta, value, onChange }: { meta: Record<string, unknown>; value: Record<string, string | null>; onChange: (v: Record<string, string | null>) => void }) {
  const [key, setKey] = useState("");
  const [val, setVal] = useState("");
  const keys = [...new Set([...Object.keys(meta), ...Object.keys(value)])].sort();
  const add = () => {
    const k = key.trim();
    if (!k || k.startsWith("_")) return;
    onChange({ ...value, [k]: val });
    setKey("");
    setVal("");
  };
  return (
    <fieldset className="field fields">
      <legend>Custom fields</legend>
      {keys.length === 0 && <span className="dim">None</span>}
      {keys.map((k) => {
        const was = meta[k];
        const now = k in value ? value[k] : was;
        if (now === null) {
          return (
            <div key={k} className="row">
              <span className="mono cut">{k}</span>
              <span className="dim">Removed when you save</span>
              <Button small onClick={() => onChange(Object.fromEntries(Object.entries(value).filter(([x]) => x !== k)))}>
                Keep {k}
              </Button>
            </div>
          );
        }
        return (
          <div key={k} className={typeof now === "string" ? "row fieldrow" : "row"}>
            {typeof now === "string" ? (
              <label className="field grow">
                <span>{k}</span>
                <input className="input" value={now} onChange={(e) => onChange({ ...value, [k]: e.target.value })} />
              </label>
            ) : (
              <span className="grow">
                <b>{k}</b> <span className="dim">kept as is (not plain text)</span>
              </span>
            )}
            <button type="button" className="icon-btn line" aria-label={`Remove the field ${k}`} data-tip={`Remove ${k}`} onClick={() => onChange({ ...value, [k]: null })}>
              <Glyph name="x" />
            </button>
          </div>
        );
      })}
      <div className="row">
        <input className="input" aria-label="New field name" placeholder="New field name" value={key} onChange={(e) => setKey(e.target.value)} />
        <input className="input" aria-label="New field value" placeholder="New field value" value={val} onChange={(e) => setVal(e.target.value)} />
        <Button onClick={add} disabled={!key.trim() || key.trim().startsWith("_")}>
          <Glyph name="plus" />
          Add the field
        </Button>
      </div>
      {key.trim().startsWith("_") && <small className="why danger">Names starting with an underscore belong to plugins and can't be set here.</small>}
    </fieldset>
  );
}

/** Earlier saved versions, each one can be put back (the site keeps the current one too). */
function History({ site, post, onRestored }: { site: Site; post: Post; onRestored: (p: Post, message: string) => void }) {
  const [list, setList] = useState<Revision[] | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<Revision | null>(null);
  const [busy, setBusy] = useState(false);
  const show = () => {
    setOpen(true);
    api.revisions(site.id, post.id).then(setList, (e) => setError(String(e)));
  };
  const restore = async (r: Revision) => {
    setBusy(true);
    try {
      const msg = await api.restoreRevision(site.id, post.id, r.id);
      const p = await api.post(site.id, post.post_type, post.id);
      onRestored(p, `${msg} "${p.title}" on ${site.name} is back to the version from ${r.date}.`);
      setAsking(null);
      setList(await api.revisions(site.id, post.id));
    } catch (e) {
      toast(String(e), { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };
  if (!open) {
    return (
      <Button small onClick={show}>
        <Glyph name="history" />
        Show earlier versions
      </Button>
    );
  }
  return (
    <div className="versions">
      {error && <p className="alert danger">{error}</p>}
      {!list && !error && <p role="status">Reading earlier versions…</p>}
      {list?.length === 0 && <p className="dim">No earlier versions are saved.</p>}
      {list && list.length > 0 && (
        <ul className="vlist" aria-label="Earlier versions">
          {list.map((r) => {
            const on = asking?.id === r.id;
            return (
              <li key={r.id} className={on ? "on" : undefined}>
                <span className="av" aria-hidden="true">
                  {initials(r.author)}
                </span>
                <span className="vwho">
                  <b>{r.author || "Someone"}</b>
                  <span>
                    <span className="mono">{r.date}</span> · {r.title || "(no title)"}
                  </span>
                </span>
                <Button small className={on ? undefined : "quiet"} aria-pressed={on} aria-label={`Put this version back, from ${r.date}`} onClick={() => setAsking(on ? null : r)}>
                  Put this version back
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {asking && (
        <div className="callout vask">
          <Glyph name="undo" />
          <div>
            <p>
              <b>Put back the version from {asking.date}?</b> The title and body go back to that version. The current one is kept as a version too, so you can undo this.
            </p>
            <div className="row">
              <Button small onClick={() => setAsking(null)}>
                Keep the current one
              </Button>
              <Button small kind="primary" disabled={busy} onClick={() => restore(asking)}>
                {busy ? "Putting it back…" : "Put it back"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TermsField({ site, tax, value, onChange }: { site: Site; tax: Taxonomy; value: Pick[]; onChange: (v: Pick[]) => void }) {
  const [known, setKnown] = useState<Pick[]>([]);
  const [typed, setTyped] = useState("");
  const [why, setWhy] = useState("");
  useEffect(() => {
    api.terms(site.id, tax.name).then(setKnown, () => setKnown([]));
  }, [site.id, tax.name]);
  const add = () => {
    const name = typed.trim();
    if (!name) return;
    const found = known.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (!found && !tax.can_add) {
      setWhy(`Pick one of the existing ${tax.label.toLowerCase()}.`);
      return;
    }
    setWhy("");
    const pick = found ?? { name };
    if (!value.some((v) => v.name.toLowerCase() === pick.name.toLowerCase())) onChange([...value, pick]);
    setTyped("");
  };
  return (
    <fieldset className="field terms">
      <legend>{tax.label}</legend>
      <div className="tags">
        {value.length === 0 && <span className="dim">None</span>}
        {value.map((t) => (
          <span key={t.name} className="term">
            {t.name}
            {t.id == null && " (new)"}
            <button type="button" aria-label={`Remove ${t.name}`} onClick={() => onChange(value.filter((v) => v !== t))}>
              <Glyph name="x" />
            </button>
          </span>
        ))}
      </div>
      <div className="row">
        <Combobox
          className="input sm"
          suggestions={known.map((t) => t.name)}
          aria-label={`Add to ${tax.label}`}
          placeholder={tax.can_add ? "Type a name, new or existing" : "Type an existing name"}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button small onClick={add} disabled={!typed.trim()}>
          Add
        </Button>
      </div>
      {why && <small className="why danger">{why}</small>}
    </fieldset>
  );
}

function BlockRow({ b, value, onChange }: { b: Block; value: string; onChange: (html: string) => void }) {
  const label = `${blockLabel(b.name)} ${b.index + 1}`;
  const style = { marginLeft: `calc(${b.depth} * var(--sp-4))` };
  if (!b.editable) {
    return (
      <li className="blk locked" style={style}>
        <span className="blk-name">{label}</span>
        <span className="dim cut" data-tip={b.html}>
          {b.html || "No text"}
        </span>
        <span className="tag">Kept as is</span>
      </li>
    );
  }
  return (
    <li className="blk" style={style}>
      <label className="field">
        <span>{label}</span>
        <textarea className="input" rows={Math.min(8, Math.max(2, Math.ceil(value.length / 70)))} value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </li>
  );
}

type Props = { site: Site; type: PostType; postId?: number; onClose: () => void; onSaved: (message: string, undo?: () => Promise<unknown>) => void };

export function Editor({ site, type, postId, onClose, onSaved }: Props) {
  const isNew = postId == null;
  const [post, setPost] = useState<Post | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("draft");
  const [terms, setTerms] = useState<Record<string, Pick[]>>({});
  const [image, setImage] = useState<{ id: number; url: string | null }>({ id: 0, url: null });
  const [picking, setPicking] = useState(false);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trashing, setTrashing] = useState(false);
  const [date, setDate] = useState("");
  const [fields, setFields] = useState<Record<string, string | null>>({});
  const cm = site.mode === "classic_monks";
  const canFields = cm && hasTool(site, "get-post-meta");
  const canHistory = cm && hasTool(site, "list-revisions");

  const fill = (p: Post) => {
    setPost(p);
    setTitle(p.title);
    setStatus(p.status);
    setTerms(Object.fromEntries(type.taxonomies.map((t) => [t.name, (p.terms[t.name] ?? []).map((x) => ({ id: x.id, name: x.name }))])));
    setImage({ id: p.featured_image, url: p.featured_url });
    setEdits({});
    setDate(p.date ? p.date.replace(" ", "T") : "");
    setFields({});
  };

  useEffect(() => {
    if (isNew) return;
    api.post(site.id, type.name, postId).then(fill, (e) => setLoadError(String(e)));
    // Loaded once: the sheet is keyed by the entry.
  }, []);

  const termsChanged = (name: string) => {
    const was = (post?.terms[name] ?? []).map((t) => t.id).join(",");
    return (terms[name] ?? []).map((t) => t.id ?? t.name).join(",") !== was;
  };

  const draft = (): Draft => {
    const d: Draft = {};
    const refs = (name: string): TermRef[] => (terms[name] ?? []).map((t) => t.id ?? t.name);
    const changedTerms = type.taxonomies.filter((t) => (isNew ? (terms[t.name] ?? []).length > 0 : termsChanged(t.name)));
    if (changedTerms.length) d.terms = Object.fromEntries(changedTerms.map((t) => [t.name, refs(t.name)]));
    const meta = Object.entries(fields).filter(([k, v]) => post?.meta[k] !== v);
    if (meta.length) d.meta = Object.fromEntries(meta);
    if (isNew) {
      d.title = title;
      d.status = status;
      d.body = toBlocks(body);
      if (image.id) d.featured_image = image.id;
      if (date) d.date = siteDate(date);
      return d;
    }
    if (date && siteDate(date) !== post!.date) d.date = siteDate(date);
    if (title !== post!.title) d.title = title;
    if (status !== post!.status) d.status = status;
    if (image.id !== post!.featured_image) d.featured_image = image.id;
    const changed = post!.blocks.filter((b) => b.editable && edits[b.index] != null && edits[b.index] !== b.html);
    if (changed.length) d.edits = changed.map((b) => ({ index: b.index, html: edits[b.index] }));
    d.seen_modified = post!.modified;
    return d;
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        const p = await api.createPost(site.id, type.name, draft());
        onSaved(`Added "${p.title}" to ${site.name} as ${(STATUS_LABEL[p.status] ?? p.status).toLowerCase()}.`);
        onClose();
      } else {
        const p = await api.editPost(site.id, type.name, postId, draft());
        fill(p);
        onSaved(`Saved "${p.title}" on ${site.name}.`);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const untrash = async () => {
    setSaving(true);
    setError(null);
    try {
      const now = await api.untrash(site.id, postId!);
      fill(await api.post(site.id, type.name, postId!));
      onSaved(`Brought "${post?.title}" back from the trash on ${site.name}, as ${(STATUS_LABEL[now] ?? now).toLowerCase()}.`);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const trash = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.trashPost(site.id, type.name, postId!);
      // Classic Monks can bring it straight back from the message.
      const back = cm && hasTool(site, "untrash-post") ? () => api.untrash(site.id, postId!) : undefined;
      onSaved(`Moved "${post?.title}" to the trash on ${site.name}.`, back);
      onClose();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  const noun = type.singular.toLowerCase();
  const d = post || isNew ? draft() : {};
  const dirty = isNew ? title.trim() !== "" : Object.keys(d).some((k) => k !== "seen_modified");
  const statuses = post && !STATUSES.includes(post.status) ? [post.status, ...STATUSES] : STATUSES;
  const thumbnail = type.supports.includes("thumbnail");

  let content;
  if (loadError) {
    content = (
      <p className="alert danger" role="alert">
        {loadError}
      </p>
    );
  } else if (!isNew && !post) {
    content = <p role="status">Opening it…</p>;
  } else {
    content = (
      <>
        {error && (
          <p className="alert danger" role="alert">
            {error}
          </p>
        )}
        <label className="field">
          <span>Title</span>
          <input className={isNew ? "input title-lg" : "input"} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>Status</span>
          <Select className="input" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {statuses.map((s) => (
              <option key={s} value={s} disabled={!STATUSES.includes(s) || (s === "publish" && !type.can_publish && post?.status !== "publish")}>
                {STATUS_LABEL[s] ?? s}
              </option>
            ))}
          </Select>
        </label>
        <div className="field">
          <span>Publish date (the site's time)</span>
          <DateInput type="datetime-local" aria-label="Publish date" value={date} onChange={(e) => setDate(e.target.value)} />
          <small>{isNew ? "Empty means now. " : ""}Pick Published and a date after now to schedule it.</small>
        </div>
        {type.taxonomies.map((t) => (
          <TermsField key={t.name} site={site} tax={t} value={terms[t.name] ?? []} onChange={(v) => setTerms({ ...terms, [t.name]: v })} />
        ))}
        {thumbnail && (
          <fieldset className="field">
            <legend>Featured image</legend>
            {image.id ? (
              <img className="featured" src={image.url ?? ""} alt="The featured image" />
            ) : (
              <span className="dim">None</span>
            )}
            {picking ? (
              <MediaPicker
                site={site}
                cancel="Keep the current image"
                onCancel={() => setPicking(false)}
                onPick={(m) => {
                  setImage({ id: m.id, url: m.url });
                  setPicking(false);
                }}
              />
            ) : (
              <div className="row">
                <Button small onClick={() => setPicking(true)}>
                  <Glyph name="image" />
                  Choose an image
                </Button>
                {image.id > 0 && (
                  <Button small className="quiet" onClick={() => setImage({ id: 0, url: null })}>
                    Remove the image
                  </Button>
                )}
              </div>
            )}
          </fieldset>
        )}
        {canFields && <FieldsEdit meta={post?.meta ?? {}} value={fields} onChange={setFields} />}
        {!isNew && canHistory && post && (
          <fieldset className="field">
            <legend>Earlier versions</legend>
            <History
              site={site}
              post={post}
              onRestored={(p, msg) => {
                fill(p);
                onSaved(msg);
              }}
            />
          </fieldset>
        )}
        <h3 className="sect">Body</h3>
        {isNew ? (
          <label className="field">
            <span>Text</span>
            <textarea className="input" rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
            <small>Each paragraph becomes a paragraph block. Leave a blank line between paragraphs.</small>
          </label>
        ) : post!.locked ? (
          <p className="alert">{post!.locked}</p>
        ) : post!.blocks.length === 0 ? (
          <p className="dim">The body is empty. Add text to it in WordPress.</p>
        ) : (
          <>
            <p className="help-text" id="blocks-help">
              Only text blocks can change here. Every other block, and every block's settings, stays exactly as it is.
            </p>
            <ol className="blocks" aria-label="Blocks" aria-describedby="blocks-help">
              {post!.blocks.map((b) => (
                <BlockRow key={b.index} b={b} value={edits[b.index] ?? b.html} onChange={(html) => setEdits({ ...edits, [b.index]: html })} />
              ))}
            </ol>
          </>
        )}
      </>
    );
  }

  const footer = trashing ? (
    <>
      <p className="callout danger sum">
        <Glyph name="trash" />
        <span>
          <b>Move "{post?.title}" to the trash?</b> It comes off the site. WordPress keeps it there for 30 days, so you can bring it back.
        </span>
      </p>
      <Button onClick={() => setTrashing(false)}>Keep it</Button>
      <Button kind="danger" className="solid" disabled={saving} onClick={trash}>
        <Glyph name="trash" />
        {saving ? "Moving…" : "Move it to the trash"}
      </Button>
    </>
  ) : (
    <>
      {!isNew && post?.status === "trash" && canHistory && (
        <Button className="push" disabled={saving} onClick={untrash}>
          {saving ? "Bringing it back…" : "Bring it back from the trash"}
        </Button>
      )}
      {!isNew && post && post.status !== "trash" && type.can_delete && (
        <Button kind="danger" className="push" onClick={() => setTrashing(true)}>
          Move to the trash
        </Button>
      )}
      <Button onClick={onClose}>{dirty ? "Close without saving" : "Close"}</Button>
      <Button kind="primary" className="disc" disabled={saving || !dirty || !!loadError || (!isNew && !post)} onClick={save}>
        {saving ? "Saving…" : isNew ? `Add the ${noun}` : "Save changes"}
        <span className="btn-disc">
          <Glyph name="check" />
        </span>
      </Button>
    </>
  );

  return (
    <Sheet
      title={isNew ? `New ${noun} on ${site.name}` : `Edit ${noun} on ${site.name}`}
      intro={post ? <span className="mono">{post.link || `${post.title} · ${STATUS_LABEL[post.status] ?? post.status}`}</span> : undefined}
      onClose={onClose}
      footer={footer}
    >
      {content}
    </Sheet>
  );
}
