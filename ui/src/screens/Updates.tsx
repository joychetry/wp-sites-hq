// SPDX-License-Identifier: GPL-3.0-or-later
// Updates: everything waiting on every site, picked and sent to the plan.
import { Fragment, useMemo, useState } from "react";
import "../styles/screens/updates.css";
import { ago, api, blocked, siteStatus, type SecurityReport, type Site, type SiteInventory, type Vulnerability } from "../api";
import { Button, Glyph, HeadActions, Icon } from "../components/ui";
import { SiteTile } from "../components/SiteTile";
import { ChangeTile } from "../components/PkgTile";
import { Empty, toast } from "../components/feedback";
import { Page, Toolbar } from "../components/page";
import type { PlanRow } from "../components/JobSheet";
import { planTitle, updatesOf, type Kind, type Row } from "../fleet";

export { planTitle, updatesOf } from "../fleet";

/** Sites whose updates aren't in the list, and why. */
function unseen(sites: Site[], inventory: Map<number, SiteInventory>): [Site, string][] {
  return sites.flatMap((s): [Site, string][] => {
    const inv = inventory.get(s.id);
    const why =
      blocked(s, inv) ??
      (!inv!.inventory.updates_known ? "Basic mode can't see updates. They need Monks Central, Classic Monks or Classic Monks Pro on the site." : null) ??
      (inv!.inventory.needs_credentials
        ? "WordPress here needs FTP details to update, so its updates can't run from Monks Central."
        : null);
    return why ? [[s, why]] : [];
  });
}

/** The known vulnerability this update fixes, from the site's last security check. */
export function fixes(r: Row, report: SecurityReport | undefined): Vulnerability | undefined {
  const a = r.change.action;
  const id = a.do === "update_plugin" ? a.plugin : a.do === "update_theme" ? a.theme : null;
  return report?.vulnerabilities.find(
    (v) =>
      (a.do === "update_core" ? v.kind === "wordpress" : v.id === id && v.kind !== "wordpress") &&
      !!v.fixed_in &&
      !!r.to &&
      r.to.localeCompare(v.fixed_in, undefined, { numeric: true }) >= 0,
  );
}

/** "Good to know" about one update: a badge when it needs a look, quiet words otherwise. */
function goodToKnow(r: Row, vuln: Vulnerability | undefined): [string, "danger" | "warning" | null] {
  if (vuln) return ["Security fix", "danger"];
  if (r.kind === "Translations") return ["Language files", null];
  if (r.from && r.to && r.from.split(".")[0] !== r.to.split(".")[0]) return ["Major release", "warning"];
  if (r.kind === "Theme" && r.active) return ["Active theme", null];
  if (r.kind === "Plugin" && r.active === false) return ["Not active", null];
  return ["Minor release", null];
}

const KINDS: [Kind | "all", string, string][] = [
  ["all", "All", ""],
  ["WordPress", "Core", "k-core"],
  ["Plugin", "Plugins", "k-plugin"],
  ["Theme", "Themes", "k-theme"],
  ["Translations", "Translations", "k-tr"],
];
const KEY_WORD: Record<Kind, [string, string]> = {
  WordPress: ["core", "core"],
  Plugin: ["plugin", "plugins"],
  Theme: ["theme", "themes"],
  Translations: ["translation set", "translation sets"],
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;


type Props = {
  sites: Site[];
  inventory: Map<number, SiteInventory>;
  reports?: SecurityReport[];
  onPlan: (title: string, rows: PlanRow[]) => void;
};

export function Updates({ sites, inventory, reports = [], onPlan }: Props) {
  const rows = useMemo(() => {
    const byId = new Map(reports.map((r) => [r.site_id, r]));
    return [...sites]
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((s) => updatesOf(s, inventory.get(s.id)))
      .map((r) => {
        const vuln = fixes(r, byId.get(r.change.site_id));
        return { ...r, vuln, note: vuln ? "security fix" : undefined };
      });
  }, [sites, inventory, reports]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<Kind | "all">("all");
  const [grouped, setGrouped] = useState(true);
  const [reading, setReading] = useState(false);
  // Errors float as toasts, so the rows don't move under the pointer.
  const setError = (text: string) => toast(text, { tone: "danger" });
  const chosen = rows.filter((r) => picked.has(r.key));
  const shown = rows.filter((r) => kind === "all" || r.kind === kind);
  const notes = unseen(sites, inventory);
  const oldest = Math.min(...sites.map((s) => inventory.get(s.id)?.fetched_at ?? Infinity));
  const siteCount = (list: Row[]) => new Set(list.map((r) => r.change.site_id)).size;
  const count = (k: Kind) => rows.filter((r) => r.kind === k).length;
  const security = rows.filter((r) => r.vuln);
  const groups = useMemo(() => {
    const m = new Map<number, typeof shown>();
    shown.forEach((r) => m.set(r.change.site_id, [...(m.get(r.change.site_id) ?? []), r]));
    return [...m].map(([id, list]) => ({ site: sites.find((s) => s.id === id)!, list }));
  }, [shown, sites]);

  const toggle = (keys: string[], on: boolean) =>
    setPicked((p) => {
      const next = new Set(p);
      keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
      return next;
    });
  const box = (keys: string[], label: string) => {
    const all = keys.length > 0 && keys.every((k) => picked.has(k));
    return (
      <button
        type="button"
        className="box"
        role="checkbox"
        aria-checked={all ? true : keys.some((k) => picked.has(k)) ? "mixed" : false}
        aria-label={label}
        onClick={() => toggle(keys, !all)}
      />
    );
  };

  const readAgain = async () => {
    setReading(true);
    await api.refreshInventory().catch((e) => setError(String(e)));
    setReading(false);
  };

  const row = (r: (typeof rows)[number]) => {
    const [words, tone] = goodToKnow(r, r.vuln);
    return (
      <tr key={r.key} className={picked.has(r.key) ? "sel" : undefined}>
        <td>{box([r.key], `Select ${r.label} on ${r.site}`)}</td>
        <td>
          <div className="item">
            <ChangeTile action={r.change.action} name={r.name} />
            <span>
              <b className="cut" data-tip={r.name}>
                {r.name}
              </b>
              <small>{grouped ? (r.kind === "WordPress" ? "Core" : r.kind) : `${r.kind === "WordPress" ? "Core" : r.kind} · ${r.site}`}</small>
            </span>
          </div>
        </td>
        <td>
          {r.from && r.to ? (
            <span className="vto">
              <s>{r.from}</s>
              <Glyph name="arrow" />
              <span className="sr-only"> to </span>
              <b>{r.to}</b>
            </span>
          ) : (
            <span className="dim">new files</span>
          )}
        </td>
        <td>
          {tone ? (
            <span className={`tag ${tone}`} data-tip={r.vuln?.title}>
              {words}
            </span>
          ) : (
            <span className="dim">{words}</span>
          )}
        </td>
      </tr>
    );
  };

  // The right column: what is waiting, security fixes first, and how to go back.
  const side = (
    <div className="stack updates-side">
      <section className="stat" aria-label="What's waiting">
        <div className="stat-top">
          <h2 className="label">What's waiting</h2>
        </div>
        <p className="stat-n">
          <strong>{rows.length}</strong> {rows.length ? `${rows.length === 1 ? "update" : "updates"} on ${plural(siteCount(rows), "site")}` : "nothing waiting"}
        </p>
        {rows.length > 0 && (
          <>
            <div
              className="mix"
              role="img"
              aria-label={KINDS.slice(1)
                .filter(([k]) => count(k as Kind) > 0)
                .map(([k]) => `${count(k as Kind)} ${KEY_WORD[k as Kind][count(k as Kind) === 1 ? 0 : 1]}`)
                .join(", ")}
            >
              {KINDS.slice(1).map(([k, , cls]) => count(k as Kind) > 0 && <i key={k} className={cls} style={{ flex: count(k as Kind) }} />)}
            </div>
            <ul className="mix-key">
              {KINDS.slice(1).map(
                ([k, , cls]) =>
                  count(k as Kind) > 0 && (
                    <li key={k} className={cls}>
                      <i aria-hidden="true" />
                      <b>{count(k as Kind)}</b> {KEY_WORD[k as Kind][count(k as Kind) === 1 ? 0 : 1]}
                    </li>
                  ),
              )}
            </ul>
          </>
        )}
      </section>
      {security.length > 0 && (
        <section className="card upd-alert" aria-labelledby="upd-alert-t">
          <div className="card-body">
            <div className="row">
              <span className="tile sm warning">
                <Glyph name="alert" />
              </span>
              <b id="upd-alert-t">Action needed</b>
              <span className="tag">{plural(security.length, "security fix", "security fixes")}</span>
            </div>
            <p className="dim">
              {security.length === 1 ? "This update fixes a known vulnerability" : "These updates fix known vulnerabilities"}, from the last
              security check. Run {security.length === 1 ? "it" : "them"} first.
            </p>
            <ul className="upd-fixes">
              {security.map((r) => (
                <li key={r.key}>
                  <b>
                    {r.name} {r.to}
                  </b>{" "}
                  on {r.site}
                  <small>{r.vuln!.title}</small>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
      <p className="callout">
        <Glyph name="history" />
        <span>
          <b>A release misbehaves?</b> After each plugin update on a site with current Classic Monks, Monks Central checks that the
          site still works and puts the old version back if it doesn't. To go back later, open the plugin in Plugins and choose an
          older version.
        </span>
      </p>
    </div>
  );

  return (
    <Page className="updates" side={side}>
      <HeadActions>
        <Button disabled={reading} onClick={readAgain}>
          Read every site again
          <Glyph name="refresh" />
        </Button>
        <Button kind="primary" className="disc" disabled={rows.length === 0} onClick={() => onPlan(planTitle(rows), rows)}>
          Update all {rows.length}
          <span className="btn-disc">
            <Glyph name="arrow" />
          </span>
        </Button>
      </HeadActions>
      <Toolbar>
        <div className="segmented inline" role="group" aria-label="Show">
          {KINDS.filter(([k]) => k !== "Translations" || count("Translations") > 0).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {label} <small>{k === "all" ? rows.length : count(k)}</small>
            </button>
          ))}
        </div>
        <label className="row check end">
          <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
          <span>Group by site</span>
        </label>
      </Toolbar>
      <section className="card" aria-label="Pending updates">
        {rows.length === 0 ? (
          <Empty picture="done" title="No updates waiting.">
            <p>
              {sites.length === 0
                ? "Add a site to see its updates here."
                : "Every site that Monks Central can read is up to date. Sites read their updates from WordPress.org about twice a day."}
            </p>
          </Empty>
        ) : shown.length === 0 ? (
          <Empty small title="Nothing of this kind is waiting." />
        ) : (
          <table className="t" aria-label="Updates waiting">
            <thead>
              <tr>
                <th className="tick">{box(shown.map((r) => r.key), "Select every update")}</th>
                <th>Update</th>
                <th>From → to</th>
                <th>Good to know</th>
              </tr>
            </thead>
            <tbody>
              {grouped
                ? groups.map(({ site, list }) => {
                    const st = siteStatus(site);
                    return (
                      <Fragment key={site.id}>
                        <tr className="grp">
                          <td>{box(list.map((r) => r.key), `Select every update on ${site.name}`)}</td>
                          <td colSpan={3}>
                            <div className="item">
                              <SiteTile site={site} size="sm" />
                              <b>{site.name}</b>
                              <span className="dim">{plural(list.length, "update")}</span>
                              {st.tone !== "ok" && (
                                <>
                                  <span className={`st pill ${st.tone}`}>
                                    <Icon tone={st.tone} />
                                    {st.label}
                                  </span>
                                  <span className="dim">From the last read, {ago(inventory.get(site.id)?.fetched_at ?? null)}</span>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        {list.map(row)}
                      </Fragment>
                    );
                  })
                : shown.map(row)}
            </tbody>
          </table>
        )}
        {rows.length > 0 && (
          // Always there, so ticking a row doesn't move anything.
          <div className="card-foot">
            <span className="dim grow" role="status">
              {reading
                ? "Reading every site…"
                : chosen.length
                  ? `${plural(chosen.length, "update")} selected`
                  : Number.isFinite(oldest)
                    ? `Read ${ago(oldest)}`
                    : ""}
            </span>
            <Button small disabled={chosen.length === 0} onClick={() => onPlan(planTitle(chosen), chosen)}>
              {chosen.length ? `Update ${chosen.length} selected` : "Update selected"}
            </Button>
          </div>
        )}
      </section>
      {notes.length > 0 && (
        <section className="card" aria-label="Sites not in this list">
          <div className="card-head">
            <h2>Not in this list</h2>
            <span className="dim">{plural(notes.length, "site")}</span>
          </div>
          <ul className="unseen-list">
            {notes.map(([s, why]) => (
              <li key={s.id}>
                <SiteTile site={s} size="sm" />
                <b>{s.name}</b>
                <span className="dim">{why}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Page>
  );
}
