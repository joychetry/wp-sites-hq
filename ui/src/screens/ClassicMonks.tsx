// SPDX-License-Identifier: GPL-3.0-or-later
// Classic Monks on one site: its features, the settings it lets WP Sites HQ change,
// its activity log with undo, and changes waiting for approval (plan Phase 4).
import "../styles/screens/classic-monks.css";
import { Blocked, Empty as EmptyState, Skeleton, toast } from "../components/feedback";
import { Page, Toolbar } from "../components/page";
import { Select, NumberInput, Tabs, SearchInput } from "../components/controls";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, cmBlocked, hasTool, pluginName, useInventory, type Activity, type ActivityRow, type Approval, type CmReports, type FeatureGroup, type Setting, type Site } from "../api";
import { SiteTile } from "../components/SiteTile";
import { Button, Glyph, Icon, Status } from "../components/ui";
import { day, dayTime } from "../format";

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

/** Who made a change, as the log names them: changes this app made are yours, also from before
 * its rename (older rows say Monks Central). */
export const whoOf = (who: string) => (/^(WP Sites HQ|Monks Central)$/.test(who) ? "You" : who || "Not known");
const initials = (who: string) =>
  who
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";

/** What a waiting change acts on: the site's own name for it, else the id in the tool's arguments. */
export function targetOf(a: Approval): string {
  const p = a.preview ?? {};
  const name = [p.title, p.display_name, p.name, p.username].find((v) => typeof v === "string" && v.trim());
  if (name) return `“${name}”`;
  const args = a.input ?? {};
  const ids: [string, string][] = [["post_id", "post"], ["user_id", "user"], ["comment_id", "comment"], ["term_id", "term"], ["plugin", "plugin"], ["theme", "theme"], ["id", "number"]];
  const hit = ids.find(([k]) => ["string", "number"].includes(typeof args[k]));
  return hit ? `${hit[1]} ${args[hit[0]]}` : "";
}

const firstCm = (sites: Site[]) => (sites.find((s) => !cmBlocked(s)) ?? sites[0])?.id ?? null;
const suffix = (s: Site) => (cmBlocked(s) ? " (can't change here)" : "");

// shortcut: the next ClassicMonks opens on this site's waiting changes (set by the AI page's link), upgrade to App state if more pages need it.
let start: number | null = null;
export const showApprovals = (siteId: number) => {
  start = siteId;
};

export function ClassicMonks({ sites, onAi }: { sites: Site[]; onAi?: () => void }) {
  const [initial] = useState(() => (sites.some((s) => s.id === start) ? start : null));
  useEffect(() => {
    start = null;
  }, []);
  const [siteId, setSiteId] = useState<number | null>(() => initial ?? firstCm(sites));
  const site = sites.find((s) => s.id === siteId) ?? sites.find((s) => s.id === firstCm(sites)) ?? null;
  const blocked = site ? cmBlocked(site) : null;
  const [tab, setTab] = useState<Tab>(initial != null ? "approvals" : "features");
  // Bumped after an undo so the open tab reads the site again.
  const [round, setRound] = useState(0);
  const [logged, setLogged] = useState(0);
  const { inventory } = useInventory();
  // The waiting changes, read once for the tab's count, the side card and the tab itself.
  const canWait = !!site && !blocked && hasTool(site, "list-pending-approvals");
  const waiting = useRead<Approval[]>(() => (canWait ? api.approvals(site!.id) : Promise.resolve([])), [site?.id, canWait]);

  if (sites.length === 0) {
    return (
      <EmptyState picture="sites" title="No sites yet">
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
              {update && <Status pill tone="ok">{update} ready</Status>}
            </div>
            {current === "features" && (
              <p className="dim">
                Each change applies to the site at once and is logged, so you can undo it from Activity. Locked features (security and login) change only in
                WordPress, so a mistake here can't lock you out.
              </p>
            )}
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
        <label className="row" data-tip={site ? `${site.name}${suffix(site)}` : undefined}>
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
                {suffix(s)}
              </option>
            ))}
          </Select>
        </label>
      </Toolbar>
      {!blocked && site && (
        <Tabs
          label="Show"
          idBase="cm"
          tabs={tools.map(([id, label]) => ({ id, label, count: id === "approvals" ? count : undefined }))}
          value={current}
          onChange={(t) => {
            setTab(t);
          }}
        />
      )}
      <div role={blocked || !site ? undefined : "tabpanel"} id="cm-panel" aria-labelledby={blocked || !site ? undefined : `cm-tab-${current}`}>
        {blocked || !site ? (
          <section className="card">
            {site && blocked && <Blocked site={site} reason={blocked} title={site.sign_in_again ? undefined : `Classic Monks can't be changed on ${site.name}`} />}
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
              <Approvals key={site.id} site={site} onDone={setDone} read={waiting} onAi={onAi} />
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
      <EmptyState alert title={`${what} didn't load`} action={<Button onClick={retry}>Try again</Button>}>
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

function Empty({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <EmptyState title={title} action={action}>
        {children}
      </EmptyState>
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
  // Search looks inside the chosen section; the count is always the whole site.
  const inGroup = data.filter((g) => !group || g.key === group);
  const groups = words
    ? [{ key: "", label: "Matching", toggles: inGroup.flatMap((g) => g.toggles).filter((t) => `${t.label} ${t.name} ${t.description}`.toLowerCase().includes(words)) }]
    : inGroup;
  const every = data.flatMap((g) => g.toggles);
  const on = every.filter((t) => t.on).length;
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
          <Select className="input sm" aria-label="Section" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">All sections</option>
            {data.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label} ({g.toggles.length})
              </option>
            ))}
          </Select>
        </label>
        <SearchInput aria-label="Find a feature" placeholder="Find a feature" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <span className="end dim" role="status">
          <b>{on}</b> of {every.length} turned on
        </span>
      </Toolbar>
      {groups.every((g) => g.toggles.length === 0) ? (
        <Empty title="No feature matches" action={<Button onClick={() => setTyped("")}>Clear search</Button>}>
          <p>{group ? "Try another word, or look in All sections." : "Try another word."}</p>
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
                        aria-describedby={t.description ? `fd-${t.name}` : undefined}
                        onChange={() => flip(t.name, t.label, !t.on)}
                      />
                      <span className="what">
                        <label htmlFor={`f-${t.name}`}>{t.label}</label>
                        {t.description && <small id={`fd-${t.name}`}>{t.description}</small>}
                      </span>
                      {t.locked && (
                        <span className="tag" data-tip="Change it in the site's WordPress dashboard, so a mistake here can't lock you out.">
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

/** A setting's raw option, in words: "default" is WordPress's own, an empty one was never set. */
const OPTION_WORD: Record<string, string> = { default: "WordPress default", "": "Not set" };
const optionWord = (o: string) => OPTION_WORD[o] ?? o.charAt(0).toUpperCase() + o.slice(1);

function Settings({ site, onDone, round }: Part) {
  const { data, error, load } = useRead<Setting[]>(() => api.settings(site.id), [site.id, round]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <Failed what="Classic Monks' settings" error={error} retry={load} />;
  if (!data) return <Loading label={`Reading Classic Monks' settings on ${site.name}…`} />;
  if (data.length === 0)
    return (
      <Empty title="Nothing to change here">
        <p>This Classic Monks lets WP Sites HQ change no settings. Its features are under Features.</p>
      </Empty>
    );
  const valueOf = (s: Setting) => edits[s.name] ?? (s.value == null ? "" : String(s.value));
  const save = async (s: Setting) => {
    const raw = valueOf(s);
    const value = s.control === "number" ? Number(raw) : raw;
    setBusy(s.name);
    try {
      const undo = await api.setSetting(site.id, s.name, value);
      onDone({ text: `Set ${s.label} to ${s.control === "select" ? optionWord(raw) : raw} on ${site.name}.`, undo, ok: true });
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
              <b id={`set-${s.name}`}>{s.label}</b>
              <div className="row">
                {s.control === "select" ? (
                  <Select className="input" aria-labelledby={`set-${s.name}`} value={valueOf(s)} onChange={(e) => setEdits({ ...edits, [s.name]: e.target.value })}>
                    {!s.options.includes(valueOf(s)) && <option value={valueOf(s)}>{optionWord(valueOf(s))}</option>}
                    {s.options.map((o) => (
                      <option key={o} value={o}>
                        {optionWord(o)}
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
                <Button kind={changed ? "soft" : undefined} disabled={!changed || busy === s.name} aria-label={`Save ${s.label}`} onClick={() => save(s)}>
                  {busy === s.name ? "Saving…" : "Save"}
                  {changed && <Glyph name="check" />}
                </Button>
              </div>
              {s.description && <small>{s.description}</small>}
            </li>,
          ];
        })}
      </ul>
      <p className="card-foot note" id="settings-legend">
        The settings Classic Monks lets WP Sites HQ change, each saved on its own. Everything else stays in WordPress.
      </p>
    </section>
  );
}

/** A status word with its icon; waiting for approval gets the clock, as in the waiting card. `small`: the icon alone, the word in a tip. */
function StatusOf({ status, small }: { status: string; small?: boolean }) {
  const [word, tone] = STATUS_WORD[status] ?? [status, "unknown"];
  const icon = status === "pending" ? <Glyph name="clock" /> : <Icon tone={tone} />;
  return small ? (
    <span className={`st ${tone}`} data-tip={word}>
      {icon}
      <span className="sr-only">{word}</span>
    </span>
  ) : status === "pending" ? (
    <span className={`st ${tone}`}>
      {icon}
      {word}
    </span>
  ) : (
    <Status tone={tone}>{word}</Status>
  );
}

/** One logged change: who made it, what changed and when, then Undo or what became of it. `small` (the side card) keeps it to one line each. */
function Change({ row, busy, onUndo, small }: { row: ActivityRow; busy: boolean; onUndo: () => void; small?: boolean }) {
  const who = whoOf(row.who);
  const what = row.summary || toolLabel(row.tool);
  const when = dayTime(row.time) || row.time;
  const undo = `Undo ${what} from ${when}`;
  return (
    <li className="fix">
      <span className={`av ${who === "You" ? "me" : ""}`} aria-hidden="true">
        {who === "You" ? "You" : initials(who)}
      </span>
      <div>
        <b data-tip={small ? what : undefined}>{what}</b>
        <span data-tip={small ? `${who} · ${when}` : undefined}>
          {who} · {when}
        </span>
      </div>
      {row.can_undo ? (
        small ? (
          <button type="button" className="icon-btn" disabled={busy} aria-label={undo} data-tip="Undo" onClick={onUndo}>
            <Glyph name="undo" />
          </button>
        ) : (
          <Button small className="ghost" disabled={busy} aria-label={undo} onClick={onUndo}>
            {busy ? "Undoing…" : "Undo"}
            <Glyph name="undo" />
          </Button>
        )
      ) : (
        <StatusOf status={row.status} small={small} />
      )}
    </li>
  );
}

/** Undo one logged change at once, as the toast's Undo does: an undo is itself logged and can be undone. */
function useUndo(site: Site, onDone: (d: Done) => void) {
  const [busy, setBusy] = useState<number | null>(null);
  const undo = async (r: ActivityRow) => {
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
  return { busy, undo };
}

function Recent({ site, onDone, round, onAll }: Part & { onAll: () => void }) {
  const { data } = useRead<Activity>(() => api.activity(site.id, 1), [site.id, round]);
  const { busy, undo } = useUndo(site, onDone);
  const rows = data?.rows.slice(0, 3) ?? [];
  return (
    <section className="card" aria-labelledby="cm-recent-t">
      <div className="card-head">
        <h2 id="cm-recent-t">Latest changes</h2>
        <button type="button" className="link" onClick={onAll}>
          Open Activity
          <Glyph name="arrow" />
        </button>
      </div>
      {data && rows.length === 0 ? (
        <p className="quiet">Nothing changed through Classic Monks yet.</p>
      ) : (
        <ul className="fixes recent" aria-label="Latest changes">
          {rows.map((r) => (
            <Change key={r.id} row={r} busy={busy === r.id} onUndo={() => undo(r)} small />
          ))}
        </ul>
      )}
    </section>
  );
}

function Log({ site, onDone, round }: Part) {
  const [page, setPage] = useState(1);
  const { data, error, load } = useRead<Activity>(() => api.activity(site.id, page), [site.id, page, round]);
  const { busy, undo } = useUndo(site, onDone);
  if (error) return <Failed what="The activity log" error={error} retry={load} />;
  if (!data) return <Loading label={`Reading the activity log on ${site.name}…`} />;
  if (data.rows.length === 0)
    return (
      <Empty title="Nothing in the log yet">
        <p>Changes made through Classic Monks, by WP Sites HQ or an AI app, show here.</p>
      </Empty>
    );
  return (
    <section className="card" aria-label={`Activity on ${site.name}`}>
      <ul className="fixes" aria-label="Activity" aria-describedby="activity-legend">
        {data.rows.map((r) => (
          <Change key={r.id} row={r} busy={busy === r.id} onUndo={() => undo(r)} />
        ))}
      </ul>
      {data.pages > 1 && (
        <div className="card-foot pager">
          <span>
            Page {data.page} of {data.pages}, {data.total} {data.total === 1 ? "change" : "changes"}
          </span>
          <Button small disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <Glyph name="arrow-left" />
            Previous page
          </Button>
          <Button small disabled={page >= data.pages} onClick={() => setPage(page + 1)}>
            Next page
            <Glyph name="arrow" />
          </Button>
        </div>
      )}
      <p className="card-foot note" id="activity-legend">
        Newest first, in the site's own time. Undo puts back what a change replaced; not every change can be undone.
      </p>
    </section>
  );
}

/** How long a waiting change has left: plain at first, amber under 5 minutes, Expired at the end. */
function Left({ seconds }: { seconds: number }) {
  if (seconds <= 0) return <Status tone="unknown">Expired</Status>;
  const min = Math.max(1, Math.round(seconds / 60));
  return min < 5 ? <Status tone="warning">{min} min left</Status> : <span>{min} min left</span>;
}

function Approvals({ site, onDone, read, onAi }: Part & { read: Read<Approval[]>; onAi?: () => void }) {
  const { data, error, load } = read;
  // Approving happens in the browser: coming back to the app reads the list again.
  useEffect(() => {
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);
  if (error) return <Failed what="The changes waiting for approval" error={error} retry={load} />;
  if (!data) return <Loading label={`Reading ${site.name}…`} />;
  const toAi = onAi && (
    <>
      {" "}
      Changes on several sites wait as plans on the AI page.{" "}
      <button type="button" className="link" onClick={onAi}>
        Open AI
        <Glyph name="arrow" />
      </button>
    </>
  );
  if (data.length === 0)
    return (
      <Empty title="Nothing is waiting for approval" action={<Button onClick={load}>Check again</Button>}>
        <p>
          When an AI app asks to change {site.name}, the request waits here until you approve it on the site.
          {toAi}
        </p>
      </Empty>
    );
  const what = (a: Approval) => [toolLabel(a.tool), targetOf(a)].filter(Boolean).join(" ");
  const open = (a: Approval) =>
    api.openApproval(site.id, a.id).then(
      () => onDone({ text: `Opened the approval page for ${what(a)} on ${site.name} in your browser.`, undo: null, ok: true }),
      (e) => onDone({ text: String(e), undo: null, ok: false }),
    );
  return (
    <section className="card" aria-label={`Changes waiting on ${site.name}`}>
      <div className="card-head">
        <span className="dim">
          {data.length === 1 ? "1 change waits" : `${data.length} changes wait`} on {site.name}
        </span>
        <Button small onClick={load}>
          Check again
          <Glyph name="refresh" />
        </Button>
      </div>
      <ul className="fixes" aria-label="Waiting for approval" aria-describedby="approvals-legend">
        {data.map((a) => (
          <li key={a.id} className="fix">
            <span className="tile sm warning">
              <Glyph name="clock" />
            </span>
            <div>
              <b>{what(a)}</b>
              <span>
                On {site.name} · Asked by {a.who || "Not known"} · {dayTime(a.time) || a.time} · <Left seconds={a.expires_in} />
              </span>
            </div>
            <Button small aria-label={`Approve or decline on the site: ${what(a)}`} disabled={a.expires_in <= 0} onClick={() => open(a)}>
              Approve or decline on the site
              <Glyph name="external" />
            </Button>
          </li>
        ))}
      </ul>
      <p className="card-foot note" id="approvals-legend">
        Changes AI apps asked for on this site. You decide each one on the site itself, so an app can never approve its own change.
        {toAi}
      </p>
    </section>
  );
}

const pct = (part: number, all: number) => (all ? `${Math.round((part / all) * 100)}%` : "no users");
const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;
/** "administrator" -> "Administrators". */
const roles = (role: string) => `${role.charAt(0).toUpperCase()}${role.slice(1).replace(/_/g, " ")}s`;
/** The site a visitor came from, without the noise of the full address. */
const host = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
};
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
      <h2>What Classic Monks saw on {site.name}</h2>
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
        <EmptyState alert title="The reports didn't load" action={<Button onClick={load}>Try again</Button>}>
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
                {um.has_results ? `files (${mb(um.listed_size)})` : "Not scanned yet"}
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
            <colgroup>
              <col className="c-fill" />
              <col className="c-num" />
              <col className="c-date" />
              <col className="c-wide" />
            </colgroup>
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
                  <td className="m cut" data-tip={u.url}>
                    {u.url}
                  </td>
                  <td className="r">{u.hits}</td>
                  <td className="dim" data-tip={dayTime(u.last_seen) || undefined}>
                    {day(u.last_seen) || u.last_seen}
                  </td>
                  <td className="dim cut" data-tip={u.referrer || undefined}>
                    {u.referrer ? host(u.referrer) : "Not known"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="card-foot note" id="notfound-legend">
            Addresses visitors asked for that the site doesn't have. Came from is the site that linked to it, when the browser said.
          </p>
        </section>
      )}
      {se && (se.top_searches.length > 0 || se.zero_result_queries.length > 0) && (
        <section className="card" aria-label="Searches">
          <div className="card-head">
            <h2>What visitors search for</h2>
          </div>
          <ul className="fixes">
            {[...se.top_searches.map((q) => ({ ...q, none: false })), ...se.zero_result_queries.map((q) => ({ ...q, none: true }))].map((q) => (
              <li key={`${q.none}${q.query}`} className="fix two">
                <b>{q.query}</b>
                <span>
                  {q.searches === 1 ? "1 search" : `${q.searches} searches`}
                  {q.none && ", found nothing"}
                </span>
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
          <dl className="card-body kv">
            <dt>Most tried names</dt>
            <dd>{lo.top_usernames.map((u) => `${u.value} (${u.attempts})`).join(", ") || "None"}</dd>
            <dt>Most active addresses</dt>
            <dd>{lo.top_ips.map((u) => `${u.value} (${u.attempts})`).join(", ")}</dd>
            <dt>Login Lockdown</dt>
            <dd>{lo.lockdown_enabled ? "On" : "Off"}</dd>
          </dl>
        </section>
      )}
      {tf && (
        <section className="card" aria-label="Two-factor sign-in">
          <div className="card-head">
            <h2>Two-factor sign-in</h2>
          </div>
          <p className="card-body dim">
            {tf.enforcement.enabled ? `Required for ${tf.enforcement.roles.map((r) => roles(r).toLowerCase()).join(", ") || "no roles"}.` : "Not required for anyone."}{" "}
            {tf.roles.map((r) => `${roles(r.role)}: ${r.with_2fa} of ${r.users}`).join(", ")}
          </p>
        </section>
      )}
    </>
  );
}
