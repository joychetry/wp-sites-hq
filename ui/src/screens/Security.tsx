// Security: known vulnerabilities, abandoned plugins and changed files on every site.
import { useState } from "react";
import { ago, api, type SecurityReport, type Site, type SiteInventory, type Vulnerability } from "../api";
import { Button, Status } from "../components/ui";
import type { PlanRow } from "../components/JobSheet";

const SEVERITY_TONE: Record<string, "danger" | "warning"> = { critical: "danger", high: "danger" };
const KIND: Record<string, string> = { plugin: "Plugin", theme: "Theme", wordpress: "WordPress" };
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
  const [error, setError] = useState<string | null>(null);
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
  const notes = named.flatMap((s): [string, string][] => {
    const r = byId.get(s.id);
    if (!r) return [[s.name, "Not scanned yet."]];
    return r.notes.map((n) => [s.name, n]);
  });

  const scan = async () => {
    setScanning(true);
    setError(null);
    await api.scanSecurity().catch((e) => setError(String(e)));
    setScanning(false);
  };

  if (sites.length === 0) {
    return (
      <div className="empty">
        <h2>No sites yet.</h2>
        <p>Add a site to scan it for known vulnerabilities, abandoned plugins and changed files.</p>
      </div>
    );
  }

  return (
    <div className="scroll">
      <div className="bar">
        <span className="dim" role="status">
          {scanning ? "Scanning every site…" : Number.isFinite(oldest) ? `Scanned ${ago(oldest)}` : "Not scanned yet"}
        </span>
        <span className="grow" />
        {uniqueFixes.length > 0 && (
          <Button small onClick={() => onPlan(`Fix ${plural(uniqueFixes.length, "vulnerable plugin")}`, uniqueFixes)}>
            Update {plural(uniqueFixes.length, "vulnerable plugin")}
          </Button>
        )}
        <Button small kind="primary" disabled={scanning} onClick={scan}>
          {scanning ? "Scanning…" : "Scan all sites now"}
        </Button>
      </div>
      {error && (
        <div className="notice">
          <p className="alert danger" role="alert">
            {error}
          </p>
        </div>
      )}
      <p className="legend" id="security-legend">
        <span>
          {scanned.length === 0
            ? "Every site is scanned once a day while Monks Central runs."
            : vulns.length + abandoned.length + changed.length === 0
              ? `No known problems on ${plural(scanned.length, "site")}.`
              : `${plural(vulns.length, "known vulnerability", "known vulnerabilities")}, ${plural(abandoned.length, "abandoned plugin")} and ${plural(changed.length, "changed install", "changed installs")} on ${plural(scanned.length, "site")}.`}{" "}
          Vulnerabilities come from WPVulnerability, checked against the version each site runs. Sites are scanned once
          a day while Monks Central runs.
        </span>
      </p>

      <section aria-labelledby="sec-vulns">
        <h2 className="h-sec" id="sec-vulns">
          Known vulnerabilities
        </h2>
        {vulns.length === 0 ? (
          <p className="dim">None in the versions your sites run.</p>
        ) : (
          <table className="t" aria-labelledby="sec-vulns">
            <thead>
              <tr>
                <th>Site</th>
                <th>In</th>
                <th>Installed</th>
                <th>Problem</th>
                <th>Severity</th>
                <th>Fix</th>
              </tr>
            </thead>
            <tbody>
              {vulns.map(({ site, x }, i) => {
                const fix = fixOf(x, site, inventory.get(site.id));
                return (
                  <tr key={`${site.id}:${x.id}:${i}`}>
                    <td className="name cut" title={site.name}>
                      {site.name}
                    </td>
                    <td className="cut" title={x.name}>
                      {x.name}
                      <span className="sr-only"> ({KIND[x.kind]})</span>
                    </td>
                    <td className="m">{x.installed}</td>
                    <td className="wrap">
                      {x.title}
                      {x.link && (
                        <>
                          {" "}
                          <button
                            type="button"
                            className="link"
                            aria-label={`Read more about ${x.title}`}
                            onClick={() => api.openLink(x.link!)}
                          >
                            Read more
                          </button>
                        </>
                      )}
                    </td>
                    <td>
                      {x.severity ? (
                        <Status tone={SEVERITY_TONE[x.severity] ?? "warning"}>
                          {x.severity[0].toUpperCase() + x.severity.slice(1)}
                        </Status>
                      ) : (
                        <span className="dim">Not rated</span>
                      )}
                    </td>
                    <td>
                      {fix ? (
                        <Button
                          small
                          aria-label={`Update to ${fix.to} on ${site.name}`}
                          onClick={() => onPlan(`Update ${x.name} on ${site.name}`, [fix])}
                        >
                          Update to {fix.to}
                        </Button>
                      ) : x.fixed_in ? (
                        <span>Fixed in {x.fixed_in}</span>
                      ) : (
                        <span className="dim">No fix yet</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="sec-abandoned">
        <h2 className="h-sec" id="sec-abandoned">
          Abandoned plugins
        </h2>
        {abandoned.length === 0 ? (
          <p className="dim">None. Every plugin from WordPress.org had a release in the last two years.</p>
        ) : (
          <table className="t" aria-labelledby="sec-abandoned">
            <thead>
              <tr>
                <th>Site</th>
                <th>Plugin</th>
                <th>Installed</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {abandoned.map(({ site, x }) => (
                <tr key={`${site.id}:${x.id}`}>
                  <td className="name cut" title={site.name}>
                    {site.name}
                  </td>
                  <td className="cut" title={x.name}>
                    {x.name}
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
        )}
      </section>

      <section aria-labelledby="sec-files">
        <h2 className="h-sec" id="sec-files">
          Files that differ from WordPress.org
        </h2>
        {changed.length === 0 ? (
          <p className="dim">
            None. WordPress and every plugin from WordPress.org match their published checksums, where the site can
            check them.
          </p>
        ) : (
          <table className="t" aria-labelledby="sec-files">
            <thead>
              <tr>
                <th>Site</th>
                <th>In</th>
                <th>Files</th>
              </tr>
            </thead>
            <tbody>
              {changed.map(({ site, x }) => {
                const files = [
                  ...x.modified.map((f) => `${f} (changed)`),
                  ...x.missing.map((f) => `${f} (missing)`),
                  ...x.added.map((f) => `${f} (extra)`),
                ];
                return (
                  <tr key={`${site.id}:${x.name}`}>
                    <td className="name cut" title={site.name}>
                      {site.name}
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
        )}
      </section>

      {notes.length > 0 && (
        <section className="unseen" aria-label="Not checked">
          <h3>Not checked</h3>
          <ul className="ulist">
            {notes.map(([name, why], i) => (
              <li key={`${name}:${i}`}>
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
