// SPDX-License-Identifier: GPL-3.0-or-later
// Sites: a dense keyboard table, a selection bar and an inspector for the
// focused site.
import { dismiss, Empty, toast } from "../components/feedback";
import { Combobox, SearchInput, TagInput } from "../components/controls";
import { useEffect, useMemo, useRef, useState } from "react";
import { ago, api, connectionLabel, connectorInfo, hasTool, pluginName, NO_TOOLS, noTools, siteStatus, slow, useInventory, type PluginZip, type Site } from "../api";
import { Button, Glyph, HeadActions, Icon, Kbd, Logo, Status } from "../components/ui";
import { SiteTile } from "../components/SiteTile";
import { Page, SidePanel, Toolbar } from "../components/page";
import { updatesOf } from "./Updates";
import "../styles/screens/sites.css";

type Props = {
  sites: Site[];
  groups: string[];
  focusId: number | null;
  setFocusId: (id: number | null) => void;
  onAdd: () => void;
  onSignInAgain: (site: Site) => void;
  onUpdates?: () => void;
};

type StatusFilter = "any" | "attention" | "danger" | "ok";

// The design's tabs, plus Down on its own (a filter the app had before the redesign).
const FILTERS: [StatusFilter, string][] = [
  ["any", "All"],
  ["attention", "Needs attention"],
  ["danger", "Down"],
  ["ok", "Up"],
];
const matches = (s: Site, f: StatusFilter) => {
  const tone = siteStatus(s).tone;
  return f === "any" || tone === f || (f === "attention" && (tone === "warning" || tone === "danger"));
};
type ModeFilter = "any" | Site["mode"];

/** Typing in a field, or a dialog is open: leave the keys alone. */
function busyKeys(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return (
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    // The kit's controls (Select, menus, lists) handle their own keys and mark them handled.
    e.defaultPrevented ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) ||
    !!document.querySelector('[aria-modal="true"]')
  );
}

export function Sites({ sites, groups, focusId, setFocusId, onAdd, onSignInAgain, onUpdates }: Props) {
  const { inventory } = useInventory();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("any");
  const [mode, setMode] = useState<ModeFilter>("any");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [groupFor, setGroupFor] = useState("");
  const [grouping, setGrouping] = useState(false);
  const filter = useRef<HTMLInputElement>(null);
  const table = useRef<HTMLTableElement>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sites.filter((s) => {
      return (
        matches(s, status) &&
        (mode === "any" || s.mode === mode) &&
        (!q || [s.name, s.url, s.group ?? "", ...s.tags].some((v) => v.toLowerCase().includes(q)))
      );
    });
  }, [sites, query, status, mode]);

  const focus = rows.find((s) => s.id === focusId) ?? rows[0] ?? null;
  const picked = sites.filter((s) => selected.has(s.id));

  useEffect(() => {
    // Removed sites leave the selection.
    const ids = new Set(sites.map((s) => s.id));
    setSelected((sel) => new Set([...sel].filter((id) => ids.has(id))));
  }, [sites]);

  const toggle = (id: number) =>
    setSelected((sel) => {
      const next = new Set(sel);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const move = (by: number) => {
    if (!rows.length) return;
    const i = Math.max(0, rows.findIndex((s) => s.id === focus?.id));
    const next = rows[Math.min(rows.length - 1, Math.max(0, i + by))];
    setFocusId(next.id);
    table.current?.querySelector(`[data-id="${next.id}"]`)?.scrollIntoView?.({ block: "nearest" });
  };

  const check = async (ids: number[]) => {
    // A toast, not a line above the table, so the rows stay where they are.
    const t = toast(`Checking ${ids.length === 1 ? "the site" : `${ids.length} sites`}…`, { tone: "info" });
    await Promise.all(ids.map((id) => api.check(id).catch(() => {})));
    dismiss(t);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busyKeys(e)) return;
      const k = e.key;
      if (k === "j" || k === "ArrowDown") move(1);
      else if (k === "k" || k === "ArrowUp") move(-1);
      // Space belongs to the focused button or checkbox unless the grid itself has focus.
      else if ((k === "x" || (k === " " && e.target === table.current)) && focus) toggle(focus.id);
      else if (k === "/") filter.current?.focus();
      else if (k === "a") onAdd();
      else if (k === "r") check(picked.length ? picked.map((s) => s.id) : focus ? [focus.id] : []);
      else if (k === "Escape" && selected.size) setSelected(new Set());
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const host = (s: Site) => s.url.replace(/^https?:\/\//, "");
  const count = (f: StatusFilter) => sites.filter((s) => matches(s, f)).length;
  const modes: [ModeFilter, string][] = [
    ["any", "Connection and group"],
    ["classic_monks", "Through a plugin"],
    ["basic", "Basic mode"],
  ];
  const modeAt = modes.findIndex(([m]) => m === mode);

  const side = (
    <SidePanel className="site-pane" label={focus ? `${focus.name} details` : "Site details"} empty="Pick a site to see its details, notes and actions.">
      {focus && (
        <Inspector
          key={focus.id}
          site={focus}
          groups={groups}
          allTags={[...new Set(sites.flatMap((x) => x.tags))].sort()}
          updates={updatesOf(focus, inventory?.get(focus.id))}
          onCheck={() => check([focus.id])}
          onSignInAgain={() => onSignInAgain(focus)}
          onUpdates={onUpdates}
          onRemoved={(text, ok) => {
            toast(text, { tone: ok ? "ok" : "warning" });
            setFocusId(null);
          }}
        />
      )}
    </SidePanel>
  );

  return (
    <>
      <HeadActions>
        <Button kind="primary" className="disc" aria-keyshortcuts="A" onClick={onAdd}>
          <span className="btn-disc">
            <Glyph name="plus" />
          </span>
          Add a site
        </Button>
      </HeadActions>
      <Page className="sites" side={side}>
        <Toolbar>
          <div className="segmented inline" role="group" aria-label="Show sites">
            {FILTERS.map(([f, label]) => (
              <button key={f} type="button" aria-pressed={status === f} onClick={() => setStatus(f)}>
                {label}
                <small>{count(f)}</small>
              </button>
            ))}
          </div>
          <SearchInput
            ref={filter}
            placeholder="Filter by name, address, group or tag"
            aria-label="Filter sites"
            aria-keyshortcuts="/"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                table.current?.focus();
              } else if (e.key === "Enter" || e.key === "ArrowDown") table.current?.focus();
            }}
          />
          <button
            type="button"
            className={`chip ${mode !== "any" ? "on" : ""}`}
            onClick={() => setMode(modes[(modeAt + 1) % modes.length][0])}
            aria-label={`${mode === "any" ? "Connection and group" : `Connection ${modes[modeAt][1]}`}, change`}
          >
            <Glyph name="sliders" />
            {mode === "any" ? (
              "Connection and group"
            ) : (
              <>
                Connection <b>{modes[modeAt][1]}</b>
              </>
            )}
          </button>
        </Toolbar>
        <section className="card" aria-label="All sites">
          {rows.length === 0 ? (
            sites.length === 0 ? (
              <Empty
                title="No sites yet."
                action={
                  <Button kind="primary" keys="A" onClick={onAdd}>
                    Add a site
                  </Button>
                }
              >
                <p>Add a site with Monks Central, Classic Monks or Classic Monks Pro on it for full control, or any WordPress 7.1 site in Basic mode.</p>
              </Empty>
            ) : (
              <Empty
                small
                title="No site matches these filters."
                action={
                  <Button
                    onClick={() => {
                      setQuery("");
                      setStatus("any");
                      setMode("any");
                    }}
                  >
                    Clear the filters
                  </Button>
                }
              />
            )
          ) : (
            <table
              ref={table}
              className="t"
              role="grid"
              aria-readonly="true"
              tabIndex={0}
              aria-label="Sites"
              aria-describedby="sites-legend"
              aria-activedescendant={focus ? `site-${focus.id}` : undefined}
            >
              <thead>
                <tr>
                  <th className="tick">
                    <button
                      type="button"
                      className="box"
                      role="checkbox"
                      aria-checked={rows.every((r) => selected.has(r.id)) ? true : rows.some((r) => selected.has(r.id)) ? "mixed" : false}
                      aria-label="Tick every site shown"
                      onClick={() =>
                        setSelected((sel) => {
                          const all = rows.every((r) => sel.has(r.id));
                          const next = new Set(sel);
                          for (const r of rows) {
                            if (all) next.delete(r.id);
                            else next.add(r.id);
                          }
                          return next;
                        })
                      }
                    />
                  </th>
                  <th className="fill">Site</th>
                  <th className="c-status">Status</th>
                  <th className="c-wp">WordPress</th>
                  <th className="c-conn">Connection</th>
                  <th className="acts-col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const st = siteStatus(s);
                  const on = selected.has(s.id);
                  const core = inventory?.get(s.id)?.inventory.wordpress_update;
                  const again = s.sign_in_again || noTools(s);
                  return (
                    <tr
                      key={s.id}
                      id={`site-${s.id}`}
                      data-id={s.id}
                      className={[on && "sel", s.id === focus?.id && "focus", again && "warn"].filter(Boolean).join(" ")}
                      aria-selected={on}
                      onClick={() => setFocusId(s.id)}
                    >
                      <td>
                        <button
                          type="button"
                          className="box"
                          role="checkbox"
                          aria-checked={on}
                          aria-label={`Select ${s.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(s.id);
                          }}
                        />
                      </td>
                      <td className="fill">
                        <span className="site" data-tip={`${s.name}, ${host(s)}${s.tags.length ? `. Tags: ${s.tags.join(", ")}` : ""}`}>
                          <SiteTile site={s} />
                          <span>
                            <b className="cut">{s.name}</b>
                            <small className="cut">{host(s)}</small>
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className={`st pill ${st.tone}`}>
                          <Icon tone={st.tone} />
                          {st.label}
                          {slow(s) && ", slow"}
                        </span>
                      </td>
                      <td>
                        <span className="row nowrap">
                          <span className={s.wp_version ? "m" : "dim"}>{s.wp_version ?? "not known"}</span>
                          {core && (
                            <span className="tag ok" data-tip={`WordPress ${core} is waiting`}>
                              <Glyph name="arrow-up" />
                              {core}
                              <span className="sr-only"> waiting</span>
                            </span>
                          )}
                        </span>
                      </td>
                      <td>
                        <span className="conn">
                          {s.mode === "basic" ? <Glyph name="link" /> : <Logo />}
                          {s.mode === "basic" ? "Basic" : pluginName(s)}
                        </span>
                      </td>
                      <td className="acts-col">
                        {/* Mouse shortcuts; the keyboard reaches the same actions in the panel (R, and its buttons). */}
                        <span className="rowacts">
                          {again ? (
                            <button type="button" className="icon-btn" tabIndex={-1} aria-label={`Sign in to ${s.name} again`} data-tip="Sign in again" onClick={() => onSignInAgain(s)}>
                              <Glyph name="login" />
                            </button>
                          ) : s.health === "down" ? (
                            <button type="button" className="icon-btn" tabIndex={-1} aria-label={`Check ${s.name} again`} data-tip="Check again" onClick={() => check([s.id])}>
                              <Glyph name="refresh" />
                            </button>
                          ) : (
                            <>
                              {hasTool(s, "create-login-link") && (
                                <button
                                  type="button"
                                  className="icon-btn"
                                  tabIndex={-1}
                                  aria-label={`Log in to the ${s.name} dashboard`}
                                  data-tip="Log in to the dashboard"
                                  onClick={() => api.login(s.id).catch((e) => toast(String(e), { tone: "danger" }))}
                                >
                                  <Glyph name="login" />
                                </button>
                              )}
                              <button
                                type="button"
                                className="icon-btn"
                                tabIndex={-1}
                                aria-label={`Open ${s.name} in the browser`}
                                data-tip="Open the site"
                                onClick={() => api.open(s.id).catch((e) => toast(String(e), { tone: "danger" }))}
                              >
                                <Glyph name="external" />
                              </button>
                            </>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="card-foot" id="sites-legend">
            <span className="dim">
              Showing {rows.length} of {sites.length} {sites.length === 1 ? "site" : "sites"}.
            </span>
            <span className="keys dim">
              <Kbd>J</Kbd> <Kbd>K</Kbd> move · <Kbd>X</Kbd> tick · <Kbd>/</Kbd> filter · <Kbd>R</Kbd> check the open site ·{" "}
              <Kbd>A</Kbd> add a site
            </span>
          </p>
          {/* Under the table and stuck to the bottom: ticking a row never moves the rows. */}
          {picked.length > 0 && (
            <div className="selbar" role="region" aria-label="Selection">
              <b>
                {picked.length} {picked.length === 1 ? "site" : "sites"} ticked
              </b>
              <label className="row">
                <span>Move to group</span>
                <Combobox
                  className="input sm"
                  style={{ width: 170 }}
                  suggestions={groups}
                  placeholder="Choose a group"
                  aria-label="Group for the selected sites"
                  value={groupFor}
                  onChange={(e) => setGroupFor(e.target.value)}
                  onKeyDown={async (e) => {
                    const g = groupFor.trim();
                    // An empty box never ungroups the whole selection; one Enter at a time.
                    if (e.key !== "Enter" || !g || grouping) return;
                    setGrouping(true);
                    const failed = (await Promise.all(picked.map((s) => api.setGroup(s.id, g).then(() => 0, () => 1)))).reduce<number>((a, b) => a + b, 0);
                    setGrouping(false);
                    setGroupFor("");
                    if (failed) toast(`${failed} of ${picked.length} sites didn't move to ${g}.`, { tone: "danger" });
                    else toast(`Put ${picked.length === 1 ? "1 site" : `${picked.length} sites`} in ${g}.`);
                  }}
                />
              </label>
              <Button small className="ghost" keys="R" onClick={() => check(picked.map((s) => s.id))}>
                <Glyph name="refresh" />
                Check them now
              </Button>
              <span className="grow" />
              <Button small className="ghost" onClick={() => setSelected(new Set())} keys="Esc">
                Clear selection
              </Button>
            </div>
          )}
        </section>
      </Page>
    </>
  );
}

type InspectorProps = {
  site: Site;
  groups: string[];
  allTags: string[];
  updates: { kind: string }[];
  onCheck: () => void;
  onSignInAgain: () => void;
  onUpdates?: () => void;
  onRemoved: (message: string, signedOut: boolean) => void;
};

/** "3 plugin updates", "1 core update and 2 plugin updates". */
function waitingWords(updates: { kind: string }[]) {
  const by = new Map<string, number>();
  for (const u of updates) by.set(u.kind, (by.get(u.kind) ?? 0) + 1);
  const name: Record<string, string> = { WordPress: "core", Plugin: "plugin", Theme: "theme", Translations: "translation" };
  const parts = [...by].map(([k, n]) => `${n} ${name[k] ?? k.toLowerCase()} ${n === 1 ? "update" : "updates"}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
}

/** Basic mode: get the Monks Central plugin onto the site, then connect through it. */
function GetPlugin({ site: s }: { site: Site }) {
  const [busy, setBusy] = useState<null | "download" | "browser">(null);
  const [saved, setSaved] = useState<PluginZip | null>(null);
  const upload = `${s.url}/wp-admin/plugin-install.php?tab=upload`;
  const fail = (e: unknown) => toast(String(e), { tone: "danger" });

  const download = async () => {
    setBusy("download");
    try {
      setSaved(await api.downloadPlugin(s.id));
      await api.openLink(upload, s.id).catch(fail);
    } catch (e) {
      fail(e);
    }
    setBusy(null);
  };
  const connect = async () => {
    setBusy("browser");
    try {
      const site = await api.connectPlugin(s.id);
      toast(`${site.name} is connected through its plugin.`);
    } catch (e) {
      fail(e);
      setBusy(null);
    }
  };

  if (busy === "browser")
    return (
      <div className="row">
        <span className="sum waiting" role="status">
          Waiting for you in the browser
        </span>
        <Button small onClick={() => api.cancelSignIn()}>
          Cancel the sign-in
        </Button>
      </div>
    );
  return (
    <>
      {saved ? (
        <p className="callout ok" role="status">
          <Glyph name="check" />
          <span>
            Monks Central {saved.version} is saved as <span className="m">{saved.path}</span>, checked against the SHA-256
            published with it. On the site's Upload Plugin page, choose that file, press Install Now, then Activate Plugin.
            WordPress lets apps install only from WordPress.org, so this one step is yours.
          </span>
        </p>
      ) : null}
      <div className="btn-grid one">
        {saved ? (
          <Button small onClick={() => api.openLink(upload, s.id).catch(fail)}>
            <Glyph name="external" />
            Open the upload page
          </Button>
        ) : (
          <Button small disabled={busy !== null} onClick={download}>
            <Glyph name="download" />
            {busy === "download" ? "Getting Monks Central…" : "Install Monks Central for me"}
          </Button>
        )}
        <Button small kind={saved ? "primary" : undefined} disabled={busy !== null} onClick={connect}>
          <Glyph name="login" />
          Connect through the plugin
        </Button>
      </div>
    </>
  );
}

function Inspector({ site: s, groups, allTags, updates, onCheck, onSignInAgain, onUpdates, onRemoved }: InspectorProps) {
  const [group, setGroup] = useState(s.group ?? "");
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  // Errors float as toasts, so the sections below don't move under the pointer.
  const setError = (text: string) => toast(text, { tone: "danger" });
  // Kept here so two quick tag edits build on each other, not on the tags before the first save.
  const [tags, setTags] = useState(s.tags);
  const savedTags = s.tags.join("\n");
  useEffect(() => setTags(s.tags), [savedTags]);
  const [deleting, setDeleting] = useState<number | null>(null);
  const st = siteStatus(s);
  const caps = s.capabilities;
  const abilities = Array.isArray(caps.abilities) ? caps.abilities.length : 0;
  const modules = caps.modules && typeof caps.modules === "object" ? (caps.modules as Record<string, boolean>) : null;
  const again = s.sign_in_again || noTools(s);
  const canLogin = hasTool(s, "create-login-link") && !s.sign_in_again;
  const plugin = connectorInfo(s);

  const run = async (f: () => Promise<unknown>) => {
    try {
      await f();
    } catch (e) {
      setError(String(e));
    }
  };

  const saveGroup = () => {
    if ((s.group ?? "") !== group.trim()) run(() => api.setGroup(s.id, group.trim() || null));
  };

  return (
    <>
      <header className="ihead">
        <SiteTile site={s} size="lg" />
        <div>
          <h2>{s.name}</h2>
          <small>
            {s.url.replace(/^https?:\/\//, "")}
            {s.client && ` · ${s.client}`}
          </small>
        </div>
        <span className={`st pill ${st.tone}`}>
          <Icon tone={st.tone} />
          {st.label}
        </span>
      </header>
      <section>
        {again ? (
          <Button kind="primary" className="disc block" onClick={onSignInAgain}>
            <span className="btn-disc">
              <Glyph name="login" />
            </span>
            Sign in again
          </Button>
        ) : (
          canLogin && (
            <Button kind="primary" className="disc block" onClick={() => run(() => api.login(s.id))}>
              <span className="btn-disc">
                <Glyph name="arrow" />
              </span>
              Log in to the dashboard
            </Button>
          )
        )}
        <div className="btn-grid">
          <Button small onClick={() => api.open(s.id).catch((e) => setError(String(e)))}>
            <Glyph name="external" />
            Open the site
          </Button>
          <Button small onClick={onCheck} keys="R">
            <Glyph name="refresh" />
            Check now
          </Button>
        </div>
        <dl className="dl">
          <div>
            <dt>WordPress</dt>
            <dd className={s.wp_version ? "m" : undefined}>{s.wp_version ?? "not known"}</dd>
          </div>
          <div>
            <dt>PHP</dt>
            <dd className={s.php_version ? "m" : undefined}>{s.php_version ?? "not known"}</dd>
          </div>
          <div>
            <dt>Plugin</dt>
            <dd>{plugin?.running ?? "not used"}</dd>
          </div>
          {!!plugin?.spare.length && (
            <div>
              <dt>Also on the site</dt>
              <dd>{plugin.spare.join(", ")}, not running</dd>
            </div>
          )}
          <div>
            <dt>Connection</dt>
            <dd>{connectionLabel(s)}</dd>
          </div>
          {s.mode === "basic" && (
            <div>
              <dt>Signed in as</dt>
              <dd>{s.username}</dd>
            </div>
          )}
          <div>
            <dt>Last checked</dt>
            <dd>{ago(s.checked_at)}</dd>
          </div>
          <div>
            <dt>Detail</dt>
            <dd>
              {s.sign_in_again ? (
                "The saved sign-in can't be used. Sign in again."
              ) : slow(s) ? (
                <Status tone="info">{s.health_detail} It still works.</Status>
              ) : (
                s.health_detail || "Not checked yet."
              )}
            </dd>
          </div>
        </dl>
        {updates.length > 0 && onUpdates && (
          <button type="button" className="callout ok go" onClick={onUpdates}>
            <Glyph name="download" />
            <span>
              <b>{waitingWords(updates)}</b> waiting
            </span>
            <span className="golink">
              Review
              <Glyph name="arrow" />
            </span>
          </button>
        )}
      </section>
      <section>
        <h3>What Monks Central can do here</h3>
        {s.mode === "basic" ? (
          <>
            <p className="dim-2">
              Content, users, comments and the plugin list through WordPress itself. Updates, one-click login and the rest
              need one plugin on the site: Monks Central, Classic Monks or Classic Monks Pro. Any of them works.
            </p>
            <GetPlugin site={s} />
          </>
        ) : noTools(s) ? (
          <p className="callout warning">
            <Glyph name="alert" />
            <span>{NO_TOOLS}</span>
          </p>
        ) : (
          <dl className="dl">
            <div>
              <dt>Tools</dt>
              <dd>
                {abilities} {abilities === 1 ? "tool" : "tools"} this app may use
              </dd>
            </div>
            <div>
              <dt>Access</dt>
              <dd>
                {caps.operator === true
                  ? "Full, ticked on the site"
                  : caps.operator === false
                    ? "Limited: changes may wait for approval on the site"
                    : "Not known"}
              </dd>
            </div>
            <div>
              <dt>Approvals</dt>
              <dd>{caps.approvals === true ? "The site can ask before a change" : "Not on this site"}</dd>
            </div>
            {modules && (
              <div>
                <dt>Modules on</dt>
                <dd>
                  {Object.entries(modules)
                    .filter(([, on]) => on)
                    .map(([m]) => m)
                    .join(", ") || "none"}
                </dd>
              </div>
            )}
          </dl>
        )}
        {caps.degraded === true && !noTools(s) && (
          <p className="callout warning">
            <Glyph name="alert" />
            <span>This Classic Monks is older. Update it on the site for every feature.</span>
          </p>
        )}
      </section>
      <section>
        <h3>Organise</h3>
        <label className="field-label" htmlFor="insp-group">
          Group
        </label>
        <Combobox
          id="insp-group"
          className="input"
          suggestions={groups}
          placeholder="No group"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          onBlur={saveGroup}
          onKeyDown={(e) => e.key === "Enter" && saveGroup()}
        />
        <p className="field-label" aria-hidden="true">
          Tags
        </p>
        <TagInput
          label="Tags"
          value={tags}
          suggestions={allTags}
          onChange={(next) => {
            setTags(next);
            run(() => api.setTags(s.id, next));
          }}
        />
      </section>
      <section>
        <h3>
          <label htmlFor="insp-note">Notes</label>
        </h3>
        {s.notes.length > 0 && (
          <ul className="site-notes">
            {s.notes.map((n) => (
              <li key={n.id}>
                <div>
                  <b>{n.body}</b>
                  <small>{ago(n.added_at)}</small>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Delete note"
                  data-tip="Delete note"
                  disabled={deleting === n.id}
                  onClick={async () => {
                    setDeleting(n.id);
                    await run(async () => {
                      await api.deleteNote(s.id, n.id);
                      // Undo writes the note again (with today's date).
                      toast(`Deleted the note on ${s.name}.`, { undo: () => run(() => api.addNote(s.id, n.body)) });
                    });
                    setDeleting(null);
                  }}
                >
                  <Glyph name="trash" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          id="insp-note"
          className="input"
          placeholder="Anything to remember about this site"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div>
          <Button small disabled={!note.trim()} onClick={() => run(() => api.addNote(s.id, note).then(() => setNote("")))}>
            <Glyph name="plus" />
            Add the note
          </Button>
        </div>
      </section>
      <section>
        {confirm ? (
          <div role="alertdialog" aria-label={`Remove ${s.name}`}>
            <p style={{ margin: "0 0 10px" }}>
              {s.mode === "classic_monks"
                ? "Monks Central signs out on the site, then deletes its saved sign-in here. Group, tags and notes go too."
                : "Monks Central deletes the saved application password here. Group, tags and notes go too."}
            </p>
            <div className="row">
              <Button
                small
                kind="danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await api.remove(s.id);
                    onRemoved(r.message, r.signed_out);
                  } catch (e) {
                    setError(String(e));
                    setBusy(false);
                  }
                }}
              >
                Remove {s.name}
              </Button>
              <Button small onClick={() => setConfirm(false)}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <Button small className="ghost danger-text" onClick={() => setConfirm(true)}>
            <Glyph name="trash" />
            Remove from Monks Central
          </Button>
        )}
      </section>
    </>
  );
}
