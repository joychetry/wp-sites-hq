// SPDX-License-Identifier: GPL-3.0-or-later
// Install a plugin from WordPress.org (search), a zip link, a zip on this computer
// (plugin or theme, Classic Monks M8) or a bundle, on the sites you pick.
import "../styles/screens/install.css";
import { FilePicker, SearchInput } from "../components/controls";
import { useEffect, useId, useMemo, useState } from "react";
import { api, blocked, can, count, fileBase64, hasTool, type Bundle, type Found, type Site, type SiteInventory, type Staged } from "../api";
import { Button, Glyph } from "../components/ui";
import { SiteTile } from "../components/SiteTile";
import { toast } from "../components/feedback";
import { Sheet } from "../components/Sheet";
import type { PlanRow } from "../components/JobSheet";
import { PkgTile, slugOf } from "../components/PkgTile";

/** How the sheet opens: for a theme (from Themes), or back from the review with what was picked. */
export type InstallStart = { theme?: boolean; pick?: Pick; chosen?: number[]; activate?: boolean };

type Props = {
  sites: Site[];
  inventory: Map<number, SiteInventory>;
  start?: InstallStart;
  onClose: () => void;
  /** `back` reopens this sheet as it was, from the review. */
  onPlan: (title: string, rows: PlanRow[], back: InstallStart) => void;
};

export type Pick =
  | { source: string; name: string; link: boolean; zip?: undefined; bundle?: undefined }
  | { zip: Staged; kind: "plugin" | "theme"; overwrite: boolean; name: string; bundle?: undefined }
  | { bundle: Bundle; name: string; zip?: undefined };

const isLink = (source: string) => source.startsWith("https://");

/** A WordPress.org name without its tagline: "Yoast SEO – Advanced SEO with…" is "Yoast SEO". */
export const shortName = (name: string) => name.split(/\s[–—-]\s|:\s/)[0].trim() || name;

/** The bundle's plugins this site doesn't have yet. */
export function missing(b: Bundle, inv: SiteInventory | undefined) {
  return b.plugins.filter((p) => isLink(p.source) || !inv?.inventory.plugins.some((x) => slugOf(x.id) === p.source));
}

/** Why a site can't take this pick, or null. */
export function cannot(s: Site, inv: SiteInventory | undefined, pick: Pick): string | null {
  const stop = blocked(s, inv);
  if (stop) return stop;
  if (pick.zip) {
    if (s.mode === "basic") return "Zips need the WP Sites HQ plugin, Classic Monks or Classic Monks Pro on the site.";
    if (!hasTool(s, "install-zip")) return "Update Classic Monks here to install zips.";
  } else if (!can(s, "install_plugin")) return "This connection can't install plugins.";
  if (inv?.inventory.needs_credentials) return "WordPress here needs FTP details to install.";
  if (pick.bundle) {
    const left = missing(pick.bundle, inv);
    if (left.length === 0) return "Has them all.";
    if (s.mode === "basic" && left.some((p) => isLink(p.source))) return "Basic mode installs from WordPress.org only.";
    return null;
  }
  if (pick.zip) return null;
  if (pick.link && s.mode === "basic") return "Basic mode installs from WordPress.org only.";
  if (!pick.link && inv?.inventory.plugins.some((p) => slugOf(p.id) === pick.source)) return "Already installed.";
  return null;
}

/** One slug or link a line, to bundle plugins. */
export function parseBundle(text: string) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((source) => ({ source, name: "" }));
}

function Bundles({ names, onPick }: { names: Map<string, string>; onPick: (b: Bundle) => void }) {
  const [list, setList] = useState<Bundle[]>([]);
  const [editing, setEditing] = useState<Bundle | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const load = () => api.bundles().then(setList, (e) => setError(String(e)));
  useEffect(() => {
    load();
  }, []);
  const edit = (b: Bundle) => {
    setEditing(b);
    setDeleting(false);
    setText(b.plugins.map((p) => p.source).join("\n"));
    setError(null);
  };
  const save = async () => {
    try {
      await api.saveBundle({ ...editing!, plugins: parseBundle(text) });
      setEditing(null);
      load();
    } catch (e) {
      toast(String(e), { tone: "danger" });
    }
  };
  const remove = async () => {
    try {
      await api.deleteBundle(editing!.id);
      setEditing(null);
      load();
    } catch (e) {
      toast(String(e), { tone: "danger" });
    }
    setDeleting(false);
  };
  return (
    <fieldset className="field">
      <legend>Bundles</legend>
      {error && <p className="alert danger">{error}</p>}
      {editing ? (
        <>
          <label className="field">
            <span>Bundle name</span>
            {/* The form replaces the list low in the sheet: focus brings it into view. */}
            <input className="input" autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </label>
          <label className="field">
            <span>Plugins, one per line</span>
            <textarea className="input mono" rows={5} placeholder={"woocommerce\nwordpress-seo\nhttps://example.com/my-plugin.zip"} value={text} onChange={(e) => setText(e.target.value)} />
            <small>WordPress.org slugs (the end of the plugin's address there), or https links to zips.</small>
          </label>
          {deleting ? (
            <div className="row ins-acts">
              <span className="sum">Delete the {editing.name} bundle? Sites keep the plugins it installed.</span>
              <span className="grow" />
              <Button small autoFocus onClick={() => setDeleting(false)}>
                Keep it
              </Button>
              <Button small kind="danger" onClick={remove}>
                Delete the bundle
                <Glyph name="trash" />
              </Button>
            </div>
          ) : (
            <div className="row ins-acts">
              {editing.id > 0 && (
                <Button small kind="danger" onClick={() => setDeleting(true)}>
                  Delete the bundle
                  <Glyph name="trash" />
                </Button>
              )}
              <span className="grow" />
              <Button small className="ghost" onClick={() => setEditing(null)}>
                <Glyph name="arrow-left" />
                Back to the bundles
              </Button>
              <Button small kind="primary" className="disc" disabled={!editing.name.trim() || !text.trim()} onClick={save}>
                Save the bundle
                <span className="btn-disc">
                  <Glyph name="check" />
                </span>
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          {list.length === 0 && <p className="dim">A bundle installs several plugins in one go, like the ones every new shop gets.</p>}
          <ul className="ins-bundles" aria-label="Bundles">
            {list.map((b) => (
              <li key={b.id}>
                <span className="tile sm" aria-hidden="true">
                  <Glyph name="package" />
                </span>
                <span className="grow">
                  <b>{b.name}</b>
                  <small className="named">
                    <span className="tiles">
                      {b.plugins.map((p) => !isLink(p.source) && <PkgTile key={p.source} kind="plugin" slug={p.source} name={p.name || p.source} size="xs" />)}
                    </span>
                    <span>
                      {b.plugins.length === 1 ? "1 plugin" : `${b.plugins.length} plugins`}: {b.plugins.map((p) => p.name || names.get(p.source) || p.source.split("/").pop()).join(", ")}
                    </span>
                  </small>
                </span>
                <Button small className="ghost" aria-label={`Edit the ${b.name} bundle`} onClick={() => edit(b)}>
                  Edit
                </Button>
                <Button small kind="soft" onClick={() => onPick(b)}>
                  Install {b.name}
                </Button>
              </li>
            ))}
          </ul>
          <div>
            <Button small className="ghost" onClick={() => edit({ id: 0, name: "", plugins: [] })}>
              New bundle
              <Glyph name="plus" />
            </Button>
          </div>
        </>
      )}
    </fieldset>
  );
}

export function Install({ sites, inventory, start, onClose, onPlan }: Props) {
  const theme = !!start?.theme;
  const [query, setQuery] = useState("");
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const linkId = useId();
  const [found, setFound] = useState<Found[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick | null>(start?.pick ?? null);
  const [chosen, setChosen] = useState<Set<number>>(new Set(start?.chosen));
  const [activate, setActivate] = useState(start?.activate ?? !theme);
  const [zipKind, setZipKind] = useState<"plugin" | "theme">(theme ? "theme" : "plugin");
  // Plugin names the sites already report, for bundle rows that only have a slug.
  const names = useMemo(() => new Map([...inventory.values()].flatMap((i) => i.inventory.plugins.map((p) => [slugOf(p.id), p.name] as const))), [inventory]);
  const [overwrite, setOverwrite] = useState(false);
  const [reading, setReading] = useState(false);

  const useZip = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setError(null);
    try {
      const zip = await api.stageZip(file.name, await fileBase64(file));
      choose({ zip, kind: zipKind, overwrite, name: zip.name });
      // A new theme isn't switched to unless asked.
      setActivate(zipKind === "plugin");
    } catch (e) {
      setError(String(e));
    } finally {
      setReading(false);
    }
  };

  const search = async () => {
    setSearching(true);
    setError(null);
    try {
      setFound((await api.searchPlugins(query)).map((f) => ({ ...f, name: shortName(f.name) })));
    } catch (e) {
      setError(String(e));
    } finally {
      setSearching(false);
    }
  };

  const choose = (p: Pick) => {
    setPick(p);
    setChosen(new Set(sites.filter((s) => !cannot(s, inventory.get(s.id), p)).map((s) => s.id)));
  };

  const useLink = () => {
    const url = link.trim();
    if (!/^https?:\/\/\S+$/.test(url)) {
      setLinkError("Paste the full link to a zip, starting with https://.");
      return;
    }
    setLinkError(null);
    choose({ source: url, name: decodeURIComponent(url.split("/").pop() || url), link: true });
  };

  // The changes the review gets: one per site, or one per missing plugin per site for a bundle.
  const picked = sites.filter((s) => chosen.has(s.id));
  const then = pick && activate ? (pick.zip && pick.kind === "theme" ? " and use it" : " and activate it") : "";
  const rows: PlanRow[] = !pick
    ? []
    : pick.bundle
      ? picked.flatMap((s) =>
          missing(pick.bundle, inventory.get(s.id)).map((p) => ({
            site: s.name,
            label: `Install ${p.name || names.get(p.source) || p.source}${then}`,
            change: { site_id: s.id, action: { do: "install_plugin" as const, source: p.source, activate } },
          })),
        )
      : picked.map((s) => ({
          site: s.name,
          label: `Install ${pick.name}${pick.zip && pick.overwrite ? ", replacing it" : ""}${then}`,
          change: {
            site_id: s.id,
            action: pick.zip
              ? { do: "install_zip" as const, file: pick.zip.file, name: pick.zip.name, kind: pick.kind, activate, overwrite: pick.overwrite }
              : { do: "install_plugin" as const, source: pick.source, activate },
          },
        }));
  const open = sites.filter((s) => pick && !cannot(s, inventory.get(s.id), pick));

  const review = () => {
    if (!pick) return;
    const on = picked.length === 1 ? picked[0].name : `${picked.length} sites`;
    onPlan(pick.bundle ? `Install the ${pick.bundle.name} bundle on ${on}` : `Install ${pick.name} on ${on}`, rows, { theme, pick, chosen: [...chosen], activate });
  };

  return (
    <Sheet
      title={pick ? (pick.bundle ? `Install the ${pick.name} bundle` : `Install ${pick.name}`) : theme ? "Install a theme" : "Install a plugin"}
      intro={
        pick
          ? "Pick the sites. You confirm before anything is installed."
          : theme
            ? "Choose a theme zip from this computer."
            : "Search WordPress.org, paste a link, choose a zip, or install a bundle."
      }
      onClose={onClose}
      footer={
        <>
          {pick && (
            <Button onClick={() => setPick(null)}>
              <Glyph name="arrow-left" />
              Back
            </Button>
          )}
          <Button onClick={onClose}>Close without changes</Button>
          {pick && (
            <Button kind="primary" className="disc" disabled={rows.length === 0} onClick={review}>
              {rows.length === 1 ? "Review the change" : `Review ${rows.length} changes`}
              <span className="btn-disc">
                <Glyph name="arrow" />
              </span>
            </Button>
          )}
        </>
      }
    >
      {error && (
        <p className="alert danger" role="alert">
          {error}
        </p>
      )}
      {!pick ? (
        <>
          {!theme && (
            <>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            <SearchInput
              className="grow"
              aria-label="Search WordPress.org plugins"
              placeholder="Search WordPress.org plugins"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button type="submit" disabled={searching || query.trim().length < 2}>
              {searching ? "Searching…" : "Search"}
            </Button>
          </form>
          <div role="status" className="dim found-count">
            {found && `${found.length === 0 ? "Nothing found." : `${found.length} found on WordPress.org.`}`}
          </div>
          {found && found.length > 0 && (
            <ul className="ins-found" aria-label="Plugins found">
              {found.map((f) => (
                <li key={f.slug}>
                  <PkgTile kind="plugin" slug={f.slug} name={f.name} />
                  <span className="grow">
                    <b>{f.name}</b>
                    <small className="cut" data-tip={f.summary}>
                      {f.summary}
                    </small>
                    <small>
                      <span className="mono">{f.version}</span> · <span>{count(f.active_installs)} sites use it</span>
                    </small>
                  </span>
                  <Button small aria-label={`Choose ${f.name}`} onClick={() => choose({ source: f.slug, name: f.name, link: false })}>
                    Choose
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <hr className="ins-rule" />
          <label className="field">
            <span>Or a link to a zip</span>
            <div className="row">
              <input
                className="input"
                placeholder="https://example.com/my-plugin.zip"
                value={link}
                aria-invalid={!!linkError}
                aria-describedby={linkError ? linkId : undefined}
                onChange={(e) => setLink(e.target.value)}
              />
              <Button onClick={useLink} disabled={!link.trim()}>
                Use this link
              </Button>
            </div>
            {linkError && (
              <small className="err" id={linkId} role="alert">
                {linkError}
              </small>
            )}
            <span className="callout warning">
              <Glyph name="alert" />
              <span>
                <b>Needs Classic Monks Pro on the site.</b> Only use links you trust: the zip runs as code on the site.
              </span>
            </span>
          </label>
            </>
          )}
          <fieldset className={theme ? "field" : "field ins-zip"}>
            <legend>{theme ? "A zip from this computer" : "Or a zip from this computer"}</legend>
            {!theme && <ZipKind kind={zipKind} onKind={setZipKind} />}
            <Replace on={overwrite} onChange={setOverwrite} />
            <FilePicker label="Choose a zip file" busy={reading ? "Reading the zip…" : undefined} accept=".zip,application/zip" disabled={reading} onFile={useZip} />
            <small>Needs the WP Sites HQ plugin, Classic Monks or Classic Monks Pro on the site. Only use zips you trust: they run as code on the site.</small>
          </fieldset>
          {!theme && (
            <>
              <hr className="ins-rule" />
              <Bundles names={names} onPick={(b) => choose({ bundle: b, name: b.name })} />
            </>
          )}
        </>
      ) : (
        <>
          <p>
            <b>{pick.name}</b>
            {!pick.zip && !pick.bundle && pick.link && <span className="mono dim"> {pick.source}</span>}
            {pick.zip && <span className="dim"> {(pick.zip.size / 1048576).toFixed(1)} MB</span>}
            {pick.bundle && <span className="dim"> {pick.bundle.plugins.map((p) => p.name || names.get(p.source) || p.source).join(", ")}. Each site gets the ones it doesn't have.</span>}
          </p>
          {/* Still changeable after the file is chosen. */}
          {pick.zip && (
            <div className="ins-zipset">
              <ZipKind
                kind={pick.kind}
                onKind={(kind) => {
                  setPick({ ...pick, kind });
                  setActivate(kind === "plugin");
                }}
              />
              <Replace on={pick.overwrite} onChange={(overwrite) => setPick({ ...pick, overwrite })} />
            </div>
          )}
          <ul className="ins-sites" aria-label="Sites">
            {open.length > 1 && (
              <li>
                <button
                  type="button"
                  className="box"
                  role="checkbox"
                  aria-checked={open.every((s) => chosen.has(s.id)) ? true : chosen.size > 0 ? "mixed" : false}
                  aria-label="All sites"
                  onClick={() => setChosen(new Set(open.every((s) => chosen.has(s.id)) ? [] : open.map((s) => s.id)))}
                />
                <b className="grow">All sites</b>
              </li>
            )}
            {sites.map((s) => {
              const why = cannot(s, inventory.get(s.id), pick);
              return (
                <li key={s.id} className={why ? "no" : undefined}>
                  <button
                    type="button"
                    className="box"
                    role="checkbox"
                    aria-checked={chosen.has(s.id)}
                    aria-label={`Install on ${s.name}`}
                    disabled={!!why}
                    onClick={() =>
                      setChosen((c) => {
                        const next = new Set(c);
                        if (next.has(s.id)) next.delete(s.id);
                        else next.add(s.id);
                        return next;
                      })
                    }
                  />
                  <SiteTile site={s} size="sm" />
                  <span className="grow">
                    {s.name}
                    {why && <span className="dim"> {why}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="row ins-then">
            <button
              type="button"
              className="box"
              role="checkbox"
              aria-checked={activate}
              aria-labelledby="activate-label"
              onClick={() => setActivate((a) => !a)}
            />
            <span id="activate-label">{pick.zip && pick.kind === "theme" ? "Use it as the site's theme after installing" : pick.bundle ? "Activate them after installing" : "Activate it after installing"}</span>
          </p>
        </>
      )}
    </Sheet>
  );
}

/** What the zip holds: picked before the file, and still changeable after. */
function ZipKind({ kind, onKind }: { kind: "plugin" | "theme"; onKind: (k: "plugin" | "theme") => void }) {
  return (
    <div className="segmented" role="group" aria-label="The zip holds">
      <button type="button" aria-pressed={kind === "plugin"} onClick={() => onKind("plugin")}>
        A plugin
      </button>
      <button type="button" aria-pressed={kind === "theme"} onClick={() => onKind("theme")}>
        A theme
      </button>
    </div>
  );
}

function Replace({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="row check">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span>
        Replace it where it's already installed <span className="dim">for a new version of a paid plugin or theme</span>
      </span>
    </label>
  );
}
