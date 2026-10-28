// SPDX-License-Identifier: GPL-3.0-or-later
// Plugins and Themes: one row per plugin or theme, one column per site, and an
// inspector for the cell in focus. Arrow keys move between cells.
import "../styles/screens/matrix.css";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api, blocked, can, type Action, type Change, type Item, type PluginVersions, type SecurityReport, type Site, type SiteInventory, type Vulnerability } from "../api";
import { Button, Glyph, HeadActions, Icon } from "../components/ui";
import { Menu, SearchInput } from "../components/controls";
import { Sheet } from "../components/Sheet";
import { SiteTile } from "../components/SiteTile";
import { PkgTile, slugOf } from "../components/PkgTile";
import { toast } from "../components/feedback";
import type { PlanRow } from "../components/JobSheet";

export type Kind = "plugins" | "themes";

type Col = { id: string; name: string; sites: number; updates: number };

type Props = {
  kind: Kind;
  sites: Site[];
  inventory: Map<number, SiteInventory>;
  /** Review first: many sites, or a change that removes or switches something. */
  onPlan: (title: string, rows: PlanRow[], start: "plan" | "confirm", danger?: boolean) => void;
  /** Run now and show progress: one site, nothing lost if it goes wrong. */
  onRun: (title: string, changes: Change[]) => void;
  onInstall?: () => void;
};

/** A stable release older than the installed one: rolling back never upgrades, and never lands on a beta. */
export function olderStable(version: string, installed: string): boolean {
  if (!/^\d+(\.\d+)*$/.test(version)) return false;
  const base = installed.match(/^\d+(\.\d+)*/)?.[0];
  if (!base) return false;
  const a = version.split(".").map(Number);
  const b = base.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d < 0;
  }
  return false;
}

const itemsOf = (kind: Kind, inv: SiteInventory | undefined) => (kind === "plugins" ? inv?.inventory.plugins : inv?.inventory.themes) ?? [];

export { slugOf };

/** A known vulnerability in the version this site runs, from the last security check. */
const vulnOf = (reports: SecurityReport[], kind: Kind, site: number, it: Item | undefined) =>
  it && reports.find((r) => r.site_id === site)?.vulnerabilities.find((v) => v.kind === (kind === "plugins" ? "plugin" : "theme") && v.id === it.id && v.installed === it.version);

type Tone = "up" | "on" | "idle" | "none" | "vuln";

/** A cell's look and its words: the version, then what state it is in. */
export function cellOf(kind: Kind, it: Item | undefined, vuln?: Vulnerability): { tone: Tone; word: string } {
  const plugin = kind === "plugins";
  if (!it) return { tone: "none", word: "Not installed" };
  if (vuln) return { tone: "vuln", word: vuln.fixed_in && it.update ? "Vulnerable · fix ready" : "Vulnerable" };
  if (it.update) return { tone: "up", word: `Update to ${it.update}${plugin && !it.active ? " · inactive" : !plugin && it.active ? " · active" : ""}` };
  if (it.active) return { tone: "on", word: plugin ? "Active" : "Active theme" };
  return { tone: "idle", word: plugin ? "Inactive" : "Installed" };
}

const STATUS = ["Any", "Update ready", "Inactive", "Known vulnerability", "Not on every site"] as const;
type StatusFilter = (typeof STATUS)[number];

export function Matrix({ kind, sites, inventory, onPlan, onRun, onInstall }: Props) {
  const [onlyUpdates, setOnlyUpdates] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("Any");
  const [cursor, setCursor] = useState<[number, number]>([0, 0]);
  const [sel, setSel] = useState<{ site: number; item: string } | null>(null);
  const [reports, setReports] = useState<SecurityReport[]>([]);
  const grid = useRef<HTMLTableElement>(null);
  const plugin = kind === "plugins";
  const noun = plugin ? "plugin" : "theme";
  const Noun = plugin ? "Plugin" : "Theme";

  useEffect(() => {
    let live = true;
    (async () => {
      const r = await api.security();
      if (live && Array.isArray(r)) setReports(r);
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const read = useMemo(() => [...sites].sort((a, b) => a.name.localeCompare(b.name)), [sites]);
  const cols = useMemo(() => {
    const m = new Map<string, Col>();
    for (const s of read)
      for (const it of itemsOf(kind, inventory.get(s.id))) {
        const c = m.get(it.id) ?? { id: it.id, name: it.name || it.id, sites: 0, updates: 0 };
        c.sites += 1;
        if (it.update) c.updates += 1;
        m.set(it.id, c);
      }
    return [...m.values()].sort((a, b) => b.sites - a.sites || a.name.localeCompare(b.name));
  }, [read, inventory, kind]);
  const shown = read.filter((s) => !onlyUpdates || itemsOf(kind, inventory.get(s.id)).some((i) => i.update));
  const ready = shown.filter((s) => !blocked(s, inventory.get(s.id)));
  const notReady = shown.filter((s) => blocked(s, inventory.get(s.id)));
  const items = useMemo(() => new Map(read.map((s) => [s.id, new Map(itemsOf(kind, inventory.get(s.id)).map((i) => [i.id, i]))])), [read, inventory, kind]);
  const itemAt = (site: number, id: string) => items.get(site)?.get(id);
  const waiting = cols.reduce((n, c) => n + c.updates, 0);

  const q = query.trim().toLowerCase();
  const rows = cols.filter((c) => {
    if (q && !c.name.toLowerCase().includes(q) && !c.id.toLowerCase().includes(q)) return false;
    const on = ready.map((s) => itemAt(s.id, c.id));
    if (status === "Update ready") return on.some((i) => i?.update);
    if (status === "Inactive") return on.some((i) => i && !i.active);
    if (status === "Known vulnerability") return ready.some((s) => vulnOf(reports, kind, s.id, itemAt(s.id, c.id)));
    if (status === "Not on every site") return on.some((i) => !i);
    return true;
  });
  // Filters can shrink the grid under the cursor; the grid keeps one Tab stop.
  const cur: [number, number] = [Math.min(cursor[0], rows.length - 1), Math.min(cursor[1], ready.length - 1)];

  const updateRows = (only?: string): PlanRow[] =>
    ready.flatMap((s) =>
      itemsOf(kind, inventory.get(s.id))
        .filter((i) => i.update && (!only || i.id === only) && can(s, plugin ? "update_plugin" : "update_theme"))
        .map((i) => ({
          site: s.name,
          label: `Update ${i.name}`,
          from: i.version,
          to: i.update,
          change: {
            site_id: s.id,
            action: (plugin ? { do: "update_plugin", plugin: i.id } : { do: "update_theme", theme: i.id }) as Action,
          },
        })),
    );

  const focusCell = (r: number, c: number) => {
    const rr = Math.max(0, Math.min(rows.length - 1, r));
    const cc = Math.max(0, Math.min(ready.length - 1, c));
    setCursor([rr, cc]);
    grid.current?.querySelector<HTMLElement>(`[data-cell="${rr}:${cc}"]`)?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const [r, c] = cur;
    const moves: Record<string, [number, number]> = {
      ArrowRight: [r, c + 1],
      ArrowLeft: [r, c - 1],
      ArrowDown: [r + 1, c],
      ArrowUp: [r - 1, c],
      Home: [r, 0],
      End: [r, ready.length - 1],
    };
    const to = moves[e.key];
    if (!to) return;
    e.preventDefault();
    focusCell(...to);
  };

  const selSite = sel && sites.find((s) => s.id === sel.site);
  const selCol = sel && cols.find((c) => c.id === sel.item);
  const updateLabel = waiting === 0 ? `No ${noun} updates` : `Update ${waiting === 1 ? `1 ${noun}` : `${waiting} ${noun}s`}`;

  return (
    <>
      <HeadActions>
        {onInstall && (
          <Button onClick={onInstall}>
            <Glyph name="plus" />
            Install a plugin
          </Button>
        )}
        <Button kind="primary" className={waiting ? "disc" : undefined} disabled={waiting === 0} onClick={() => onPlan(updateLabel, updateRows(), "plan")}>
          {updateLabel}
          {waiting > 0 && (
            <span className="btn-disc">
              <Glyph name="arrow" />
            </span>
          )}
        </Button>
      </HeadActions>
      <div className="scroll page mx">
        <div className="stack">
          <div className="filters">
            <SearchInput aria-label={`Find a ${noun}`} placeholder={`Find a ${noun}`} value={query} onChange={(e) => setQuery(e.target.value)} />
            <Menu
              label="Show"
              className="chip"
              items={[
                { label: "Every site", run: () => setOnlyUpdates(false) },
                { label: "Only sites with updates", run: () => setOnlyUpdates(true) },
              ]}
            >
              Show: <b>{onlyUpdates ? "Only sites with updates" : "Every site"}</b>
            </Menu>
            {plugin && (
              <Menu label="Status" className="chip" items={STATUS.map((s) => ({ label: s, run: () => setStatus(s) }))}>
                Status: <b>{status}</b>
              </Menu>
            )}
          </div>
          <section className="card" aria-label={`${Noun}s by site`}>
            {cols.length === 0 ? (
              <div className="empty">
                <h2>No {noun}s to show yet.</h2>
                <p>
                  {sites.length === 0
                    ? "Add a site to see its plugins and themes here."
                    : `Monks Central reads each site's ${noun}s when it checks the site. Check all sites now, then come back.`}
                </p>
              </div>
            ) : rows.length === 0 || ready.length === 0 ? (
              <p className="card-body dim">{ready.length === 0 ? "None of these sites can be read now. See why below." : `No ${noun} matches these filters.`}</p>
            ) : (
              <div className="mx-box">
                <table
                  ref={grid}
                  className="t mx-t"
                  role="grid"
                  aria-readonly="true"
                  aria-label={plugin ? "Plugins on every site" : "Themes on every site"}
                  aria-describedby={`${kind}-legend`}
                  onKeyDown={onKey}
                >
                  <thead>
                    <tr>
                      <th scope="col">{Noun}</th>
                      {ready.map((s) => (
                        <th key={s.id} scope="col" data-tip={s.name}>
                          <span className="colname">{s.name}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((col, r) => (
                      <tr key={col.id}>
                        <th scope="row">
                          <span className="mx-plug">
                            <Tile kind={kind} id={col.id} name={col.name} />
                            <span>
                              <b>{col.name}</b>
                              <small>{plugin ? slugOf(col.id) : col.id}</small>
                            </span>
                          </span>
                        </th>
                        {ready.map((s, c) => {
                          const it = itemAt(s.id, col.id);
                          const { tone, word } = cellOf(kind, it, vulnOf(reports, kind, s.id, it));
                          const on = sel?.site === s.id && sel.item === col.id;
                          return (
                            <td key={s.id} role="gridcell">
                              <button
                                type="button"
                                className={`cell ${tone}`}
                                data-cell={`${r}:${c}`}
                                tabIndex={cur[0] === r && cur[1] === c ? 0 : -1}
                                aria-pressed={on}
                                onFocus={() => setCursor([r, c])}
                                onClick={() => setSel({ site: s.id, item: col.id })}
                              >
                                <span className="sr-only">
                                  {col.name} on {s.name}:
                                </span>{" "}
                                {it ? (
                                  <>
                                    <span className="v">{it.version || "version not known"}</span>
                                    <span className="sr-only">,</span>{" "}
                                  </>
                                ) : (
                                  <span className="v" aria-hidden="true">
                                    –
                                  </span>
                                )}
                                <span className="w">{word}</span>
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {cols.length > 0 && (
            <ul className="mx-legend" id={`${kind}-legend`} aria-label="What the cells mean">
              <li>
                <span className="cell up" aria-hidden="true" />
                Update ready
              </li>
              <li>
                <span className="cell on" aria-hidden="true" />
                Active
              </li>
              <li>
                <span className="cell idle" aria-hidden="true" />
                {plugin ? "Inactive" : "Installed"}
              </li>
              <li>
                <span className="cell none" aria-hidden="true" />
                Not installed
              </li>
              <li>
                <span className="cell vuln" aria-hidden="true" />
                Known vulnerability
              </li>
              <li className="end">Arrow keys move, Enter opens the {noun} on that site.</li>
            </ul>
          )}
          {notReady.length > 0 && (
            <section className="mx-notes" aria-label="Sites not in this table">
              <h3 className="mx-label">Not in this table</h3>
              <ul>
                {notReady.map((s) => (
                  <li key={s.id} className="callout">
                    <Glyph name="info" />
                    <span>
                      <b>{s.name}</b> {blocked(s, inventory.get(s.id))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
      {selSite && selCol ? (
        <Inspector
          key={`${selSite.id}:${selCol.id}`}
          kind={kind}
          site={selSite}
          col={selCol}
          item={itemAt(selSite.id, selCol.id)}
          vuln={vulnOf(reports, kind, selSite.id, itemAt(selSite.id, selCol.id))}
          others={read.flatMap((s) => {
            const it = itemAt(s.id, selCol.id);
            return it ? [{ site: s, item: it }] : [];
          })}
          everywhere={updateRows(selCol.id)}
          onPlan={onPlan}
          onRun={onRun}
          onClose={() => setSel(null)}
        />
      ) : (
        !plugin &&
        ready.length > 0 &&
        cols.length > 0 && (
          <aside className="insp mx-insp" aria-label="Active theme on each site">
            <div className="card-head">
              <h2>Active theme on each site</h2>
            </div>
            <ul className="mx-list">
              {ready.map((s) => {
                const it = itemsOf(kind, inventory.get(s.id)).find((i) => i.active);
                return (
                  <li key={s.id}>
                    <SiteTile site={s} />
                    <span>
                      <b>{s.name}</b>
                      <span>{it ? `${it.name} ${it.version}` : "Not known"}</span>
                    </span>
                    {it?.update ? (
                      <span className="tag ok">Update ready</span>
                    ) : it ? (
                      <span className="st pill ok">
                        <Icon tone="ok" />
                        Current
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </aside>
        )
      )}
    </>
  );
}

/** The plugin's icon or the theme's screenshot from WordPress.org, else its letter. */
function Tile({ kind, id, name, big }: { kind: Kind; id: string; name: string; big?: boolean }) {
  return kind === "plugins" ? <PkgTile kind="plugin" slug={slugOf(id)} name={name} size={big ? "lg" : undefined} /> : <PkgTile kind="theme" slug={id} name={name} size={big ? "lg" : undefined} />;
}

type InspectorProps = {
  kind: Kind;
  site: Site;
  col: Col;
  item: Item | undefined;
  vuln: Vulnerability | undefined;
  others: { site: Site; item: Item }[];
  everywhere: PlanRow[];
  onPlan: Props["onPlan"];
  onRun: Props["onRun"];
  onClose: () => void;
};

function Inspector({ kind, site: s, col, item, vuln, others, everywhere, onPlan, onRun, onClose }: InspectorProps) {
  const [rolling, setRolling] = useState(false);
  const autoId = useId();
  const plugin = kind === "plugins";
  const name = item?.name || col.name;
  const one = (action: Action) => [{ site_id: s.id, action }];
  const row = (label: string, action: Action, from?: string | null, to?: string | null): PlanRow[] => [
    { site: s.name, label, from, to, change: { site_id: s.id, action } },
  ];
  const id = col.id;
  const state = !item ? "Not installed" : item.active ? (plugin ? "Active" : "Active theme") : plugin ? "Inactive" : "Installed";

  const acts: React.ReactNode[] = [];
  if (item) {
    if (item.update && can(s, plugin ? "update_plugin" : "update_theme"))
      acts.push(
        <Button
          key="up"
          small
          kind="primary"
          className="disc"
          onClick={() => onRun(`Update ${name} on ${s.name}`, one(plugin ? { do: "update_plugin", plugin: id } : { do: "update_theme", theme: id }))}
        >
          Update to {item.update}
          <span className="btn-disc">
            <Glyph name="arrow" />
          </span>
        </Button>,
      );
    if (plugin && !item.active && can(s, "activate_plugin"))
      acts.push(
        <Button key="act" small onClick={() => onRun(`Activate ${name} on ${s.name}`, one({ do: "activate_plugin", plugin: id }))}>
          <Glyph name="power" />
          Activate
        </Button>,
      );
    if (plugin && item.active && can(s, "deactivate_plugin"))
      acts.push(
        <Button key="deact" small onClick={() => onPlan(`Deactivate ${name} on ${s.name}`, row(`Deactivate ${name}`, { do: "deactivate_plugin", plugin: id }), "confirm", true)}>
          <Glyph name="power" />
          Deactivate
        </Button>,
      );
    if (!plugin && !item.active && can(s, "activate_theme"))
      acts.push(
        <Button key="use" small onClick={() => onPlan(`Use ${name} on ${s.name}`, row(`Use the ${name} theme`, { do: "activate_theme", theme: id }), "confirm")}>
          <Glyph name="palette" />
          Use this theme
        </Button>,
      );
  } else if (plugin && can(s, "install_plugin")) {
    acts.push(
      <Button key="inst" small kind="primary" onClick={() => onRun(`Install ${name} on ${s.name}`, one({ do: "install_plugin", source: slugOf(id), activate: false }))}>
        <Glyph name="download" />
        Install here
      </Button>,
    );
  }
  const auto = plugin && item && item.auto_update != null && can(s, "auto_update_plugin");
  const roll = plugin && item && can(s, "rollback_plugin") && can(s, "rollback_plugin", "list-plugin-versions");
  const canDelete = item && (plugin ? can(s, "delete_plugin") : can(s, "delete_theme")) && !(item.active && (!plugin || s.mode === "basic"));
  const nothing = acts.length === 0 && !auto && !roll && !canDelete;
  const themeInUse = !plugin && item?.active && (nothing || can(s, "delete_theme"));
  const why =
    themeInUse && s.mode !== "basic"
      ? "This is the theme the site uses. Use another theme first to delete it."
      : !nothing
        ? null
        : s.mode === "basic"
          ? `Basic mode can't change ${plugin ? "this plugin here" : "themes"}. That needs Classic Monks on the site.`
          : "This connection has no tools for this. Sign in again and tick the plugin and theme tool groups.";

  return (
    <>
      <aside className="insp mx-insp" aria-label={`${name} on ${s.name}`}>
        <div className="ihead">
          <Tile kind={kind} id={col.id} name={name} big />
          <div>
            <h2>{name}</h2>
            <small>
              on {s.name} · {state}
            </small>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Glyph name="x" />
          </button>
        </div>
        <div className="mx-ibody">
          {vuln ? (
            <p className="callout danger">
              <Glyph name="alert" />
              <span>
                <b>{vuln.title}.</b> {vuln.fixed_in ? `Fixed in ${vuln.fixed_in}.` : "No fix yet."}
              </span>
            </p>
          ) : item?.update ? (
            <p className="callout ok">
              <Glyph name="download" />
              <span>
                <b>{item.update} is ready.</b> This site runs {item.version || "a version not known"}.
              </span>
            </p>
          ) : !item ? (
            <p className="callout">
              <Glyph name="info" />
              <span>Not installed on this site.</span>
            </p>
          ) : null}
          {acts.length > 0 && <div className="acts">{acts}</div>}
          {why && (
            <p className="callout">
              <Glyph name="info" />
              <span>{why}</span>
            </p>
          )}
          {plugin && item && item.auto_update != null && (
            <div className="mx-auto">
              <span>
                <label htmlFor={autoId}>Automatic updates</label>
                <span id={`${autoId}-d`}>{item.auto_update ? "On for this site" : "Off on this site"}</span>
              </span>
              <input
                id={autoId}
                type="checkbox"
                role="switch"
                aria-describedby={`${autoId}-d`}
                checked={item.auto_update}
                disabled={!auto}
                onChange={() => onRun(`Automatic updates for ${name} on ${s.name}`, one({ do: "auto_update_plugin", plugin: id, on: !item.auto_update }))}
              />
            </div>
          )}
          <div className="mx-every">
            <h3 className="mx-label">On every site</h3>
            {others.length > 0 ? (
              <dl className="dl">
                {others.map((o) => (
                  <div key={o.site.id}>
                    <dt>{o.site.name}</dt>
                    <dd>
                      {o.item.version || "not known"}
                      {o.item.update && " · update ready"}
                      {!o.item.active && (plugin ? " · inactive" : "")}
                      {!plugin && o.item.active && " · active"}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="dim">Not installed on any site.</p>
            )}
            {everywhere.length > 0 && (
              <div>
                <Button small kind="soft" onClick={() => onPlan(`Update ${name} on ${everywhere.length === 1 ? "1 site" : `${everywhere.length} sites`}`, everywhere, "plan")}>
                  Update {name} on {everywhere.length === 1 ? "1 site" : `${everywhere.length} sites`}
                </Button>
              </div>
            )}
          </div>
          {(roll || canDelete) && (
            <div className="mx-foot">
              {roll && (
                <Button small className="ghost" onClick={() => setRolling(true)}>
                  <Glyph name="history" />
                  Choose an older version
                </Button>
              )}
              {canDelete && (
                <Button
                  small
                  kind="danger"
                  onClick={() =>
                    onPlan(
                      `Delete ${name} from ${s.name}`,
                      row(`Delete ${name}`, plugin ? { do: "delete_plugin", plugin: id } : { do: "delete_theme", theme: id }, item!.version),
                      "confirm",
                      true,
                    )
                  }
                >
                  <Glyph name="trash" />
                  Delete
                </Button>
              )}
            </div>
          )}
        </div>
      </aside>
      {rolling && item && (
        <RollBack
          site={s}
          id={id}
          name={name}
          item={item}
          canAuto={!!auto}
          onClose={() => setRolling(false)}
          onPick={(rows) => {
            setRolling(false);
            onPlan(`Roll back ${name} on ${s.name}`, rows, "confirm", true);
          }}
        />
      )}
    </>
  );
}

type RollBackProps = { site: Site; id: string; name: string; item: Item; canAuto: boolean; onClose: () => void; onPick: (rows: PlanRow[]) => void };

/** Choose an older stable release; the job sheet confirms it as a risky change. */
function RollBack({ site: s, id, name, item, canAuto, onClose, onPick }: RollBackProps) {
  const [versions, setVersions] = useState<PluginVersions | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [autoOff, setAutoOff] = useState(true);
  const group = useId();

  useEffect(() => {
    api.pluginVersions(s.id, id).then(
      (v) => {
        setVersions(v);
        setPick((v.versions ?? []).find((x) => olderStable(x.version, item.version))?.version ?? null);
      },
      (e) => {
        toast(String(e), { tone: "danger" });
        onClose();
      },
    );
  }, [s.id, id]);
  const older = (versions?.versions ?? []).filter((v) => olderStable(v.version, item.version)).slice(0, 8);
  const turnOff = canAuto && item.auto_update === true && autoOff;

  const go = () => {
    if (!pick) return;
    const rows: PlanRow[] = [];
    // Off first, so WordPress doesn't update it again before the roll back lands.
    if (turnOff) rows.push({ site: s.name, label: `Turn automatic updates off for ${name}`, change: { site_id: s.id, action: { do: "auto_update_plugin", plugin: id, on: false } } });
    rows.push({ site: s.name, label: `Roll back ${name}`, from: item.version, to: pick, change: { site_id: s.id, action: { do: "rollback_plugin", plugin: id, version: pick } } });
    onPick(rows);
  };

  return (
    <Sheet
      title={`Roll back ${name} on ${s.name}`}
      intro={<span className="mono">Now on {item.version || "a version not known"}</span>}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Close without changes</Button>
          <Button kind="primary" className="disc" disabled={!pick} onClick={go}>
            Roll back {name}
            <span className="btn-disc">
              <Glyph name="history" />
            </span>
          </Button>
        </>
      }
    >
      {!versions ? (
        <p className="dim" role="status">
          Asking the site for older versions…
        </p>
      ) : older.length === 0 ? (
        <p>{versions.notice || "The site has no older version to go back to."}</p>
      ) : (
        <div className="mx-roll">
          <h3 className="mx-sub" id={group}>
            Choose a version
          </h3>
          <div className="mx-vers" role="radiogroup" aria-labelledby={group}>
            {older.map((v) => (
              <label key={v.version} className={pick === v.version ? "on" : undefined}>
                <input type="radio" name={group} checked={pick === v.version} onChange={() => setPick(v.version)} />
                <b>{v.version}</b>
              </label>
            ))}
          </div>
          {canAuto && item.auto_update === true && (
            <label className="row check">
              <input type="checkbox" checked={autoOff} onChange={(e) => setAutoOff(e.target.checked)} />
              <span>
                Turn automatic updates off <span className="dim">so {s.name} stays on the version you pick</span>
              </span>
            </label>
          )}
        </div>
      )}
    </Sheet>
  );
}
