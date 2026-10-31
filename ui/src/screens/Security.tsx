// SPDX-License-Identifier: GPL-3.0-or-later
// Security: known vulnerabilities, abandoned plugins and changed files on every site.
import "../styles/screens/security.css";
import { useState } from "react";
import { ago, api, type SecurityReport, type Site, type SiteInventory, type Vulnerability } from "../api";
import { SiteTile } from "../components/SiteTile";
import { PkgTile, slugOf } from "../components/PkgTile";
import { Button, Glyph, HeadActions, Icon } from "../components/ui";
import { Empty, toast } from "../components/feedback";
import { Page } from "../components/page";
import type { PlanRow } from "../components/JobSheet";

const SEVERITY_TONE: Record<string, "danger" | "warning"> = { critical: "danger", high: "danger" };
const KIND: Record<string, string> = { plugin: "plugin", theme: "theme", wordpress: "WordPress" };
const MONTH = new Intl.DateTimeFormat("en", { month: "short", year: "numeric" });

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The update that fixes a vulnerable plugin, when the site already offers one that new. */
export function fixOf(v: Vulnerability, site: Site, inv: SiteInventory | undefined): PlanRow | null {
  if (v.kind !== "plugin" || !v.fixed_in) return null;
  const p = inv?.inventory.plugins.find((p) => p.id === v.id);
  if (!p?.update || p.update.localeCompare(v.fixed_in, undefined, { numeric: true }) < 0) return null;
  return {
    site: site.name,
    label: `Update ${p.name}`,
    from: p.version,
    to: p.update,
    change: { site_id: site.id, action: { do: "update_plugin", plugin: p.id } },
  };
}

type Props = {
  sites: Site[];
  reports: SecurityReport[];
  inventory: Map<number, SiteInventory>;
  onPlan: (title: string, rows: PlanRow[]) => void;
};

export function Security({ sites, reports, inventory, onPlan }: Props) {
  const [scanning, setScanning] = useState(false);
  // Errors float as toasts, so the rows don't move under the pointer.
  const setError = (text: string) => toast(text, { tone: "danger" });
  const byId = new Map(reports.map((r) => [r.site_id, r]));
  const named = [...sites].sort((a, b) => a.name.localeCompare(b.name));
  const scanned = named.filter((s) => byId.has(s.id));
  const each = <T,>(pick: (r: SecurityReport) => T[]) =>
    scanned.flatMap((s) => pick(byId.get(s.id)!).map((x) => ({ site: s, x })));
  const vulns = each((r) => r.vulnerabilities);
  const abandoned = each((r) => r.abandoned);
  const changed = each((r) => r.checksums?.changed ?? []);
  const fixes = vulns.flatMap(({ site, x }) => fixOf(x, site, inventory.get(site.id)) ?? []);
  const uniqueFixes = [...new Map(fixes.map((f) => [`${f.change.site_id}:${f.label}`, f])).values()];
  const oldest = Math.min(...scanned.map((s) => byId.get(s.id)!.checked_at));
  // One card per vulnerability, with every site that has it.
  const groups = new Map<string, typeof vulns>();
  for (const v of vulns) {
    const key = `${v.x.kind}:${v.x.id}:${v.x.title}`;
    groups.set(key, [...(groups.get(key) ?? []), v]);
  }
  const cards = [...groups.values()];
  const clear = scanned.filter((s) => {
    const r = byId.get(s.id)!;
    return r.vulnerabilities.length + r.abandoned.length + (r.checksums?.changed.length ?? 0) === 0;
  });
  const vulnSites = new Set(vulns.map(({ site }) => site.id)).size;
  const [lastN, ...lastUnit] = (Number.isFinite(oldest) ? ago(oldest) : "not yet").split(" ");
  const notes = named.flatMap((s): [string, string][] => {
    const r = byId.get(s.id);
    if (!r) return [[s.name, "Not scanned yet."]];
    return r.notes.map((n) => [s.name, n]);
  });

  const scan = async () => {
    setScanning(true);
    await api.scanSecurity().catch((e) => setError(String(e)));
    setScanning(false);
  };

  if (sites.length === 0) {
    return (
      <Page>
        <Empty picture="sites" title="No sites yet.">
          <p>Add a site to scan it for known vulnerabilities, abandoned plugins and changed files.</p>
        </Empty>
      </Page>
    );
  }

  // The update button for one affected site, when the site offers the fixed version.
  const fixFor = (x: Vulnerability, site: Site) => {
    const fix = fixOf(x, site, inventory.get(site.id));
    return fix ? (
      <Button key={site.id} kind="soft" aria-label={`Update to ${fix.to} on ${site.name}`} onClick={() => onPlan(`Update ${x.name} on ${site.name}`, [fix])}>
        Update to {fix.to} on {site.name}
        <Glyph name="download" />
      </Button>
    ) : null;
  };

  return (
    <Page className="sec">
      <HeadActions>
        <Button disabled={scanning} onClick={scan}>
          {scanning ? "Scanning…" : "Scan all sites now"}
          <Glyph name="shield" />
        </Button>
        {uniqueFixes.length > 0 && (
          <Button kind="primary" className="disc" onClick={() => onPlan(`Fix ${plural(uniqueFixes.length, "vulnerable plugin")}`, uniqueFixes)}>
            Update {plural(uniqueFixes.length, "vulnerable plugin")}
            <span className="btn-disc">
              <Glyph name="arrow" />
            </span>
          </Button>
        )}
      </HeadActions>
      <span className="sr-only" role="status">
        {scanning ? "Scanning every site…" : Number.isFinite(oldest) ? `Scanned ${ago(oldest)}` : "Not scanned yet"}
      </span>
      <section className="g3" aria-label="Security at a glance">
        <div className={`stat ${vulns.length ? "alert" : ""}`}>
          <h2 className="label">Open vulnerabilities</h2>
          <p className="stat-n">
            <strong>{vulns.length}</strong> {vulns.length ? `on ${plural(vulnSites, "site")}` : "known"}
          </p>
        </div>
        <div className="stat">
          <h2 className="label">Sites clear</h2>
          <p className="stat-n">
            <strong>{clear.length}</strong> of {sites.length}
          </p>
        </div>
        <div className="stat">
          <h2 className="label">Last scan</h2>
          <p className="stat-n">
            {/^\d/.test(lastN) ? (
              <>
                <strong>{lastN}</strong> {lastUnit.join(" ")}
              </>
            ) : (
              <strong>{[lastN, ...lastUnit].join(" ")}</strong>
            )}
          </p>
        </div>
      </section>
      <div className="sec-split">
        <div className="stack">
          <h2 className="sr-only" id="sec-vulns">
            Known vulnerabilities
          </h2>
          {cards.length === 0 ? (
            <p className="callout ok">
              <Glyph name="shield" />
              <span>
                <b>No known vulnerabilities.</b> None in the versions your sites run.
              </span>
            </p>
          ) : (
            <ul className="vulns" aria-labelledby="sec-vulns">
              {cards.map((hits) => {
                const x = hits[0].x;
                const tone = x.severity ? (SEVERITY_TONE[x.severity] ?? "warning") : "";
                const kind = KIND[x.kind];
                const affected = new Set(hits.map(({ site }) => site.id));
                // Sites that run the same plugin without this vulnerability.
                const fine = scanned.flatMap((s) => {
                  const p = x.kind === "plugin" && !affected.has(s.id) ? inventory.get(s.id)?.inventory.plugins.find((p) => p.id === x.id) : undefined;
                  return p ? [`${s.name}, on ${p.version}`] : [];
                });
                const away = hits.filter(({ site }) => site.health === "down");
                const fixes = hits.map(({ site }) => fixFor(x, site)).filter(Boolean);
                return (
                  <li key={`${x.kind}:${x.id}:${x.title}`} className={`card vuln ${tone}`}>
                    <div className="card-body">
                      <div className="vhead">
                        <span className={`tile ${tone || "warning"}`}>
                          <Glyph name="shield" />
                        </span>
                        <div>
                          <span className="row">
                            <span className={`tag ${tone}`}>{x.severity ? x.severity[0].toUpperCase() + x.severity.slice(1) : "Not rated"}</span>
                            <span className="meta named">
                              {x.kind !== "wordpress" && <PkgTile kind={x.kind} slug={x.kind === "plugin" ? slugOf(x.id) : x.id} name={x.name} size="xs" />}
                              {x.name}
                              {x.kind !== "wordpress" && ` · ${kind}`}
                            </span>
                          </span>
                          <h3>{x.kind === "wordpress" ? "Vulnerability in WordPress" : `Vulnerability in a ${kind}: ${x.name}`}</h3>
                          <p>{x.title}</p>
                        </div>
                      </div>
                      <dl className="dl well">
                        <div>
                          <dt>Installed</dt>
                          <dd className="m">{[...new Set(hits.map(({ x }) => x.installed))].join(", ")}</dd>
                        </div>
                        <div>
                          <dt>Fixed in</dt>
                          <dd className="m">{x.fixed_in ?? "Not yet"}</dd>
                        </div>
                        <div>
                          <dt>Sites affected</dt>
                          <dd>
                            {hits.map(({ site, x }) => (
                              <span key={site.id} className="conn">
                                <SiteTile site={site} size="sm" />
                                {site.name}, on {x.installed}
                              </span>
                            ))}
                          </dd>
                        </div>
                        {fine.length > 0 && (
                          <div>
                            <dt>Not affected</dt>
                            <dd>{fine.join("; ")}</dd>
                          </div>
                        )}
                      </dl>
                      {away.length > 0 && (
                        <p className="callout warning">
                          <Glyph name="unplug" />
                          <span>
                            <b>{away.map(({ site }) => site.name).join(", ")} couldn't be reached at the last check.</b> Check it again, then update once it answers.
                          </span>
                        </p>
                      )}
                      <div className="row acts">
                        {fixes}
                        {fixes.length === 0 && <span className="dim">{x.fixed_in ? `Fixed in ${x.fixed_in}, once the site offers that update` : "No fix yet"}</span>}
                        {x.link && (
                          <Button className="ghost" aria-label={`Read more about ${x.title}`} onClick={() => api.openLink(x.link!).catch((e) => setError(String(e)))}>
                            Read more
                            <Glyph name="external" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {abandoned.length > 0 && (
            <section className="card" aria-labelledby="sec-abandoned">
              <div className="card-head">
                <h2 id="sec-abandoned">Abandoned plugins</h2>
                <span className="dim">No release in two years, or closed</span>
              </div>
              <table className="t" aria-labelledby="sec-abandoned">
                <thead>
                  <tr>
                    <th scope="col">Site</th>
                    <th scope="col">Plugin</th>
                    <th scope="col">Installed</th>
                    <th scope="col">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {abandoned.map(({ site, x }) => (
                    <tr key={`${site.id}:${x.id}`}>
                      <td>
                        <span className="site">
                          <SiteTile site={site} size="sm" />
                          <b>{site.name}</b>
                        </span>
                      </td>
                      <td className="cut" data-tip={x.name}>
                        <span className="site">
                          <PkgTile kind="plugin" slug={slugOf(x.id)} name={x.name} size="sm" />
                          {x.name}
                        </span>
                      </td>
                      <td className="m">{x.version}</td>
                      <td className="wrap">
                        {x.closed
                          ? `WordPress.org closed it${x.reason ? ` (${x.reason.replace(/-/g, " ")})` : ""}: it gets no more updates. Replace it.`
                          : `No release since ${x.last_updated ? MONTH.format(x.last_updated * 1000) : "a long time"}. Look for a maintained one.`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {changed.length > 0 && (
            <section className="card" aria-labelledby="sec-files">
              <div className="card-head">
                <h2 id="sec-files">Files that differ from WordPress.org</h2>
              </div>
              <table className="t" aria-labelledby="sec-files">
                <thead>
                  <tr>
                    <th scope="col">Site</th>
                    <th scope="col">In</th>
                    <th scope="col">Files</th>
                  </tr>
                </thead>
                <tbody>
                  {changed.map(({ site, x }) => {
                    const files = [...x.modified.map((f) => `${f} (changed)`), ...x.missing.map((f) => `${f} (missing)`), ...x.added.map((f) => `${f} (extra)`)];
                    return (
                      <tr key={`${site.id}:${x.name}`}>
                        <td>
                          <span className="site">
                            <SiteTile site={site} size="sm" />
                            <b>{site.name}</b>
                          </span>
                        </td>
                        <td>{x.name}</td>
                        <td className="wrap m">
                          {files.slice(0, 5).join(", ")}
                          {files.length > 5 && `, and ${files.length - 5} more`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}
        </div>

        <div className="stack">
          <section className="card" aria-labelledby="sec-clear">
            <div className="card-head">
              <h2 id="sec-clear">Sites with nothing known</h2>
            </div>
            {clear.length === 0 ? (
              <Empty small title={scanned.length ? "Every scanned site has something to look at." : "No site scanned yet."} />
            ) : (
              <ul className="fixes">
                {clear.map((s) => {
                  const inv = inventory.get(s.id)?.inventory;
                  return (
                    <li key={s.id} className="fix">
                      <SiteTile site={s} />
                      <div>
                        <b>{s.name}</b>
                        <span>{inv ? `${plural(inv.plugins.length + inv.themes.length, "plugin and theme", "plugins and themes")} scanned` : `Scanned ${ago(byId.get(s.id)!.checked_at)}`}</span>
                      </div>
                      <span className="st pill ok">
                        <Icon tone="ok" />
                        Clear
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          {notes.length > 0 && (
            <section className="card" aria-label="Not checked">
              <div className="card-head">
                <h2>Not checked</h2>
              </div>
              <ul className="fixes">
                {notes.map(([name, why], i) => {
                  const s = named.find((s) => s.name === name)!;
                  return (
                    <li key={`${name}:${i}`} className="fix two">
                      <SiteTile site={s} />
                      <div>
                        <b>{name}</b>
                        <span>{why}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <p className="note" id="security-legend">
            {scanned.length === 0
              ? "Every site is scanned once a day while WP Sites HQ runs."
              : vulns.length + abandoned.length + changed.length === 0
                ? `No known problems on ${plural(scanned.length, "site")}.`
                : `${plural(vulns.length, "known vulnerability", "known vulnerabilities")}, ${plural(abandoned.length, "abandoned plugin")} and ${plural(changed.length, "changed install", "changed installs")} on ${plural(scanned.length, "site")}.`}{" "}
            Vulnerabilities come from WPVulnerability, checked against the version each site runs. Sites are scanned once a day while WP Sites HQ runs.
          </p>
        </div>
      </div>
    </Page>
  );
}
