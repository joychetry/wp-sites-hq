// SPDX-License-Identifier: GPL-3.0-or-later
// Sites: a dense keyboard table, a selection bar and an inspector for the
// focused site.
import { dismiss, Empty, toast } from "../components/feedback";
import { Combobox, SearchInput, Select, TagInput } from "../components/controls";
import { useEffect, useMemo, useRef, useState } from "react";
import { ago, api, connectionLabel, connectorInfo, hasTool, NO_TOOLS, noTools, siteStatus, slow, useInventory, type PluginZip, type Site } from "../api";
import { AddSiteButton, Button, Glyph, HeadActions, Icon, Kbd, Logo, Status } from "../components/ui";
import { SiteTile } from "../components/SiteTile";
import { Page, SidePanel, Toolbar } from "../components/page";
import { updatesOf } from "./Updates";
import { ANY_PLUGIN } from "./AddSite";
import "../styles/screens/sites.css";

type Props = {
  sites: Site[];
  groups: string[];
  focusId: number | null;
  setFocusId: (id: number | null) => void;
  onAdd: () => void;
  onSignInAgain: (site: Site) => void;
  onUpdates?: () => void;
  /** The tab to open on: the top bar's attention chip opens Needs attention. */
  show?: StatusFilter;
};

export type StatusFilter = "any" | "attention" | "danger" | "ok";

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

export function Sites({ sites, groups, focusId, setFocusId, onAdd, onSignInAgain, onUpdates, show = "any" }: Props) {
  const { inventory } = useInventory();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>(show);
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
  const moveToGroup = async () => {
    const g = groupFor.trim();
    // An empty box never ungroups the whole selection; one move at a time.
    if (!g || grouping) return;
    setGrouping(true);
    const failed = (await Promise.all(picked.map((s) => api.setGroup(s.id, g).then(() => 0, () => 1)))).reduce<number>((a, b) => a + b, 0);
    setGrouping(false);
    setGroupFor("");
    if (failed) toast(`${failed} of ${picked.length} sites didn't move to ${g}.`, { tone: "danger" });
    else toast(`Put ${picked.length === 1 ? "1 site" : `${picked.length} sites`} in ${g}.`);
  };

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
    const failed = (await Promise.all(ids.map((id) => api.check(id).then(() => 0, () => 1)))).reduce<number>((a, b) => a + b, 0);
    dismiss(t);
    if (failed) toast(`${failed === ids.length ? "The check" : `${failed} of ${ids.length} checks`} didn't run. Try again.`, { tone: "danger" });
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
      {/* With no sites the empty state holds the one Add a site button, and there is nothing to filter or inspect. */}
      {sites.length > 0 && (
        <HeadActions>
          <AddSiteButton onClick={onAdd} />
        </HeadActions>
      )}
      <Page className="sites" side={sites.length > 0 ? side : undefined}>
        {sites.length > 0 && (
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
            placeholder="Filter sites"
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
          <Select className="conn-filter" aria-label="Connection" value={mode} onChange={(e) => setMode(e.target.value as ModeFilter)}>
            <option value="any">Any connection</option>
            <option value="classic_monks">WP Sites HQ plugin</option>
            <option value="basic">Basic mode</option>
          </Select>
        </Toolbar>
        )}
        <section className="card" aria-label="All sites">
          {rows.length === 0 ? (
            sites.length === 0 ? (
              <Empty
                title="No sites yet"
                action={<AddSiteButton onClick={onAdd} />}
              >
                <p>{ANY_PLUGIN} Or use Basic mode on any WordPress 7.1 site.</p>
              </Empty>
            ) : (
              <Empty
                small
                title="No site matches these filters"
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
              <colgroup>
                <col className="c-tick" />
                <col className="c-fill" />
                {/* "Sign-in expired" as a pill is 128px: wider than c-status. */}
                <col className="c-text" />
                <col className="c-version" />
                <col className="c-text" />
                <col className="c-act" />
              </colgroup>
              <thead>
                <tr>
                  <th className="tick">
                    <button
                      type="button"
                      className="box"
                      role="checkbox"
                      aria-checked={rows.every((r) => selected.has(r.id)) ? true : rows.some((r) => selected.has(r.id)) ? "mixed" : false}
                      aria-label="Select all shown"
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
                  <th>Site</th>
                  <th>Status</th>
                  <th>WordPress</th>
                  <th className="conn-col">Connection</th>
                  <th className="act acts-col">
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
                      <td className="tick">
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
                        </span>
                      </td>
                      <td>
                        <span className="row nowrap">
                          <span className={s.wp_version ? "m" : "dim"}>{s.wp_version ?? "Not known"}</span>
                          {core && (
                            <span className="tag ok" data-tip={`WordPress ${core} is waiting`}>
                              <Glyph name="arrow-up" />
                              {core}
                              <span className="sr-only"> waiting</span>
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="conn-col">
                        <span className="conn">
                          {s.mode === "basic" ? <Glyph name="link" /> : <Logo />}
                          {s.mode === "basic" ? "Basic mode" : "WP Sites HQ plugin"}
                        </span>
                      </td>
                      <td className="act acts-col">
                        {/* Mouse shortcuts; the keyboard reaches the same actions in the panel (R, and its buttons).
                            Each action keeps its own icon, and Open the site always sits in the right-hand slot. */}
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
                            hasTool(s, "create-login-link") && (
                              <button
                                type="button"
                                className="icon-btn"
                                tabIndex={-1}
                                aria-label={`Log in to the ${s.name} dashboard`}
                                data-tip="Log in to the dashboard"
                                onClick={() => api.login(s.id).catch((e) => toast(String(e), { tone: "danger" }))}
                              >
                                <Glyph name="dashboard" />
                              </button>
                            )
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
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {sites.length > 0 && (
          <p className="card-foot" id="sites-legend">
            <span className="dim">
              Showing {rows.length} of {sites.length} {sites.length === 1 ? "site" : "sites"}.
            </span>
            <span className="keys dim">
              <Kbd>J</Kbd> <Kbd>K</Kbd> move · <Kbd>X</Kbd> select · <Kbd>/</Kbd> filter · <Kbd>R</Kbd> check again ·{" "}
              <Kbd>A</Kbd> add a site
            </span>
          </p>
          )}
          {/* Under the table and stuck to the bottom: selecting a row never moves the rows. */}
          {picked.length > 0 && (
            <div className="selbar" role="region" aria-label="Selection">
              <b>{picked.length} selected</b>
              <Button small className="ghost" aria-label="Clear selection" onClick={() => setSelected(new Set())} keys="Esc">
                Clear
              </Button>
              <label className="row">
                <span>Move to group</span>
                <Combobox
                  className="input sm"
                  suggestions={groups}
                  placeholder="Choose a group"
                  aria-label="Group for the selected sites"
                  value={groupFor}
                  onChange={(e) => setGroupFor(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") moveToGroup();
                  }}
                />
              </label>
              <Button small disabled={!groupFor.trim() || grouping} onClick={moveToGroup}>
                Apply
              </Button>
              <Button small className="ghost" keys="R" onClick={() => check(picked.map((s) => s.id))}>
                Check {picked.length === 1 ? "1 site" : `${picked.length} sites`}
                <Glyph name="refresh" />
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

/** "3 plugin updates", "1 WordPress update and 2 plugin updates". */
function waitingWords(updates: { kind: string }[]) {
  const by = new Map<string, number>();
  for (const u of updates) by.set(u.kind, (by.get(u.kind) ?? 0) + 1);
  const name: Record<string, string> = { WordPress: "WordPress", Plugin: "plugin", Theme: "theme", Translations: "translation" };
  const parts = [...by].map(([k, n]) => `${n} ${name[k] ?? k.toLowerCase()} ${n === 1 ? "update" : "updates"}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
}

/** Module slugs as people say them. */
const MODULE: Record<string, string> = { ai: "AI", woocommerce: "WooCommerce", seo: "SEO", acf: "ACF" };

/** Basic mode: get the WP Sites HQ plugin onto the site, then connect through it. */
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
        <div className="callout ok" role="status">
          <Glyph name="check" />
          <div>
            <p>
              Saved as <span className="m path" title={saved.path}>{saved.path.split(/[\\/]/).pop()}</span> (version {saved.version},
              checked). WordPress lets apps install plugins only from WordPress.org, so these steps are yours:
            </p>
            <ol>
              <li>Open the upload page.</li>
              <li>Choose the file and press Install Now.</li>
              <li>Press Activate Plugin.</li>
              <li>Come back here and press Connect through the plugin.</li>
            </ol>
          </div>
        </div>
      ) : null}
      <div className="btn-grid one">
        {saved ? (
          <Button small onClick={() => api.openLink(upload, s.id).catch(fail)}>
            Open the upload page
            <Glyph name="external" />
          </Button>
        ) : (
          <Button small disabled={busy !== null} onClick={download}>
            {busy === "download" ? "Downloading…" : "Download the WP Sites HQ plugin"}
            <Glyph name="download" />
          </Button>
        )}
        <Button small kind={saved ? "primary" : undefined} disabled={busy !== null} onClick={connect}>
          Connect through the plugin
          <Glyph name="login" />
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
          <small title={s.url.replace(/^https?:\/\//, "")}>{s.url.replace(/^https?:\/\//, "")}</small>
          {s.client && <small className="client">{s.client}</small>}
          <span className={`st pill ${st.tone}`}>
            <Icon tone={st.tone} />
            {st.label}
          </span>
        </div>
      </header>
      <section>
        {again ? (
          <Button kind="primary" className="disc block" onClick={onSignInAgain}>
            Sign in again
            <span className="btn-disc">
              <Glyph name="login" />
            </span>
          </Button>
        ) : (
          canLogin && (
            <Button kind="primary" className="disc block" onClick={() => run(() => api.login(s.id))}>
              Log in to the dashboard
              <span className="btn-disc">
                <Glyph name="dashboard" />
              </span>
            </Button>
          )
        )}
        <div className="btn-grid">
          <Button small onClick={() => api.open(s.id).catch((e) => setError(String(e)))}>
            Open the site
            <Glyph name="external" />
          </Button>
          {/* R is in the table's key legend; a key chip here would not fit the half-width button at 1280. */}
          <Button small onClick={onCheck} aria-keyshortcuts="R">
            Check again
            <Glyph name="refresh" />
          </Button>
        </div>
        <dl className="dl">
          <div>
            <dt>WordPress</dt>
            <dd className={s.wp_version ? "m" : undefined}>{s.wp_version ?? "Not known"}</dd>
          </div>
          <div>
            <dt>PHP</dt>
            <dd className={s.php_version ? "m" : undefined}>{s.php_version ?? "Not known"}</dd>
          </div>
          <div>
            <dt>Plugin</dt>
            <dd>{plugin?.running ?? "None"}</dd>
          </div>
          {!!plugin?.spare.length && (
            <div>
              <dt>{plugin.spare.length === 1 ? "Other plugin" : "Other plugins"}</dt>
              <dd>{plugin.spare.join(", ")} (turned off)</dd>
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
            <dt>Checked</dt>
            <dd>{ago(s.checked_at)}</dd>
          </div>
          <div>
            <dt>Last check</dt>
            <dd>
              {s.sign_in_again ? (
                "Sign-in expired. Sign in again to work on this site."
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
        <h3>What WP Sites HQ can do here</h3>
        {s.mode === "basic" ? (
          <>
            <p className="dim-2">
              Content, users, comments and the plugin list through WordPress itself. Updates, one-click login and the rest
              need a plugin on the site. {ANY_PLUGIN}
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
              <dt>What it can do</dt>
              <dd>
                {abilities} {abilities === 1 ? "action" : "actions"}
              </dd>
            </div>
            <div>
              <dt>Access</dt>
              <dd>
                {caps.operator === true
                  ? "Full"
                  : caps.operator === false
                    ? "Limited: changes may wait for approval on the site"
                    : "Not known"}
              </dd>
            </div>
            <div>
              <dt>Approvals</dt>
              <dd>{caps.approvals === true ? "Changes can wait for your OK on the site" : "Not on this site"}</dd>
            </div>
            {modules && (
              <div>
                <dt>Modules</dt>
                <dd>
                  {Object.entries(modules)
                    .filter(([, on]) => on)
                    .map(([m]) => MODULE[m] ?? m.charAt(0).toUpperCase() + m.slice(1))
                    .join(", ") || "None on"}
                </dd>
              </div>
            )}
          </dl>
        )}
        {caps.degraded === true && !noTools(s) && (
          <p className="callout warning">
            <Glyph name="alert" />
            <span>The Classic Monks plugin on this site is an older version. Update it to use every feature.</span>
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
            Add the note
            <Glyph name="plus" />
          </Button>
        </div>
      </section>
      <section>
        {confirm ? (
          <div className="confirm" role="alertdialog" aria-label={`Remove ${s.name}`}>
            <p>
              {s.mode === "classic_monks"
                ? "WP Sites HQ signs out on the site, then deletes its saved sign-in here. Group, tags and notes go too."
                : "WP Sites HQ deletes the saved application password here. Group, tags and notes go too."}
            </p>
            <div className="row">
              <Button small onClick={() => setConfirm(false)}>
                Keep it
              </Button>
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
            </div>
          </div>
        ) : (
          <Button small className="ghost danger-text" onClick={() => setConfirm(true)}>
            Remove from WP Sites HQ
            <Glyph name="trash" />
          </Button>
        )}
      </section>
    </>
  );
}
