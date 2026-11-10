// SPDX-License-Identifier: GPL-3.0-or-later
// Classic Monks on one site, laid out like its own dashboard: tabs, a rail of subtabs, cards with each
// feature's switch and its values together, and one Save for every change. Activity and the changes
// waiting for approval open as sheets; the reports sit under Core, Logs, as in the plugin.
import "../styles/screens/classic-monks.css";
import { Blocked, Empty as EmptyState, Skeleton, toast } from "../components/feedback";
import { Page, Toolbar } from "../components/page";
import { Select, NumberInput, Tabs, SearchInput } from "../components/controls";
import { Sheet } from "../components/Sheet";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, cmBlocked, hasTool, pluginName, useInventory, type Activity, type ActivityRow, type Approval, type CmCard, type CmReports, type CmSubtab, type Controls, type Setting, type Site, type Toggle } from "../api";
import { leaveGuard } from "../fleet";
import { SiteTile } from "../components/SiteTile";
import { Button, Glyph, Icon, Status } from "../components/ui";
import { day, dayTime } from "../format";

/** A change on the site, with the activity rows that reverse it (newest last). */
type Done = { text: string; undo?: number[]; ok: boolean; undone?: boolean };
type Open = "activity" | "approvals" | null;

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
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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
  const [open, setOpen] = useState<Open>(initial != null ? "approvals" : null);
  // Bumped after an undo so the controls read the site again.
  const [round, setRound] = useState(0);
  const [logged, setLogged] = useState(0);
  const { inventory } = useInventory();
  // The waiting changes, read once for the button's count and the sheet.
  const canWait = !!site && !blocked && hasTool(site, "list-pending-approvals");
  const waiting = useRead<Approval[]>(() => (canWait ? api.approvals(site!.id) : Promise.resolve([])), [site?.id, canWait]);

  if (sites.length === 0) {
    return (
      <EmptyState picture="sites" title="No sites yet">
        <p>Add a site with Classic Monks on Sites, then its features show here.</p>
      </EmptyState>
    );
  }

  const count = canWait ? (waiting.data?.length ?? 0) : 0;
  // Results float as toasts, so nothing above the controls moves under the pointer.
  const setDone = (done: Done) => {
    const on = site;
    const rows = done.undo ?? [];
    const undo = async () => {
      try {
        // Newest first, so each change puts back what the one before it left.
        for (const row of [...rows].reverse()) await api.undo(on!.id, row);
        toast(`Undone: ${done.text}`);
        setRound((r) => r + 1);
        setLogged((n) => n + 1);
      } catch (e) {
        toast(String(e), { tone: "danger" });
      }
    };
    toast(done.text, { tone: done.ok ? "ok" : "danger", undo: on && rows.length ? undo : undefined });
    // The log changed: Activity reads it again.
    if (done.ok) setLogged((n) => n + 1);
    if (done.undone) setRound((r) => r + 1);
  };
  const update = site && inventory?.get(site.id)?.inventory.plugins.find((p) => p.id.startsWith("classic-monks/"))?.update;
  // Changing site with unsaved changes asks first, as leaving the page does.
  const pick = (id: number) => (leaveGuard.ask ? leaveGuard.ask(() => setSiteId(id)) : setSiteId(id));

  return (
    <Page className="cm">
      <Toolbar>
        <label className="row" data-tip={site ? `${site.name}${suffix(site)}` : undefined}>
          <span className="label">Site</span>
          <Select className="input" aria-label="Site" value={site?.id ?? ""} onChange={(e) => pick(Number(e.target.value))}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                <SiteTile site={s} size="sm" />
                {s.name}
                {suffix(s)}
              </option>
            ))}
          </Select>
        </label>
        {site && !blocked && (
          <>
            <span className="tag">{site.cm_version ? `${pluginName(site)} ${site.cm_version}` : pluginName(site)}</span>
            {update && <Status pill tone="ok">{update} ready</Status>}
            <span className="end row">
              {hasTool(site, "list-ai-activity") && (
                <Button small onClick={() => setOpen("activity")}>
                  Activity
                  <Glyph name="history" />
                </Button>
              )}
              {canWait && (
                <Button small kind={count ? "soft" : undefined} className={count ? "waits" : undefined} onClick={() => setOpen("approvals")}>
                  Waiting for approval
                  {count > 0 && (
                    <>
                      {" "}
                      <span className="n">{count}</span>
                    </>
                  )}
                  <Glyph name="clock" />
                </Button>
              )}
            </span>
          </>
        )}
      </Toolbar>
      {blocked || !site ? (
        <section className="card">{site && blocked && <Blocked site={site} reason={blocked} title={site.sign_in_again ? undefined : `Classic Monks can't be changed on ${site.name}`} />}</section>
      ) : hasTool(site, "get-features") ? (
        <ControlsView key={site.id} site={site} onDone={setDone} round={round} />
      ) : hasTool(site, "get-404-report") ? (
        <Reports key={site.id} site={site} />
      ) : (
        <Empty title="No settings to change here">
          <p>This plugin doesn't share its settings with WP Sites HQ. Its activity and waiting changes are above.</p>
        </Empty>
      )}
      {open === "activity" && site && (
        <Sheet title="Activity" intro={`Changes made through Classic Monks on ${site.name}.`} onClose={() => setOpen(null)}>
          <Log key={site.id} site={site} onDone={setDone} round={round + logged} />
        </Sheet>
      )}
      {open === "approvals" && site && (
        <Sheet title="Waiting for approval" onClose={() => setOpen(null)}>
          <Approvals key={site.id} site={site} onDone={setDone} read={waiting} onAi={onAi} />
        </Sheet>
      )}
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

/** A setting's raw option, in words: "default" is WordPress's own, an empty one was never set. */
const OPTION_WORD: Record<string, string> = { default: "WordPress default", "": "Not set" };
const optionWord = (o: string) => OPTION_WORD[o] ?? o.charAt(0).toUpperCase() + o.slice(1);
const raw = (s: Setting) => (s.value == null ? "" : String(s.value));
/** The subtab the reports live under, as on the plugin's dashboard. */
const LOGS = "subtab-logs";

/** Unsaved changes by name: a switch's new state, or a setting's typed value. */
type Edits = Record<string, boolean | string>;

function ControlsView({ site, onDone, round }: Part) {
  const { data, error, load } = useRead<Controls>(() => api.controls(site.id), [site.id, round]);
  const [tabKey, setTabKey] = useState("");
  const [subKey, setSubKey] = useState("");
  const [typed, setTyped] = useState("");
  const [edits, setEdits] = useState<Edits>({});
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const dirty = Object.keys(edits).length > 0;
  useEffect(() => {
    leaveGuard.ask = dirty ? (go) => setLeaving(() => go) : null;
    return () => {
      leaveGuard.ask = null;
    };
  }, [dirty]);
  if (error) return <Failed what="Classic Monks' settings" error={error} retry={load} />;
  if (!data) return <Loading label={`Reading Classic Monks on ${site.name}…`} />;

  const every = data.tabs.flatMap((t) => t.subtabs.flatMap((s) => s.cards));
  const label = new Map(every.flatMap((c) => [...c.toggles, ...c.settings].map((x) => [x.name, x] as const)));
  // As on the dashboard: a control shows only while the switch it depends on is on (and shown).
  const shown = (x: Toggle | Setting, depth = 0): boolean => {
    const p = x.depends_on ? label.get(x.depends_on) : undefined;
    return !p || !("on" in p) || (depth < 8 && ((edits[p.name] as boolean | undefined) ?? p.on) && shown(p, depth + 1));
  };
  const tabs = data.tabs.map((t) => ({
    ...t,
    subtabs: t.subtabs
      .map((s) => ({ ...s, cards: s.cards.map((c) => ({ ...c, toggles: c.toggles.filter((x) => shown(x)), settings: c.settings.filter((x) => shown(x)) })).filter((c) => c.toggles.length + c.settings.length > 0) }))
      .filter((s) => s.cards.length > 0),
  }));
  // Sites whose dashboard has no Logs subtab still get one for the reports.
  if (hasTool(site, "get-404-report") && !tabs.some((t) => t.subtabs.some((s) => s.key === LOGS))) {
    if (!tabs.length) tabs.push({ key: "core", label: "Core", subtabs: [] });
    tabs[0].subtabs.push({ key: LOGS, label: "Logs", description: "", cards: [] });
  }
  const tab = tabs.find((t) => t.key === tabKey) ?? tabs[0];
  const sub = tab?.subtabs.find((s) => s.key === subKey) ?? tab?.subtabs[0];
  const all = tabs.flatMap((t) => t.subtabs.flatMap((s) => s.cards.map((c) => ({ t, s, c }))));

  const edit = (name: string, value: boolean | string, saved: boolean | string) =>
    setEdits(({ [name]: _, ...rest }) => (value === saved ? rest : { ...rest, [name]: value }));
  // A number box with letters in it would save as nothing at all: it waits until it holds a number.
  const ready = Object.entries(edits).filter(([n, v]) => typeof v === "boolean" || (label.get(n) as Setting).control !== "number" || (v !== "" && Number.isFinite(Number(v))));

  const save = async (then?: () => void) => {
    setSaving(true);
    const undo: number[] = [];
    const said: string[] = [];
    let failed: string | null = null;
    // One call per change, so each keeps its own row (and its own Undo) in Activity.
    for (const [name, v] of ready) {
      const x = label.get(name)!;
      try {
        const row = typeof v === "boolean" ? await api.setFeature(site.id, name, v, x.label) : await api.setSetting(site.id, name, (x as Setting).control === "number" ? Number(v) : v, x.label);
        if (row != null) undo.push(row);
        said.push(typeof v === "boolean" ? `Turned ${v ? "on" : "off"} ${x.label}` : `Set ${x.label} to ${(x as Setting).control === "select" ? optionWord(v) : v}`);
        setEdits(({ [name]: _, ...rest }) => rest);
      } catch (e) {
        failed = `${x.label}: ${String(e)}`;
        break;
      }
    }
    setSaving(false);
    if (said.length) onDone({ text: said.length === 1 ? `${said[0]} on ${site.name}.` : `Saved ${said.length} changes on ${site.name}.`, undo, ok: true });
    if (failed) onDone({ text: failed, ok: false });
    load();
    if (!failed) then?.();
  };

  const words = typed.trim().toLowerCase();
  const hit = (x: { name: string; label: string; description: string }) => `${x.label} ${x.name} ${x.description}`.toLowerCase().includes(words);
  const found = words
    ? all
        .map(({ t, s, c }) => ({ ...c, toggles: c.toggles.filter(hit), settings: c.settings.filter(hit), where: `${t.label}, ${s.label}` }))
        .filter((c) => c.toggles.length + c.settings.length > 0)
    : [];
  const onIn = (cards: CmCard[]) => cards.reduce((n, c) => n + c.toggles.filter((x) => x.on).length, 0);
  const card = (c: CmCard & { where?: string }, i: number) => <Card key={`${c.where ?? ""}${c.title}${i}`} card={c} edits={edits} onEdit={edit} busy={saving} />;

  return (
    <>
      <div className="cm-bar">
        <Tabs
          label="Classic Monks tabs"
          idBase="cm"
          tabs={tabs.map((t) => {
            const on = onIn(t.subtabs.flatMap((s) => s.cards));
            return { id: t.key, text: t.label, label: <>
                  {t.label}
                  {on > 0 && (
                    <>
                      {" "}
                      <span className="on">{on} on</span>
                    </>
                  )}
                </> };
          })}
          value={words ? "" : (tab?.key ?? "")}
          onChange={(k) => {
            setTyped("");
            setTabKey(k);
            setSubKey("");
          }}
        />
        <SearchInput aria-label="Search settings" placeholder="Search settings" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </div>
      <div className={words ? "cm-dash found" : "cm-dash"} role={words ? undefined : "tabpanel"} id="cm-panel" aria-labelledby={words || !tab ? undefined : `cm-tab-${tab.key}`}>
        {!words && tab && (
          <nav className="cm-rail" aria-label={`${tab.label} sections`}>
            {tab.subtabs.map((s) => (
              <button key={s.key} type="button" className="navitem" aria-current={s.key === sub?.key ? "true" : undefined} onClick={() => setSubKey(s.key)}>
                {s.label}
                <span className="n" aria-label={plural(size(s), "setting")}>
                  {size(s)}
                </span>
              </button>
            ))}
          </nav>
        )}
        <div className="cm-main">
          {words ? (
            found.length === 0 ? (
              <Empty title="Nothing matches" action={<Button onClick={() => setTyped("")}>Clear search</Button>}>
                <p>Try another word. Search looks through every tab.</p>
              </Empty>
            ) : (
              <>
                <h2 className="cm-title" role="status">
                  {plural(found.reduce((n, c) => n + c.toggles.length + c.settings.length, 0), "setting")} match “{typed.trim()}”
                </h2>
                {found.map(card)}
              </>
            )
          ) : sub ? (
            <>
              <div className="cm-head">
                <h2 className="cm-title">{sub.label}</h2>
                {sub.description && <p>{sub.description}</p>}
              </div>
              {sub.cards.map(card)}
              {sub.key === LOGS && hasTool(site, "get-404-report") && <Reports site={site} />}
            </>
          ) : (
            <Empty title="Nothing to change here">
              <p>Classic Monks on {site.name} shares no settings with WP Sites HQ yet.</p>
            </Empty>
          )}
          <p className="cm-foot">
            <b>{data.on}</b> of {plural(data.total, "feature")} turned on. Everything else stays off and loads nothing.
          </p>
        </div>
      </div>
      {dirty && (
        <div className="cm-save" role="region" aria-label="Unsaved changes">
          <span role="status">
            <b>{Object.keys(edits).length}</b> {Object.keys(edits).length === 1 ? "change" : "changes"} not saved
          </span>
          <Button disabled={saving} onClick={() => setEdits({})}>
            Discard
          </Button>
          <Button kind="primary" disabled={saving || ready.length === 0} onClick={() => save()}>
            {saving ? "Saving…" : "Save"}
            <Glyph name="check" />
          </Button>
        </div>
      )}
      {leaving && (
        <Sheet
          dialog
          title="Leave without saving?"
          onClose={() => setLeaving(null)}
          footer={
            <>
              <Button onClick={() => setLeaving(null)}>Keep editing</Button>
              <Button
                kind="danger"
                onClick={() => {
                  const go = leaving;
                  leaveGuard.ask = null;
                  setLeaving(null);
                  go();
                }}
              >
                Leave without saving
              </Button>
              <Button
                kind="primary"
                onClick={() => {
                  const go = leaving;
                  setLeaving(null);
                  void save(() => {
                    leaveGuard.ask = null;
                    go();
                  });
                }}
              >
                Save and leave
              </Button>
            </>
          }
        >
          <p>
            {plural(Object.keys(edits).length, "change")} to Classic Monks on {site.name} {Object.keys(edits).length === 1 ? "isn't" : "aren't"} saved. Save now, or leave and lose{" "}
            {Object.keys(edits).length === 1 ? "it" : "them"}.
          </p>
        </Sheet>
      )}
    </>
  );
}

/** The controls on a subtab, as its rail counts them. */
const size = (s: CmSubtab) => s.cards.reduce((n, c) => n + c.toggles.length + c.settings.length, 0);

/** One card: its switches in two columns, then the values that go with them. */
function Card({ card, edits, onEdit, busy }: { card: CmCard & { where?: string }; edits: Edits; onEdit: (name: string, v: boolean | string, saved: boolean | string) => void; busy: boolean }) {
  const id = `cmc-${card.where ?? ""}${card.title}`.replace(/\W+/g, "-");
  return (
    <section className="card cm-card" aria-labelledby={id}>
      <div className="card-body">
        <h3 id={id}>
          {card.title}
          {card.where && (
            <>
              {" "}
              <small>{card.where}</small>
            </>
          )}
        </h3>
        {card.toggles.length > 0 && (
          <ul className="cm-toggles" aria-label={`${card.title} switches`}>
            {card.toggles.map((t) => {
              const on = (edits[t.name] as boolean | undefined) ?? t.on;
              return (
                <li key={t.name} className={t.name in edits ? "changed" : undefined}>
                  <input
                    type="checkbox"
                    role="switch"
                    id={`f-${t.name}`}
                    checked={on}
                    disabled={t.locked || busy}
                    aria-describedby={t.description ? `fd-${t.name}` : undefined}
                    onChange={() => onEdit(t.name, !on, t.on)}
                  />
                  <span className="what">
                    <label htmlFor={`f-${t.name}`}>{t.label}</label>
                    {t.description && (
                      <small id={`fd-${t.name}`} data-tip={t.description}>
                        {t.description}
                      </small>
                    )}
                  </span>
                  {t.locked && (
                    <span className="tag" data-tip="Change it in the site's WordPress dashboard, so a mistake here can't lock you out.">
                      Locked
                      <Glyph name="lock" />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {card.settings.length > 0 && (
          <div className="cm-fields">
            {card.settings.map((s) => {
              const v = (edits[s.name] as string | undefined) ?? raw(s);
              const set = (to: string) => onEdit(s.name, to, raw(s));
              return (
                <div key={s.name} className={s.name in edits ? "field changed" : "field"}>
                  <label htmlFor={`s-${s.name}`}>{s.label}</label>
                  {s.control === "select" ? (
                    <Select id={`s-${s.name}`} className="input" aria-label={s.label} disabled={busy} value={v} onChange={(e) => set(e.target.value)}>
                      {!s.options.includes(v) && <option value={v}>{optionWord(v)}</option>}
                      {s.options.map((o) => (
                        <option key={o} value={o}>
                          {optionWord(o)}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <NumberInput
                      id={`s-${s.name}`}
                      className="input"
                      aria-label={s.label}
                      disabled={busy}
                      aria-describedby={s.description ? `sd-${s.name}` : undefined}
                      min={s.min ?? undefined}
                      max={s.max ?? undefined}
                      step={s.step ?? undefined}
                      value={v}
                      onChange={(e) => set(e.target.value)}
                    />
                  )}
                  {s.description && <small id={`sd-${s.name}`}>{s.description}</small>}
                </div>
              );
            })}
          </div>
        )}
        {card.elsewhere > 0 && (
          <p className="cm-else">
            {card.elsewhere === 1 ? "1 more setting here changes" : `${card.elsewhere} more settings here change`} only in the site's WordPress dashboard.
          </p>
        )}
      </div>
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
      onDone({ text: `Undone: ${r.summary || toolLabel(r.tool)} on ${site.name}.`, ok: true, undone: true });
    } catch (e) {
      onDone({ text: String(e), ok: false });
    } finally {
      setBusy(null);
    }
  };
  return { busy, undo };
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
      () => onDone({ text: `Opened the approval page for ${what(a)} on ${site.name} in your browser.`, ok: true }),
      (e) => onDone({ text: String(e), ok: false }),
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
