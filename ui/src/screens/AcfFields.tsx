// SPDX-License-Identifier: GPL-3.0-or-later
// ACF field groups in the editor (Classic Monks get-acf-fields / update-acf-fields): every type the
// plan lists, drawn with the app's own controls. Values keep the shape ACF stores (ids, Ymd dates,
// sub-fields and rows keyed by field key). Flexible content, clone and unknown types are cards with
// Edit in WordPress.
import { useEffect, useId, useRef, useState } from "react";
import { api, type Media, type Site } from "../api";
import { ColorInput, Combobox, DateInput, MultiSelect, NumberInput, Select, Slider, TimeField } from "../components/controls";
import { MediaPicker } from "../components/MediaPicker";
import { RichText } from "../components/RichText";
import { Button, Glyph } from "../components/ui";

export type AcfField = {
  key: string;
  name: string;
  label: string;
  type: string;
  instructions: string;
  required: boolean;
  editable: boolean;
  settings: Record<string, unknown>;
  value?: unknown;
  sub_fields?: AcfField[];
};
export type AcfGroup = { key: string; title: string; fields: AcfField[] };
type Refs = { media: Record<string, { title: string; url: string; thumbnail: string; mime_type: string }>; posts: Record<string, { title: string; type: string }>; terms: Record<string, { name: string }>; users: Record<string, { name: string }> };
export type Acf = { post_id: number; groups: AcfGroup[]; refs: Refs };

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v === null || v === undefined || v === "" || v === false ? [] : [String(v)]);
const str = (v: unknown) => (v === null || v === undefined || v === false ? "" : String(v));
const many = (f: AcfField) => !!Number(f.settings.multiple) || f.type === "relationship" || f.type === "gallery" || (f.type === "taxonomy" && ["checkbox", "multi_select"].includes(String(f.settings.field_type)));
const choices = (f: AcfField) => Object.entries((f.settings.choices ?? {}) as Record<string, string>);
const empty = (v: unknown) => v === null || v === undefined || v === "" || v === false || (Array.isArray(v) && v.length === 0);

/** ACF's date picker stores 20261028; the calendar takes 2026-10-28. */
export const fromYmd = (v: string) => (/^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : "");
export const toYmd = (v: string) => v.replace(/-/g, "");

/** Why a value can't be saved, in ACF's own spirit, or null. Sub-fields of groups and rows are checked too. */
export function invalid(f: AcfField, v: unknown): string | null {
  if (!f.editable) return null;
  if (f.required && (empty(v) || (f.type === "true_false" && !Number(v)))) return `${f.label} is required.`;
  if (empty(v)) return null;
  const s = f.settings;
  const n = Number(v);
  if (f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(v))) return `${f.label}: "${str(v)}" is not an email address.`;
  if (f.type === "url" && !/^(https?:\/\/|\/|#|mailto:)/i.test(str(v))) return `${f.label}: write the full address, starting with https://.`;
  if ((f.type === "number" || f.type === "range") && !Number.isFinite(n)) return `${f.label} must be a number.`;
  if ((f.type === "number" || f.type === "range") && s.min !== "" && s.min != null && n < Number(s.min)) return `${f.label} must be ${s.min} or more.`;
  if ((f.type === "number" || f.type === "range") && s.max !== "" && s.max != null && n > Number(s.max)) return `${f.label} must be ${s.max} or less.`;
  if (["text", "textarea"].includes(f.type) && Number(s.maxlength) > 0 && str(v).length > Number(s.maxlength)) return `${f.label} can be ${s.maxlength} characters at most.`;
  const count = Array.isArray(v) ? v.length : 0;
  if (["relationship", "gallery", "repeater"].includes(f.type) && Number(s.min) > 0 && count < Number(s.min)) return `${f.label} needs at least ${s.min}.`;
  if (["relationship", "gallery", "repeater"].includes(f.type) && Number(s.max) > 0 && count > Number(s.max)) return `${f.label} can have ${s.max} at most.`;
  if (f.type === "group") return subErrors(f, v as Record<string, unknown>);
  if (f.type === "repeater") for (const row of v as Record<string, unknown>[]) if (subErrors(f, row)) return subErrors(f, row);
  return null;
}

const subErrors = (f: AcfField, v: Record<string, unknown> | null) => (f.sub_fields ?? []).map((sf) => invalid(sf, v?.[sf.key])).find(Boolean) ?? null;

type Ctx = { site: Site; refs: Refs; editUrl: string; idBase: string };

/** A field's control, its label, instructions and error. */
function Field({ f, value, error, ctx, onChange }: { f: AcfField; value: unknown; error?: string | null; ctx: Ctx; onChange: (v: unknown) => void }) {
  const id = useId();
  const label = `${f.label}${f.required ? " (required)" : ""}`;
  const help = f.instructions ? <small id={`${id}-help`}>{f.instructions}</small> : null;
  const err = error ? (
    <small className="err" id={`${id}-err`} role="alert">
      {error}
    </small>
  ) : null;
  const described = [f.instructions && `${id}-help`, error && `${id}-err`].filter(Boolean).join(" ") || undefined;
  const aria = { "aria-label": f.label, "aria-describedby": described, "aria-invalid": error ? true : undefined, "aria-required": f.required || undefined };
  if (!f.editable) {
    return (
      <div className="field acf-ro">
        <span>{f.label}</span>
        <p className="callout">
          <Glyph name="lock" />
          <span>
            {({ flexible_content: "Flexible content", clone: "A clone field", oembed: "An oEmbed field" } as Record<string, string>)[f.type] ?? "This field"} can only be changed in WordPress.
            {!empty(value) && typeof value !== "object" && <span className="mono cut"> Now: {str(value)}</span>}
          </span>
          <Button small onClick={() => api.openLink(ctx.editUrl, ctx.site.id).catch(() => {})}>
            <Glyph name="external" />
            Edit in WordPress
          </Button>
        </p>
      </div>
    );
  }
  const t = f.type;
  const s = f.settings;
  let control;
  if (["text", "email", "url", "password"].includes(t)) {
    control = (
      <span className="acf-wrap">
        {str(s.prepend) && <span className="dim">{str(s.prepend)}</span>}
        <input className="input" type={t === "password" ? "password" : t === "text" ? "text" : t} autoComplete="off" placeholder={str(s.placeholder)} value={str(value)} onChange={(e) => onChange(e.target.value)} {...aria} />
        {str(s.append) && <span className="dim">{str(s.append)}</span>}
      </span>
    );
  } else if (t === "textarea") {
    control = <textarea className="input" rows={Number(s.rows) || 4} placeholder={str(s.placeholder)} value={str(value)} onChange={(e) => onChange(e.target.value)} {...aria} />;
  } else if (t === "number") {
    control = <NumberInput className="input" value={str(value)} min={str(s.min)} max={str(s.max)} step={str(s.step) || undefined} onChange={(e) => onChange(e.target.value)} {...aria} />;
  } else if (t === "range") {
    const min = s.min === "" || s.min == null ? 0 : Number(s.min);
    const max = s.max === "" || s.max == null ? 100 : Number(s.max);
    control = <Slider label={f.label} min={min} max={max} step={Number(s.step) || 1} value={value === "" || value == null ? min : Number(value)} onChange={(n) => onChange(String(n))} />;
  } else if (t === "select" && many(f)) {
    control = <MultiSelect label={f.label} options={choices(f).map(([v, l]) => ({ value: v, label: l }))} value={list(value)} onChange={onChange} />;
  } else if (t === "select") {
    control = (
      <Select className="input" value={str(value)} onChange={(e) => onChange(e.target.value)} {...aria}>
        {(!!Number(s.allow_null) || empty(value)) && <option value="">None</option>}
        {choices(f).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
    );
  } else if (t === "checkbox" || t === "radio") {
    const on = list(value);
    control = (
      <div className={`acf-choices ${s.layout === "horizontal" ? "row wrap" : ""}`} role={t === "radio" ? "radiogroup" : "group"} {...aria}>
        {choices(f).map(([v, l]) => (
          <label key={v} className="row check">
            <input
              type={t}
              name={`${id}-${f.key}`}
              checked={on.includes(v)}
              onChange={(e) => onChange(t === "radio" ? v : e.target.checked ? [...on, v] : on.filter((x) => x !== v))}
            />
            {l}
          </label>
        ))}
      </div>
    );
  } else if (t === "button_group") {
    control = (
      <div className="segmented inline" role="group" {...aria}>
        {choices(f).map(([v, l]) => (
          <button key={v} type="button" aria-pressed={str(value) === v} onClick={() => onChange(!!Number(s.allow_null) && str(value) === v ? "" : v)}>
            {l}
          </button>
        ))}
      </div>
    );
  } else if (t === "true_false") {
    control = (
      <label className="row check">
        <input type="checkbox" checked={!!Number(value)} onChange={(e) => onChange(e.target.checked ? 1 : 0)} {...aria} />
        {Number(value) ? str(s.ui_on_text) || "Yes" : str(s.ui_off_text) || "No"}
      </label>
    );
  } else if (t === "wysiwyg") {
    control = <RichText label={f.label} html={str(value)} idBase={`${ctx.idBase}-${f.key}`} site={s.media_upload === 0 ? undefined : ctx.site} onChange={(h) => h !== null && onChange(h)} />;
  } else if (t === "image" || t === "file" || t === "gallery") {
    control = <MediaField f={f} value={value} ctx={ctx} onChange={onChange} />;
  } else if (t === "date_picker") {
    control = <DateInput type="date" value={fromYmd(str(value))} onChange={(e) => onChange(toYmd(e.target.value))} {...aria} />;
  } else if (t === "date_time_picker") {
    control = <DateInput type="datetime-local" value={str(value).replace(" ", "T").slice(0, 16)} onChange={(e) => onChange(e.target.value ? `${e.target.value.replace("T", " ")}:00` : "")} {...aria} />;
  } else if (t === "time_picker") {
    control = <TimeField label={f.label} value={str(value).slice(0, 5)} onChange={(v) => onChange(v ? `${v}:00` : "")} />;
  } else if (t === "color_picker") {
    control = <ColorInput label={f.label} value={str(value)} onChange={onChange} />;
  } else if (t === "link") {
    const l = (value && typeof value === "object" ? value : {}) as { title?: string; url?: string; target?: string };
    const set = (k: string, v: string) => onChange({ title: l.title ?? "", url: l.url ?? "", target: l.target ?? "", [k]: v });
    control = (
      <div className="acf-link" role="group" {...aria}>
        <input className="input" aria-label={`${f.label}: address`} placeholder="https://" value={l.url ?? ""} onChange={(e) => set("url", e.target.value)} />
        <input className="input" aria-label={`${f.label}: words people click`} placeholder="Words people click" value={l.title ?? ""} onChange={(e) => set("title", e.target.value)} />
        <label className="row check">
          <input type="checkbox" checked={l.target === "_blank"} onChange={(e) => set("target", e.target.checked ? "_blank" : "")} />
          Open in a new tab
        </label>
      </div>
    );
  } else if (["post_object", "page_link", "relationship"].includes(t)) {
    control = <PostField f={f} value={value} ctx={ctx} onChange={onChange} />;
  } else if (t === "taxonomy") {
    control = <TermField f={f} value={value} ctx={ctx} onChange={onChange} />;
  } else if (t === "user") {
    control = <UserField f={f} value={value} ctx={ctx} onChange={onChange} />;
  } else if (t === "group") {
    const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    return (
      <fieldset className="field acf-group">
        <legend>{label}</legend>
        {help}
        {(f.sub_fields ?? []).map((sf) => (
          <Field key={sf.key} f={sf} value={v[sf.key]} error={error && invalid(sf, v[sf.key])} ctx={{ ...ctx, idBase: `${ctx.idBase}-${f.key}` }} onChange={(x) => onChange({ ...v, [sf.key]: x })} />
        ))}
      </fieldset>
    );
  } else if (t === "repeater") {
    return <Repeater f={f} label={label} value={value} error={error} ctx={ctx} onChange={onChange} />;
  }
  const grouped = ["checkbox", "radio", "button_group", "link", "image", "file", "gallery", "post_object", "page_link", "relationship", "taxonomy", "user", "range", "time_picker", "color_picker", "wysiwyg"].includes(t) || (t === "select" && many(f));
  return grouped ? (
    <fieldset className="field">
      <legend>{label}</legend>
      {help}
      {control}
      {err}
    </fieldset>
  ) : (
    <div className="field">
      <span>{label}</span>
      {help}
      {control}
      {err}
    </div>
  );
}

function Repeater({ f, label, value, error, ctx, onChange }: { f: AcfField; label: string; value: unknown; error?: string | null; ctx: Ctx; onChange: (v: unknown) => void }) {
  const rows = (Array.isArray(value) ? value : []) as Record<string, unknown>[];
  const max = Number(f.settings.max) || 0;
  // Each row keeps its own key as it moves, so its editors (a wysiwyg holds its text) move with it.
  const ids = useRef<number[]>([]);
  const next = useRef(0);
  while (ids.current.length < rows.length) ids.current.push(next.current++);
  ids.current.length = rows.length;
  const move = (i: number, by: number) => {
    const moved = [...rows];
    [moved[i], moved[i + by]] = [moved[i + by], moved[i]];
    [ids.current[i], ids.current[i + by]] = [ids.current[i + by], ids.current[i]];
    onChange(moved);
  };
  const add = useRef<HTMLButtonElement>(null);
  const remove = (i: number) => {
    ids.current.splice(i, 1);
    onChange(rows.filter((_, j) => j !== i));
    // The pressed button is gone with its row: focus goes to Add a row, not the page.
    requestAnimationFrame(() => add.current?.focus());
  };
  return (
    <fieldset className="field acf-rows">
      <legend>{label}</legend>
      {f.instructions && <small>{f.instructions}</small>}
      {rows.length === 0 && <span className="dim">No rows yet.</span>}
      {rows.map((row, i) => (
        <fieldset key={ids.current[i]} className="acf-row">
          <legend>
            Row {i + 1} of {rows.length}
          </legend>
          {(f.sub_fields ?? []).map((sf) => (
            <Field key={sf.key} f={sf} value={row[sf.key]} error={error && invalid(sf, row[sf.key])} ctx={{ ...ctx, idBase: `${ctx.idBase}-${f.key}-${i}` }} onChange={(x) => onChange(rows.map((r, j) => (j === i ? { ...r, [sf.key]: x } : r)))} />
          ))}
          <div className="row">
            <Button small disabled={i === 0} onClick={() => move(i, -1)}>
              Move up
            </Button>
            <Button small disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
              Move down
            </Button>
            <Button small kind="danger" className="push" onClick={() => remove(i)}>
              Remove row {i + 1}
            </Button>
          </div>
        </fieldset>
      ))}
      {error && <small className="err">{error}</small>}
      <Button ref={add} small disabled={max > 0 && rows.length >= max} onClick={() => onChange([...rows, Object.fromEntries((f.sub_fields ?? []).map((sf) => [sf.key, sf.settings.default_value ?? ""]))])}>
        <Glyph name="plus" />
        {str(f.settings.button_label) || "Add a row"}
      </Button>
    </fieldset>
  );
}

/** Image, file and gallery: the picked items from the library, Choose and Remove. */
function MediaField({ f, value, ctx, onChange }: { f: AcfField; value: unknown; ctx: Ctx; onChange: (v: unknown) => void }) {
  const [picking, setPicking] = useState(false);
  const [known, setKnown] = useState<Record<string, Media>>({});
  const ids = list(value);
  const gallery = f.type === "gallery";
  const name = (id: string) => known[id]?.title || ctx.refs.media[id]?.title || `Item ${id}`;
  const thumb = (id: string) => known[id]?.thumb || known[id]?.url || ctx.refs.media[id]?.thumbnail || ctx.refs.media[id]?.url || "";
  return (
    <div className="acf-media">
      {ids.length === 0 && <span className="dim">None</span>}
      {ids.length > 0 && (
        <ul className="acf-picks" aria-label={`${f.label}: chosen`}>
          {ids.map((id) => (
            <li key={id}>
              {f.type !== "file" && thumb(id) ? <img src={thumb(id)} alt="" /> : <Glyph name="file" />}
              <span className="cut" data-tip={name(id)}>
                {name(id)}
              </span>
              <button type="button" className="icon-btn" aria-label={`Remove ${name(id)}`} onClick={() => onChange(gallery ? ids.filter((x) => x !== id) : "")}>
                <Glyph name="x" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {picking ? (
        <MediaPicker
          site={ctx.site}
          kind={f.type === "file" ? "" : "image"}
          use={gallery ? "Add" : "Use"}
          cancel="Close the library"
          onCancel={() => setPicking(false)}
          onPick={(m) => {
            setKnown({ ...known, [m.id]: m });
            onChange(gallery ? [...ids.filter((x) => x !== String(m.id)), String(m.id)] : String(m.id));
            if (!gallery) setPicking(false);
          }}
        />
      ) : (
        <Button small onClick={() => setPicking(true)}>
          <Glyph name={f.type === "file" ? "file" : "image"} />
          {gallery ? "Add images" : ids.length ? `Change the ${f.type}` : `Choose ${f.type === "file" ? "a file" : "an image"}`}
        </Button>
      )}
    </div>
  );
}

/** Post object, page link and relationship: chips for the chosen entries and a search to add more. */
function PostField({ f, value, ctx, onChange }: { f: AcfField; value: unknown; ctx: Ctx; onChange: (v: unknown) => void }) {
  const ids = list(value);
  const several = many(f);
  const [typed, setTyped] = useState("");
  const [found, setFound] = useState<{ id: number; title: string }[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const types = list(f.settings.post_type).length ? list(f.settings.post_type) : ["post", "page"];
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      Promise.all(types.map((pt) => api.posts(ctx.site.id, { post_type: pt, search: typed.trim() || undefined }).catch(() => null))).then((ls) => {
        if (live) setFound(ls.flatMap((l) => l?.posts ?? []).map((p) => ({ id: p.id, title: p.title || "(no title)" })));
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // Search again when the words change.
  }, [typed]);
  const name = (id: string) => names[id] ?? ctx.refs.posts[id]?.title ?? (/^\d+$/.test(id) ? `Entry ${id}` : id);
  const add = (title: string) => {
    const p = found.find((x) => x.title === title);
    if (!p) return;
    setNames({ ...names, [p.id]: p.title });
    onChange(several ? [...ids.filter((x) => x !== String(p.id)), String(p.id)] : String(p.id));
    setTyped("");
  };
  const max = Number(f.settings.max) || 0;
  return (
    <div className="acf-posts terms">
      <div className="tags">
        {ids.length === 0 && <span className="dim">None</span>}
        {ids.map((id) => (
          <span key={id} className="term">
            {name(id)}
            <button type="button" aria-label={`Remove ${name(id)}`} onClick={() => onChange(several ? ids.filter((x) => x !== id) : "")}>
              <Glyph name="x" />
            </button>
          </span>
        ))}
      </div>
      <Combobox
        className="input sm"
        aria-label={`${several ? "Add to" : "Choose"} ${f.label}`}
        placeholder={`Type to find ${types.join(" or ")} entries`}
        disabled={several && max > 0 && ids.length >= max}
        suggestions={found.filter((p) => !ids.includes(String(p.id))).map((p) => p.title)}
        value={typed}
        onPick={add}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(typed);
          }
        }}
      />
    </div>
  );
}

function TermField({ f, value, ctx, onChange }: { f: AcfField; value: unknown; ctx: Ctx; onChange: (v: unknown) => void }) {
  const [terms, setTerms] = useState<{ id: number; name: string }[] | null>(null);
  const tax = str(f.settings.taxonomy) || "category";
  useEffect(() => {
    api.terms(ctx.site.id, tax).then(setTerms, () => setTerms([]));
  }, [tax]);
  const options = (terms ?? []).map((t) => ({ value: String(t.id), label: t.name }));
  for (const id of list(value)) if (!options.some((o) => o.value === id)) options.push({ value: id, label: ctx.refs.terms[id]?.name ?? `Term ${id}` });
  if (many(f)) return <MultiSelect label={f.label} options={options} value={list(value)} onChange={(v) => onChange(v.map(Number))} />;
  return (
    <Select className="input" aria-label={f.label} value={list(value)[0] ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : "")}>
      <option value="">None</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

function UserField({ f, value, ctx, onChange }: { f: AcfField; value: unknown; ctx: Ctx; onChange: (v: unknown) => void }) {
  const [users, setUsers] = useState<{ id: number; name: string; role: string }[] | null>(null);
  useEffect(() => {
    api.users(ctx.site.id, "").then((u) => setUsers(u.users), () => setUsers([]));
  }, []);
  const roles = list(f.settings.role);
  const options = (users ?? []).filter((u) => !roles.length || roles.includes(u.role)).map((u) => ({ value: String(u.id), label: u.name }));
  for (const id of list(value)) if (!options.some((o) => o.value === id)) options.push({ value: id, label: ctx.refs.users[id]?.name ?? `User ${id}` });
  if (many(f)) return <MultiSelect label={f.label} options={options} value={list(value)} onChange={onChange} />;
  return (
    <Select className="input" aria-label={f.label} value={list(value)[0] ?? ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">None</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

/**
 * Every group's fields, each group in its own card. `values` holds the changed fields by key;
 * `errors` the messages from the last save try (ours or ACF's), by key.
 */
export function AcfGroups({ acf, values, errors, site, editUrl, onChange }: { acf: Acf; values: Record<string, unknown>; errors: Record<string, string>; site: Site; editUrl: string; onChange: (key: string, v: unknown) => void }) {
  const ctx = { site, refs: acf.refs, editUrl, idBase: "acf" };
  return (
    <>
      {acf.groups.map((g) => (
        <section key={g.key} className="card ed-card" aria-label={g.title}>
          <header className="card-head">
            <h2>{g.title}</h2>
            <span className="dim">Advanced Custom Fields</span>
          </header>
          <div className="ed-card-body">
            {g.fields.map((f) => (
              <Field key={f.key} f={f} value={f.key in values ? values[f.key] : f.value} error={errors[f.key]} ctx={ctx} onChange={(v) => onChange(f.key, v)} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

/** ACF's messages ("Email: 'x' is not a valid email address", one a line) by the field they name. */
export function acfErrors(acf: Acf, message: string): { byKey: Record<string, string>; rest: string[] } {
  const byKey: Record<string, string> = {};
  const rest: string[] = [];
  const all = acf.groups.flatMap((g) => g.fields.flatMap((f) => [{ top: f, f }, ...(f.sub_fields ?? []).map((sf) => ({ top: f, f: sf }))]));
  for (const line of message.split("\n").filter(Boolean)) {
    const hit = all.find(({ f }) => line.startsWith(`${f.label}:`) || line.startsWith(`${f.label} `));
    if (hit && !byKey[hit.top.key]) byKey[hit.top.key] = line;
    else rest.push(line);
  }
  return { byKey, rest };
}
