// SPDX-License-Identifier: GPL-3.0-or-later
// Classic Monks on one site: its features, the settings it lets Monks Central change,
// its activity log with undo, and changes waiting for approval (plan Phase 4).
import "../styles/screens/classic-monks.css";
import { Empty as EmptyState, Skeleton, toast } from "../components/feedback";
import { Page, Toolbar } from "../components/page";
import { Select, NumberInput, Tabs, SearchInput } from "../components/controls";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, cmBlocked, hasTool, pluginName, useInventory, type Activity, type ActivityRow, type Approval, type CmReports, type FeatureGroup, type Setting, type Site } from "../api";
import { SiteTile } from "../components/SiteTile";
import { Button, Glyph, Status } from "../components/ui";
import { Sheet } from "../components/Sheet";

type Tab = "features" | "settings" | "activity" | "approvals" | "reports";
const TABS: [Tab, string, string][] = [
  ["features", "Features", "get-features"],
  ["settings", "Settings", "get-settings-schema"],
  ["activity", "Activity", "list-ai-activity"],
  ["approvals", "Waiting for approval", "list-pending-approvals"],
  ["reports", "Reports", "get-404-report"],
];

/** A change on the site, with the activity row that reverses it. */
type Done = { text: string; undo: number | null; ok: boolean; undone?: boolean };

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

const DAYTIME = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
/** The site's "2026-10-28 09:30:12" as "Today, 09:30", "Yesterday, 16:12" or "Oct 24, 14:20". */
export function when(time: string, now = new Date()): string {
  const at = new Date(time.replace(" ", "T"));
  if (Number.isNaN(at.getTime())) return time;
  const hm = time.slice(11, 16);
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(at.toDateString()).getTime()) / 86_400_000);
  return `${days === 0 ? "Today" : days === 1 ? "Yesterday" : DAYTIME.format(at)}, ${hm}`;
}

/** Who made a change, as the log names them: changes Monks Central made are yours. */
const whoOf = (who: string) => (who === "Monks Central" ? "You" : who || "Not known");
const initials = (who: string) =>
  who
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";

const firstCm = (sites: Site[]) => (sites.find((s) => !cmBlocked(s)) ?? sites[0])?.id ?? null;

export function ClassicMonks({ sites }: { sites: Site[] }) {
  const [siteId, setSiteId] = useState<number | null>(() => firstCm(sites));
  const site = sites.find((s) => s.id === siteId) ?? sites.find((s) => s.id === firstCm(sites)) ?? null;
  const blocked = site ? cmBlocked(site) : null;
  const [tab, setTab] = useState<Tab>("features");
  // Bumped after an undo so the open tab reads the site again.
  const [round, setRound] = useState(0);
  const [logged, setLogged] = useState(0);
  const { inventory } = useInventory();
  // The waiting changes, read once for the tab's count, the side card and the tab itself.
  const canWait = !!site && !blocked && hasTool(site, "list-pending-approvals");
  const waiting = useRead<Approval[]>(() => (canWait ? api.approvals(site!.id) : Promise.resolve([])), [site?.id, canWait]);

  if (sites.length === 0) {
    return (
      <EmptyState picture="sites" title="No sites yet.">
        <p>Add a site with Classic Monks on Sites, then its features show here.</p>
      </EmptyState>
    );
  }

  const tools = TABS.filter(([, , tool]) => site && hasTool(site, tool));
  const current = tools.some(([t]) => t === tab) ? tab : "features";
  const count = canWait ? (waiting.data?.length ?? 0) : 0;
  // Results float as toasts, so nothing above the list moves under the pointer.
  const setDone = (done: Done) => {
    const on = site;
    const undo = async () => {
      try {
        await api.undo(on!.id, done.undo!);
        toast(`Undone: ${done.text}`);
        setRound((r) => r + 1);
        setLogged((n) => n + 1);
      } catch (e) {
        toast(String(e), { tone: "danger" });
      }
    };
    toast(done.text, { tone: done.ok ? "ok" : "danger", undo: on && done.undo != null ? undo : undefined });
    // The log changed: the recent changes and Activity read it again.
    if (done.ok) setLogged((n) => n + 1);
    if (done.undone) setRound((r) => r + 1);
  };
  const update = site && inventory?.get(site.id)?.inventory.plugins.find((p) => p.id.startsWith("classic-monks/"))?.update;

  // The site's own cards beside every tab: its Classic Monks, what waits, recent changes.
  const side =
    !blocked && site ? (
      <div className="stack cm-side">
        <section className="card" aria-label={`Classic Monks on ${site.name}`}>
          <div className="card-body">
            <div className="cm-site">
              <SiteTile site={site} />
              <div>
                <b>{site.name}</b>
                <small>{site.cm_version ? `${pluginName(site)} ${site.cm_version}` : pluginName(site)}</small>
              </div>
              {update && <span className="tag ok">{update} ready</span>}
            </div>
            <p className="dim">
              Each change applies to the site at once and is logged, so you can undo it from Activity. Locked features (security and login) change only in
              WordPress, so a mistake here can't lock you out.
            </p>
          </div>
        </section>
        {count > 0 && current !== "approvals" && (
          <section className="card cm-wait" aria-labelledby="cm-wait-t">
            <div className="card-body">
              <div className="row">
                <span className="tile sm warning">
                  <Glyph name="clock" />
                </span>
                <b id="cm-wait-t">
                  {count === 1 ? "1 change waits" : `${count} changes wait`} for approval
                </b>
              </div>
              <p className="dim">Changes AI apps asked for. Approve or decline each one on the site itself.</p>
              <div>
                <Button small onClick={() => setTab("approvals")}>
                  See what's waiting
                </Button>
              </div>
            </div>
          </section>
        )}
        {current !== "activity" && hasTool(site, "list-ai-activity") && (
          <Recent key={site.id} site={site} onDone={setDone} round={round + logged} onAll={() => setTab("activity")} />
        )}
      </div>
    ) : undefined;

  return (
    <Page className="cm" side={side}>
      <Toolbar>
        <label className="row">
          <span className="label">Site</span>
          <Select
            className="input"
            aria-label="Site"
            value={site?.id ?? ""}
            onChange={(e) => {
              setSiteId(Number(e.target.value));
            }}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                <SiteTile site={s} size="sm" />
                {s.name}
                {cmBlocked(s) ? (s.mode === "basic" ? " (no Classic Monks)" : " (not available)") : ""}
              </option>
            ))}
          </Select>
        </label>
      </Toolbar>
      {!blocked && site && (
        <Tabs
          label="Show"
          idBase="cm"
          tabs={tools.map(([id, label]) => ({
            id,
            text: label,
            label:
              id === "approvals" && count > 0 ? (
                <>
                  {label}
                  <span className="cm-n" aria-hidden="true">
                    {count}
                  </span>
                </>
              ) : (
                label
              ),
          }))}
          value={current}
          onChange={(t) => {
            setTab(t);
          }}
        />
      )}
      <div role={blocked || !site ? undefined : "tabpanel"} id="cm-panel" aria-labelledby={blocked || !site ? undefined : `cm-tab-${current}`}>
        {blocked || !site ? (
          <section className="card">
            <EmptyState title={`Classic Monks isn't available on ${site?.name ?? "this site"}.`}>
              <p>{blocked}</p>
            </EmptyState>
          </section>
        ) : (
          <div className="stack">
            {current === "features" ? (
              <Features key={site.id} site={site} onDone={setDone} round={round} />
            ) : current === "settings" ? (
              <Settings key={site.id} site={site} onDone={setDone} round={round} />
            ) : current === "activity" ? (
              <Log key={site.id} site={site} onDone={setDone} round={round + logged} />
            ) : current === "reports" ? (
              <Reports key={site.id} site={site} />
            ) : (
              <Approvals key={site.id} site={site} onDone={setDone} read={waiting} />
            )}
          </div>
        )}
      </div>
    </Page>
  );
}

type Part = { site: Site; onDone: (d: Done) => void; round?: number };
type Read<T> = { data: T | null; error: string | null; load: () => void };

/** Reads once per site, with Try again. */
function useRead<T>(read: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    // Through a promise, so a read that throws at once shows as an error too.
    Promise.resolve().then(read).then(setData, (e) => setError(String(e)));
    // The caller lists what the read depends on.
  }, deps);
  useEffect(load, [load]);
  return { data, setData, error, load };
}

function Failed({ what, error, retry }: { what: string; error: string; retry: () => void }) {
  return (
    <section className="card">
      <EmptyState alert title={`${what} didn't load.`} action={<Button onClick={retry}>Try again</Button>}>
        <p>{error}</p>
      </EmptyState>
    </section>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <section className="card">
      <Skeleton label={label} />
    </section>
  );
}

function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card">
      <EmptyState title={title}>{children}</EmptyState>
    </section>
  );
}

function Features({ site, onDone, round }: Part) {
  const { data, setData, error, load } = useRead<FeatureGroup[]>(() => api.features(site.id), [site.id, round]);
  const [group, setGroup] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <Failed what="Classic Monks' features" error={error} retry={load} />;
  if (!data) return <Loading label={`Reading Classic Monks on ${site.name}…`} />;
  const words = typed.trim().toLowerCase();
  const groups = words
    ? [{ key: "", label: "Matching", toggles: data.flatMap((g) => g.toggles).filter((t) => `${t.label} ${t.name} ${t.description}`.toLowerCase().includes(words)) }]
    : data.filter((g) => !group || g.key === group);
  const on = groups.flatMap((g) => g.toggles).filter((t) => t.on).length;
  const flip = async (name: string, label: string, on: boolean) => {
    // Ignored while one changes, rather than disabled, so the switch keeps keyboard focus.
    if (busy) return;
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
      <Toolbar>
        <label className="row">
          <span className="label">Section</span>
          <Select className="input sm" aria-label="Section" value={group} disabled={!!words} onChange={(e) => setGroup(e.target.value)}>
            <option value="">All sections</option>
            {data.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label} ({g.toggles.length})
              </option>
            ))}
          </Select>
        </label>
        <SearchInput className="sm srch" aria-label="Find a feature" placeholder="Find a feature" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <span className="end dim" role="status">
          <b>{on}</b> switched on
        </span>
      </Toolbar>
      {groups.every((g) => g.toggles.length === 0) ? (
        <Empty title="No feature matches.">
          <p>Try another word.</p>
        </Empty>
      ) : (
        <section className="card" aria-label={`Features on ${site.name}`}>
          <div className="card-body feats">
            {groups.map((g) => (
              <div key={g.key} className="feat-group">
                {!words && <h2 className="label">{g.label}</h2>}
                <ul className="feat-list" aria-label={words ? "Matching features" : `${g.label} features`}>
                  {g.toggles.map((t) => (
                    <li key={t.name}>
                      <input
                        type="checkbox"
                        role="switch"
                        id={`f-${t.name}`}
                        checked={t.on}
                        disabled={t.locked}
                        aria-busy={busy === t.name}
                        aria-describedby={t.description || t.section ? `fd-${t.name}` : undefined}
                        onChange={() => flip(t.name, t.label, !t.on)}
                      />
                      <span className="what">
                        <label htmlFor={`f-${t.name}`}>{t.label}</label>
                        {(t.description || t.section) && <small id={`fd-${t.name}`}>{t.description || t.section}</small>}
                      </span>
                      {t.locked && (
                        <span className="tag" data-tip="Changes only in WordPress, so a mistake here can't lock you out.">
                          <Glyph name="lock" />
                          Locked
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function Settings({ site, onDone, round }: Part) {
  const { data, error, load } = useRead<Setting[]>(() => api.settings(site.id), [site.id, round]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <Failed what="Classic Monks' settings" error={error} retry={load} />;
  if (!data) return <Loading label={`Reading Classic Monks' settings on ${site.name}…`} />;
  if (data.length === 0)
    return (
      <Empty title="Nothing to change here.">
        <p>This Classic Monks lets Monks Central change no settings. Its features are under Features.</p>
      </Empty>
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
    <section className="card" aria-label={`Classic Monks settings on ${site.name}`}>
      <ul className="sets" aria-label="Settings" aria-describedby="settings-legend">
        {data.map((s) => {
          const head = s.tab !== tab ? (tab = s.tab) : null;
          // A number box with letters in it would save as nothing at all.
          const changed = valueOf(s) !== (s.value == null ? "" : String(s.value)) && (s.control !== "number" || Number.isFinite(Number(valueOf(s))));
          return [
            head && (
              <li key={`h-${head}`} className="head">
                <h2 className="label">{head}</h2>
              </li>
            ),
            <li key={s.name}>
              <div className="set-field">
                <b id={`set-${s.name}`}>{s.label}</b>
                {s.control === "select" ? (
                  <Select className="input" aria-labelledby={`set-${s.name}`} value={valueOf(s)} onChange={(e) => setEdits({ ...edits, [s.name]: e.target.value })}>
                    {!s.options.includes(valueOf(s)) && <option value={valueOf(s)}>{valueOf(s) || "not set"}</option>}
                    {s.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <NumberInput
                    className="input"
                    aria-labelledby={`set-${s.name}`}
                    min={s.min ?? undefined}
                    max={s.max ?? undefined}
                    step={s.step ?? undefined}
                    value={valueOf(s)}
                    onChange={(e) => setEdits({ ...edits, [s.name]: e.target.value })}
                  />
                )}
                {(s.description || s.section) && <small>{s.description || s.section}</small>}
              </div>
              <Button kind={changed ? "soft" : undefined} disabled={!changed || busy === s.name} aria-label={`Save ${s.label}`} onClick={() => save(s)}>
                {busy === s.name ? "Saving…" : `Save ${s.label}`}
                {changed && <Glyph name="check" />}
              </Button>
            </li>,
          ];
        })}
      </ul>
      <p className="card-foot note" id="settings-legend">
        The settings Classic Monks lets Monks Central change, each saved on its own. Everything else stays in WordPress.
      </p>
    </section>
  );
}

/** One logged change: who made it, what changed and when, then Undo or what became of it. */
function Change({ row, busy, onUndo }: { row: ActivityRow; busy: boolean; onUndo: () => void }) {
  const [word, tone] = STATUS_WORD[row.status] ?? [row.status, "unknown"];
  const who = whoOf(row.who);
  const what = row.summary || toolLabel(row.tool);
  return (
    <li className="fix">
      <span className={`av ${who === "You" ? "me" : ""}`} aria-hidden="true">
        {who === "You" ? "You" : initials(who)}
      </span>
      <div>
        <b>{what}</b>
        <span>
          {who} · {when(row.time)}
        </span>
      </div>
      {row.can_undo ? (
        <Button small className="ghost" disabled={busy} aria-label={`Undo ${what} at ${row.time}`} onClick={onUndo}>
          {busy ? "Undoing…" : "Undo"}
          <Glyph name="undo" />
        </Button>
      ) : (
        <Status tone={tone}>{word}</Status>
      )}
    </li>
  );
}

/** Undo one logged change once you say so (the design's "Undo this change?"); the screen reads the site again. */
function useUndo(site: Site, onDone: (d: Done) => void) {
  const [busy, setBusy] = useState<number | null>(null);
  const [asking, setAsking] = useState<ActivityRow | null>(null);
  const run = async (r: ActivityRow) => {
    setAsking(null);
    setBusy(r.id);
    try {
      await api.undo(site.id, r.id);
      onDone({ text: `Undone: ${r.summary || toolLabel(r.tool)} on ${site.name}.`, undo: null, ok: true, undone: true });
    } catch (e) {
      onDone({ text: String(e), undo: null, ok: false });
    } finally {
      setBusy(null);
    }
  };
  const ask = asking && (
    <Sheet
      dialog
      title={`Undo this change on ${site.name}?`}
      intro="Classic Monks puts back what this change replaced, and logs the undo too."
      onClose={() => setAsking(null)}
      footer={
        <>
          <Button onClick={() => setAsking(null)}>Keep it</Button>
          <Button kind="primary" className="disc" onClick={() => run(asking)}>
            Undo
            <span className="btn-disc">
              <Glyph name="undo" />
            </span>
          </Button>
        </>
      }
    >
      <dl className="kv cm-undo">
        <dt>Change</dt>
        <dd>{asking.summary || toolLabel(asking.tool)}</dd>
        <dt>Made by</dt>
        <dd>
          {whoOf(asking.who)} · {when(asking.time)}
        </dd>
      </dl>
    </Sheet>
  );
  return { busy, undo: setAsking, ask };
}

function Recent({ site, onDone, round, onAll }: Part & { onAll: () => void }) {
  const { data } = useRead<Activity>(() => api.activity(site.id, 1), [site.id, round]);
  const { busy, undo, ask } = useUndo(site, onDone);
  const rows = data?.rows.slice(0, 3) ?? [];
  return (
    <section className="card" aria-labelledby="cm-recent-t">
      <div className="card-head">
        <h2 id="cm-recent-t">Recent changes</h2>
        <button type="button" className="link" onClick={onAll}>
          Activity
          <Glyph name="arrow" />
        </button>
      </div>
      {data && rows.length === 0 ? (
        <p className="quiet">Nothing changed through Classic Monks yet.</p>
      ) : (
        <ul className="fixes recent" aria-label="Recent changes">
          {rows.map((r) => (
            <Change key={r.id} row={r} busy={busy === r.id} onUndo={() => undo(r)} />
          ))}
        </ul>
      )}
      {ask}
    </section>
  );
}

function Log({ site, onDone, round }: Part) {
  const [page, setPage] = useState(1);
  const { data, error, load } = useRead<Activity>(() => api.activity(site.id, page), [site.id, page, round]);
  const { busy, undo, ask } = useUndo(site, onDone);
  if (error) return <Failed what="The activity log" error={error} retry={load} />;
  if (!data) return <Loading label={`Reading the activity log on ${site.name}…`} />;
  if (data.rows.length === 0)
    return (
      <Empty title="Nothing in the log yet.">
        <p>Changes made through Classic Monks' tools, by Monks Central or an AI app, show here.</p>
      </Empty>
    );
  return (
    <section className="card" aria-label={`Activity on ${site.name}`}>
      <ul className="fixes" aria-label="Activity" aria-describedby="activity-legend">
        {data.rows.map((r) => (
          <Change key={r.id} row={r} busy={busy === r.id} onUndo={() => undo(r)} />
        ))}
      </ul>
      <div className="card-foot pager">
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
      <p className="card-foot note" id="activity-legend">
        Newest first, in the site's own time. Undo puts back what a change replaced; not every change can be undone.
      </p>
      {ask}
    </section>
  );
}

function Approvals({ site, onDone, read }: Part & { read: Read<Approval[]> }) {
  const { data, error, load } = read;
  if (error) return <Failed what="The changes waiting for approval" error={error} retry={load} />;
  if (!data) return <Loading label={`Reading ${site.name}…`} />;
  if (data.length === 0)
    return (
      <Empty title="Nothing is waiting for approval.">
        <p>When an AI app asks to change {site.name}, the request waits here until you approve it on the site.</p>
        <Button onClick={load}>Check again</Button>
      </Empty>
    );
  const open = (a: Approval) =>
    api.openApproval(site.id, a.id).then(
      () => onDone({ text: `Opened the approval page for ${toolLabel(a.tool)} on ${site.name} in your browser.`, undo: null, ok: true }),
      (e) => onDone({ text: String(e), undo: null, ok: false }),
    );
  return (
    <section className="card" aria-label={`Changes waiting on ${site.name}`}>
      <ul className="fixes" aria-label="Waiting for approval" aria-describedby="approvals-legend">
        {data.map((a) => (
          <li key={a.id} className="fix">
            <span className="tile sm warning">
              <Glyph name="clock" />
            </span>
            <div>
              <b>{toolLabel(a.tool)}</b>
              <span>
                Asked by {a.who || "not known"} · {when(a.time)} · {Math.max(1, Math.round(a.expires_in / 60))} min left
              </span>
            </div>
            <Button small aria-label={`Approve or decline on the site: ${toolLabel(a.tool)}`} onClick={() => open(a)}>
              Approve or decline on the site
              <Glyph name="external" />
            </Button>
          </li>
        ))}
      </ul>
      <p className="card-foot note" id="approvals-legend">
        Changes AI apps asked for. You decide each one on the site itself, so an app can never approve its own change.
      </p>
    </section>
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

/** One of the report's numbers: a mono label, the number, and what it counts. */
function Num({ label, n, tone, children }: { label: string; n: ReactNode; tone?: string; children: ReactNode }) {
  return (
    <div className="rnum">
      <h3 className="label">{label}</h3>
      <strong className={tone}>{n}</strong>
      <small>{children}</small>
    </div>
  );
}

/** Classic Monks' own reports on one site, over a period. */
function Reports({ site }: { site: Site }) {
  const [days, setDays] = useState(30);
  const { data, error, load } = useRead<CmReports>(() => api.cmReports(site.id, days), [site.id, days]);
  const head = (
    <div className="card-head">
      <h2>Module activity on {site.name}</h2>
      <div className="segmented" role="group" aria-label="Period">
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
      <section className="card" aria-label="Reports">
        {head}
        <EmptyState alert title="The reports didn't load." action={<Button onClick={load}>Try again</Button>}>
          <p>{error}</p>
        </EmptyState>
      </section>
    );
  if (!data)
    return (
      <section className="card" aria-label="Reports">
        {head}
        <Skeleton label={`Reading the reports on ${site.name}…`} rows={3} />
      </section>
    );
  const { not_found: nf, searches: se, unused_media: um, logins: lo, two_factor: tf } = data;
  const failed = data.failed;
  return (
    <>
      <section className="card" aria-label="Reports">
        {head}
        <div className="card-body">
          <div className="rnums">
            {lo && (
              <Num label="Logins blocked" n={lo.period.lockouts ?? 0} tone={lo.period.lockouts ? "warning" : undefined}>
                of {lo.period.attempts ?? 0} failed logins
              </Num>
            )}
            {nf && (
              <Num label="Pages not found" n={nf.count} tone={nf.count ? "warning" : undefined}>
                addresses
              </Num>
            )}
            {se && (
              <Num label="Searches" n={se.total_searches}>
                {se.zero_result_searches} found nothing
              </Num>
            )}
            {um && (
              <Num label="Unused media" n={um.has_results ? (um.counts.unused ?? 0) : "none"}>
                {um.has_results ? `files, ${mb(um.listed_size)} listed` : "Not scanned yet"}
              </Num>
            )}
            {tf && (
              <Num label="Two-factor" n={pct(tf.stats.users_with_2fa, tf.stats.total_users)}>
                {tf.stats.users_with_2fa} of {tf.stats.total_users} users
              </Num>
            )}
          </div>
          {failed.length > 0 && (
            <p className="callout warning">
              <Glyph name="alert" />
              <span>Not read: {failed.map(([t, why]) => `${REPORT_NAME[t] ?? t} (${why})`).join("; ")}</span>
            </p>
          )}
        </div>
      </section>
      {nf && nf.urls.length > 0 && (
        <section className="card" aria-label="Pages not found">
          <div className="card-head">
            <h2>Pages not found, most visited</h2>
          </div>
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
          <p className="card-foot note" id="notfound-legend">
            Addresses visitors asked for that the site doesn't have. Came from is the page that linked to it, when the browser said.
          </p>
        </section>
      )}
      {se && (se.top_searches.length > 0 || se.zero_result_queries.length > 0) && (
        <section className="card" aria-label="Searches">
          <div className="card-head">
            <h2>What visitors search for</h2>
          </div>
          <ul className="fixes">
            {se.top_searches.map((q) => (
              <li key={q.query} className="fix two">
                <b>{q.query}</b>
                <span>{q.searches} times</span>
              </li>
            ))}
            {se.zero_result_queries.map((q) => (
              <li key={`0${q.query}`} className="fix two">
                <b>{q.query}</b>
                <span className="tag warning">Found nothing, {q.searches} times</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {lo && lo.top_ips.length > 0 && (
        <section className="card" aria-label="Logins">
          <div className="card-head">
            <h2>Failed logins</h2>
          </div>
          <p className="card-body dim">
            Most tried names: {lo.top_usernames.map((u) => `${u.value} (${u.attempts})`).join(", ") || "none"}. Most active addresses:{" "}
            {lo.top_ips.map((u) => `${u.value} (${u.attempts})`).join(", ")}. Lockdown is {lo.lockdown_enabled ? "on" : "off"}.
          </p>
        </section>
      )}
      {tf && (
        <section className="card" aria-label="Two-factor sign-in">
          <div className="card-head">
            <h2>Two-factor sign-in</h2>
          </div>
          <p className="card-body dim">
            {tf.enforcement.enabled ? `Required for ${tf.enforcement.roles.join(", ") || "no roles"}.` : "Not required for anyone."}{" "}
            {tf.roles.map((r) => `${r.role}: ${r.with_2fa} of ${r.users}`).join(", ")}
          </p>
        </section>
      )}
    </>
  );
}
