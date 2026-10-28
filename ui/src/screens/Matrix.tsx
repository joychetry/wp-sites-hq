// Plugins and Themes: one row per site, one column per plugin or theme, and an
// inspector for the cell in focus. Arrow keys move between cells.
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api, blocked, can, type Action, type Change, type Item, type PluginVersions, type Site, type SiteInventory } from "../api";
import { Button, Status } from "../components/ui";
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

/** The plugin's folder is its WordPress.org slug. */
export const slugOf = (file: string) => file.split("/")[0].replace(/\.php$/, "");

export function Matrix({ kind, sites, inventory, onPlan, onRun, onInstall }: Props) {
  const [onlyUpdates, setOnlyUpdates] = useState(false);
  const [cursor, setCursor] = useState<[number, number]>([0, 0]);
  const [sel, setSel] = useState<{ site: number; item: string } | null>(null);
  const grid = useRef<HTMLTableElement>(null);
  const noun = kind === "plugins" ? "plugin" : "theme";

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
  const rows = read.filter(
    (s) => !onlyUpdates || itemsOf(kind, inventory.get(s.id)).some((i) => i.update),
  );
  const ready = rows.filter((s) => !blocked(s, inventory.get(s.id)));
  const notReady = rows.filter((s) => blocked(s, inventory.get(s.id)));
  const waiting = cols.reduce((n, c) => n + c.updates, 0);

  const updateRows = (only?: string): PlanRow[] =>
    ready.flatMap((s) =>
      itemsOf(kind, inventory.get(s.id))
        .filter((i) => i.update && (!only || i.id === only) && can(s, kind === "plugins" ? "update_plugin" : "update_theme"))
        .map((i) => ({
          site: s.name,
          label: `Update ${i.name}`,
          from: i.version,
          to: i.update,
          change: {
            site_id: s.id,
            action: (kind === "plugins" ? { do: "update_plugin", plugin: i.id } : { do: "update_theme", theme: i.id }) as Action,
          },
        })),
    );

  const focusCell = (r: number, c: number) => {
    const rr = Math.max(0, Math.min(ready.length - 1, r));
    const cc = Math.max(0, Math.min(cols.length - 1, c));
    setCursor([rr, cc]);
    grid.current?.querySelector<HTMLElement>(`[data-cell="${rr}:${cc}"]`)?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const [r, c] = cursor;
    const moves: Record<string, [number, number]> = {
      ArrowRight: [r, c + 1],
      ArrowLeft: [r, c - 1],
      ArrowDown: [r + 1, c],
      ArrowUp: [r - 1, c],
      Home: [r, 0],
      End: [r, cols.length - 1],
    };
    const to = moves[e.key];
    if (!to) return;
    e.preventDefault();
    focusCell(...to);
  };

  const selSite = sel && sites.find((s) => s.id === sel.site);
  const selCol = sel && cols.find((c) => c.id === sel.item);

  return (
    <>
      <div className="scroll">
        <div className="bar">
          <button
            type="button"
            className={`chip ${onlyUpdates ? "on" : ""}`}
            onClick={() => setOnlyUpdates((v) => !v)}
            aria-label={`Show: ${onlyUpdates ? "only sites with updates" : "every site"}. Change`}
          >
            <b>Show</b> {onlyUpdates ? "only sites with updates" : "every site"}
          </button>
          <span className="grow" />
          {onInstall && (
            <Button small onClick={onInstall}>
              Install a plugin
            </Button>
          )}
          <Button
            small
            kind="primary"
            disabled={waiting === 0}
            onClick={() => onPlan(`Update ${waiting === 1 ? `1 ${noun}` : `${waiting} ${noun}s`}`, updateRows(), "plan")}
          >
            {waiting === 0 ? `No ${noun} updates` : `Update ${waiting === 1 ? `1 ${noun}` : `${waiting} ${noun}s`}`}
          </Button>
        </div>
        {cols.length === 0 ? (
          <div className="empty">
            <h2>No {noun}s to show yet.</h2>
            <p>
              {sites.length === 0
                ? "Add a site to see its plugins and themes here."
                : `Monks Central reads each site's ${noun}s when it checks the site. Check all sites now, then come back.`}
            </p>
          </div>
        ) : (
          <>
            <p className="legend" id={`${kind}-legend`}>
              <span>One row per site, one column per {noun}. A version: installed and active.</span>
              <span>
                <span className="off m">1.0</span> struck through: installed, not active.
              </span>
              <span>
                <span aria-hidden="true">·</span> dot: not installed.
              </span>
              <span>
                <span className="tag warning">Update</span>: a newer version is waiting.
              </span>
              <span>Arrow keys move, Enter opens the {noun} on that site.</span>
            </p>
            <div className="mxbox">
              <table
                ref={grid}
                className="t mx"
                role="grid"
                aria-readonly="true"
                aria-label={kind === "plugins" ? "Plugins on every site" : "Themes on every site"}
                aria-describedby={`${kind}-legend`}
                onKeyDown={onKey}
              >
                <thead>
                  <tr>
                    <th scope="col">Site</th>
                    {cols.map((c) => (
                      <th key={c.id} scope="col" data-tip={`${c.name}: on ${c.sites} of ${read.length} sites`}>
                        <span className="colname">{c.name}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ready.map((s, r) => {
                    const items = new Map(itemsOf(kind, inventory.get(s.id)).map((i) => [i.id, i]));
                    return (
                      <tr key={s.id}>
                        <th scope="row" className="name cut" data-tip={s.name}>
                          {s.name}
                        </th>
                        {cols.map((col, c) => {
                          const it = items.get(col.id);
                          const on = sel?.site === s.id && sel.item === col.id;
                          return (
                            <td key={col.id} role="gridcell" className={on ? "focus" : undefined}>
                              <button
                                type="button"
                                className="cell"
                                data-cell={`${r}:${c}`}
                                tabIndex={cursor[0] === r && cursor[1] === c ? 0 : -1}
                                aria-pressed={on}
                                onFocus={() => setCursor([r, c])}
                                onClick={() => setSel({ site: s.id, item: col.id })}
                              >
                                <span className="sr-only">
                                  {col.name} on {s.name}:
                                </span>{" "}
                                {it ? (
                                  <>
                                    <span className={`m ${it.active ? "" : "off"}`}>{it.version || "version not known"}</span>
                                    {!it.active && <span className="sr-only">, not active</span>}
                                    {it.update && (
                                      <>
                                        <span className="sr-only">,</span> <span className="tag warning">Update</span>{" "}
                                        <span className="sr-only">to {it.update} waiting</span>
                                      </>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    <span className="dim" aria-hidden="true">
                                      ·
                                    </span>
                                    <span className="sr-only">not installed</span>
                                  </>
                                )}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {notReady.length > 0 && (
          <section className="unseen" aria-label="Sites not in this table">
            <h3>Not in this table</h3>
            <ul className="ulist">
              {notReady.map((s) => (
                <li key={s.id}>
                  <b>{s.name}</b>
                  <span className="dim">{blocked(s, inventory.get(s.id))}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {selSite && selCol && (
        <Inspector
          key={`${selSite.id}:${selCol.id}`}
          kind={kind}
          site={selSite}
          col={selCol}
          item={itemsOf(kind, inventory.get(selSite.id)).find((i) => i.id === selCol.id)}
          everywhere={updateRows(selCol.id)}
          onPlan={onPlan}
          onRun={onRun}
          onClose={() => setSel(null)}
        />
      )}
    </>
  );
}

type InspectorProps = {
  kind: Kind;
  site: Site;
  col: Col;
  item: Item | undefined;
  everywhere: PlanRow[];
  onPlan: Props["onPlan"];
  onRun: Props["onRun"];
  onClose: () => void;
};

function Inspector({ kind, site: s, col, item, everywhere, onPlan, onRun, onClose }: InspectorProps) {
  const [versions, setVersions] = useState<PluginVersions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const plugin = kind === "plugins";
  const name = item?.name || col.name;
  const one = (action: Action) => [{ site_id: s.id, action }];
  const row = (label: string, action: Action, from?: string | null, to?: string | null): PlanRow[] => [
    { site: s.name, label, from, to, change: { site_id: s.id, action } },
  ];
  const id = col.id;

  const loadVersions = async () => {
    setLoading(true);
    setError(null);
    try {
      setVersions(await api.pluginVersions(s.id, id));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  const older = (versions?.versions ?? []).filter((v) => olderStable(v.version, item?.version ?? ""));

  const acts: React.ReactNode[] = [];
  if (item) {
    if (item.update && can(s, plugin ? "update_plugin" : "update_theme"))
      acts.push(
        <Button key="up" small kind="primary" onClick={() => onRun(`Update ${name} on ${s.name}`, one(plugin ? { do: "update_plugin", plugin: id } : { do: "update_theme", theme: id }))}>
          Update to {item.update}
        </Button>,
      );
    if (plugin && !item.active && can(s, "activate_plugin"))
      acts.push(
        <Button key="act" small onClick={() => onRun(`Activate ${name} on ${s.name}`, one({ do: "activate_plugin", plugin: id }))}>
          Activate
        </Button>,
      );
    if (plugin && item.active && can(s, "deactivate_plugin"))
      acts.push(
        <Button key="deact" small onClick={() => onPlan(`Deactivate ${name} on ${s.name}`, row(`Deactivate ${name}`, { do: "deactivate_plugin", plugin: id }), "confirm", true)}>
          Deactivate
        </Button>,
      );
    if (plugin && item.auto_update != null && can(s, "auto_update_plugin"))
      acts.push(
        <Button key="auto" small onClick={() => onRun(`Automatic updates for ${name} on ${s.name}`, one({ do: "auto_update_plugin", plugin: id, on: !item.auto_update }))}>
          Turn automatic updates {item.auto_update ? "off" : "on"}
        </Button>,
      );
    if (!plugin && !item.active && can(s, "activate_theme"))
      acts.push(
        <Button key="use" small onClick={() => onPlan(`Use ${name} on ${s.name}`, row(`Use the ${name} theme`, { do: "activate_theme", theme: id }), "confirm")}>
          Use this theme
        </Button>,
      );
    const canDelete = plugin ? can(s, "delete_plugin") : can(s, "delete_theme");
    if (canDelete && !(item.active && (!plugin || s.mode === "basic")))
      acts.push(
        <Button
          key="del"
          small
          kind="danger"
          onClick={() =>
            onPlan(
              `Delete ${name} from ${s.name}`,
              row(`Delete ${name}`, plugin ? { do: "delete_plugin", plugin: id } : { do: "delete_theme", theme: id }, item.version),
              "confirm",
              true,
            )
          }
        >
          Delete
        </Button>,
      );
  } else if (plugin && can(s, "install_plugin")) {
    acts.push(
      <Button key="inst" small kind="primary" onClick={() => onRun(`Install ${name} on ${s.name}`, one({ do: "install_plugin", source: slugOf(id), activate: false }))}>
        Install here
      </Button>,
    );
  }

  return (
    <aside className="insp" aria-label={`${name} on ${s.name}`}>
      <header>
        <h2>{name}</h2>
        <span className="dim">on {s.name}</span>
        <div className="acts">
          {acts}
          <Button small onClick={onClose}>
            Close
          </Button>
        </div>
        {acts.length === 0 && (
          <p className="dim" style={{ margin: "8px 0 0" }}>
            {s.mode === "basic"
              ? `Basic mode can't change ${plugin ? "this plugin here" : "themes"}. That needs Classic Monks on the site.`
              : item?.active && !plugin
                ? "This is the theme the site uses. Use another theme first to delete it."
                : "This connection has no tools for this. Sign in again and tick the plugin and theme tool groups."}
          </p>
        )}
      </header>
      {error && (
        <p className="alert danger" role="alert" style={{ margin: "12px 16px 0" }}>
          {error}
        </p>
      )}
      <section>
        <h3>On this site</h3>
        {item ? (
          <dl className="kv">
            <dt>Version</dt>
            <dd className="mono">{item.version || "not known"}</dd>
            <dt>Status</dt>
            <dd>{item.active ? <Status tone="ok">Active</Status> : <Status tone="unknown">Installed, not active</Status>}</dd>
            <dt>Update</dt>
            <dd>{item.update ? <Status tone="warning">{item.update} is waiting</Status> : "none waiting"}</dd>
            {plugin && (
              <>
                <dt>Automatic updates</dt>
                <dd>{item.auto_update == null ? "not known" : item.auto_update ? "on" : "off"}</dd>
              </>
            )}
          </dl>
        ) : (
          <p style={{ margin: 0 }}>Not installed.</p>
        )}
      </section>
      {plugin && item && can(s, "rollback_plugin") && can(s, "rollback_plugin", "list-plugin-versions") && (
        <section>
          <h3>Roll back</h3>
          {!versions ? (
            <Button small disabled={loading} onClick={loadVersions}>
              {loading ? "Asking the site…" : "Choose an older version"}
            </Button>
          ) : older.length === 0 ? (
            <p style={{ margin: 0 }}>{versions.notice || "The site has no older version to go back to."}</p>
          ) : (
            <ul className="ulist versions" aria-label="Older versions">
              {older.slice(0, 8).map((v) => (
                <li key={v.version}>
                  <span className="mono">{v.version}</span>
                  <Button
                    small
                    kind="danger"
                    onClick={() =>
                      onPlan(
                        `Roll back ${name} on ${s.name}`,
                        row(`Roll back ${name}`, { do: "rollback_plugin", plugin: id, version: v.version }, item.version, v.version),
                        "confirm",
                        true,
                      )
                    }
                  >
                    Roll back to {v.version}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section>
        <h3>On every site</h3>
        <p style={{ margin: "0 0 8px" }}>
          Installed on {col.sites === 1 ? "1 site" : `${col.sites} sites`}
          {col.updates > 0 && `, with an update waiting on ${col.updates}`}.
        </p>
        {everywhere.length > 0 && (
          <Button small onClick={() => onPlan(`Update ${name} on ${everywhere.length === 1 ? "1 site" : `${everywhere.length} sites`}`, everywhere, "plan")}>
            Update {name} on {everywhere.length === 1 ? "1 site" : `${everywhere.length} sites`}
          </Button>
        )}
      </section>
    </aside>
  );
}
