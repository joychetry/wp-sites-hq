// SPDX-License-Identifier: GPL-3.0-or-later
// Updates: everything waiting on every site, picked and sent to the plan.
import { useMemo, useState } from "react";
import { ago, api, blocked, type Action, type Site, type SiteInventory } from "../api";
import { Button } from "../components/ui";
import { toast } from "../components/feedback";
import type { PlanRow } from "../components/JobSheet";

type Kind = "WordPress" | "Plugin" | "Theme" | "Translations";
type Row = PlanRow & { key: string; kind: Kind; name: string };

/** Every update a site has waiting, as plan rows. */
export function updatesOf(s: Site, inv: SiteInventory | undefined): Row[] {
  if (!inv || blocked(s, inv) || !inv.inventory.updates_known) return [];
  const i = inv.inventory;
  const row = (key: string, kind: Kind, name: string, action: Action, from: string | null, to: string | null): Row => ({
    key: `${s.id}:${key}`,
    kind,
    name,
    site: s.name,
    label: kind === "Translations" ? name : `Update ${name}${kind === "Theme" ? " theme" : ""}`,
    from,
    to,
    change: { site_id: s.id, action },
  });
  return [
    ...(i.wordpress_update ? [row("core", "WordPress", "WordPress", { do: "update_core" }, i.wordpress, i.wordpress_update)] : []),
    ...i.plugins
      .filter((p) => p.update)
      .map((p) => row(`p:${p.id}`, "Plugin", p.name, { do: "update_plugin", plugin: p.id }, p.version, p.update)),
    ...i.themes
      .filter((t) => t.update)
      .map((t) => row(`t:${t.id}`, "Theme", t.name, { do: "update_theme", theme: t.id }, t.version, t.update)),
    ...(i.translations > 0
      ? [row("tr", "Translations", "Update translations", { do: "update_translations" }, null, null)]
      : []),
  ];
}

/** The plan's title for these updates, e.g. "Update WooCommerce on MC A". */
export function planTitle(list: (PlanRow & { name: string })[]): string {
  const sites = new Set(list.map((r) => r.change.site_id)).size;
  return `Update ${list.length === 1 ? list[0].name : `${list.length} things`} on ${sites === 1 ? list[0].site : `${sites} sites`}`;
}

/** Sites whose updates aren't in the list, and why. */
function unseen(sites: Site[], inventory: Map<number, SiteInventory>): [string, string][] {
  return sites.flatMap((s): [string, string][] => {
    const inv = inventory.get(s.id);
    const why =
      blocked(s, inv) ??
      (!inv!.inventory.updates_known ? "Basic mode can't see updates. They need Classic Monks on the site." : null) ??
      (inv!.inventory.needs_credentials
        ? "WordPress here needs FTP details to update, so its updates can't run from Monks Central."
        : null);
    return why ? [[s.name, why]] : [];
  });
}

type Props = {
  sites: Site[];
  inventory: Map<number, SiteInventory>;
  onPlan: (title: string, rows: PlanRow[]) => void;
};

export function Updates({ sites, inventory, onPlan }: Props) {
  const rows = useMemo(
    () => [...sites].sort((a, b) => a.name.localeCompare(b.name)).flatMap((s) => updatesOf(s, inventory.get(s.id))),
    [sites, inventory],
  );
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reading, setReading] = useState(false);
  // Errors float as toasts, so the rows don't move under the pointer.
  const setError = (text: string) => toast(text, { tone: "danger" });
  const chosen = rows.filter((r) => picked.has(r.key));
  const notes = unseen(sites, inventory);
  const oldest = Math.min(...sites.map((s) => inventory.get(s.id)?.fetched_at ?? Infinity));
  const siteCount = (list: Row[]) => new Set(list.map((r) => r.change.site_id)).size;

  const toggle = (key: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const readAgain = async () => {
    setReading(true);
    await api.refreshInventory().catch((e) => setError(String(e)));
    setReading(false);
  };

  return (
    <div className="scroll">
      <div className="bar">
        <span className="dim" role="status">
          {reading ? "Reading every site…" : Number.isFinite(oldest) ? `Read ${ago(oldest)}` : ""}
        </span>
        <span className="grow" />
        <Button small disabled={reading} onClick={readAgain}>
          Read every site again
        </Button>
        {/* Always there, so ticking a row doesn't slide the buttons beside it. */}
        <Button small disabled={chosen.length === 0} onClick={() => onPlan(planTitle(chosen), chosen)}>
          {chosen.length ? `Update ${chosen.length} selected` : "Update selected"}
        </Button>
        <Button small kind="primary" disabled={rows.length === 0} onClick={() => onPlan(planTitle(rows), rows)}>
          Update all {rows.length}
        </Button>
      </div>
      {rows.length === 0 ? (
        <div className="empty">
          <h2>No updates waiting.</h2>
          <p>
            {sites.length === 0
              ? "Add a site to see its updates here."
              : "Every site that Monks Central can read is up to date. Sites read their updates from WordPress.org about twice a day."}
          </p>
        </div>
      ) : (
        <>
          <p className="legend" id="updates-legend">
            <span>
              Every update waiting on {siteCount(rows) === 1 ? "1 site" : `${siteCount(rows)} sites`}. Installed is the
              version the site runs now; Available is the one it gets. Tick some, or update all; you see the plan before
              anything changes. After each plugin update on a site with current Classic Monks, Monks Central checks that
              the site still works and puts the
              old version back if it doesn't.
            </span>
          </p>
          <table className="t" aria-label="Updates waiting" aria-describedby="updates-legend">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <span className="sr-only">Selected</span>
                </th>
                <th>Site</th>
                <th>Type</th>
                <th>Name</th>
                <th>Installed</th>
                <th>Available</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={picked.has(r.key) ? "sel" : undefined}>
                  <td>
                    <button
                      type="button"
                      className="box"
                      role="checkbox"
                      aria-checked={picked.has(r.key)}
                      aria-label={`Select ${r.label} on ${r.site}`}
                      onClick={() => toggle(r.key)}
                    />
                  </td>
                  <td className="name cut" data-tip={r.site}>
                    {r.site}
                  </td>
                  <td>{r.kind}</td>
                  <td className="cut" data-tip={r.name}>
                    {r.name}
                  </td>
                  <td className={r.from ? "m" : "dim"}>{r.from ?? "not shown"}</td>
                  <td className={r.to ? "m" : "dim"}>{r.to ?? "new files"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {notes.length > 0 && (
        <section className="unseen" aria-label="Sites not in this list">
          <h3>Not in this list</h3>
          <ul className="ulist">
            {notes.map(([name, why]) => (
              <li key={name}>
                <b>{name}</b>
                <span className="dim">{why}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
