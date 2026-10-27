// Install a plugin from WordPress.org (search) or a zip link, on the sites you pick.
import { useState } from "react";
import { api, blocked, can, count, type Found, type Site, type SiteInventory } from "../api";
import { Button } from "../components/ui";
import { Sheet } from "../components/Sheet";
import type { PlanRow } from "../components/JobSheet";
import { slugOf } from "./Matrix";

type Props = {
  sites: Site[];
  inventory: Map<number, SiteInventory>;
  onClose: () => void;
  onPlan: (title: string, rows: PlanRow[]) => void;
};

type Pick = { source: string; name: string; link: boolean };

/** Why a site can't take this plugin, or null. */
function cannot(s: Site, inv: SiteInventory | undefined, pick: Pick): string | null {
  const stop = blocked(s, inv);
  if (stop) return stop;
  if (!can(s, "install_plugin")) return "This connection can't install plugins.";
  if (pick.link && s.mode === "basic") return "Basic mode installs from WordPress.org only.";
  if (!pick.link && inv?.inventory.plugins.some((p) => slugOf(p.id) === pick.source)) return "Already installed.";
  if (inv?.inventory.needs_credentials) return "WordPress here needs FTP details to install.";
  return null;
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
    const rows: PlanRow[] = sites
      .filter((s) => chosen.has(s.id))
      .map((s) => ({
        site: s.name,
        label: `Install ${pick.name}${activate ? " and activate it" : ""}`,
        change: { site_id: s.id, action: { do: "install_plugin", source: pick.source, activate } },
      }));
    onPlan(`Install ${pick.name} on ${rows.length === 1 ? rows[0].site : `${rows.length} sites`}`, rows);
  };

  return (
    <Sheet
      title="Install a plugin"
      intro={pick ? "Pick the sites. You confirm before anything is installed." : "Search WordPress.org, or paste a link to a plugin zip."}
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
            <input
              className="input"
              aria-label="Search WordPress.org plugins"
              placeholder="Search WordPress.org plugins"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button kind="primary" type="submit" disabled={searching || query.trim().length < 2}>
              {searching ? "Searching…" : "Search"}
            </Button>
          </form>
          <div role="status" className="dim found-count">
            {found && `${found.length === 0 ? "Nothing found." : `${found.length} found on WordPress.org.`}`}
          </div>
          {found && found.length > 0 && (
            <ul className="found" aria-label="Plugins found">
              {found.map((f) => (
                <li key={f.slug}>
                  <div className="grow">
                    <b>{f.name}</b> <span className="mono dim">{f.version}</span>
                    <p>{f.summary}</p>
                    <span className="dim">{count(f.active_installs)} sites use it</span>
                  </div>
                  <Button small onClick={() => choose({ source: f.slug, name: f.name, link: false })}>
                    Choose {f.name.length > 24 ? "this one" : f.name}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <label className="field" style={{ marginTop: 24 }}>
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
            <small>Needs Classic Monks Pro on the site. Only use links you trust: the zip runs as code on the site.</small>
          </label>
        </>
      ) : (
        <>
          <p>
            <b>{pick.name}</b>
            {pick.link && <span className="mono dim"> {pick.source}</span>}
          </p>
          <ul className="plan-list" aria-label="Sites">
            {sites.map((s) => {
              const why = cannot(s, inventory.get(s.id), pick);
              return (
                <li key={s.id}>
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
                  <span className="grow">{s.name}</span>
                  {why && <span className="dim">{why}</span>}
                </li>
              );
            })}
          </ul>
          <p className="row">
            <button
              type="button"
              className="box"
              role="checkbox"
              aria-checked={activate}
              aria-labelledby="activate-label"
              onClick={() => setActivate((a) => !a)}
            />
            <span id="activate-label">Activate it after installing</span>
          </p>
        </>
      )}
    </Sheet>
  );
}
