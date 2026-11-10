// SPDX-License-Identifier: GPL-3.0-or-later
// Monitoring: is each site up, how fast, and when its certificate and domain expire.
import "../styles/screens/monitoring.css";
import { useState } from "react";
import { ago, api, type Monitor, type Site, type Tone } from "../api";
import { SiteTile } from "../components/SiteTile";
import { Button, Glyph, HeadActions, Icon, Status } from "../components/ui";
import { Empty } from "../components/feedback";
import { Page } from "../components/page";
import { byName, day, speed } from "../format";

const DAY = 86400;

/** "in 41 days", with a tone: a month's notice, then a week's. */
export function expiry(
  at: number | null,
  now = Date.now() / 1000,
): { tone: "ok" | "warning" | "danger"; text: string; date: string } | null {
  if (at == null) return null;
  const days = Math.floor((at - now) / DAY);
  const date = day(at);
  if (days < 0) return { tone: "danger", text: "Expired", date };
  const text = days === 0 ? "Expires today" : `${days === 1 ? "1 day" : `${days} days`} left`;
  return { tone: days < 7 ? "danger" : days < 30 ? "warning" : "ok", text, date };
}

const runWord = (running: boolean, again: boolean) => (running ? "Testing speed, up to a minute" : again ? "Test speed again" : "Test speed");

/** 99.98%, and 100% when nothing failed. */
const pct = (n: number) => `${n >= 99.995 || n === 0 ? n.toFixed(0) : n.toFixed(2)}%`;

/** Google's bands for a phone score: 90 and up is good, under 50 is poor. */
const band = (score: number): [string, string] => (score >= 90 ? ["ok", "Good"] : score >= 50 ? ["warning", "Needs work"] : ["danger", "Poor"]);

const host = (s: Site) => s.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Props = { sites: Site[]; monitors: Monitor[] };
const NAME_DOWN = 3;

export function Monitoring({ sites, monitors }: Props) {
  const [running, setRunning] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const byId = new Map(monitors.map((m) => [m.site_id, m]));
  const named = [...sites].sort(byName);
  const last = Math.max(0, ...monitors.map((m) => m.checked_at ?? 0)) || null;
  const down = named.filter((s) => byId.get(s.id)?.up === false);
  const seen = named.flatMap((s) => byId.get(s.id) ?? []).filter((m) => m.up != null);
  const up = seen.filter((m) => m.up);
  const months = seen.flatMap((m) => (m.uptime_month == null ? [] : [m.uptime_month]));
  const scores = named.flatMap((s) => (byId.get(s.id)?.pagespeed ? [{ s, score: byId.get(s.id)!.pagespeed!.score }] : []));
  const lowest = scores.reduce<(typeof scores)[number] | null>((low, x) => (!low || x.score < low.score ? x : low), null);
  const avg = (ns: number[]) => ns.reduce((a, b) => a + b, 0) / ns.length;
  // A few down sites are named; more are a count, so the card stays one card high (the table lists them).
  const since = down.length === 1 ? byId.get(down[0].id)?.down_since : null;
  const downSay =
    down.length === 0
      ? ""
      : down.length === 1
        ? `${down[0].name} ${since ? `went down ${ago(since)}` : "is down"}.`
        : down.length <= NAME_DOWN
          ? `${down.slice(0, -1).map((s) => s.name).join(", ")} and ${down[down.length - 1].name} are down.`
          : `${down.length} sites are down.`;

  // true while every site is checked, or the id of the one site a row's "Check again" checks.
  const [checking, setChecking] = useState<boolean | number>(false);
  const check = async (id?: number) => {
    setChecking(id ?? true);
    await api.checkMonitors(id).catch(() => {});
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
      <Page>
        <Empty picture="pulse" title="No sites yet">
          <p>Add a site to watch whether it's up, how fast it answers, and when its certificate and domain expire.</p>
        </Empty>
      </Page>
    );
  }

  return (
    <Page className="mon">
      <HeadActions>
        <Button kind="primary" className="disc" disabled={checking !== false} onClick={() => check()}>
          {checking === true ? "Checking…" : "Check all sites"}
          <span className="btn-disc">
            <Glyph name="refresh" />
          </span>
        </Button>
      </HeadActions>
      <p className="callout ok">
        <Glyph name="clock" />
        <span>
          <b>Monitoring runs only while the app or its tray agent is running.</b> Close both and monitoring pauses until you open one again.
        </span>
      </p>
      <section className="stats" aria-label="Your sites at a glance">
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
            <strong>{months.length ? pct(avg(months)) : "Not known"}</strong> {months.length > 0 && "across your sites"}
          </p>
          <p className="stat-note">
            {down.length > 0
              ? downSay
              : seen.length
                ? "Every home page answered at the last check."
                : "No home page checked yet."}
          </p>
        </div>
        <div className="stat">
          <h2 className="label">Average response</h2>
          <p className="stat-n">
            <strong>{up.length ? speed(avg(up.map((m) => m.ms))) : "No answer"}</strong>
          </p>
          <p className="stat-note">{up.length ? `From the ${plural(up.length, "page")} that answered.` : "No page answered yet."}</p>
        </div>
        <div className="stat">
          <h2 className="label">Google speed score, phone</h2>
          <p className="stat-n">
            <strong>{scores.length ? Math.round(avg(scores.map((x) => x.score))) : "Not known"}</strong> {scores.length > 0 && "average"}
          </p>
          <p className="stat-note">{lowest ? `Lowest: ${lowest.s.name} at ${lowest.score}.` : "Not run on any public site yet."}</p>
        </div>
      </section>
      <section className="card" aria-label="Every home page">
        <table className="t" aria-label="Monitoring" aria-describedby="monitoring-legend">
          <colgroup>
            <col className="c-fill" />
            <col className="c-text" />
            <col className="c-text" />
            <col className="c-wide" />
            <col className="c-text" />
            <col className="c-act" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Site</th>
              <th scope="col">Home page</th>
              <th scope="col">Uptime</th>
              <th scope="col">Renewals</th>
              <th scope="col">Speed score</th>
              <th scope="col" className="act">
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
              const mine = checking === s.id;
              const run = runWord(running === s.id, !!ps);
              // Every cell is one line and, at most, a quieter second one; the full text is in its tip.
              const certLine = cert ? `Certificate, ${cert.date}` : s.url.startsWith("https:") ? "Certificate not read yet" : "No certificate (http)";
              const domainLine = domain ? `${m?.domain}, ${domain.date}` : m?.public === false ? "Local address, no domain" : m?.domain_note || "Domain not looked up yet";
              return (
                <tr key={s.id}>
                  <td>
                    <span className="site" data-tip={`${s.name}, ${host(s)}`}>
                      <SiteTile site={s} />
                      <span>
                        <b>{s.name}</b>
                        <small>{host(s)}</small>
                      </span>
                    </span>
                  </td>
                  <td>
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
                        <span className="ms">{speed(m.ms)}</span>
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
                        <span className="sub cut danger" data-tip={m.error}>
                          {m.error}
                        </span>
                      </>
                    )}
                  </td>
                  <td>
                    {m?.uptime_day == null ? (
                      <span className="dim">Not known</span>
                    ) : (
                      <>
                        <Day day={m.day ?? []} label={`Up ${pct(m.uptime_day)} of the last 24 hours`} />
                        {m.uptime_month != null && <span className="sub">{pct(m.uptime_month)} over 30 days</span>}
                      </>
                    )}
                  </td>
                  <td>
                    {/* The certificate on the first line, the domain under it; the date of each in its tip. */}
                    <span className="renew" data-tip={certLine}>
                      {cert ? <Status tone={cert.tone}>Certificate: {cert.text.toLowerCase()}</Status> : <span className="dim">{certLine}</span>}
                    </span>
                    <span className="renew sub cut" data-tip={domainLine}>
                      {domain ? <Status tone={domain.tone}>Domain: {domain.text.toLowerCase()}</Status> : domainLine}
                    </span>
                  </td>
                  <td>
                    {isDown && m?.public !== false ? (
                      <span className="tag">Couldn't load</span>
                    ) : ps ? (
                      <>
                        <Status pill tone={(tone || "unknown") as Tone}>
                          {ps.score} · {word}
                        </Status>
                        <span className="sub cut" data-tip={`Main content shows in ${ps.lcp}. Tested ${ago(ps.at)}.`}>
                          Tested {ago(ps.at)}
                        </span>
                      </>
                    ) : (
                      <span className="dim">{m?.public === false ? "Public sites only" : "Not tested yet"}</span>
                    )}
                    {notes[s.id] && (
                      <span className="sub cut danger" data-tip={notes[s.id]}>
                        {notes[s.id]}
                      </span>
                    )}
                  </td>
                  <td className="act">
                    {isDown ? (
                      <button type="button" className="icon-btn" aria-label={mine ? `Checking ${s.name}…` : `Check ${s.name} again`} data-tip={mine ? "Checking…" : "Check again"} onClick={() => checking === false && check(s.id)}>
                        <Glyph name={mine ? "loader" : "refresh"} />
                      </button>
                    ) : (
                      m?.public !== false && (
                        <button type="button" className="icon-btn" aria-label={`${run} on ${s.name}`} data-tip={run} onClick={() => pageSpeed(s)}>
                          <Glyph name={running === s.id ? "loader" : "zap"} />
                        </button>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="card-foot" id="monitoring-legend">
          <span role="status">{checking === true ? "Checking every site…" : last ? `Checked ${ago(last)}.` : "Not checked yet."}</span>
          <span>
            {down.length > 0 ? `${down.length === 1 ? "1 site is" : `${down.length} sites are`} down${down.length <= NAME_DOWN ? `: ${down.map((s) => s.name).join(", ")}` : "; each shows Down in the table"}. ` : ""}
            Each home page loads every 5 minutes, and you get a notice when a site goes down or comes back. Uptime is the share of those checks that got an answer.
            The speed score is Google's PageSpeed score for a phone; local addresses have no domain to renew, and Google can't reach them to test.
          </span>
        </p>
      </section>
    </Page>
  );
}

/** The design's last-24-hours line: response time per hour in green, hours it was down as red dots on the floor. */
export function Day({ day, label }: { day: Monitor["day"]; label: string }) {
  const W = 112, H = 26, step = W / 23;
  const ms = day.flatMap((h) => (h?.ms != null ? [h.ms] : []));
  // Padded around the day's range, so an ordinary day reads as the design's calm line, not a zigzag.
  const top = Math.max(...ms, 1) * 1.3, low = Math.min(...ms, top) * 0.7;
  const y = (v: number) => 3 + (H - 6) * (1 - (v - low) / (top - low || 1));
  // A line through the hours with a time; a gap where none was taken.
  // "l0 0" after each start: an hour with no timed neighbour still shows, as a round dot.
  const path = day.map((h, i) => (h?.ms != null ? (i && day[i - 1]?.ms != null ? "L" : "M") + `${(i * step).toFixed(1)} ${y(h.ms).toFixed(1)}` + (i && day[i - 1]?.ms != null ? "" : "l0 0") : "")).join("");
  return (
    <svg className="day-line" viewBox={`-2 0 ${W + 4} ${H}`} width={W + 4} height={H} role="img" aria-label={ms.length ? `${label}; ${Math.min(...ms)} to ${Math.max(...ms)} ms` : label}>
      <path d={path} />
      {day.map((h, i) => (h && !h.up ? <circle key={i} cx={i * step} cy={H - 3} r={1.6} /> : null))}
    </svg>
  );
}
