// Monitoring: is each site up, how fast, and when its certificate and domain expire.
import { useState } from "react";
import { ago, api, type Monitor, type Site } from "../api";
import { Button, Status } from "../components/ui";

const DAY = 86400;
const DATE = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" });

/** "in 41 days", with a tone: a month's notice, then a week's. */
export function expiry(
  at: number | null,
  now = Date.now() / 1000,
): { tone: "ok" | "warning" | "danger"; text: string; date: string } | null {
  if (at == null) return null;
  const days = Math.floor((at - now) / DAY);
  const date = DATE.format(at * 1000);
  if (days < 0) return { tone: "danger", text: "Expired", date };
  const text = days === 0 ? "Expires today" : `${days === 1 ? "1 day" : `${days} days`} left`;
  return { tone: days < 7 ? "danger" : days < 30 ? "warning" : "ok", text, date };
}

const runWord = (running: boolean, again: boolean) =>
  running ? "Running PageSpeed, up to a minute" : again ? "Run PageSpeed again" : "Run PageSpeed";

const pct = (n: number | null) => (n == null ? "not yet" : `${n >= 99.95 || n === 0 ? n.toFixed(0) : n.toFixed(1)}%`);

type Props = { sites: Site[]; monitors: Monitor[] };

export function Monitoring({ sites, monitors }: Props) {
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const byId = new Map(monitors.map((m) => [m.site_id, m]));
  const named = [...sites].sort((a, b) => a.name.localeCompare(b.name));
  const last = Math.max(0, ...monitors.map((m) => m.checked_at ?? 0)) || null;
  const down = named.filter((s) => byId.get(s.id)?.up === false);

  const checkAll = async () => {
    setChecking(true);
    await api.checkMonitors().catch(() => {});
    setChecking(false);
  };
  // Not disabled while one runs: a disabled button would drop keyboard focus.
  const pageSpeed = async (s: Site) => {
    if (running != null) return;
    setRunning(s.id);
    setNotes(({ [s.id]: _, ...rest }) => rest);
    try {
      await api.pageSpeed(s.id);
    } catch (e) {
      setNotes((n) => ({ ...n, [s.id]: String(e) }));
    } finally {
      setRunning(null);
    }
  };

  if (sites.length === 0) {
    return (
      <div className="empty">
        <h2>No sites yet.</h2>
        <p>Add a site to watch whether it's up, how fast it answers, and when its certificate and domain expire.</p>
      </div>
    );
  }

  return (
    <div className="scroll">
      <div className="bar">
        <span className="dim" role="status">
          {checking ? "Loading every home page…" : last ? `Checked ${ago(last)}` : "Not checked yet"}
        </span>
        <span className="grow" />
        <Button small kind="primary" disabled={checking} onClick={checkAll}>
          {checking ? "Loading…" : "Load every home page now"}
        </Button>
      </div>
      <p className="legend" id="monitoring-legend">
        <span>
          {down.length > 0
            ? `${down.length === 1 ? "1 site is" : `${down.length} sites are`} down: ${down.map((s) => s.name).join(", ")}. `
            : ""}
          Each home page loads every 5 minutes while Monks Central runs, also from the tray with the window closed, and
          you get a notice when a site goes down or comes back. Uptime is the share of those checks that got an answer.
          PageSpeed is Google's score for a phone. Local addresses have no domain to renew, and PageSpeed can't reach
          them.
        </span>
      </p>
      <table className="t" aria-label="Monitoring" aria-describedby="monitoring-legend">
        <thead>
          <tr>
            <th>Site</th>
            <th>Now</th>
            <th>Answered in</th>
            <th>Up, 24 h</th>
            <th>Up, 30 days</th>
            <th>Certificate</th>
            <th>Domain</th>
            <th>PageSpeed</th>
          </tr>
        </thead>
        <tbody>
          {named.map((s) => {
            const m = byId.get(s.id);
            const cert = expiry(m?.cert_expires ?? null);
            const domain = expiry(m?.domain_expires ?? null);
            const ps = m?.pagespeed;
            return (
              <tr key={s.id}>
                <td className="name cut" title={s.name}>
                  {s.name}
                </td>
                <td className="wrap-s">
                  {m?.up == null ? (
                    <Status tone="unknown">Not checked</Status>
                  ) : m.up ? (
                    <Status tone="ok">Up</Status>
                  ) : (
                    <>
                      <Status tone="danger">Down{m.down_since ? ` since ${ago(m.down_since)}` : ""}</Status>
                      <span className="why danger">{m.error}</span>
                    </>
                  )}
                </td>
                <td className="m">{m?.up ? `${(m.ms / 1000).toFixed(1)} s` : <span className="dim">none</span>}</td>
                <td className="m">{pct(m?.uptime_day ?? null)}</td>
                <td className="m">{pct(m?.uptime_month ?? null)}</td>
                <td>
                  {cert ? (
                    <>
                      <Status tone={cert.tone}>{cert.text}</Status>
                      <span className="why">{cert.date}</span>
                    </>
                  ) : (
                    <span className="dim">{s.url.startsWith("https:") ? "not read yet" : "none (http)"}</span>
                  )}
                </td>
                <td className="wrap-s">
                  {domain ? (
                    <>
                      <Status tone={domain.tone}>{domain.text}</Status>
                      <span className="why">
                        {m?.domain}, {domain.date}
                      </span>
                    </>
                  ) : (
                    <span className="dim">
                      {m?.public === false ? "Local address" : m?.domain_note || "not looked up yet"}
                    </span>
                  )}
                </td>
                <td className="wrap-s">
                  {ps && (
                    <span>
                      <b>{ps.score}</b> of 100
                      <span className="why">
                        LCP {ps.lcp}, CLS {ps.cls}, TBT {ps.tbt}. Tested {ago(ps.at)}.
                      </span>
                    </span>
                  )}
                  {notes[s.id] && <span className="why danger">{notes[s.id]}</span>}
                  {m?.public === false ? (
                    <span className="dim">Public sites only</span>
                  ) : (
                    <Button
                      small
                      aria-label={`${runWord(running === s.id, !!ps)} on ${s.name}`}
                      onClick={() => pageSpeed(s)}
                    >
                      {runWord(running === s.id, !!ps)}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
