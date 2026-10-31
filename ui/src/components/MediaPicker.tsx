// SPDX-License-Identifier: GPL-3.0-or-later
// Pick an item from a site's media library, or upload one picked on this computer and use it
// (the featured image now; the post editor's Add media and ACF fields later).
import { useCallback, useEffect, useRef, useState } from "react";
import { api, fileBase64, type Library, type Media, type Site } from "../api";
import { FilePicker, SearchInput } from "./controls";
import { Progress, toast } from "./feedback";
import { Button, Glyph } from "./ui";

/** The core's own cap: larger files go through WordPress. */
const MAX_FILE = 256 * 1024 * 1024;

/** "image/jpeg" -> "JPEG", "application/pdf" -> "PDF". */
export const kind = (mime: string) => (mime.split("/")[1] ?? mime).replace(/^x-/, "").replace(/^vnd\..*/, "file").toUpperCase();

/** Sizes as WordPress writes them (1 MB = 1024 KB), so "64 MB" here is the site's own "64 MB". */
export const fileSize = (n: number) => (n >= 2 ** 30 ? `${+(n / 2 ** 30).toFixed(1)} GB` : n >= 2 ** 20 ? `${+(n / 2 ** 20).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`);

/** The largest file this site takes from WP Sites HQ. */
export const limitOf = (lib: Library | null) => Math.min(lib?.limit || MAX_FILE, MAX_FILE);

/** Why this file can't go to the site, checked before sending it; null when it can. */
export function refusal(f: File, lib: Library | null): string | null {
  if (f.size === 0) return "This file is empty.";
  const limit = limitOf(lib);
  if (f.size > limit) return `It's over the ${fileSize(limit)} limit.`;
  const ext = f.name.includes(".") ? f.name.split(".").pop()!.toLowerCase() : "";
  const types = Object.keys(lib?.allowed ?? {});
  if (types.length && !types.some((t) => t.split("|").includes(ext))) return ext ? `This site doesn't take .${ext} files.` : "The file needs a type at the end of its name, like .jpg.";
  return null;
}

let nextKey = 1;
/** A key for one upload's progress events and its Stop. */
export const uploadKey = () => `up-${Date.now()}-${nextKey++}`;

/** An item's picture: the image (its small version in the grid), or a file glyph for anything else. */
export function Pic({ m, alt = "", big, fresh }: { m: Media; alt?: string; big?: boolean; fresh?: number }) {
  // After a replace the address stays the same: ask for the new pixels.
  const url = big ? m.url : m.thumb || m.url;
  const src = fresh && /^https?:/.test(url) ? `${url}${url.includes("?") ? "&" : "?"}v=${fresh}` : url;
  return <span className="mthumb-img">{m.mime.startsWith("image/") && m.url ? <img src={src} alt={alt} loading="lazy" /> : <Glyph name="file" />}</span>;
}

/** Progress events for every upload under way, as a map of key to bytes sent. */
export function useProgress() {
  const [sent, setSent] = useState<Record<string, number>>({});
  useEffect(() => {
    const off = api.onMediaProgress((p) => setSent((was) => ({ ...was, [p.key]: p.sent })));
    return () => {
      off.then((f) => f()).catch(() => {});
    };
  }, []);
  return sent;
}

type Props = {
  site: Site;
  /** image, video, audio or application; empty for every type. */
  kind?: string;
  /** What Use says before the item's name, and Cancel's words. */
  use?: string;
  cancel?: string;
  onPick: (m: Media) => void;
  onCancel: () => void;
};

export function MediaPicker({ site, kind = "image", use = "Use", cancel = "Cancel", onPick, onCancel }: Props) {
  const [lib, setLib] = useState<Library | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [at, setAt] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const sent = useProgress();

  // Only the newest search's answer is shown (an older one must not replace or join it).
  const asked = useRef(0);
  const load = useCallback(
    (p: number) => {
      const n = ++asked.current;
      api.media(site.id, { page: p, search, kind }).then(
        (l) => {
          if (n !== asked.current) return;
          setLib((old) => (p === 1 ? l : { ...l, items: [...(old?.items ?? []), ...l.items] }));
          setPage(p);
          setError(null);
        },
        (e) => n === asked.current && setError(String(e)),
      );
    },
    [site.id, search, kind],
  );
  useEffect(() => load(1), [load]);

  const items = lib?.items ?? null;
  // The one clicked, or the newest, is the one Use puts on the entry.
  const chosen = items?.find((m) => m.id === at) ?? items?.[0] ?? null;
  const no = file ? refusal(file, lib) || (kind && !file.type.startsWith(`${kind}/`) ? "Choose an image file." : null) : null;

  const upload = async () => {
    if (!file) return;
    const key = uploadKey();
    setSending(key);
    try {
      const m = await api.uploadMedia(site.id, key, file.name, await fileBase64(file), { alt: alt.trim() });
      toast(`Uploaded ${file.name} to ${site.name}.`);
      onPick(m);
    } catch (e) {
      const why = String(e);
      toast(why.startsWith("Stopped") ? "Stopped. Nothing was added." : why, { tone: why.startsWith("Stopped") ? "ok" : "danger" });
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="imgpick">
      <form
        className="row nowrap"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(typed.trim());
        }}
      >
        <SearchInput className="sm" aria-label="Search the media library" placeholder="Search the media library" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <Button small type="submit">
          Search
        </Button>
      </form>
      {error && <p className="alert danger" role="alert">{error}</p>}
      {!items && !error && <p role="status">Reading the media library…</p>}
      {items?.length === 0 && <p>{search ? "Nothing matches. Try other words." : "The media library has no images yet. Upload one below."}</p>}
      {items && items.length > 0 && (
        <ul className="mthumbs small" aria-label="Images">
          {items.map((m) => (
            <li key={m.id}>
              <button type="button" className="mthumb" aria-pressed={m.id === chosen?.id} onClick={() => setAt(m.id)}>
                <Pic m={m} alt="" />
                <b data-tip={m.title || m.file_name}>{m.title || m.file_name || "No title"}</b>
              </button>
            </li>
          ))}
        </ul>
      )}
      {lib && lib.items.length < lib.total && (
        <Button small className="quiet" onClick={() => load(page + 1)}>
          Load more
        </Button>
      )}
      <div className="row">
        {chosen && (
          <Button small kind="soft" onClick={() => onPick(chosen)}>
            {use} {chosen.title || chosen.file_name || "this image"}
          </Button>
        )}
        <Button small className="quiet" onClick={onCancel}>
          {cancel}
        </Button>
      </div>
      <div className="imgpick-up" role="group" aria-label="A new image from this computer">
        <FilePicker label="Upload a new image" accept={kind ? `${kind}/*` : undefined} disabled={!!sending} onFile={(f) => setFile(f ?? null)} />
        {file && no && <small className="err">{no}</small>}
        {file && !no && (
          <>
            <label className="field">
              <span>Alt text</span>
              <input className="input sm" placeholder="Describe the image" value={alt} disabled={!!sending} onChange={(e) => setAlt(e.target.value)} />
            </label>
            {sending ? (
              <div className="row nowrap">
                <Progress label={`Uploading ${file.name}`} value={sent[sending] ?? 0} max={file.size} />
                <Button small onClick={() => api.stopMedia(sending)}>
                  Stop
                </Button>
              </div>
            ) : (
              <Button small kind="soft" onClick={upload}>
                Upload and use it
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
