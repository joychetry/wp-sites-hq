// SPDX-License-Identifier: GPL-3.0-or-later
// Monitoring: is each site up, how fast, and when its certificate and domain expire.
import "../styles/screens/monitoring.css";
import { useState } from "react";
import { ago, api, type Monitor, type Site } from "../api";
import { SiteTile } from "../components/SiteTile";
import { Button, Glyph, HeadActions, Icon, Status } from "../components/ui";

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

/** 99.98%, and 100% when nothing failed. */
const pct = (n: number | null) => (n == null ? "not yet" : `${n >= 99.995 || n === 0 ? n.toFixed(0) : n.toFixed(2)}%`);

/** Google's bands for a phone score: 90 and up is good, under 50 is poor. */
const band = (score: number): [string, string] => (score >= 90 ? ["ok", "Good"] : score >= 50 ? ["warning", "Needs work"] : ["danger", "Poor"]);

const host = (s: Site) => s.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Props = { sites: Site[]; monitors: Monitor[] };

export function Monitoring({ sites, monitors }: Props) {
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const byId = new Map(monitors.map((m) => [m.site_id, m]));
  const named = [...sites].sort((a, b) => a.name.localeCompare(b.name));
  const last = Math.max(0, ...monitors.map((m) => m.checked_at ?? 0)) || null;
  const down = named.filter((s) => byId.get(s.id)?.up === false);
  const seen = named.flatMap((s) => byId.get(s.id) ?? []).filter((m) => m.up != null);
  const up = seen.filter((m) => m.up);
  const months = seen.flatMap((m) => (m.uptime_month == null ? [] : [m.uptime_month]));
  const scores = named.flatMap((s) => (byId.get(s.id)?.pagespeed ? [{ s, score: byId.get(s.id)!.pagespeed!.score }] : []));
  const lowest = scores.reduce<(typeof scores)[number] | null>((low, x) => (!low || x.score < low.score ? x : low), null);
  const avg = (ns: number[]) => ns.reduce((a, b) => a + b, 0) / ns.length;

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
    <div className="scroll page mon">
      <HeadActions>
        <Button kind="primary" className="disc" disabled={checking} onClick={checkAll}>
          {checking ? "Loading…" : "Load every home page now"}
          <span className="btn-disc">
            <Glyph name="refresh" />
          </span>
        </Button>
      </HeadActions>
      <div className="stack">
        <p className="callout ok">
          <Glyph name="clock" />
          <span>
            <b>Monitoring runs only while the app or its tray agent is running.</b> Close both and monitoring pauses until you open one again.
          </span>
        </p>
        <section className="stats" aria-label="Fleet health">
          <div className="stat">
            <h2 className="label">Home pages up</h2>
            <p className="stat-n">
              <strong>{up.length}</strong> of {sites.length}
            </p>
            <div className="mix" role="img" aria-label={`${up.length} up, ${down.length} down, ${sites.length - seen.length} not checked`}>
              {up.length > 0 && <i className="k-up" style={{ flex: up.length }} />}
              {down.length > 0 && <i className="k-down" style={{ flex: down.length }} />}
              {sites.length > seen.length && <i className="k-off" style={{ flex: sites.length - seen.length }} />}
            </div>
          </div>
          <div className="stat">
            <h2 className="label">Uptime, 30 days</h2>
            <p className="stat-n">
              <strong>{months.length ? pct(avg(months)) : "none"}</strong> across the fleet
            </p>
            <p className="stat-note">
              {down.length > 0
                ? `${down.map((s) => s.name).join(", ")} ${down.length === 1 ? "is" : "are"} down${down.length === 1 && byId.get(down[0].id)?.down_since ? ` since ${ago(byId.get(down[0].id)!.down_since)}` : ""}.`
                : seen.length
                  ? "Every home page answered at the last check."
                  : "No home page checked yet."}
            </p>
          </div>
          <div className="stat">
            <h2 className="label">Average response</h2>
            <p className="stat-n">
              <strong>{up.length ? Math.round(avg(up.map((m) => m.ms))) : "none"}</strong> {up.length > 0 && "ms"}
            </p>
            <p className="stat-note">{up.length ? `From the ${plural(up.length, "page")} that answered.` : "No page answered yet."}</p>
          </div>
          <div className="stat">
            <h2 className="label">PageSpeed, mobile</h2>
            <p className="stat-n">
              <strong>{scores.length ? Math.round(avg(scores.map((x) => x.score))) : "none"}</strong> {scores.length > 0 && "average"}
            </p>
            <p className="stat-note">{lowest ? `Lowest: ${lowest.s.name} at ${lowest.score}.` : "Not run on any public site yet."}</p>
          </div>
        </section>
        <section className="card" aria-label="Every home page">
          <table className="t" aria-label="Monitoring" aria-describedby="monitoring-legend">
            <thead>
              <tr>
                <th scope="col">Site</th>
                <th scope="col">Home page</th>
                <th scope="col">Last 24 hours</th>
                <th scope="col" className="r">
                  Uptime, 30 days
                </th>
                <th scope="col">Renewals</th>
                <th scope="col">PageSpeed</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {named.map((s) => {
                const m = byId.get(s.id);
                const cert = expiry(m?.cert_expires ?? null);
                const domain = expiry(m?.domain_expires ?? null);
                const ps = m?.pagespeed;
                const isDown = m?.up === false;
                const [tone, word] = ps ? band(ps.score) : ["", ""];
                return (
                  <tr key={s.id} className={isDown ? "warn" : undefined}>
                    <td>
                      <span className="site" data-tip={`${s.name}, ${host(s)}`}>
                        <SiteTile site={s} />
                        <span>
                          <b className="cut">{s.name}</b>
                          <small className="cut">{host(s)}</small>
                        </span>
                      </span>
                    </td>
                    <td className="wrap-s">
                      {m?.up == null ? (
                        <span className="st pill unknown">
                          <Icon tone="unknown" />
                          Not checked
                        </span>
                      ) : m.up ? (
                        <span className="row nowrap">
                          <span className="st pill ok">
                            <Icon tone="ok" />
                            {m.status === 200 ? "200 OK" : "Up"}
                          </span>
                          <span className="ms">{m.ms} ms</span>
                        </span>
                      ) : (
                        <>
                          <span className="row nowrap">
                            <span className="st pill danger">
                              <Icon tone="danger" />
                              Down
                            </span>
                            {m.down_since && <span className="dim">since {ago(m.down_since)}</span>}
                          </span>
                          <span className="why danger">{m.error}</span>
                        </>
                      )}
                    </td>
                    <td>
                      {/* shortcut: the core keeps a day's uptime, not each check's response time, so this is a share bar, not the design's line */}
                      {m?.uptime_day == null ? (
                        <span className="dim">not yet</span>
                      ) : (
                        <span className="day">
                          <span className="mix" role="img" aria-label={`Up ${pct(m.uptime_day)} of the last 24 hours`}>
                            {m.uptime_day > 0 && <i className="k-up" style={{ flex: m.uptime_day }} />}
                            {m.uptime_day < 100 && <i className="k-down" style={{ flex: 100 - m.uptime_day }} />}
                          </span>
                          <span className="ms" aria-hidden="true">
                            {pct(m.uptime_day)}
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="r ms">{pct(m?.uptime_month ?? null)}</td>
                    <td className="wrap-s">
                      {cert ? (
                        <span className="renew">
                          <Status tone={cert.tone}>{cert.text}</Status>
                          <span className="why">Certificate, {cert.date}</span>
                        </span>
                      ) : (
                        <span className="why">{s.url.startsWith("https:") ? "Certificate not read yet" : "No certificate (http)"}</span>
                      )}
                      {domain ? (
                        <span className="renew">
                          <Status tone={domain.tone}>{domain.text}</Status>
                          <span className="why">
                            {m?.domain}, {domain.date}
                          </span>
                        </span>
                      ) : (
                        <span className="why">{m?.public === false ? "Local address" : m?.domain_note || "Domain not looked up yet"}</span>
                      )}
                    </td>
                    <td className="wrap-s">
                      {isDown && m?.public !== false ? (
                        <span className="tag">Couldn't load</span>
                      ) : ps ? (
                        <>
                          <span className={`tag ${tone}`}>
                            {ps.score} · {word}
                          </span>
                          <span className="why">
                            LCP {ps.lcp}, CLS {ps.cls}, TBT {ps.tbt}. Tested {ago(ps.at)}.
                          </span>
                        </>
                      ) : (
                        <span className="dim">{m?.public === false ? "Public sites only" : "Not run yet"}</span>
                      )}
                      {notes[s.id] && <span className="why danger">{notes[s.id]}</span>}
                    </td>
                    <td className="r">
                      {isDown ? (
                        <Button small disabled={checking} aria-label={`Check ${s.name} again`} onClick={checkAll}>
                          <Glyph name="refresh" />
                          {checking ? "Checking…" : "Check again"}
                        </Button>
                      ) : (
                        m?.public !== false && (
                          <Button small className="ghost" aria-label={`${runWord(running === s.id, !!ps)} on ${s.name}`} onClick={() => pageSpeed(s)}>
                            <Glyph name="zap" />
                            {runWord(running === s.id, !!ps)}
                          </Button>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="card-foot" id="monitoring-legend">
            <span role="status">{checking ? "Loading every home page…" : last ? `Checked ${ago(last)}.` : "Not checked yet."}</span>
            <span>
              {down.length > 0 ? `${down.length === 1 ? "1 site is" : `${down.length} sites are`} down: ${down.map((s) => s.name).join(", ")}. ` : ""}
              Each home page loads every 5 minutes, and you get a notice when a site goes down or comes back. Uptime is the share of those checks that got an answer.
              PageSpeed is Google's score for a phone; local addresses have no domain to renew, and PageSpeed can't reach them.
            </span>
          </p>
        </section>
      </div>
    </div>
  );
}
