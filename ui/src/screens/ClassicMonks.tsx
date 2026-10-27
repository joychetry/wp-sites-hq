// Classic Monks on one site: its features, the settings it lets Monks Central change,
// its activity log with undo, and changes waiting for approval (plan Phase 4).
import { useCallback, useEffect, useState } from "react";
import { api, cmBlocked, hasTool, type Activity, type Approval, type FeatureGroup, type Setting, type Site } from "../api";
import { Button, Status } from "../components/ui";

type Tab = "features" | "settings" | "activity" | "approvals";
const TABS: [Tab, string, string][] = [
  ["features", "Features", "get-features"],
  ["settings", "Settings", "get-settings-schema"],
  ["activity", "Activity", "list-ai-activity"],
  ["approvals", "Waiting for approval", "list-pending-approvals"],
];

/** A change on the site, with the activity row that reverses it. */
type Done = { text: string; undo: number | null; ok: boolean };

const STATUS_WORD: Record<string, [string, "ok" | "warning" | "danger" | "unknown" | "info"]> = {
  ok: ["Done", "ok"],
  error: ["Failed", "danger"],
  denied: ["Refused", "danger"],
  pending: ["Waiting for approval", "warning"],
  approved: ["Approved", "ok"],
  declined: ["Declined", "danger"],
  used: ["Done after approval", "ok"],
  undone: ["Undone", "info"],
  expired: ["Expired", "unknown"],
};

/** "update-features" -> "Update features". */
export const toolLabel = (tool: string) => {
  const s = tool.replace(/^classic-monks\//, "").replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const firstCm = (sites: Site[]) => (sites.find((s) => !cmBlocked(s)) ?? sites[0])?.id ?? null;

export function ClassicMonks({ sites }: { sites: Site[] }) {
  const [siteId, setSiteId] = useState<number | null>(() => firstCm(sites));
  const site = sites.find((s) => s.id === siteId) ?? sites.find((s) => s.id === firstCm(sites)) ?? null;
  const blocked = site ? cmBlocked(site) : null;
  const [tab, setTab] = useState<Tab>("features");
  const [done, setDone] = useState<Done | null>(null);
  // Bumped after an undo so the open tab reads the site again.
  const [round, setRound] = useState(0);

  if (sites.length === 0) {
    return (
      <div className="empty">
        <h2>No sites yet.</h2>
        <p>Add a site with Classic Monks on Sites, then its features show here.</p>
      </div>
    );
  }

  const tools = TABS.filter(([, , tool]) => site && hasTool(site, tool));
  const current = tools.some(([t]) => t === tab) ? tab : "features";
  const undo = async () => {
    if (!site || done?.undo == null) return;
    try {
      await api.undo(site.id, done.undo);
      setDone({ text: `Undone: ${done.text}`, undo: null, ok: true });
      setRound((r) => r + 1);
    } catch (e) {
      setDone({ text: String(e), undo: null, ok: false });
    }
  };

  return (
    <div className="scroll">
      <div className="bar">
        <label className="row pick">
          <span>Site</span>
          <select
            className="input sm"
            aria-label="Site"
            value={site?.id ?? ""}
            onChange={(e) => {
              setSiteId(Number(e.target.value));
              setDone(null);
            }}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {cmBlocked(s) ? (s.mode === "basic" ? " (no Classic Monks)" : " (not available)") : ""}
              </option>
            ))}
          </select>
        </label>
        {!blocked && (
          <div className="segmented types" role="group" aria-label="Show">
            {tools.map(([t, l]) => (
              <button
                key={t}
                type="button"
                aria-pressed={t === current}
                onClick={() => {
                  setTab(t);
                  setDone(null);
                }}
              >
                {l}
              </button>
            ))}
          </div>
        )}
      </div>
      <div role="status" className="notice">
        {done && (
          <p className={`alert row ${done.ok ? "ok" : "danger"}`}>
            <span className="grow">{done.text}</span>
            {done.undo != null && (
              <Button small onClick={undo}>
                Undo
              </Button>
            )}
          </p>
        )}
      </div>
      {blocked || !site ? (
        <div className="empty">
          <h2>Classic Monks isn't available on {site?.name ?? "this site"}.</h2>
          <p>{blocked}</p>
        </div>
      ) : current === "features" ? (
        <Features key={site.id} site={site} onDone={setDone} round={round} />
      ) : current === "settings" ? (
        <Settings key={site.id} site={site} onDone={setDone} round={round} />
      ) : current === "activity" ? (
        <Log key={site.id} site={site} onDone={setDone} />
      ) : (
        <Approvals key={site.id} site={site} onDone={setDone} />
      )}
    </div>
  );
}

type Part = { site: Site; onDone: (d: Done) => void; round?: number };

/** Reads once per site, with Try again. */
function useRead<T>(read: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    read().then(setData, (e) => setError(String(e)));
    // The caller lists what the read depends on.
  }, deps);
  useEffect(load, [load]);
  return { data, setData, error, load };
}

function Failed({ what, error, retry }: { what: string; error: string; retry: () => void }) {
  return (
    <div className="empty" role="alert">
      <h2>{what} didn't load.</h2>
      <p>{error}</p>
      <Button onClick={retry}>Try again</Button>
    </div>
  );
}

function Features({ site, onDone, round }: Part) {
  const { data, setData, error, load } = useRead<FeatureGroup[]>(() => api.features(site.id), [site.id, round]);
  const [group, setGroup] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <Failed what="Classic Monks' features" error={error} retry={load} />;
  if (!data)
    return (
      <p className="empty" role="status">
        Reading Classic Monks on {site.name}…
      </p>
    );
  const shown = data.find((g) => g.key === group) ?? data[0];
  const words = typed.trim().toLowerCase();
  const toggles = words
    ? data.flatMap((g) => g.toggles).filter((t) => `${t.label} ${t.name} ${t.description}`.toLowerCase().includes(words))
    : (shown?.toggles ?? []);
  const flip = async (name: string, label: string, on: boolean) => {
    setBusy(name);
    try {
      const undo = await api.setFeature(site.id, name, on);
      setData(data.map((g) => ({ ...g, toggles: g.toggles.map((t) => (t.name === name ? { ...t, on } : t)) })));
      onDone({ text: `Turned ${on ? "on" : "off"} ${label} on ${site.name}.`, undo, ok: true });
    } catch (e) {
      onDone({ text: String(e), undo: null, ok: false });
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <form className="bar" onSubmit={(e) => e.preventDefault()}>
        <label className="row pick">
          <span>Section</span>
          <select className="input sm" aria-label="Section" value={shown?.key ?? ""} disabled={!!words} onChange={(e) => setGroup(e.target.value)}>
            {data.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label} ({g.toggles.length})
              </option>
            ))}
          </select>
        </label>
        <input className="input sm" aria-label="Find a feature" placeholder="Find a feature in every section" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </form>
      <p className="legend" id="features-legend">
        Each feature says On or Off. Locked ones (security and login) change only in WordPress, so a mistake here can't lock you out.
      </p>
      {toggles.length === 0 ? (
        <div className="empty">
          <h2>No feature matches.</h2>
          <p>Try another word.</p>
        </div>
      ) : (
        <ul className="toggles" aria-label={words ? "Matching features" : `${shown?.label} features`} aria-describedby="features-legend">
          {toggles.map((t) => (
            <li key={t.name}>
              <span className="what">
                <b>{t.label}</b>
                {(t.description || t.section) && <small>{t.description || t.section}</small>}
              </span>
              <Status tone={t.on ? "ok" : "unknown"}>{t.on ? "On" : "Off"}</Status>
              {t.locked ? (
                <span className="tag">Locked</span>
              ) : (
                <Button small disabled={busy === t.name} aria-label={`${t.on ? "Turn off" : "Turn on"} ${t.label}`} onClick={() => flip(t.name, t.label, !t.on)}>
                  {busy === t.name ? "Changing…" : t.on ? "Turn off" : "Turn on"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Settings({ site, onDone, round }: Part) {
  const { data, error, load } = useRead<Setting[]>(() => api.settings(site.id), [site.id, round]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <Failed what="Classic Monks' settings" error={error} retry={load} />;
  if (!data)
    return (
      <p className="empty" role="status">
        Reading Classic Monks' settings on {site.name}…
      </p>
    );
  if (data.length === 0)
    return (
      <div className="empty">
        <h2>Nothing to change here.</h2>
        <p>This Classic Monks lets Monks Central change no settings. Its features are under Features.</p>
      </div>
    );
  const valueOf = (s: Setting) => edits[s.name] ?? (s.value == null ? "" : String(s.value));
  const save = async (s: Setting) => {
    const raw = valueOf(s);
    const value = s.control === "number" ? Number(raw) : raw;
    setBusy(s.name);
    try {
      const undo = await api.setSetting(site.id, s.name, value);
      onDone({ text: `Set ${s.label} to ${raw} on ${site.name}.`, undo, ok: true });
      setEdits(({ [s.name]: _, ...rest }) => rest);
      load();
    } catch (e) {
      onDone({ text: String(e), undo: null, ok: false });
    } finally {
      setBusy(null);
    }
  };
  let tab = "";
  return (
    <>
      <p className="legend" id="settings-legend">
        The settings Classic Monks lets Monks Central change. Everything else stays in WordPress.
      </p>
      <ul className="toggles" aria-label="Settings" aria-describedby="settings-legend">
        {data.map((s) => {
          const head = s.tab !== tab ? (tab = s.tab) : null;
          const changed = valueOf(s) !== (s.value == null ? "" : String(s.value));
          return [
            head && (
              <li key={`h-${head}`} className="head">
                <h3>{head}</h3>
              </li>
            ),
            <li key={s.name}>
              <span className="what">
                <b id={`set-${s.name}`}>{s.label}</b>
                {(s.description || s.section) && <small>{s.description || s.section}</small>}
              </span>
              {s.control === "select" ? (
                <select className="input sm" aria-labelledby={`set-${s.name}`} value={valueOf(s)} onChange={(e) => setEdits({ ...edits, [s.name]: e.target.value })}>
                  {!s.options.includes(valueOf(s)) && <option value={valueOf(s)}>{valueOf(s) || "not set"}</option>}
                  {s.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="input sm"
                  type="number"
                  aria-labelledby={`set-${s.name}`}
                  min={s.min ?? undefined}
                  max={s.max ?? undefined}
                  step={s.step ?? undefined}
                  value={valueOf(s)}
                  onChange={(e) => setEdits({ ...edits, [s.name]: e.target.value })}
                />
              )}
              <Button small disabled={!changed || busy === s.name} aria-label={`Save ${s.label}`} onClick={() => save(s)}>
                {busy === s.name ? "Saving…" : "Save"}
              </Button>
            </li>,
          ];
        })}
      </ul>
    </>
  );
}

function Log({ site, onDone }: Part) {
  const [page, setPage] = useState(1);
  const { data, error, load } = useRead<Activity>(() => api.activity(site.id, page), [site.id, page]);
  const [busy, setBusy] = useState<number | null>(null);
  if (error) return <Failed what="The activity log" error={error} retry={load} />;
  if (!data)
    return (
      <p className="empty" role="status">
        Reading the activity log on {site.name}…
      </p>
    );
  if (data.rows.length === 0)
    return (
      <div className="empty">
        <h2>Nothing in the log yet.</h2>
        <p>Changes made through Classic Monks' tools, by Monks Central or an AI app, show here.</p>
      </div>
    );
  const undo = async (id: number, tool: string) => {
    setBusy(id);
    try {
      await api.undo(site.id, id);
      onDone({ text: `Undone: ${toolLabel(tool)} on ${site.name}.`, undo: null, ok: true });
      load();
    } catch (e) {
      onDone({ text: String(e), undo: null, ok: false });
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <p className="legend" id="activity-legend">
        Newest first, in the site's own time. Undo puts back what a change replaced; not every change can be undone.
      </p>
      <table className="t" aria-label="Activity" aria-describedby="activity-legend">
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Who</th>
            <th scope="col">What</th>
            <th scope="col">Result</th>
            <th scope="col">
              <span className="sr-only">Undo</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => {
            const [word, tone] = STATUS_WORD[r.status] ?? [r.status, "unknown"];
            return (
              <tr key={r.id}>
                <td className="num">{r.time}</td>
                <td>{r.who || "not known"}</td>
                <td>{toolLabel(r.tool)}</td>
                <td>
                  <Status tone={tone}>{word}</Status>
                </td>
                <td>
                  {r.can_undo && (
                    <Button small disabled={busy === r.id} aria-label={`Undo ${toolLabel(r.tool)} at ${r.time}`} onClick={() => undo(r.id, r.tool)}>
                      {busy === r.id ? "Undoing…" : "Undo"}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="pager">
        <span>
          Page {data.page} of {data.pages}, {data.total} {data.total === 1 ? "change" : "changes"}
        </span>
        <Button small disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous page
        </Button>
        <Button small disabled={page >= data.pages} onClick={() => setPage(page + 1)}>
          Next page
        </Button>
      </div>
    </>
  );
}

function Approvals({ site, onDone }: Part) {
  const { data, error, load } = useRead<Approval[]>(() => api.approvals(site.id), [site.id]);
  if (error) return <Failed what="The changes waiting for approval" error={error} retry={load} />;
  if (!data)
    return (
      <p className="empty" role="status">
        Reading {site.name}…
      </p>
    );
  if (data.length === 0)
    return (
      <div className="empty">
        <h2>Nothing is waiting for approval.</h2>
        <p>When an AI app asks to change {site.name}, the request waits here until you approve it on the site.</p>
        <Button onClick={load}>Check again</Button>
      </div>
    );
  const open = (a: Approval) =>
    api.openApproval(site.id, a.id).then(
      () => onDone({ text: `Opened the approval page for ${toolLabel(a.tool)} on ${site.name} in your browser.`, undo: null, ok: true }),
      (e) => onDone({ text: String(e), undo: null, ok: false }),
    );
  return (
    <>
      <p className="legend" id="approvals-legend">
        Changes AI apps asked for. You decide each one on the site itself, so an app can never approve its own change.
      </p>
      <table className="t" aria-label="Waiting for approval" aria-describedby="approvals-legend">
        <thead>
          <tr>
            <th scope="col">Asked</th>
            <th scope="col">By</th>
            <th scope="col">Change</th>
            <th scope="col">Time left</th>
            <th scope="col">
              <span className="sr-only">Decide</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((a) => (
            <tr key={a.id}>
              <td className="num">{a.time}</td>
              <td>{a.who || "not known"}</td>
              <td>{toolLabel(a.tool)}</td>
              <td className="num">{Math.max(1, Math.round(a.expires_in / 60))} min</td>
              <td>
                <Button small kind="primary" aria-label={`Approve or decline on the site: ${toolLabel(a.tool)}`} onClick={() => open(a)}>
                  Approve or decline on the site
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
