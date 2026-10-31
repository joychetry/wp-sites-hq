// SPDX-License-Identifier: GPL-3.0-or-later
// A site's media library (plan "media and editor", part 1): browse it as a grid or a list, filter it,
// upload files picked on this computer, change an item's details, replace its file, move items to the trash.
import "../styles/screens/media.css";
import { DateInput, dayLabel, FilePicker, SearchInput, Select } from "../components/controls";
import { Empty, Progress, Skeleton, toast } from "../components/feedback";
import { Page, SidePanel, Toolbar } from "../components/page";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { fileSize, kind, limitOf, Pic, refusal, uploadKey, useProgress } from "../components/MediaPicker";
import { api, contentBlocked, fileBase64, hasTool, type Library, type Media as Item, type MediaDetails, type Site } from "../api";
import { Button, Glyph, HeadActions } from "../components/ui";
import { firstUsable, SitePick } from "./Content";

export const KINDS: [string, string][] = [
  ["", "All types"],
  ["image", "Images"],
  ["video", "Videos"],
  ["audio", "Audio"],
  ["application", "Documents"],
];

/** Picked files waiting to go, going, or gone; each with its details. */
type Job = { key: string; file: File; alt: string; title: string; caption: string; state: "ready" | "sending" | "done" | "failed" | "stopped"; sent: number; why?: string };

function Uploads({ site, lib, onUploaded, onClose, children }: { site: Site; lib: Library | null; onUploaded: (m: Item) => void; onClose: () => void; children: ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const card = useRef<HTMLElement>(null);
  // Opened from the page head: go straight to Choose files.
  useEffect(() => card.current?.querySelector<HTMLElement>(".drop button")?.focus(), []);
  const latest = useRef(jobs);
  latest.current = jobs;
  const sent = useProgress();
  const busy = jobs.some((j) => j.state === "sending");
  const set = (key: string, change: Partial<Job>) => setJobs((js) => js.map((j) => (j.key === key ? { ...j, ...change } : j)));
  const ready = jobs.filter((j) => j.state === "ready" && !refusal(j.file, lib));
  const limit = limitOf(lib);

  const add = (fs: File[]) =>
    setJobs((js) => [
      ...js.filter((j) => j.state === "ready" || j.state === "sending"),
      ...fs.map((file) => ({ key: uploadKey(), file, alt: "", title: file.name.replace(/\.[^.]+$/, ""), caption: "", state: "ready" as const, sent: 0 })),
    ]);

  const send = async () => {
    let done = 0;
    for (const first of ready) {
      // Stopped or removed while waiting its turn.
      const j = latest.current.find((x) => x.key === first.key);
      if (!j || j.state !== "ready") continue;
      set(j.key, { state: "sending" });
      try {
        const data = await fileBase64(j.file);
        const m = await api.uploadMedia(site.id, j.key, j.file.name, data, { alt: j.alt.trim(), title: j.title.trim(), caption: j.caption.trim() });
        set(j.key, { state: "done" });
        done++;
        onUploaded(m);
      } catch (e) {
        const why = String(e);
        set(j.key, why.startsWith("Stopped") ? { state: "stopped" } : { state: "failed", why });
      }
    }
    if (done) toast(`Uploaded ${done === 1 ? "1 file" : `${done} files`} to ${site.name}.`);
    const failed = latest.current.filter((j) => j.state === "failed").length;
    if (failed) toast(`${failed === 1 ? "1 file" : `${failed} files`} didn't upload. The reason is next to each one.`, { tone: "danger" });
  };

  return (
    <section ref={card} className="card mup" aria-labelledby="media-upload">
      <div className="card-head">
        <h2 id="media-upload">
          <Glyph name="upload" />
          Upload files
        </h2>
        <Button small className="quiet" disabled={busy} onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="card-body">
        <FilePicker label="Choose files" hint="or drop files here" onFiles={add} disabled={busy} />
        <small className="dim" id="media-upload-help">
          Up to {fileSize(limit)} a file{Object.keys(lib?.allowed ?? {}).length ? ": images, documents, audio and video the site allows." : "."} Fill in the alt text before you upload, so screen readers can describe each image.
        </small>
        {jobs.length > 0 && (
          <ul className="mqueue" aria-label="Files to upload">
            {jobs.map((j) => {
              const no = j.state === "ready" ? refusal(j.file, lib) : null;
              const image = j.file.type.startsWith("image/");
              return (
                <li key={j.key} className={j.state}>
                  <div className="mq-head">
                    <b data-tip={j.file.name}>{j.file.name}</b>
                    <span className="dim">{fileSize(j.file.size)}</span>
                    {j.state === "ready" && (
                      <Button small className="quiet" aria-label={`Remove ${j.file.name} from the list`} onClick={() => setJobs((js) => js.filter((x) => x.key !== j.key))}>
                        <Glyph name="x" />
                      </Button>
                    )}
                    {j.state === "sending" && (
                      <Button small onClick={() => api.stopMedia(j.key)}>
                        Stop
                      </Button>
                    )}
                    {j.state === "done" && <span className="ok">Uploaded</span>}
                    {j.state === "stopped" && <span className="dim">Stopped</span>}
                  </div>
                  {no && <small className="err">{no}</small>}
                  {j.state === "failed" && <small className="err">{j.why}</small>}
                  {j.state === "sending" && <Progress label={`Uploading ${j.file.name}`} value={sent[j.key] ?? 0} max={j.file.size} />}
                  {j.state === "ready" && !no && (
                    <div className="mq-fields">
                      {image && (
                        <label className="field">
                          <span>Alt text</span>
                          <input className="input sm" placeholder="Describe the image" value={j.alt} onChange={(e) => set(j.key, { alt: e.target.value })} />
                        </label>
                      )}
                      <label className="field">
                        <span>Title</span>
                        <input className="input sm" value={j.title} onChange={(e) => set(j.key, { title: e.target.value })} />
                      </label>
                      <label className="field">
                        <span>Caption</span>
                        <input className="input sm" value={j.caption} onChange={(e) => set(j.key, { caption: e.target.value })} />
                      </label>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {jobs.length > 0 && (
          <div className="row">
            {(busy || ready.length > 0) && (
              <Button kind="primary" disabled={busy} onClick={send}>
                {busy ? "Uploading…" : ready.length === 1 ? "Upload 1 file" : `Upload ${ready.length} files`}
              </Button>
            )}
            {!busy && (
              <Button className="quiet" onClick={() => setJobs([])}>
                Clear the list
              </Button>
            )}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

const FIELDS = ["alt", "title", "caption", "description"] as const;
const detailsOf = (m: Item): Required<MediaDetails> => ({ alt: m.alt, title: m.title, caption: m.caption, description: m.description });

/** The picked item: preview, facts, its details to change, and Replace with a way back. */
function Details({ site, item, fresh, onChanged }: { site: Site; item: Item; fresh?: number; onChanged: (m: Item, replaced?: boolean) => void }) {
  const [form, setForm] = useState(detailsOf(item));
  const [usage, setUsage] = useState<number | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [keepName, setKeepName] = useState(false);
  const [replacing, setReplacing] = useState<{ key: string; size: number } | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const sent = useProgress();
  const cm = site.mode === "classic_monks";
  const canReplace = cm && hasTool(site, "replace-media");
  const canEdit = !cm || hasTool(site, "update-media");
  const image = item.mime.startsWith("image/");

  useEffect(() => {
    setForm(detailsOf(item));
    setCanUndo(false);
    setUsage(undefined);
    let live = true;
    if (cm)
      api.mediaItem(site.id, item.id).then(
        (m) => live && setUsage(m.usage),
        () => live && setUsage(null),
      );
    return () => {
      live = false;
    };
    // Only another item resets the form, not a save of this one.
  }, [site.id, item.id]);

  const was = detailsOf(item);
  const changed = Object.fromEntries(FIELDS.filter((f) => form[f] !== was[f]).map((f) => [f, form[f]])) as MediaDetails;
  const dirty = Object.keys(changed).length > 0;
  const name = item.title || item.file_name || "this item";

  const save = async () => {
    setSaving(true);
    const before = Object.fromEntries(Object.keys(changed).map((f) => [f, was[f as keyof MediaDetails]])) as MediaDetails;
    try {
      const m = await api.updateMedia(site.id, item.id, changed);
      onChanged(m);
      toast(`Saved the details of ${m.title || m.file_name}.`, {
        undo: () =>
          api.updateMedia(site.id, item.id, before).then(
            (b) => {
              onChanged(b);
              setForm(detailsOf(b));
              toast(`Put the earlier details of ${b.title || b.file_name} back.`);
            },
            (e) => toast(String(e), { tone: "danger" }),
          ),
      });
    } catch (e) {
      toast(String(e), { tone: "danger" });
    } finally {
      setSaving(false);
    }
  };

  const replace = async (f: File | undefined) => {
    if (!f) return;
    const key = uploadKey();
    setReplacing({ key, size: f.size });
    try {
      const m = await api.replaceMedia(site.id, item.id, key, f.name, await fileBase64(f), keepName);
      onChanged(m, true);
      setCanUndo(true);
      toast(m.url === item.url ? `Replaced the file of ${name}. Its address stays the same.` : `Replaced the file of ${name}. Its new address is ${m.url}.`);
    } catch (e) {
      const why = String(e);
      toast(why.startsWith("Stopped") ? "Stopped. The file wasn't replaced." : why, { tone: why.startsWith("Stopped") ? "ok" : "danger" });
    } finally {
      setReplacing(null);
    }
  };

  const undoReplace = () =>
    api.restoreMediaFile(site.id, item.id).then(
      (m) => {
        onChanged(m, true);
        setCanUndo(false);
        toast(`Put the earlier file of ${name} back.`);
      },
      (e) => toast(String(e), { tone: "danger" }),
    );

  const copy = () =>
    navigator.clipboard.writeText(item.url).then(
      () => toast("Copied the file's address."),
      () => toast("Couldn't copy. Select the address and copy it yourself.", { tone: "danger" }),
    );

  const dims = item.width && item.height ? `${item.width} × ${item.height} pixels` : null;
  return (
    <section className="mdetails" aria-labelledby="media-details">
      <div className="card-head">
        <h2 id="media-details">
          <Glyph name="image" />
          Details
        </h2>
      </div>
      <div className="card-body">
        <div className="mpreview">
          <Pic m={item} alt={item.alt} big fresh={fresh} />
        </div>
        <dl className="dl">
          <div>
            <dt>File</dt>
            <dd className="mono cut" data-tip={item.file_name || undefined}>
              {item.file_name || "not known"}
            </dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{kind(item.mime)}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{item.size ? fileSize(item.size) : "not known"}</dd>
          </div>
          {dims && (
            <div>
              <dt>Dimensions</dt>
              <dd>{dims}</dd>
            </div>
          )}
          <div>
            <dt>Uploaded</dt>
            <dd>{dayLabel(item.date) || item.date || "not known"}</dd>
          </div>
          <div>
            <dt>By</dt>
            <dd>{item.author || "not known"}</dd>
          </div>
          {cm && (
            <div>
              <dt>Used in</dt>
              <dd className={usage ? undefined : "dim"}>{usage === undefined ? "Counting…" : usage === null ? "not known" : usage === 0 ? "No posts or pages" : usage === 1 ? "1 post or page" : `${usage} posts and pages`}</dd>
            </div>
          )}
        </dl>
        <div className="field">
          <label htmlFor="media-url">Address</label>
          <div className="row nowrap">
            <input id="media-url" className="input sm mono" readOnly value={item.url} onFocus={(e) => e.target.select()} />
            <Button small onClick={copy}>
              Copy
              <Glyph name="copy" />
            </Button>
          </div>
        </div>
        <form
          className="mform"
          aria-label={`Details of ${name}`}
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty) save();
          }}
        >
          {image && (
            <div className="field">
              <label htmlFor="media-alt">Alt text</label>
              <textarea id="media-alt" className="input" rows={2} aria-describedby="media-alt-help" disabled={!canEdit} value={form.alt} onChange={(e) => setForm({ ...form, alt: e.target.value })} />
              <small id="media-alt-help">Screen readers read this aloud. Leave it empty only for decoration.</small>
            </div>
          )}
          <label className="field">
            <span>Title</span>
            <input className="input" disabled={!canEdit} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label className="field">
            <span>Caption</span>
            <textarea className="input" rows={2} disabled={!canEdit} value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea className="input" rows={3} disabled={!canEdit} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          {!canEdit && <small className="dim">Changing details needs a newer Classic Monks on the site.</small>}
          <div className="row">
            <Button kind="primary" type="submit" disabled={!dirty || saving || !canEdit}>
              {saving ? "Saving…" : "Save"}
            </Button>
            {dirty && (
              <Button className="quiet" onClick={() => setForm(was)}>
                Discard changes
              </Button>
            )}
          </div>
        </form>
        <div className="mreplace" role="group" aria-labelledby="media-replace">
          <h3 id="media-replace">Replace the file</h3>
          {canReplace ? (
            <>
              <p className="dim">Same item, new file: every post that shows it gets the new one. The site keeps the earlier file until the next replace.</p>
              <FilePicker label="Choose the new file" disabled={!!replacing} busy={replacing ? "Replacing…" : undefined} onFile={replace} />
              <label className="row check">
                <input type="checkbox" checked={keepName} disabled={!!replacing} onChange={(e) => setKeepName(e.target.checked)} />
                <span>
                  Use the new file's name <span className="dim">the address changes</span>
                </span>
              </label>
              {replacing && (
                <div className="row nowrap">
                  <Progress label={`Replacing the file of ${name}`} value={sent[replacing.key] ?? 0} max={replacing.size} />
                  <Button small onClick={() => api.stopMedia(replacing.key)}>
                    Stop
                  </Button>
                </div>
              )}
              {canUndo && !replacing && (
                <Button onClick={undoReplace}>
                  Undo the replace
                  <Glyph name="undo" />
                </Button>
              )}
            </>
          ) : (
            <p className="dim">{cm ? "Replacing files needs a newer Classic Monks on the site." : "Replacing files needs the WP Sites HQ plugin, Classic Monks or Classic Monks Pro on the site. This site is in Basic mode."}</p>
          )}
        </div>
        <Button className="quiet" onClick={() => api.openLink(item.url).catch((e) => toast(String(e), { tone: "danger" }))}>
          Open the file
          <Glyph name="external" />
        </Button>
      </div>
    </section>
  );
}

export function Media({ sites }: { sites: Site[] }) {
  const [siteId, setSiteId] = useState<number | null>(() => firstUsable(sites));
  // The group filter can hide the picked site: fall back to the first one shown.
  const site = sites.find((s) => s.id === siteId) ?? sites.find((s) => s.id === firstUsable(sites)) ?? null;
  const current = site?.id ?? null;
  const blocked = site ? contentBlocked(site) : null;
  const [lib, setLib] = useState<Library | null>(null);
  const [page, setPage] = useState(1);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [month, setMonth] = useState("");
  const [view, setView] = useState<"grid" | "list">(() => (localStorage.getItem("mc-media-view") === "list" ? "list" : "grid"));
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [alt, setAlt] = useState("");
  const [importing, setImporting] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [fresh, setFresh] = useState<Record<number, number>>({});
  const [upOpen, setUpOpen] = useState(false);
  const items = lib?.items ?? null;

  // Only the newest request's answer is shown: a slow site's library must never appear under
  // another site, where its ids would be edited, replaced or trashed on that site.
  const asked = useRef(0);
  const load = useCallback(
    (p: number, keep = false) => {
      const n = ++asked.current;
      if (current == null || blocked) return;
      if (p === 1 && !keep) setLib(null);
      api.media(current, { page: p, search, kind: type, month }).then(
        (l) => {
          if (n !== asked.current) return;
          setLib((old) => (p === 1 ? l : { ...l, items: [...(old?.items ?? []), ...l.items] }));
          setPage(p);
          setError(null);
        },
        (e) => n === asked.current && setError(String(e)),
      );
    },
    [current, blocked, search, type, month],
  );
  useEffect(() => load(1), [load]);
  useEffect(() => setTicked(new Set()), [current, search, type, month]);
  // Search as you type, once the typing pauses.
  useEffect(() => {
    const t = setTimeout(() => setSearch(typed.trim()), 300);
    return () => clearTimeout(t);
  }, [typed]);

  if (sites.length === 0) {
    return (
      <Empty title="No sites yet.">
        <p>Add a site on Sites, then its media library shows here.</p>
      </Empty>
    );
  }

  const more = !!lib && lib.items.length < lib.total;
  const canTrash = !!site && site.mode === "classic_monks" && hasTool(site, "trash-media");
  const filtered = !!(search || type || month);
  // The picked item, or the newest one, shows its details beside the library.
  const chosen = items?.find((m) => m.id === picked) ?? items?.[0] ?? null;
  const changed = (m: Item, replaced?: boolean) => {
    setLib((l) => l && { ...l, items: l.items.map((x) => (x.id === m.id ? m : x)) });
    if (replaced) setFresh((f) => ({ ...f, [m.id]: Date.now() }));
  };
  const tick = (id: number, on: boolean) =>
    setTicked((was) => {
      const next = new Set(was);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

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

  const trash = async () => {
    if (!site) return;
    const ids = [...ticked];
    try {
      const r = await api.trashMedia(site.id, ids, false);
      setTicked(new Set());
      load(1, true);
      const n = r.done.length;
      if (n)
        toast(`Moved ${n === 1 ? "1 item" : `${n} items`} to the trash on ${site.name}. Classic Monks keeps them there for a while before deleting them.`, {
          undo: () =>
            api.trashMedia(site.id, r.done, true).then(
              (b) => {
                toast(`Brought ${b.done.length === 1 ? "1 item" : `${b.done.length} items`} back from the trash.`);
                load(1, true);
              },
              (e) => toast(String(e), { tone: "danger" }),
            ),
        });
      if (r.skipped.length) toast(`${r.skipped.length === 1 ? "1 item stayed" : `${r.skipped.length} items stayed`}: ${r.skipped.map(([, why]) => why).join(" ")}`, { tone: "danger" });
    } catch (e) {
      toast(String(e), { tone: "danger" });
    }
  };

  // A grid tile: the picture picks it too, the name is the button, the tick sits beside it (never over it).
  const tile = (m: Item) => (
    <>
      <span className="mpic" onClick={() => setPicked(m.id)}>
        <Pic m={m} fresh={fresh[m.id]} />
      </span>
      <div className="mfoot">
        {canTrash && tickBox(m)}
        <button type="button" className="mthumb" aria-pressed={m.id === chosen?.id} onClick={() => setPicked(m.id)}>
          <b data-tip={m.title || m.file_name}>{m.title || m.file_name || "No title"}</b>
          <small>
            {kind(m.mime)}
            {m.date && ` · ${dayLabel(m.date) || m.date}`}
          </small>
        </button>
      </div>
    </>
  );
  const tickBox = (m: Item) => <input type="checkbox" aria-label={`Tick ${m.title || m.file_name || "No title"}`} checked={ticked.has(m.id)} onChange={(e) => tick(m.id, e.target.checked)} />;

  let body;
  if (blocked) {
    body = (
      <Empty title={`${site!.name}'s media isn't available here.`}>
        <p>{blocked}</p>
      </Empty>
    );
  } else if (error) {
    body = (
      <Empty alert title="The media library didn't load." action={<Button onClick={() => load(1)}>Try again</Button>}>
        <p>{error}</p>
      </Empty>
    );
  } else if (!items) {
    body = <Skeleton label={`Reading ${site?.name}'s media library…`} />;
  } else if (items.length === 0) {
    body = (
      <Empty
        title={filtered ? "Nothing matches." : "The media library is empty."}
        action={
          filtered && (
            <Button
              onClick={() => {
                setTyped("");
                setSearch("");
                setType("");
                setMonth("");
              }}
            >
              Clear the filters
            </Button>
          )
        }
      >
        <p>{filtered ? "Try other words, another type or another month." : "Upload files, or import an image from a link."}</p>
      </Empty>
    );
  } else {
    body = (
      <>
        <p className="sr-only" id="media-legend">
          Newest first. Pick one to see its details, alt text and where it is used{canTrash ? ", or tick several to move them to the trash" : ""}.
        </p>
        {canTrash && (
          <div className="bulk" role="group" aria-label="Change the ticked items">
            <b>{ticked.size === 0 ? "None ticked" : ticked.size === 1 ? "1 item ticked" : `${ticked.size} items ticked`}</b>
            <Button small disabled={ticked.size === 0} onClick={trash}>
              Move to the trash{ticked.size > 0 && ` (${ticked.size})`}
              <Glyph name="trash" />
            </Button>
            <span className="grow" />
            <Button small keys="Esc" disabled={ticked.size === 0} onClick={() => setTicked(new Set())}>
              Clear selection
            </Button>
          </div>
        )}
        {view === "grid" ? (
          <ul className="mthumbs mgrid" aria-label={`${site?.name} media`} aria-describedby="media-legend">
            {items.map((m) => (
              <li key={m.id} className={[m.id === chosen?.id && "on", ticked.has(m.id) && "sel"].filter(Boolean).join(" ") || undefined}>
                {tile(m)}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mlist">
            <table className="t" aria-label={`${site?.name} media`} aria-describedby="media-legend">
              <thead>
                <tr>
                  {canTrash && (
                    <th scope="col" className="tick">
                      <input type="checkbox" aria-label="Tick every item shown" checked={ticked.size === items.length} onChange={(e) => setTicked(new Set(e.target.checked ? items.map((m) => m.id) : []))} />
                    </th>
                  )}
                  <th scope="col">File</th>
                  <th scope="col">Type</th>
                  <th scope="col" className="r">
                    Size
                  </th>
                  <th scope="col">Dimensions</th>
                  <th scope="col">Uploaded</th>
                  <th scope="col">By</th>
                </tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.id} className={m.id === chosen?.id || ticked.has(m.id) ? "sel" : undefined}>
                    {canTrash && <td className="tick">{tickBox(m)}</td>}
                    <td className="name">
                      <button type="button" className="mrow" aria-pressed={m.id === chosen?.id} onClick={() => setPicked(m.id)}>
                        <Pic m={m} fresh={fresh[m.id]} />
                        <span>
                          <b className="cut" data-tip={m.title || m.file_name}>
                            {m.title || "No title"}
                          </b>
                          <small className="mono cut">{m.file_name || "not known"}</small>
                        </span>
                      </button>
                    </td>
                    <td>{kind(m.mime)}</td>
                    <td className="r">{m.size ? fileSize(m.size) : "not known"}</td>
                    <td>{m.width && m.height ? `${m.width} × ${m.height}` : "none"}</td>
                    <td>
                      <span className="when">{dayLabel(m.date) || m.date || "not known"}</span>
                    </td>
                    <td className="who">{m.author || "not known"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  }

  return (
    <Page
      side={
        <SidePanel className="mside" label="Media details" empty="Pick a file to see and edit its details.">
          {!blocked && site && chosen && <Details key={`${site.id}-${chosen.id}`} site={site} item={chosen} fresh={fresh[chosen.id]} onChanged={changed} />}
        </SidePanel>
      }
    >
      {site && !blocked && (
        <HeadActions>
          <Button kind="primary" className="disc" aria-expanded={upOpen} onClick={() => setUpOpen(!upOpen)}>
            Upload files
            <span className="btn-disc">
              <Glyph name="upload" />
            </span>
          </Button>
        </HeadActions>
      )}
      <Toolbar label="Which items to show" className="mbar">
        <SitePick sites={sites} value={current} onChange={setSiteId} />
        {!blocked && (
          <>
            <SearchInput aria-label="Search the media library" placeholder="Search files" value={typed} onChange={(e) => setTyped(e.target.value)} />
            <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
              {KINDS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
            <DateInput type="month" aria-label="Uploaded in" value={month} onChange={(e) => setMonth(e.target.value)} />
            {month && (
              <Button className="ghost" onClick={() => setMonth("")}>
                Any month
              </Button>
            )}
            <div className="segmented inline end" role="group" aria-label="Show as">
              {(["grid", "list"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => {
                    setView(v);
                    localStorage.setItem("mc-media-view", v);
                  }}
                >
                  {v === "grid" ? "Grid" : "List"}
                </button>
              ))}
            </div>
          </>
        )}
      </Toolbar>
      {upOpen && site && !blocked && (
        <Uploads
          site={site}
          lib={lib}
          onClose={() => setUpOpen(false)}
          onUploaded={(m) => {
            setLib((l) => l && { ...l, items: [m, ...l.items.filter((x) => x.id !== m.id)], total: l.total + 1 });
            setPicked(m.id);
          }}
        >
          <form
            className="mimport"
            aria-labelledby="media-import"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <h3 id="media-import">
              <Glyph name="link" />
              Import an image
            </h3>
            <div className="mimport-row">
              <label className="field">
                <span>Image link</span>
                <input className="input" type="url" spellCheck={false} placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
              </label>
              <div className="field">
                <label htmlFor="media-import-alt">Alt text</label>
                <input id="media-import-alt" className="input" placeholder="Describe the image for people who can't see it" value={alt} onChange={(e) => setAlt(e.target.value)} />
              </div>
              <div>
                <Button className="disc" type="submit" disabled={importing || !link.trim()}>
                  {importing ? "Importing…" : "Import the image"}
                  <span className="btn-disc">
                    <Glyph name="download" />
                  </span>
                </Button>
              </div>
            </div>
          </form>
        </Uploads>
      )}
      <section
        className="card mlib"
        aria-label={site ? `Media library of ${site.name}` : "Media library"}
        onKeyDown={(e) => {
          if (e.key === "Escape" && ticked.size > 0) {
            e.preventDefault();
            setTicked(new Set());
          }
        }}
      >
        {body}
        {items && items.length > 0 && !blocked && !error && (
          <div className="card-foot">
            {/* Read out after Load more, so the new items are noticed. */}
            <span className="count" aria-live="polite">
              {items.length} of {lib!.total === 1 ? "1 item" : `${lib!.total} items`}
            </span>
            {more && (
              <Button small onClick={() => load(page + 1)}>
                Load more
              </Button>
            )}
          </div>
        )}
      </section>
    </Page>
  );
}
