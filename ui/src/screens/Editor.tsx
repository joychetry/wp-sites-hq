// SPDX-License-Identifier: GPL-3.0-or-later
// One entry on a full page, laid out like WordPress's classic editor. Main column: title, permalink,
// the body (TinyMCE on a classic body, one inline editor per text block on a block page, locked for
// page builders), custom fields and ACF groups. Side column: Publish (status, visibility, schedule,
// preview, save, trash), every taxonomy, featured image, excerpt, author, page attributes and
// earlier versions. Ctrl+S saves; leaving with unsaved changes asks first; a change made on the site
// since it opened stops the save (the core compares `modified`).
import "../styles/screens/media.css";
import "../styles/screens/editor.css";
import { Combobox, DateInput, NumberInput, Select } from "../components/controls";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, hasTool, type Block, type Draft, type Post, type PostType, type Revision, type Site, type Taxonomy, type TermRef } from "../api";
import { Button, Glyph } from "../components/ui";
import { toast, Empty } from "../components/feedback";
import { Sheet } from "../components/Sheet";
import { MediaPicker } from "../components/MediaPicker";
import { InlineText, RichText } from "../components/RichText";
import { acfErrors, AcfGroups, invalid, type Acf } from "./AcfFields";
import { STATUS_LABEL } from "./Content";
import { leaveGuard } from "../fleet";
import { Page } from "../components/page";


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

/** A body with no block comments is classic: one editable block, or nothing yet. */
export const isClassic = (p: Post) => !p.locked && (p.blocks.length === 0 || (p.blocks.length === 1 && p.blocks[0].name === "" && p.blocks[0].editable));

/** PHP's serialize() output: WordPress keeps these out of its Custom Fields box, and so do we. */
export const isSerialized = (v: string) => /^(?:[aOC]:\d+:[\s\S]*[;}]|s:\d+:"[\s\S]*";|[bid]:[^;]*;|N;)$/.test(v.trim());

/**
 * Custom fields: text values can change; lists, serialized values and other values stay as they are.
 * Keys an ACF group owns are left to its card, so one value isn't edited in two places.
 */
function FieldsEdit({ meta, value, owned, onChange }: { meta: Record<string, unknown>; value: Record<string, string | null>; owned: (key: string) => boolean; onChange: (v: Record<string, string | null>) => void }) {
  const [key, setKey] = useState("");
  const [val, setVal] = useState("");
  const keys = [...new Set([...Object.keys(meta), ...Object.keys(value)])].filter((k) => !owned(k)).sort();
  const add = () => {
    const k = key.trim();
    if (!k || k.startsWith("_")) return;
    onChange({ ...value, [k]: val });
    setKey("");
    setVal("");
  };
  return (
    <section className="card ed-card" aria-label="Custom fields">
      <header className="card-head">
        <h2>Custom fields</h2>
      </header>
      <fieldset className="ed-card-body field fields">
        <legend className="sr-only">Custom fields</legend>
        {keys.length === 0 && <p className="dim ed-none">None</p>}
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
            <div key={k} className={typeof now === "string" && !isSerialized(now) ? "row fieldrow" : "row"}>
              {typeof now === "string" && !isSerialized(now) ? (
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
            Add the field
            <Glyph name="plus" />
          </Button>
        </div>
        {key.trim().startsWith("_") && <small className="why danger">Names starting with an underscore belong to plugins and can't be set here.</small>}
      </fieldset>
    </section>
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
        Show earlier versions
        <Glyph name="history" />
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
                <Button small className={on ? undefined : "quiet"} aria-pressed={on} aria-label={`Put back the version from ${r.date}`} onClick={() => setAsking(on ? null : r)}>
                  Put back
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
      <legend className="sr-only">{tax.label}</legend>
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

function BlockRow({ b, onChange }: { b: Block; onChange: (html: string | null) => void }) {
  const label = `${blockLabel(b.name)} ${b.index + 1}`;
  const style = { marginLeft: `calc(${b.depth} * var(--sp-4))` };
  if (!b.editable) {
    return (
      <li className="blk locked" style={style}>
        <span className="blk-name">{label}</span>
        <span className="dim cut" data-tip={b.html || undefined}>
          {b.html || "No text"}
        </span>
        <span className="tag">
          <Glyph name="lock" />
          Kept as is
        </span>
      </li>
    );
  }
  return (
    <li className="blk" style={style}>
      <span className="blk-name">{label}</span>
      <InlineText label={label} html={b.html} pre={b.name === "core/preformatted" || b.name === "core/verse"} heading={b.name === "core/heading"} onChange={onChange} />
    </li>
  );
}

/** A side box, like WordPress's: a small card with a title. */
function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card ed-box" aria-label={title}>
      <h2 className="ed-box-title">{title}</h2>
      <div className="ed-box-body">{children}</div>
    </section>
  );
}

// `back` names where the back button goes, when that isn't the list of this type.
type Props = { site: Site; type: PostType; postId?: number; back?: string; onClose: () => void; onSaved: (message: string, undo?: () => Promise<unknown>) => void };

export function Editor({ site, type, postId, back, onClose, onSaved }: Props) {
  const isNew = postId == null;
  const [post, setPost] = useState<Post | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState("draft");
  const [password, setPassword] = useState("");
  const [visibility, setVisibility] = useState<"public" | "password" | "private">("public");
  const [terms, setTerms] = useState<Record<string, Pick[]>>({});
  const [image, setImage] = useState<{ id: number; url: string | null }>({ id: 0, url: null });
  const [picking, setPicking] = useState(false);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [body, setBody] = useState<string | null>(null);
  const [excerpt, setExcerpt] = useState("");
  const [author, setAuthor] = useState(0);
  const [parent, setParent] = useState(0);
  const [order, setOrder] = useState("0");
  const [template, setTemplate] = useState("");
  const [saving, setSaving] = useState(false);
  const [trashing, setTrashing] = useState(false);
  const [date, setDate] = useState("");
  const [fields, setFields] = useState<Record<string, string | null>>({});
  const [acf, setAcf] = useState<Acf | null>(null);
  const [acfValues, setAcfValues] = useState<Record<string, unknown>>({});
  const [acfShown, setAcfShown] = useState<Record<string, string>>({});
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  // Bumped on every load, so the body editors start again with the site's text.
  const [round, setRound] = useState(0);
  // The same for the ACF fields: after an Undo or a reload their editors show the site's values.
  const [acfRound, setAcfRound] = useState(0);
  // Opening the page puts focus on its heading, so a screen reader says which entry this is.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const cm = site.mode === "classic_monks";
  const canFields = cm && hasTool(site, "get-post-meta");
  const canHistory = cm && hasTool(site, "list-revisions");
  const canAcf = cm && hasTool(site, "get-acf-fields");

  const fill = (p: Post) => {
    setPost(p);
    setTitle(p.title);
    setSlug(p.slug ?? "");
    setStatus(p.status);
    setPassword(p.password ?? "");
    setVisibility(p.status === "private" ? "private" : p.password ? "password" : "public");
    setTerms(Object.fromEntries(type.taxonomies.map((t) => [t.name, (p.terms[t.name] ?? []).map((x) => ({ id: x.id, name: x.name }))])));
    setImage({ id: p.featured_image, url: p.featured_url });
    setEdits({});
    setBody(null);
    setExcerpt(p.excerpt ?? "");
    setAuthor(p.author_id ?? 0);
    setParent(p.parent ?? 0);
    setOrder(String(p.menu_order ?? 0));
    setTemplate(p.template ?? "");
    setDate(p.date ? p.date.replace(" ", "T") : "");
    setFields({});
    setRound((r) => r + 1);
  };

  const loadAcf = (id: number) => {
    if (!canAcf) return;
    api.acf(site.id, id).then(
      (a) => {
        setAcf(a as Acf | null);
        setAcfValues({});
        setAcfShown({});
        setAcfRound((r) => r + 1);
      },
      () => setAcf(null),
    );
  };

  useEffect(() => {
    if (isNew) return;
    api.post(site.id, type.name, postId).then(fill, (e) => setLoadError(String(e)));
    loadAcf(postId);
    // Loaded once: the page is keyed by the entry.
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
    const pw = visibility === "password" ? password : "";
    if (isNew) {
      d.title = title;
      d.status = status;
      if (body) d.body = body;
      if (image.id) d.featured_image = image.id;
      if (date) d.date = siteDate(date);
      if (excerpt.trim()) d.excerpt = excerpt;
      if (slug.trim()) d.slug = slug.trim();
      if (pw) d.password = pw;
      return d;
    }
    const p = post!;
    if (date && siteDate(date) !== p.date) d.date = siteDate(date);
    if (title !== p.title) d.title = title;
    if (status !== p.status) d.status = status;
    if (image.id !== p.featured_image) d.featured_image = image.id;
    if (excerpt !== (p.excerpt ?? "")) d.excerpt = excerpt;
    if (p.page_fields) {
      if (slug.trim() !== (p.slug ?? "") && slug.trim()) d.slug = slug.trim();
      if (pw !== (p.password ?? "")) d.password = pw;
      if (author && author !== p.author_id) d.author = author;
      if (parent !== (p.parent ?? 0)) d.parent = parent;
      if (Number(order) !== (p.menu_order ?? 0) && Number.isFinite(Number(order))) d.menu_order = Number(order);
      if (template !== (p.template ?? "")) d.template = template;
    }
    if (body !== null) d.edits = [{ index: 0, html: body }];
    else {
      const changed = p.blocks.filter((b) => b.editable && edits[b.index] != null);
      if (changed.length) d.edits = changed.map((b) => ({ index: b.index, html: edits[b.index] }));
    }
    d.seen_modified = p.modified;
    return d;
  };

  const noun = type.singular.toLowerCase();
  const d = post || isNew ? draft() : {};
  const acfDirty = Object.keys(acfValues).length > 0;
  const dirty = isNew ? title.trim() !== "" || body !== null : Object.keys(d).some((k) => k !== "seen_modified") || acfDirty;

  // Keep the unsaved-changes question and Ctrl+S in step with what is on the page.
  const saveRef = useRef<(to?: string) => void>(() => {});
  useEffect(() => {
    leaveGuard.ask = dirty ? (go) => setLeaving(() => go) : null;
    return () => {
      leaveGuard.ask = null;
    };
  }, [dirty]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const save = async (to?: string) => {
    if (saving || (!dirty && !to) || loadError || (!isNew && !post)) return;
    if (isNew && !title.trim()) {
      toast("Give it a title first.", { tone: "danger" });
      return;
    }
    // ACF's own rules first, so nothing is saved while a field is wrong.
    if (acf && acfDirty) {
      const bad: Record<string, string> = {};
      for (const g of acf.groups) for (const f of g.fields) if (f.key in acfValues) {
        const why = invalid(f, acfValues[f.key]);
        if (why) bad[f.key] = why;
      }
      setAcfShown(bad);
      if (Object.keys(bad).length) {
        toast(`Nothing was saved. Fix ${Object.keys(bad).length === 1 ? "the ACF field" : `${Object.keys(bad).length} ACF fields`} marked in red, then save again.`, { tone: "danger" });
        return;
      }
    }
    // Nothing can be typed while it saves: the answer fills the page again, which would drop it.
    const was = document.activeElement as HTMLElement | null;
    setSaving(true);
    try {
      const dr = draft();
      if (to) dr.status = to;
      if (isNew) {
        const p = await api.createPost(site.id, type.name, dr);
        onSaved(`Added "${p.title}" to ${site.name} as ${(STATUS_LABEL[p.status] ?? p.status).toLowerCase()}.`);
        leaveGuard.ask = null;
        onClose();
        return;
      }
      let p = post!;
      if (Object.keys(dr).some((k) => k !== "seen_modified")) {
        p = await api.editPost(site.id, type.name, postId, dr);
        fill(p);
        onSaved(`Saved "${p.title}" on ${site.name}.`);
      }
      if (acf && acfDirty) {
        try {
          // As the body's check: a field changed on the site since it opened is not overwritten.
          const value = (a: Acf | null, k: string) => JSON.stringify(a?.groups.flatMap((g) => g.fields).find((f) => f.key === k)?.value ?? null);
          const fresh = (await api.acf(site.id, postId)) as Acf | null;
          if (Object.keys(acfValues).some((k) => value(fresh, k) !== value(acf, k))) {
            toast("An ACF field was changed on the site after you opened it, so the ACF fields were not saved.", { tone: "danger", action: { label: "Open the site's version", run: () => loadAcf(postId) } });
            return;
          }
          const done = await api.saveAcf(site.id, postId, acfValues);
          const n = Object.keys(acfValues).length;
          const back = done.undo;
          toast(`Saved ${n === 1 ? "1 ACF field" : `${n} ACF fields`} of "${p.title}" on ${site.name}.`, back ? { undo: () => api.undo(site.id, back).then(() => (loadAcf(postId), toast("The ACF fields are back as they were."))) } : undefined);
          loadAcf(postId);
        } catch (e) {
          const { byKey, rest } = acfErrors(acf, String(e));
          setAcfShown(byKey);
          toast(rest.length ? rest.join(" ") : "ACF didn't take the fields marked in red, so none of the ACF fields were saved.", { tone: "danger" });
        }
      }
    } catch (e) {
      const why = String(e);
      // Someone changed it on the site since it opened: theirs can be opened, dropping ours.
      const action = why.includes("changed on the site") ? { label: "Open the site's version", run: reload } : undefined;
      toast(why, { tone: "danger", action });
    } finally {
      setSaving(false);
      requestAnimationFrame(() => was?.isConnected && was.focus());
    }
  };
  saveRef.current = save;

  function reload() {
    api.post(site.id, type.name, postId!).then(fill, (e) => toast(String(e), { tone: "danger" }));
    loadAcf(postId!);
  }

  const untrash = async () => {
    setSaving(true);
    try {
      const now = await api.untrash(site.id, postId!);
      fill(await api.post(site.id, type.name, postId!));
      onSaved(`Brought "${post?.title}" back from the trash on ${site.name}, as ${(STATUS_LABEL[now] ?? now).toLowerCase()}.`);
    } catch (e) {
      toast(String(e), { tone: "danger" });
    } finally {
      setSaving(false);
    }
  };

  const trash = async () => {
    setSaving(true);
    try {
      await api.trashPost(site.id, type.name, postId!);
      // Classic Monks can bring it straight back from the message.
      const back = cm && hasTool(site, "untrash-post") ? () => api.untrash(site.id, postId!) : undefined;
      onSaved(`Moved "${post?.title}" to the trash on ${site.name}.`, back);
      leaveGuard.ask = null;
      onClose();
    } catch (e) {
      toast(String(e), { tone: "danger" });
      setSaving(false);
      setTrashing(false);
    }
  };

  const leave = () => (dirty ? setLeaving(() => onClose) : onClose());
  const chooseVisibility = (v: "public" | "password" | "private") => {
    setVisibility(v);
    if (v === "private") setStatus("private");
    else if (status === "private") setStatus(post?.status === "private" ? "publish" : (post?.status ?? "draft"));
  };

  const thumbnail = type.supports.includes("thumbnail");
  const live = post ? ["publish", "future", "private"].includes(post.status) : false;
  const future = date !== "" && new Date(date) > new Date();
  // As WordPress: an entry that isn't out yet is a draft or pending; Publish puts it out.
  const statuses = live ? ["publish", "pending", "draft"] : ["draft", "pending"];
  if (!statuses.includes(status)) statuses.push(status);
  const editUrl = `${site.url.replace(/\/$/, "")}/wp-admin/post.php?post=${postId}&action=edit`;
  const pf = isNew || post?.page_fields;
  const authors = post?.choices?.authors ?? [];
  const parents = post?.choices?.parents ?? [];
  const templates = Object.entries(post?.choices?.templates ?? {});
  const attrs = pf && !isNew && (type.hierarchical || templates.length > 0 || type.supports.includes("page-attributes"));
  const permalinkBase = post?.link && slug ? post.link.replace(/[^/]+\/?$/, "") : null;
  const primary = live ? "Update" : !type.can_publish ? "Submit for review" : future ? "Schedule" : "Publish";
  const primaryTo = visibility === "private" ? "private" : live ? undefined : !type.can_publish ? "pending" : "publish";

  if (loadError) {
    return (
      <Page className="ed-page">
        <div className="ed-top">
          <Button onClick={onClose}>
            {back ?? `Back to ${type.label.toLowerCase()}`}
            <Glyph name="arrow" />
          </Button>
        </div>
        <Empty alert title={`This ${noun} didn't open.`}>
          <p>{loadError}</p>
        </Empty>
      </Page>
    );
  }

  const acfNames = (acf?.groups ?? []).flatMap((g) => g.fields.map((f) => ({ name: f.name, nested: !!f.sub_fields?.length || f.type === "flexible_content" })));
  const acfOwns = (k: string) => acfNames.some((f) => k === f.name || (f.nested && k.startsWith(`${f.name}_`)));

  let bodyPart;
  if (!isNew && !post) bodyPart = <p role="status">Opening it…</p>;
  else if (post?.locked) {
    bodyPart = (
      <p className="callout">
        <Glyph name="lock" />
        <span>{post.locked}</span>
      </p>
    );
  } else if (isNew || isClassic(post!)) {
    bodyPart = <RichText key={round} label="Body" idBase="body" html={post?.blocks[0]?.html ?? ""} site={site} onChange={setBody} />;
  } else {
    bodyPart = (
      <>
        <p className="help-text" id="blocks-help">
          This {noun} is made of blocks. Click a text block to change its words; every other block, and every block's settings, stays exactly as it is.
        </p>
        <ol className="blocks" key={round} aria-label="Blocks" aria-describedby="blocks-help">
          {post!.blocks.map((b) => (
            <BlockRow
              key={b.index}
              b={b}
              onChange={(html) =>
                setEdits((was) => {
                  const next = { ...was };
                  if (html === null) delete next[b.index];
                  else next[b.index] = html;
                  return next;
                })
              }
            />
          ))}
        </ol>
      </>
    );
  }

  return (
    <Page className="ed-page">
      <div className="ed-top">
        <Button onClick={leave}>
          {back ?? `Back to ${type.label.toLowerCase()}`}
          <Glyph name="arrow" />
        </Button>
        <h2 ref={heading} tabIndex={-1}>
          {isNew ? `New ${noun}` : `Edit ${noun}`} <span className="dim">on {site.name}</span>
        </h2>
        {dirty && <span className="tag warning">Unsaved changes</span>}
      </div>
      <div className="ed-grid" inert={saving} aria-busy={saving || undefined}>
        <div className="ed-main stack">
          <section className="card ed-card" aria-label="Title and body">
            <div className="ed-card-body">
              <input className="input title-lg" aria-label="Title" placeholder="Add title" value={title} onChange={(e) => setTitle(e.target.value)} />
              {pf && (
                <label className="ed-slug row">
                  <span className="dim">Permalink:</span>
                  {permalinkBase && <span className="mono cut ed-base">{permalinkBase}</span>}
                  <input className="input sm mono" aria-label="Slug" placeholder={isNew ? "made from the title" : "slug"} value={slug} onChange={(e) => setSlug(e.target.value)} />
                </label>
              )}
              {bodyPart}
            </div>
          </section>
          {canFields && <FieldsEdit meta={post?.meta ?? {}} value={fields} owned={acfOwns} onChange={setFields} />}
          {acf && acf.groups.length > 0 && (
            <AcfGroups
              key={acfRound}
              acf={acf}
              values={acfValues}
              errors={acfShown}
              site={site}
              editUrl={editUrl}
              onChange={(k, v) => {
                setAcfValues((was) => ({ ...was, [k]: v }));
                if (acfShown[k]) setAcfShown(({ [k]: _, ...rest }) => rest);
              }}
            />
          )}
        </div>
        <aside className="ed-side stack" aria-label="Publish and details">
          <Box title="Publish">
            <label className="field">
              <span>Status</span>
              <Select className="input sm" aria-label="Status" value={status} disabled={visibility === "private"} onChange={(e) => setStatus(e.target.value)}>
                {statuses.map((s) => (
                  <option key={s} value={s} disabled={!["publish", "pending", "draft"].includes(s) || (s === "publish" && !type.can_publish && post?.status !== "publish")}>
                    {STATUS_LABEL[s] ?? s}
                  </option>
                ))}
              </Select>
            </label>
            <fieldset className="field ed-vis">
              <legend>Visibility</legend>
              {(["public", "password", "private"] as const).map((v) =>
                v === "password" && !pf ? null : (
                  <label key={v} className="row check">
                    <input type="radio" name="visibility" checked={visibility === v} disabled={v === "private" && !type.can_publish} onChange={() => chooseVisibility(v)} />
                    {v === "public" ? "Public" : v === "password" ? "Password protected" : "Private"}
                  </label>
                ),
              )}
              {visibility === "password" && <input className="input sm" aria-label="Password" placeholder="The password visitors type" value={password} onChange={(e) => setPassword(e.target.value)} />}
            </fieldset>
            <div className="field">
              <span>Publish date (the site's time)</span>
              <DateInput type="datetime-local" aria-label="Publish date" value={date} onChange={(e) => setDate(e.target.value)} />
              <small>{isNew ? "Empty means now. " : ""}A date after now schedules it.</small>
            </div>
            <div className="ed-acts">
              {!live && visibility !== "private" && (
                <Button small disabled={saving || (!dirty && !isNew)} onClick={() => save(status === "pending" ? "pending" : "draft")}>
                  {status === "pending" ? "Save as pending" : "Save draft"}
                </Button>
              )}
              {post && post.preview_link && (
                <Button small onClick={() => api.openLink(post.preview_link, site.id).catch((e) => toast(String(e), { tone: "danger" }))}>
                  Preview
                  <Glyph name="external" />
                </Button>
              )}
            </div>
            <div className="ed-acts end">
              {!isNew && post && post.status !== "trash" && type.can_delete && (
                <Button small kind="danger" className="quiet" onClick={() => setTrashing(true)}>
                  Move to the trash
                </Button>
              )}
              {!isNew && post?.status === "trash" && canHistory ? (
                <Button small disabled={saving} onClick={untrash}>
                  {saving ? "Bringing it back…" : "Bring it back from the trash"}
                </Button>
              ) : (
                <Button kind="primary" className="disc" disabled={saving || (live && !dirty) || (!isNew && !post)} onClick={() => save(primaryTo)}>
                  {saving ? "Saving…" : primary}
                  <span className="btn-disc">
                    <Glyph name="check" />
                  </span>
                </Button>
              )}
            </div>
            <small className="dim">Ctrl+S saves.</small>
          </Box>
          {type.taxonomies.map((t) => (
            <Box key={t.name} title={t.label}>
              <TermsField site={site} tax={t} value={terms[t.name] ?? []} onChange={(v) => setTerms({ ...terms, [t.name]: v })} />
            </Box>
          ))}
          {thumbnail && (
            <Box title="Featured image">
              {image.id ? <img className="featured" src={image.url ?? ""} alt="The featured image" /> : <span className="dim">None</span>}
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
                <div className="row wrap">
                  <Button small onClick={() => setPicking(true)}>
                    {image.id ? "Change the image" : "Choose an image"}
                    <Glyph name="image" />
                  </Button>
                  {image.id > 0 && (
                    <Button small className="quiet" onClick={() => setImage({ id: 0, url: null })}>
                      Remove the image
                    </Button>
                  )}
                </div>
              )}
            </Box>
          )}
          {(type.supports.includes("excerpt") || excerpt) && (
            <Box title="Excerpt">
              <textarea className="input" rows={3} aria-label="Excerpt" value={excerpt} onChange={(e) => setExcerpt(e.target.value)} />
              <small className="dim">A short summary some themes show in lists.</small>
            </Box>
          )}
          {authors.length > 0 && (
            <Box title="Author">
              <Select className="input sm" aria-label="Author" value={author} onChange={(e) => setAuthor(Number(e.target.value))}>
                {authors.some((a) => a.id === author) || !post ? null : <option value={author}>{post.author || `User ${author}`}</option>}
                {authors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Box>
          )}
          {attrs && (
            <Box title={type.hierarchical ? "Page attributes" : "Attributes"}>
              {type.hierarchical && (
                <label className="field">
                  <span>Parent</span>
                  <Select className="input sm" aria-label="Parent" value={parent} onChange={(e) => setParent(Number(e.target.value))}>
                    <option value={0}>No parent (top level)</option>
                    {parents.some((x) => x.id === parent) || parent === 0 ? null : <option value={parent}>Entry {parent}</option>}
                    {parents.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.title || "(no title)"}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              {(templates.length > 0 || template) && (
                <label className="field">
                  <span>Template</span>
                  <Select className="input sm" aria-label="Template" value={template} onChange={(e) => setTemplate(e.target.value)}>
                    <option value="">Default template</option>
                    {templates.some(([f]) => f === template) || !template ? null : <option value={template}>{template}</option>}
                    {templates.map(([file, name]) => (
                      <option key={file} value={file}>
                        {name}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              <label className="field">
                <span>Order</span>
                <NumberInput className="input sm" aria-label="Order" value={order} onChange={(e) => setOrder(e.target.value)} />
              </label>
            </Box>
          )}
          {!isNew && canHistory && post && (
            <Box title="Earlier versions">
              <History
                site={site}
                post={post}
                onRestored={(p, msg) => {
                  fill(p);
                  onSaved(msg);
                }}
              />
            </Box>
          )}
        </aside>
      </div>
      {trashing && (
        <Sheet
          dialog
          title={`Move "${post?.title}" to the trash?`}
          onClose={() => setTrashing(false)}
          footer={
            <>
              <Button onClick={() => setTrashing(false)}>Keep it</Button>
              <Button kind="danger" className="solid" disabled={saving} onClick={trash}>
                {saving ? "Moving…" : "Move it to the trash"}
                <Glyph name="trash" />
              </Button>
            </>
          }
        >
          <p>It comes off the site. WordPress keeps it there for 30 days, so you can bring it back.</p>
        </Sheet>
      )}
      {leaving && (
        <Sheet
          dialog
          title="Leave without saving?"
          onClose={() => setLeaving(null)}
          footer={
            <>
              <Button onClick={() => setLeaving(null)}>Keep editing</Button>
              <Button
                kind="danger"
                className="solid"
                onClick={() => {
                  const go = leaving;
                  leaveGuard.ask = null;
                  setLeaving(null);
                  go();
                }}
              >
                Leave without saving
              </Button>
            </>
          }
        >
          <p>Your changes to "{title || `this ${noun}`}" aren't saved. If you leave now, they are lost.</p>
        </Sheet>
      )}
    </Page>
  );
}
