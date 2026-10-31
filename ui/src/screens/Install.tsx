// SPDX-License-Identifier: GPL-3.0-or-later
// Install a plugin from WordPress.org (search), a zip link, a zip on this computer
// (plugin or theme, Classic Monks M8) or a bundle, on the sites you pick.
import "../styles/screens/install.css";
import { FilePicker, SearchInput } from "../components/controls";
import { useEffect, useState } from "react";
import { api, blocked, can, count, fileBase64, hasTool, type Bundle, type Found, type Site, type SiteInventory, type Staged } from "../api";
import { Button, Glyph } from "../components/ui";
import { SiteTile } from "../components/SiteTile";
import { toast } from "../components/feedback";
import { Sheet } from "../components/Sheet";
import type { PlanRow } from "../components/JobSheet";
import { PkgTile, slugOf } from "../components/PkgTile";

type Props = {
  sites: Site[];
  inventory: Map<number, SiteInventory>;
  onClose: () => void;
  onPlan: (title: string, rows: PlanRow[]) => void;
};

type Pick =
  | { source: string; name: string; link: boolean; zip?: undefined; bundle?: undefined }
  | { zip: Staged; kind: "plugin" | "theme"; overwrite: boolean; name: string; bundle?: undefined }
  | { bundle: Bundle; name: string; zip?: undefined };

const isLink = (source: string) => source.startsWith("https://");

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

function Bundles({ onPick }: { onPick: (b: Bundle) => void }) {
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
            <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </label>
          <label className="field">
            <span>Plugins, one a line</span>
            <textarea className="input mono" rows={5} placeholder={"woocommerce\nwordpress-seo\nhttps://example.com/my-plugin.zip"} value={text} onChange={(e) => setText(e.target.value)} />
            <small>WordPress.org slugs (the end of the plugin's address there), or https links to zips.</small>
          </label>
          {deleting ? (
            <div className="row ins-acts">
              <span className="sum">Delete the {editing.name} bundle? Sites keep the plugins it installed.</span>
              <span className="grow" />
              <Button small onClick={() => setDeleting(false)}>
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
                Close without saving
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
                      {b.plugins.length === 1 ? "1 plugin" : `${b.plugins.length} plugins`}: {b.plugins.map((p) => p.name || p.source.split("/").pop()).join(", ")}
                    </span>
                  </small>
                </span>
                <Button small className="ghost" onClick={() => edit(b)}>
                  Edit the {b.name} bundle
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

export function Install({ sites, inventory, onClose, onPlan }: Props) {
  const [query, setQuery] = useState("");
  const [link, setLink] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [activate, setActivate] = useState(true);
  const [zipKind, setZipKind] = useState<"plugin" | "theme">("plugin");
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
      setFound(await api.searchPlugins(query));
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
      setError("Paste the full link to a zip, starting with https://.");
      return;
    }
    choose({ source: url, name: decodeURIComponent(url.split("/").pop() || url), link: true });
  };

  const review = () => {
    if (!pick) return;
    const picked = sites.filter((s) => chosen.has(s.id));
    const on = (n: number) => (n === 1 ? picked[0].name : `${n} sites`);
    const then = activate ? (pick.zip && pick.kind === "theme" ? " and use it" : " and activate it") : "";
    if (pick.bundle) {
      const rows: PlanRow[] = picked.flatMap((s) =>
        missing(pick.bundle, inventory.get(s.id)).map((p) => ({
          site: s.name,
          label: `Install ${p.name || p.source}${then}`,
          change: { site_id: s.id, action: { do: "install_plugin" as const, source: p.source, activate } },
        })),
      );
      onPlan(`Install the ${pick.bundle.name} bundle on ${on(picked.length)}`, rows);
      return;
    }
    const rows: PlanRow[] = picked.map((s) => ({
      site: s.name,
      label: `Install ${pick.name}${pick.zip && pick.overwrite ? ", replacing it" : ""}${then}`,
      change: {
        site_id: s.id,
        action: pick.zip
          ? { do: "install_zip", file: pick.zip.file, name: pick.zip.name, kind: pick.kind, activate, overwrite: pick.overwrite }
          : { do: "install_plugin", source: pick.source, activate },
      },
    }));
    onPlan(`Install ${pick.name} on ${on(rows.length)}`, rows);
  };

  return (
    <Sheet
      title={pick ? (pick.bundle ? `Install the ${pick.name} bundle` : `Install ${pick.name}`) : "Install a plugin"}
      intro={pick ? "Pick the sites. You confirm before anything is installed." : "Search WordPress.org, paste a link, choose a zip, or install a bundle."}
      onClose={onClose}
      footer={
        <>
          {pick && <Button onClick={() => setPick(null)}>Back</Button>}
          <Button onClick={onClose}>Close without changes</Button>
          {pick && (
            <Button kind="primary" disabled={chosen.size === 0} onClick={review}>
              Review {chosen.size === 1 ? "1 site" : `${chosen.size} sites`}
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
              {found.map((f, i) => (
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
                  <Button small kind={i === 0 ? "soft" : undefined} onClick={() => choose({ source: f.slug, name: f.name, link: false })}>
                    Choose {f.name.length > 24 ? "this one" : f.name}
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
                onChange={(e) => setLink(e.target.value)}
              />
              <Button onClick={useLink} disabled={!link.trim()}>
                Use this link
              </Button>
            </div>
            <span className="callout warning">
              <Glyph name="alert" />
              <span>
                <b>Needs Classic Monks Pro on the site.</b> Only use links you trust: the zip runs as code on the site.
              </span>
            </span>
          </label>
          <fieldset className="field ins-zip">
            <legend>Or a zip from this computer</legend>
            <div className="segmented" role="group" aria-label="The zip holds">
              <button type="button" aria-pressed={zipKind === "plugin"} onClick={() => setZipKind("plugin")}>
                A plugin
              </button>
              <button type="button" aria-pressed={zipKind === "theme"} onClick={() => setZipKind("theme")}>
                A theme
              </button>
            </div>
            <label className="row check">
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              <span>
                Replace it where it's already installed <span className="dim">for a new version of a paid plugin or theme</span>
              </span>
            </label>
            <FilePicker label="Choose a zip file" busy={reading ? "Reading the zip…" : undefined} accept=".zip,application/zip" disabled={reading} onFile={useZip} />
            <small>Needs the WP Sites HQ plugin, Classic Monks or Classic Monks Pro on the site. Only use zips you trust: they run as code on the site.</small>
          </fieldset>
          <hr className="ins-rule" />
          <Bundles onPick={(b) => choose({ bundle: b, name: b.name })} />
        </>
      ) : (
        <>
          <p>
            <b>{pick.name}</b>
            {!pick.zip && !pick.bundle && pick.link && <span className="mono dim"> {pick.source}</span>}
            {pick.zip && <span className="dim"> {pick.kind === "theme" ? "theme" : "plugin"}, {(pick.zip.size / 1048576).toFixed(1)} MB{pick.overwrite ? ", replaces an installed copy" : ""}</span>}
            {pick.bundle && <span className="dim"> {pick.bundle.plugins.map((p) => p.name || p.source).join(", ")}. Each site gets the ones it doesn't have.</span>}
          </p>
          <ul className="ins-sites" aria-label="Sites">
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
