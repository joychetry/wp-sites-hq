// SPDX-License-Identifier: GPL-3.0-or-later
// Plugins and Themes: one row per plugin or theme, one column per site, and an
// inspector for the cell in focus. Arrow keys move between cells.
import "../styles/screens/matrix.css";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { api, blocked, can, type Action, type Change, type Item, type PluginVersions, type SecurityReport, type Site, type SiteInventory, type Vulnerability } from "../api";
import { Button, Details, Glyph, HeadActions, Icon } from "../components/ui";
import { Menu, SearchInput } from "../components/controls";
import { Sheet } from "../components/Sheet";
import { SiteTile } from "../components/SiteTile";
import { PkgTile, slugOf } from "../components/PkgTile";
import { Empty, toast } from "../components/feedback";
import { Page, SidePanel, Toolbar } from "../components/page";
import type { PlanRow } from "../components/JobSheet";
import { vulnSummary } from "../format";
import { NotInList } from "./Updates";

export type Kind = "plugins" | "themes";

type Col = { id: string; name: string; sites: number; updates: number };

type Props = {
  kind: Kind;
  sites: Site[];
  inventory: Map<number, SiteInventory>;
  /** Review first: many sites, or a change that removes or switches something. `onBack` reopens the form the rows came from. */
  onPlan: (title: string, rows: PlanRow[], start: "plan" | "confirm", danger?: boolean, onBack?: () => void, backLabel?: string) => void;
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

/** Every known vulnerability for this plugin or theme, from any site's last security check. */
const advisoriesOf = (reports: SecurityReport[], kind: Kind, id: string) =>
  reports.flatMap((r) => r.vulnerabilities).filter((v) => v.kind === (kind === "plugins" ? "plugin" : "theme") && v.id === id);

/** A known vulnerability in the version this site runs. Matched on the version, so the same version reads the same on every site. */
export const vulnOf = (reports: SecurityReport[], kind: Kind, it: Item | undefined) => it && advisoriesOf(reports, kind, it.id).find((v) => v.installed === it.version);

const below = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true }) < 0;

/** Whether a known advisory covers this version: below its fix, or (with no fix yet) at or below the version it was found on. */
export const affected = (version: string, advisories: Vulnerability[]) =>
  advisories.some((v) => (v.fixed_in ? below(version, v.fixed_in) : !below(v.installed, version)));

/** The plugin WP Sites HQ reaches the site through: turning it off or deleting it cuts the site off. */
export const isConnector = (id: string) => /^(classic-monks(-pro)?|wp-sites-hq)$/.test(slugOf(id));

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

  const q = query.trim().toLowerCase();
  const rows = cols.filter((c) => {
    if (q && !c.name.toLowerCase().includes(q) && !c.id.toLowerCase().includes(q)) return false;
    const on = ready.map((s) => itemAt(s.id, c.id));
    if (status === "Update ready") return on.some((i) => i?.update);
    if (status === "Inactive") return on.some((i) => i && !i.active);
    if (status === "Known vulnerability") return ready.some((s) => vulnOf(reports, kind, itemAt(s.id, c.id)));
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
  // Counted from the rows the plan gets, so the button, the plan's title and its rows agree.
  const allUpdates = updateRows();
  const updateLabel = allUpdates.length === 0 ? `No ${noun} updates` : `Update ${allUpdates.length === 1 ? `1 ${noun}` : `${allUpdates.length} ${noun}s`}`;

  const themesAside = !plugin && ready.length > 0 && cols.length > 0;
  const side = (
    <SidePanel
      className="mx-insp"
      label={selSite && selCol ? `${itemAt(selSite.id, selCol.id)?.name || selCol.name} on ${selSite.name}` : themesAside ? "Active theme on each site" : `${Noun} details`}
      empty={`Pick a cell to manage that ${noun} on that site.`}
    >
      {selSite && selCol ? (
        <Inspector
          key={`${selSite.id}:${selCol.id}`}
          kind={kind}
          site={selSite}
          col={selCol}
          item={itemAt(selSite.id, selCol.id)}
          vuln={vulnOf(reports, kind, itemAt(selSite.id, selCol.id))}
          advisories={advisoriesOf(reports, kind, selCol.id)}
          others={read.flatMap((s) => {
            const it = itemAt(s.id, selCol.id);
            // Only sites the table can read: a blocked site's list is out of date.
            if (!it || blocked(s, inventory.get(s.id))) return [];
            // Why an update listed here is not in the update button below it.
            const held = it.update && !can(s, plugin ? "update_plugin" : "update_theme") ? "This connection has no tool to update it." : null;
            return [{ site: s, item: it, held }];
          })}
          out={notReady.map((s) => s.name)}
          everywhere={updateRows(selCol.id)}
          onPlan={onPlan}
          onRun={onRun}
          onClose={() => setSel(null)}
        />
      ) : (
        themesAside && (
          <>
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
                      <span data-tip={it ? `${it.name} ${it.version}` : undefined}>{it ? `${it.name} ${it.version}` : "Not known"}</span>
                    </span>
                    {it?.update ? (
                      <span className="st pill up">
                        <Glyph name="download" />
                        Update ready
                      </span>
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
          </>
        )
      )}
    </SidePanel>
  );

  return (
    <>
      <HeadActions>
        {onInstall && (
          <Button onClick={onInstall}>
            Install a {noun}
            <Glyph name="plus" />
          </Button>
        )}
        <Button kind="primary" className={allUpdates.length ? "disc" : undefined} disabled={allUpdates.length === 0} onClick={() => onPlan(updateLabel, allUpdates, "plan")}>
          {updateLabel}
          {allUpdates.length > 0 && (
            <span className="btn-disc">
              <Glyph name="arrow" />
            </span>
          )}
        </Button>
      </HeadActions>
      <Page className="mx" side={side}>
          <Toolbar>
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
          </Toolbar>
          <section className="card" aria-label={`${Noun}s by site`}>
            {cols.length === 0 ? (
              <Empty title={`No ${noun}s to show yet.`}>
                <p>
                  {sites.length === 0
                    ? "Add a site to see its plugins and themes here."
                    : `WP Sites HQ reads each site's ${noun}s when it checks the site. Check all sites now, then come back.`}
                </p>
              </Empty>
            ) : ready.length === 0 ? (
              <Empty small title="None of these sites can be read now. See why below." />
            ) : rows.length === 0 ? (
              <Empty
                small
                title={`No ${noun} matches these filters.`}
                action={
                  <Button
                    onClick={() => {
                      setQuery("");
                      setStatus("Any");
                      setOnlyUpdates(false);
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
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
                  // The name column keeps its room however many sites there are; the box scrolls sideways past that.
                  style={{ "--sites": ready.length } as CSSProperties}
                >
                  <colgroup>
                    <col className="c-fill" />
                    {ready.map((s) => (
                      <col key={s.id} className="c-text" />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">{Noun}</th>
                      {ready.map((s) => (
                        <th key={s.id} scope="col" data-tip={s.url}>
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
                              <b data-tip={col.name}>{col.name}</b>
                              <small>{plugin ? slugOf(col.id) : col.id}</small>
                            </span>
                          </span>
                        </th>
                        {ready.map((s, c) => {
                          const it = itemAt(s.id, col.id);
                          const { tone, word } = cellOf(kind, it, vulnOf(reports, kind, it));
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
                                {it && (
                                  <>
                                    <span className="v">{it.version || "version not known"}</span>
                                    <span className="sr-only">,</span>{" "}
                                  </>
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
            {ready.length > 0 && rows.length > 0 && (
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
          </section>
          <NotInList notes={notReady.map((s) => [s, blocked(s, inventory.get(s.id))!])} />
      </Page>
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
  advisories: Vulnerability[];
  others: { site: Site; item: Item; held: string | null }[];
  /** Sites the table leaves out, by name. */
  out: string[];
  everywhere: PlanRow[];
  onPlan: Props["onPlan"];
  onRun: Props["onRun"];
  onClose: () => void;
};

function Inspector({ kind, site: s, col, item, vuln, advisories, others, out, everywhere, onPlan, onRun, onClose }: InspectorProps) {
  // The version list: closed (false), or open with the version picked before going back from the review.
  const [rolling, setRolling] = useState<string | null | false>(false);
  const autoId = useId();
  const plugin = kind === "plugins";
  const name = item?.name || col.name;
  const one = (action: Action) => [{ site_id: s.id, action }];
  // "Update to X" above runs this site now; this button is only for an update that reaches other sites too.
  const fleetWide = everywhere.some((r) => r.change.site_id !== s.id);
  const where = everywhere.length === 1 ? everywhere[0].site : `${everywhere.length} sites`;
  const held = fleetWide ? others.filter((o) => o.held) : [];
  // WP Sites HQ talks to the site through this plugin (not in Basic mode, which signs in with WordPress itself).
  const connector = plugin && isConnector(col.id) && s.mode !== "basic";
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
          Activate
          <Glyph name="power" />
        </Button>,
      );
    if (plugin && item.active && !connector && can(s, "deactivate_plugin"))
      acts.push(
        <Button key="deact" small onClick={() => onPlan(`Deactivate ${name} on ${s.name}`, row(`Deactivate ${name}`, { do: "deactivate_plugin", plugin: id }), "confirm", true)}>
          Deactivate
          <Glyph name="power" />
        </Button>,
      );
    if (!plugin && !item.active && can(s, "activate_theme"))
      acts.push(
        <Button key="use" small onClick={() => onPlan(`Use ${name} on ${s.name}`, row(`Use the ${name} theme`, { do: "activate_theme", theme: id }), "confirm")}>
          Use this theme
          <Glyph name="palette" />
        </Button>,
      );
  } else if (plugin && can(s, "install_plugin")) {
    acts.push(
      <Button key="inst" small kind="primary" onClick={() => onRun(`Install ${name} on ${s.name}`, one({ do: "install_plugin", source: slugOf(id), activate: false }))}>
        Install here
        <Glyph name="download" />
      </Button>,
    );
  }
  const auto = plugin && item && item.auto_update != null && can(s, "auto_update_plugin");
  const roll = plugin && item && can(s, "rollback_plugin") && can(s, "rollback_plugin", "list-plugin-versions");
  const canDelete = item && !connector && (plugin ? can(s, "delete_plugin") : can(s, "delete_theme")) && !(item.active && (!plugin || s.mode === "basic"));
  const nothing = acts.length === 0 && !auto && !roll && !canDelete;
  const themeInUse = !plugin && item?.active && (nothing || can(s, "delete_theme"));
  const why =
    themeInUse && s.mode !== "basic"
      ? "This is the theme the site uses. Use another theme first to delete it."
      : connector
        ? `WP Sites HQ reaches ${s.name} through this plugin, so it can't be turned off or deleted from here. That would cut ${s.name} off.`
        : !nothing
          ? null
          : s.mode === "basic"
            ? `Basic mode can't change ${plugin ? "this plugin here" : "themes"}. That needs the WP Sites HQ plugin, Classic Monks or Classic Monks Pro on the site.`
            : "This connection may not change plugins or themes. Sign in again and allow them.";

  return (
    <>
      <div className="ihead">
        <Tile kind={kind} id={col.id} name={name} big />
        <div>
          <h2>{name}</h2>
          <small data-tip={`On ${s.name} · ${state}`}>
            On {s.name} · {state}
          </small>
        </div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <Glyph name="x" />
        </button>
      </div>
      <div className="mx-ibody">
        {vuln ? (
          <div className="callout danger">
            <Glyph name="alert" />
            <span>
              <b>Known vulnerability.</b> {vulnSummary(vuln.title)} {vuln.fixed_in ? `Fixed in ${vuln.fixed_in}.` : "No fix yet."}
              <Details>{vuln.title}</Details>
            </span>
          </div>
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
                    <span className="mono">{o.item.version || "Not known"}</span>
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
          {out.length > 0 && <p className="dim">Not in this list: {out.join(", ")}.</p>}
          {fleetWide && (
            <div>
              <Button small kind="soft" onClick={() => onPlan(`Update ${name} on ${where}`, everywhere, "plan")}>
                Update on {where}
              </Button>
            </div>
          )}
          {held.map((o) => (
            <p key={o.site.id} className="dim">
              Not in this update: {o.site.name}. {o.held}
            </p>
          ))}
        </div>
        {(roll || canDelete) && (
          <div className="mx-foot">
            {roll && (
              <Button small className="ghost" onClick={() => setRolling(null)}>
                Choose an older version
                <Glyph name="history" />
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
                Delete
                <Glyph name="trash" />
              </Button>
            )}
          </div>
        )}
      </div>
      {rolling !== false && item && (
        <RollBack
          site={s}
          id={id}
          name={name}
          item={item}
          canAuto={!!auto}
          advisories={advisories}
          initial={rolling}
          onClose={() => setRolling(false)}
          onPick={(rows, version) => {
            setRolling(false);
            onPlan(`Roll back ${name} on ${s.name}`, rows, "confirm", true, () => setRolling(version), "Back to the versions");
          }}
        />
      )}
    </>
  );
}

type RollBackProps = {
  site: Site;
  id: string;
  name: string;
  item: Item;
  canAuto: boolean;
  advisories: Vulnerability[];
  /** The version picked before going back from the review. */
  initial: string | null;
  onClose: () => void;
  onPick: (rows: PlanRow[], version: string) => void;
};

/** Choose an older stable release; the job sheet confirms it as a risky change. */
function RollBack({ site: s, id, name, item, canAuto, advisories, initial, onClose, onPick }: RollBackProps) {
  const [versions, setVersions] = useState<PluginVersions | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [autoOff, setAutoOff] = useState(true);
  const group = useId();

  useEffect(() => {
    api.pluginVersions(s.id, id).then(
      (v) => {
        setVersions(v);
        setPick(initial ?? (v.versions ?? []).find((x) => olderStable(x.version, item.version))?.version ?? null);
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
    rows.push({
      site: s.name,
      label: `Roll back ${name}`,
      from: item.version,
      to: pick,
      note: affected(pick, advisories) ? `${pick} has a known vulnerability` : undefined,
      change: { site_id: s.id, action: { do: "rollback_plugin", plugin: id, version: pick } },
    });
    onPick(rows, pick);
  };

  return (
    <Sheet
      fit
      title={`Roll back ${name} on ${s.name}`}
      intro={
        <>
          Now on <span className="mono">{item.version || "a version not known"}</span>
        </>
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Close without changes</Button>
          <Button kind="primary" className="disc" disabled={!pick} onClick={go}>
            Review the rollback
            <span className="btn-disc">
              <Glyph name="arrow" />
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
                {affected(v.version, advisories) && (
                  <span className="st danger">
                    <Glyph name="alert" />
                    Has a known vulnerability
                  </span>
                )}
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
