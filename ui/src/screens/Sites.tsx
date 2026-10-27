// Sites: a dense keyboard table, a selection bar and an inspector for the
// focused site.
import { useEffect, useMemo, useRef, useState } from "react";
import { ago, api, connectionLabel, NO_TOOLS, noTools, siteStatus, slow, type Site, type Tone } from "../api";
import { Button, Kbd, Status } from "../components/ui";

type Props = {
  sites: Site[];
  groups: string[];
  focusId: number | null;
  setFocusId: (id: number | null) => void;
  onAdd: () => void;
  onSignInAgain: (site: Site) => void;
};

type StatusFilter = "any" | Exclude<Tone, "unknown">;
type ModeFilter = "any" | Site["mode"];

/** Typing in a field, or a dialog is open: leave the keys alone. */
function busyKeys(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return (
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) ||
    !!document.querySelector('[aria-modal="true"]')
  );
}

export function Sites({ sites, groups, focusId, setFocusId, onAdd, onSignInAgain }: Props) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("any");
  const [mode, setMode] = useState<ModeFilter>("any");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [notice, setNotice] = useState<{ tone: "ok" | "warning" | "danger"; text: string } | null>(null);
  const [groupFor, setGroupFor] = useState("");
  const filter = useRef<HTMLInputElement>(null);
  const table = useRef<HTMLTableElement>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sites.filter((s) => {
      const st = siteStatus(s).tone;
      return (
        (status === "any" || st === status) &&
        (mode === "any" || s.mode === mode) &&
        (!q || [s.name, s.url, s.group ?? "", ...s.tags].some((v) => v.toLowerCase().includes(q)))
      );
    });
  }, [sites, query, status, mode]);

  const focus = rows.find((s) => s.id === focusId) ?? rows[0] ?? null;
  const picked = sites.filter((s) => selected.has(s.id));

  useEffect(() => {
    // Removed sites leave the selection.
    setSelected((sel) => new Set([...sel].filter((id) => sites.some((s) => s.id === id))));
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
    setNotice({ tone: "ok", text: `Checking ${ids.length === 1 ? "the site" : `${ids.length} sites`}…` });
    await Promise.all(ids.map((id) => api.check(id).catch(() => {})));
    setNotice(null);
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

  const chip = <T extends string>(label: string, value: T, set: (v: T) => void, options: [T, string][]) => {
    const i = options.findIndex(([v]) => v === value);
    const [, text] = options[i];
    return (
      <button
        type="button"
        className={`chip ${value !== options[0][0] ? "on" : ""}`}
        onClick={() => set(options[(i + 1) % options.length][0])}
        aria-label={`${label}: ${text}. Change`}
      >
        <b>{label}</b> {text}
      </button>
    );
  };

  return (
    <>
      <div className="scroll">
        <div className="bar">
          {chip("Status", status, setStatus, [
            ["any", "any"],
            ["ok", "healthy"],
            ["warning", "needs a look"],
            ["danger", "down"],
          ])}
          {chip("Connection", mode, setMode, [
            ["any", "any"],
            ["classic_monks", "Classic Monks"],
            ["basic", "Basic mode"],
          ])}
          <span className="grow" />
          <input
            ref={filter}
            className="input sm"
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
          <Button small onClick={onAdd} keys="A">
            Add a site
          </Button>
        </div>
        {picked.length > 0 && (
          <div className="selbar" role="region" aria-label="Selection">
            <b>{picked.length} selected</b>
            <Button small kind="primary" keys="R" onClick={() => check(picked.map((s) => s.id))}>
              Check now
            </Button>
            <input
              className="input sm"
              style={{ width: 160 }}
              list="groups"
              placeholder="Put in a group"
              aria-label="Group for the selected sites"
              value={groupFor}
              onChange={(e) => setGroupFor(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key !== "Enter") return;
                await Promise.all(picked.map((s) => api.setGroup(s.id, groupFor.trim() || null)));
                setGroupFor("");
              }}
            />
            <Button small onClick={() => setSelected(new Set())} keys="Esc">
              Clear selection
            </Button>
          </div>
        )}
        <div role="status" className="notice">
          {notice && <p className={`alert ${notice.tone}`}>{notice.text}</p>}
        </div>
        <datalist id="groups">
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        {rows.length === 0 ? (
          <div className="empty">
            {sites.length === 0 ? (
              <>
                <h2>No sites yet.</h2>
                <p>Add a site with Classic Monks for full control, or any WordPress 7.1 site in Basic mode.</p>
                <Button kind="primary" keys="A" onClick={onAdd}>
                  Add a site
                </Button>
              </>
            ) : (
              <>
                <p>No site matches these filters.</p>
                <Button
                  onClick={() => {
                    setQuery("");
                    setStatus("any");
                    setMode("any");
                  }}
                >
                  Clear the filters
                </Button>
              </>
            )}
          </div>
        ) : (
          <>
            <p className="legend" id="sites-legend">
              <Status tone="ok">Healthy</Status>
              <Status tone="warning">Needs a look, sign in again or no tools yet</Status>
              <Status tone="danger">Down</Status>
              <Status tone="unknown">Not checked yet</Status>
              <span>
                Point at a name for its address. WordPress and PHP are the versions each site runs. Last checked is when
                Monks Central last asked the site.
              </span>
            </p>
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
                  <th style={{ width: 34 }}>
                    <span className="sr-only">Selected</span>
                  </th>
                  <th>Site</th>
                    <th>Status</th>
                  <th>Group</th>
                  <th>WordPress</th>
                  <th>PHP</th>
                  <th>Connection</th>
                  <th>Tags</th>
                  <th>Last checked</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const st = siteStatus(s);
                  const on = selected.has(s.id);
                  return (
                    <tr
                      key={s.id}
                      id={`site-${s.id}`}
                      data-id={s.id}
                      className={[on && "sel", s.id === focus?.id && "focus"].filter(Boolean).join(" ")}
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
                      <td className="name cut" title={`${s.name}, ${s.url.replace(/^https?:\/\//, "")}`}>
                        {s.name}
                      </td>
                      <td>
                        <Status tone={st.tone}>{st.label}</Status>
                        {slow(s) && <span className="dim">, slow</span>}
                      </td>
                      <td>{s.group ?? <span className="dim">none</span>}</td>
                      <td className={s.wp_version ? "m" : "dim"}>{s.wp_version ?? "not known"}</td>
                      <td className={s.php_version ? "m" : "dim"}>{s.php_version?.split(".").slice(0, 2).join(".") ?? "not known"}</td>
                      <td>{s.mode === "basic" ? "Basic mode" : "Classic Monks"}</td>
                      <td title={s.tags.join(", ")}>
                        {s.tags.length > 0 && <span className="tag">{s.tags[0]}</span>}
                        {s.tags.length > 1 && (
                          <span className="dim">
                            {" "}
                            +{s.tags.length - 1}
                            <span className="sr-only"> more tags</span>
                          </span>
                        )}
                      </td>
                      <td>{ago(s.checked_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
      {focus && (
        <Inspector
          key={focus.id}
          site={focus}
          onCheck={() => check([focus.id])}
          onSignInAgain={() => onSignInAgain(focus)}
          onRemoved={(text, ok) => {
            setNotice({ tone: ok ? "ok" : "warning", text });
            setFocusId(null);
          }}
        />
      )}
    </>
  );
}

type InspectorProps = {
  site: Site;
  onCheck: () => void;
  onSignInAgain: () => void;
  onRemoved: (message: string, signedOut: boolean) => void;
};

function Inspector({ site: s, onCheck, onSignInAgain, onRemoved }: InspectorProps) {
  const [group, setGroup] = useState(s.group ?? "");
  const [tag, setTag] = useState("");
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const st = siteStatus(s);
  const caps = s.capabilities;
  const abilities = Array.isArray(caps.abilities) ? caps.abilities.length : 0;
  const modules = caps.modules && typeof caps.modules === "object" ? (caps.modules as Record<string, boolean>) : null;

  const run = async (f: () => Promise<unknown>) => {
    setError(null);
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
    <aside className="insp" aria-label={`${s.name} details`}>
      <header>
        <h2>{s.name}</h2>
        <span className="mono dim">{s.url.replace(/^https?:\/\//, "")}</span>
        <div className="acts">
          {(s.sign_in_again || noTools(s)) && (
            <Button small kind="primary" onClick={onSignInAgain}>
              Sign in again
            </Button>
          )}
          <Button small onClick={() => api.open(s.id).catch((e) => setError(String(e)))}>
            Open the site
          </Button>
          <Button small onClick={onCheck} keys="R">
            Check now
          </Button>
        </div>
      </header>
      {error && (
        <p className="alert danger" role="alert" style={{ margin: "12px 16px 0" }}>
          {error}
        </p>
      )}
      <section>
        <h3>Health</h3>
        <dl className="kv">
          <dt>Status</dt>
          <dd>
            <Status tone={st.tone}>{st.label}</Status>
          </dd>
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
          <dt>Checked</dt>
          <dd>{ago(s.checked_at)}</dd>
        </dl>
      </section>
      <section>
        <h3>Versions</h3>
        <dl className="kv">
          <dt>WordPress</dt>
          <dd className={s.wp_version ? "mono" : undefined}>{s.wp_version ?? "unknown"}</dd>
          <dt>PHP</dt>
          <dd className={s.php_version ? "mono" : undefined}>{s.php_version ?? "unknown"}</dd>
          <dt>Classic Monks</dt>
          <dd className={s.cm_version ? "mono" : undefined}>{s.cm_version ?? (s.mode === "basic" ? "not used" : "unknown")}</dd>
          <dt>Connection</dt>
          <dd>{connectionLabel(s)}</dd>
          {s.mode === "basic" && (
            <>
              <dt>Signed in as</dt>
              <dd>{s.username}</dd>
            </>
          )}
        </dl>
      </section>
      <section>
        <h3>What Monks Central can do here</h3>
        {s.mode === "basic" ? (
          <p style={{ margin: 0, color: "var(--text-2)" }}>
            Content, users, comments and the plugin list through WordPress itself. Updates, one-click login and Classic
            Monks modules need Classic Monks.
          </p>
        ) : noTools(s) ? (
          <p className="alert" style={{ margin: 0 }}>
            {NO_TOOLS}
          </p>
        ) : (
          <dl className="kv">
            <dt>Tools</dt>
            <dd>
              {abilities} {abilities === 1 ? "tool" : "tools"} this app may use
            </dd>
            <dt>Access</dt>
            <dd>
              {caps.operator === true
                ? "Full, ticked on the site"
                : caps.operator === false
                  ? "Limited: changes may wait for approval on the site"
                  : "Not known"}
            </dd>
            <dt>Approvals</dt>
            <dd>{caps.approvals === true ? "The site can ask before a change" : "Not on this site"}</dd>
            {modules && (
              <>
                <dt>Modules on</dt>
                <dd>
                  {Object.entries(modules)
                    .filter(([, on]) => on)
                    .map(([m]) => m)
                    .join(", ") || "none"}
                </dd>
              </>
            )}
          </dl>
        )}
        {caps.degraded === true && !noTools(s) && (
          <p className="alert" style={{ margin: "10px 0 0" }}>
            This Classic Monks is older. Update it on the site for every feature.
          </p>
        )}
      </section>
      <section>
        <h3>
          <label htmlFor="insp-group">Group</label>
        </h3>
        <input
          id="insp-group"
          className="input sm"
          list="groups"
          placeholder="No group"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          onBlur={saveGroup}
          onKeyDown={(e) => e.key === "Enter" && saveGroup()}
        />
      </section>
      <section>
        <h3>
          <label htmlFor="insp-tag">Tags</label>
        </h3>
        {s.tags.length > 0 && (
          <div className="tags">
            {s.tags.map((t) => (
              <span key={t} className="tag">
                {t}
                <button
                  type="button"
                  aria-label={`Remove tag ${t}`}
                  onClick={() => run(() => api.setTags(s.id, s.tags.filter((x) => x !== t)))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          id="insp-tag"
          className="input sm"
          placeholder="Add a tag, then Enter"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && tag.trim()) {
              run(() => api.setTags(s.id, [...s.tags, tag.trim()]));
              setTag("");
            }
          }}
        />
      </section>
      <section>
        <h3>
          <label htmlFor="insp-note">Notes</label>
        </h3>
        <textarea
          id="insp-note"
          className="input"
          placeholder="Write a note about this site"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="acts" style={{ marginTop: 6 }}>
          <Button
            small
            disabled={!note.trim()}
            onClick={() => run(() => api.addNote(s.id, note).then(() => setNote("")))}
          >
            Add the note
          </Button>
        </div>
        {s.notes.length > 0 && (
          <ul className="ulist notes" style={{ marginTop: 8 }}>
            {s.notes.map((n) => (
              <li key={n.id}>
                <p>{n.body}</p>
                <span className="row dim" style={{ fontSize: "var(--fs-sm)" }}>
                  {ago(n.added_at)}
                  <button
                    type="button"
                    className="btn sm"
                    style={{ marginLeft: "auto" }}
                    onClick={() => run(() => api.deleteNote(s.id, n.id))}
                  >
                    Delete note
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
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
          <Button small kind="danger" onClick={() => setConfirm(true)}>
            Remove from Monks Central
          </Button>
        )}
      </section>
      <p className="note">
        <Kbd>J</Kbd> <Kbd>K</Kbd> move between sites, <Kbd>X</Kbd> select, <Kbd>/</Kbd> filter, <Kbd>R</Kbd> check now
      </p>
    </aside>
  );
}
