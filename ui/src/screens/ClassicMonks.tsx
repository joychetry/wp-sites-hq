// Classic Monks on one site: its features, the settings it lets Monks Central change,
// its activity log with undo, and changes waiting for approval (plan Phase 4).
import { Skeleton, toast } from "../components/feedback";
import { Select, NumberInput, Tabs, SearchInput } from "../components/controls";
import { useCallback, useEffect, useState } from "react";
import { api, cmBlocked, hasTool, type Activity, type Approval, type CmReports, type FeatureGroup, type Setting, type Site } from "../api";
import { Button, Status } from "../components/ui";

type Tab = "features" | "settings" | "activity" | "approvals" | "reports";
const TABS: [Tab, string, string][] = [
  ["features", "Features", "get-features"],
  ["settings", "Settings", "get-settings-schema"],
  ["activity", "Activity", "list-ai-activity"],
  ["approvals", "Waiting for approval", "list-pending-approvals"],
  ["reports", "Reports", "get-404-report"],
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
  // Results float as toasts, so nothing above the list moves under the pointer.
  const setDone = (done: Done) => {
    const on = site;
    const undo = async () => {
      try {
        await api.undo(on!.id, done.undo!);
        toast(`Undone: ${done.text}`);
        setRound((r) => r + 1);
      } catch (e) {
        toast(String(e), { tone: "danger" });
      }
    };
    toast(done.text, { tone: done.ok ? "ok" : "danger", undo: on && done.undo != null ? undo : undefined });
  };

  return (
    <div className="scroll">
      <div className="bar">
        <label className="row pick">
          <span>Site</span>
          <Select
            className="input sm"
            aria-label="Site"
            value={site?.id ?? ""}
            onChange={(e) => {
              setSiteId(Number(e.target.value));
            }}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {cmBlocked(s) ? (s.mode === "basic" ? " (no Classic Monks)" : " (not available)") : ""}
              </option>
            ))}
          </Select>
        </label>
        {!blocked && (
          <Tabs
            label="Show"
            idBase="cm"
            tabs={tools.map(([id, label]) => ({ id, label }))}
            value={current}
            onChange={(t) => {
              setTab(t);
            }}
          />
        )}
      </div>
      <div role={blocked || !site ? undefined : "tabpanel"} id="cm-panel" aria-labelledby={blocked || !site ? undefined : `cm-tab-${current}`}>
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
        ) : current === "reports" ? (
          <Reports key={site.id} site={site} />
        ) : (
          <Approvals key={site.id} site={site} onDone={setDone} />
        )}
      </div>
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
      <Skeleton label={`Reading Classic Monks on ${site.name}…`} />
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
          <Select className="input sm" aria-label="Section" value={shown?.key ?? ""} disabled={!!words} onChange={(e) => setGroup(e.target.value)}>
            {data.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label} ({g.toggles.length})
              </option>
            ))}
          </Select>
        </label>
        <SearchInput className="sm" aria-label="Find a feature" placeholder="Find a feature in every section" value={typed} onChange={(e) => setTyped(e.target.value)} />
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
      <Skeleton label={`Reading Classic Monks' settings on ${site.name}…`} />
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
          // A number box with letters in it would save as nothing at all.
          const changed = valueOf(s) !== (s.value == null ? "" : String(s.value)) && (s.control !== "number" || Number.isFinite(Number(valueOf(s))));
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
                <Select className="input sm" aria-labelledby={`set-${s.name}`} value={valueOf(s)} onChange={(e) => setEdits({ ...edits, [s.name]: e.target.value })}>
                  {!s.options.includes(valueOf(s)) && <option value={valueOf(s)}>{valueOf(s) || "not set"}</option>}
                  {s.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </Select>
              ) : (
                <NumberInput
                  className="input sm"
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
      <Skeleton label={`Reading the activity log on ${site.name}…`} />
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
      <Skeleton label={`Reading ${site.name}…`} />
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

const pct = (part: number, all: number) => (all ? `${Math.round((part / all) * 100)}%` : "no users");
const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;
const REPORT_NAME: Record<string, string> = {
  "get-404-report": "Pages not found",
  "get-search-report": "Searches",
  "get-unused-media-report": "Unused media",
  "get-login-security-report": "Logins",
  "get-2fa-report": "Two-factor sign-in",
};

/** Classic Monks' own reports on one site, over a period. */
function Reports({ site }: { site: Site }) {
  const [days, setDays] = useState(30);
  const { data, error, load } = useRead<CmReports>(() => api.cmReports(site.id, days), [site.id, days]);
  const period = (
    <div className="bar">
      <div className="segmented types" role="group" aria-label="Period">
        {[7, 30, 90].map((d) => (
          <button key={d} type="button" aria-pressed={d === days} onClick={() => setDays(d)}>
            {d} days
          </button>
        ))}
      </div>
    </div>
  );
  if (error)
    return (
      <>
        {period}
        <Failed what="The reports" error={error} retry={load} />
      </>
    );
  if (!data)
    return (
      <>
        {period}
        <Skeleton label={`Reading the reports on ${site.name}…`} />
      </>
    );
  const { not_found: nf, searches: se, unused_media: um, logins: lo, two_factor: tf } = data;
  const failed = data.failed;
  return (
    <>
      {period}
      <div className="kpis">
        {nf && (
          <div className="kpi">
            <div className={`v ${nf.count ? "warning" : ""}`}>{nf.count}</div>
            <div className="l">Addresses not found</div>
          </div>
        )}
        {se && (
          <div className="kpi">
            <div className="v">{se.total_searches}</div>
            <div className="l">Searches, {se.zero_result_searches} found nothing</div>
          </div>
        )}
        {um && (
          <div className="kpi">
            <div className="v">{um.has_results ? (um.counts.unused ?? 0) : "not scanned"}</div>
            <div className="l">{um.has_results ? `Unused media files, ${mb(um.listed_size)} listed` : "Unused media: not scanned yet"}</div>
          </div>
        )}
        {lo && (
          <div className="kpi">
            <div className={`v ${lo.period.lockouts ? "warning" : ""}`}>{lo.period.attempts ?? 0}</div>
            <div className="l">Failed logins, {lo.period.lockouts ?? 0} lockouts</div>
          </div>
        )}
        {tf && (
          <div className="kpi">
            <div className="v">{pct(tf.stats.users_with_2fa, tf.stats.total_users)}</div>
            <div className="l">
              Users with two-factor, {tf.stats.users_with_2fa} of {tf.stats.total_users}
            </div>
          </div>
        )}
      </div>
      {failed.length > 0 && <p className="alert">Not read: {failed.map(([t, why]) => `${REPORT_NAME[t] ?? t} (${why})`).join("; ")}</p>}
      {nf && nf.urls.length > 0 && (
        <section aria-label="Pages not found">
          <h2 className="sect">Pages not found, most visited</h2>
          <p className="legend" id="notfound-legend">
            Addresses visitors asked for that the site doesn't have. Came from is the page that linked to it, when the browser said.
          </p>
          <table className="t" aria-label="Pages not found" aria-describedby="notfound-legend">
            <thead>
              <tr>
                <th scope="col">Address</th>
                <th scope="col" className="r">
                  Visits
                </th>
                <th scope="col">Last time</th>
                <th scope="col">Came from</th>
              </tr>
            </thead>
            <tbody>
              {nf.urls.map((u) => (
                <tr key={u.id}>
                  <td className="m cut">{u.url}</td>
                  <td className="r">{u.hits}</td>
                  <td className="dim">{u.last_seen}</td>
                  <td className="dim cut">{u.referrer || "not known"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {se && (se.top_searches.length > 0 || se.zero_result_queries.length > 0) && (
        <section aria-label="Searches">
          <h2 className="sect">What visitors search for</h2>
          <ul className="plain">
            {se.top_searches.map((q) => (
              <li key={q.query} className="row">
                <span className="grow">{q.query}</span>
                <span className="dim">{q.searches} times</span>
              </li>
            ))}
            {se.zero_result_queries.map((q) => (
              <li key={`0${q.query}`} className="row">
                <span className="grow">{q.query}</span>
                <span className="tag warning">Found nothing, {q.searches} times</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {lo && lo.top_ips.length > 0 && (
        <section aria-label="Logins">
          <h2 className="sect">Failed logins</h2>
          <p className="dim">
            Most tried names: {lo.top_usernames.map((u) => `${u.value} (${u.attempts})`).join(", ") || "none"}. Most active addresses:{" "}
            {lo.top_ips.map((u) => `${u.value} (${u.attempts})`).join(", ")}. Lockdown is {lo.lockdown_enabled ? "on" : "off"}.
          </p>
        </section>
      )}
      {tf && (
        <section aria-label="Two-factor sign-in">
          <h2 className="sect">Two-factor sign-in</h2>
          <p className="dim">
            {tf.enforcement.enabled ? `Required for ${tf.enforcement.roles.join(", ") || "no roles"}.` : "Not required for anyone."}{" "}
            {tf.roles.map((r) => `${r.role}: ${r.with_2fa} of ${r.users}`).join(", ")}
          </p>
        </section>
      )}
    </>
  );
}
