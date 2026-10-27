// Overview: one serif sentence about the fleet (from direction A), then the
// dense Console panels.
import { siteStatus, type Site } from "../api";
import { Button, Status } from "../components/ui";

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const word = (n: number) => WORDS[n] ?? String(n);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Two sites are down. One needs a look." and the quieter rest. */
export function summary(sites: Site[]): { lead: string; rest: string } {
  const n = sites.length;
  if (n === 0) return { lead: "No sites yet.", rest: "Add one to see how it is doing." };
  const tones = sites.map((s) => siteStatus(s).tone);
  const down = tones.filter((t) => t === "danger").length;
  const look = tones.filter((t) => t === "warning").length;
  const ok = tones.filter((t) => t === "ok").length;
  if (down === 0 && look === 0) {
    if (ok === 0) return { lead: "Checking your sites.", rest: "This takes a few seconds." };
    const lead = n === 1 ? "Your one site is healthy." : n === 2 ? "Both sites are healthy." : `All ${word(n)} sites are healthy.`;
    return { lead, rest: ok < n ? `${cap(word(n - ok))} not checked yet.` : "" };
  }
  const parts = [];
  if (down) parts.push(`${cap(word(down))} ${down === 1 ? "site is" : "sites are"} down.`);
  if (look) parts.push(`${cap(word(look))} ${look === 1 ? "needs" : "need"} a look.`);
  const rest = ok ? `The other ${word(ok)} ${ok === 1 ? "is" : "are"} fine.` : "";
  return { lead: parts.join(" "), rest };
}

function attention(s: Site): string | null {
  if (s.sign_in_again) return "The saved sign-in can't be used. Sign in again.";
  if (s.health === "down" || s.health === "warning") return s.health_detail || "Needs a look.";
  if (s.capabilities.degraded === true) return "Older Classic Monks. Update it for every feature.";
  return null;
}

function Dist({ label, values }: { label: string; values: string[] }) {
  const counts = new Map<string, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  const rows = [...counts].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]));
  return (
    <>
      <h3>{label}</h3>
      <div className="seg" aria-hidden="true">
        {rows.map(([v, n]) => (
          <i key={v} style={{ flex: n }} />
        ))}
      </div>
      <p>
        {rows.map(([v, n]) => (
          <span key={v}>
            <b>{n}</b>
            {v}
          </span>
        ))}
      </p>
    </>
  );
}

type Props = {
  sites: Site[];
  onOpen: (id: number) => void;
  onCheck: (id: number) => void;
  onSignInAgain: (id: number) => void;
  onAdd: () => void;
};

export function Overview({ sites, onOpen, onCheck, onSignInAgain, onAdd }: Props) {
  const { lead, rest } = summary(sites);
  const tone = (t: string) => sites.filter((s) => siteStatus(s).tone === t).length;
  const cm = sites.filter((s) => s.mode === "classic_monks").length;
  const approvals = sites.reduce((n, s) => n + (Number(s.capabilities.pending_approvals) || 0), 0);
  const needs = sites.filter((s) => attention(s));
  return (
    <div className="scroll">
      <h2 className="sentence">
        {lead} {rest && <span className="dim">{rest}</span>}
      </h2>
      {sites.length === 0 ? (
        <div className="empty">
          <p>Add a site with Classic Monks for full control, or any WordPress 7.1 site in Basic mode.</p>
          <Button kind="primary" keys="A" onClick={onAdd}>
            Add a site
          </Button>
        </div>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi">
              <div className="v">{sites.length}</div>
              <div className="l">Sites</div>
            </div>
            <div className="kpi">
              <div className={`v ${tone("danger") ? "danger" : ""}`}>{tone("danger")}</div>
              <div className="l">Down</div>
            </div>
            <div className="kpi">
              <div className={`v ${tone("warning") ? "warning" : ""}`}>{tone("warning")}</div>
              <div className="l">Need a look</div>
            </div>
            <div className="kpi">
              <div className="v">{cm}</div>
              <div className="l">With Classic Monks</div>
            </div>
            <div className="kpi">
              <div className="v">{approvals}</div>
              <div className="l">Approvals waiting on sites</div>
            </div>
          </div>
          <div className="panels">
            <section className="panel" aria-label="Needs attention">
              <h2>Needs attention</h2>
              {needs.length === 0 ? (
                <p className="quiet">Nothing needs you right now.</p>
              ) : (
                <table className="t">
                  <tbody>
                    {needs.map((s) => {
                      const st = siteStatus(s);
                      return (
                        <tr key={s.id}>
                          <td style={{ width: 24 }}>
                            <Status tone={st.tone === "ok" ? "warning" : st.tone} />
                          </td>
                          <td className="name">{s.name}</td>
                          <td style={{ whiteSpace: "normal" }}>{attention(s)}</td>
                          <td className="r">
                            {s.sign_in_again ? (
                              <Button small onClick={() => onSignInAgain(s.id)}>
                                Sign in again
                              </Button>
                            ) : s.health === "down" ? (
                              <Button small onClick={() => onCheck(s.id)}>
                                Check again
                              </Button>
                            ) : (
                              <Button small onClick={() => onOpen(s.id)}>
                                Open in Sites
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
            <section className="panel" aria-label="Versions">
              <h2>Versions</h2>
              <div className="dist">
                <Dist label="WordPress" values={sites.map((s) => s.wp_version ?? "unknown")} />
                <Dist label="PHP" values={sites.map((s) => s.php_version?.split(".").slice(0, 2).join(".") ?? "unknown")} />
                <Dist
                  label="Connection"
                  values={sites.map((s) => (s.mode === "basic" ? "Basic mode" : s.capabilities.degraded ? "Classic Monks (older)" : "Classic Monks"))}
                />
              </div>
            </section>
          </div>
        </>
      )}
      <p className="note">Monks Central checks your sites while it is open. Sites cannot send alerts to it on their own.</p>
    </div>
  );
}
