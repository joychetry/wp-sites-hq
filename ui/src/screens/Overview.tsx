// Overview: one serif sentence about the fleet (from direction A), then the
// dense Console panels.
import { NO_TOOLS, noTools, siteStatus, slow, type Site } from "../api";
import { useState } from "react";
import { Button, Kbd, Status } from "../components/ui";

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const word = (n: number) => WORDS[n] ?? String(n);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Two sites are down. One needs a look." and the quieter rest. */
export function summary(sites: Site[]): { lead: string; rest: string } {
  const n = sites.length;
  if (n === 0) return { lead: "Welcome to Monks Central.", rest: "Add your first site to get started." };
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
  if (noTools(s)) return NO_TOOLS;
  if (s.capabilities.degraded === true) return "This Classic Monks is older. Update it on the site for every feature.";
  return null;
}

const UNKNOWN = "not known yet";

/** One bar per value, then "5 sites on 7.1.3" for each. */
function Dist({ label, values, versions }: { label: string; values: string[]; versions?: boolean }) {
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
            <b>{n}</b> {n === 1 ? "site" : "sites"}{" "}
            {v === UNKNOWN ? `where the version is ${UNKNOWN}` : <>on {versions ? <span className="mono">{v}</span> : v}</>}
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
  /** Opens another part of the app, for the getting started steps. */
  onGo?: (section: "Updates" | "AI" | "Sites" | "palette") => void;
};

const TIPS = "mc-tips-hidden";

/** First run: what Monks Central does, in three steps, with the first one as the main button. */
function Welcome({ onAdd, onGo }: Pick<Props, "onAdd" | "onGo">) {
  return (
    <section className="welcome" aria-label="Getting started">
      <ol className="steps-cards">
        <li>
          <span className="n" aria-hidden="true">1</span>
          <h3>Add your first site</h3>
          <p>With Classic Monks on the site you get full control. Any WordPress 7.1 site also works in Basic mode, with fewer tools.</p>
          <Button kind="primary" keys="A" onClick={onAdd}>
            Add a site
          </Button>
        </li>
        <li>
          <span className="n" aria-hidden="true">2</span>
          <h3>See how every site is doing</h3>
          <p>Monks Central checks health, versions and updates every 15 minutes while it runs, also from the tray with the window closed.</p>
        </li>
        <li>
          <span className="n" aria-hidden="true">3</span>
          <h3>Work on all of them at once</h3>
          <p>
            Update, install and publish across sites with one plan you review first. Press <Kbd>Ctrl K</Kbd> to find any page, site or action.
          </p>
          {onGo && (
            <Button onClick={() => onGo("palette")}>Open the command palette</Button>
          )}
        </li>
      </ol>
      <p className="dim">Your sign-ins stay on this computer, encrypted. Nothing goes to a Monks Central server.</p>
    </section>
  );
}

/** After the first site: a few next steps until they are done or hidden. */
function NextSteps({ sites, onGo, onAdd }: { sites: Site[]; onGo: NonNullable<Props["onGo"]>; onAdd: () => void }) {
  const [hidden, setHidden] = useState(() => localStorage.getItem(TIPS) === "1");
  const steps: [string, boolean, string, () => void][] = [
    ["Add more sites", sites.length > 1, "Add a site", onAdd],
    ["Put sites in groups, so the rail can show one group at a time", sites.some((s) => s.group), "Open Sites", () => onGo("Sites")],
    ["Review the updates waiting", false, "Open Updates", () => onGo("Updates")],
    ["Let an AI app plan work for you, with your confirmation", false, "Connect an AI app", () => onGo("AI")],
  ];
  if (hidden || steps.every(([, done]) => done)) return null;
  return (
    <section className="next-steps" aria-label="Next steps">
      <h2>Next steps</h2>
      <ul>
        {steps.map(([what, done, label, go]) => (
          <li key={what} className={done ? "done" : ""}>
            <Status tone={done ? "ok" : "unknown"}>
              {what}
              <span className="sr-only">{done ? ": done" : ": not done yet"}</span>
            </Status>
            {!done && (
              <Button small onClick={go}>
                {label}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Button
        small
        onClick={() => {
          localStorage.setItem(TIPS, "1");
          setHidden(true);
        }}
      >
        Hide these steps
      </Button>
    </section>
  );
}

export function Overview({ sites, onOpen, onCheck, onSignInAgain, onAdd, onGo }: Props) {
  const { lead, rest } = summary(sites);
  const tone = (t: string) => sites.filter((s) => siteStatus(s).tone === t).length;
  const cm = sites.filter((s) => s.mode === "classic_monks").length;
  const approvals = sites.reduce((n, s) => n + (Number(s.capabilities.pending_approvals) || 0), 0);
  const needs = sites.filter((s) => attention(s));
  const slows = sites.filter(slow);
  return (
    <div className="scroll">
      <h2 className="sentence">
        {lead} {rest && <span className="dim">{rest}</span>}
      </h2>
      {sites.length === 0 ? (
        <Welcome onAdd={onAdd} onGo={onGo} />
      ) : (
        <>
          {onGo && <NextSteps sites={sites} onGo={onGo} onAdd={onAdd} />}
          <div className="kpis">
            <div className="kpi">
              <div className="v">{sites.length}</div>
              <div className="l">Sites connected</div>
            </div>
            <div className="kpi">
              <div className={`v ${tone("danger") ? "danger" : ""}`}>{tone("danger")}</div>
              <div className="l">Sites down</div>
            </div>
            <div className="kpi">
              <div className={`v ${tone("warning") ? "warning" : ""}`}>{tone("warning")}</div>
              <div className="l">Sites that need a look</div>
            </div>
            <div className="kpi">
              <div className="v">{cm}</div>
              <div className="l">Sites with Classic Monks</div>
            </div>
            <div className="kpi">
              <div className="v">{approvals}</div>
              <div className="l">Changes waiting for approval on sites</div>
            </div>
          </div>
          <div className="panels">
            <section className="panel" aria-label="Needs attention">
              <h2>Needs attention</h2>
              <p className="help">Sites with a problem, what is wrong and the one step that fixes it.</p>
              {needs.length === 0 ? (
                <p className="quiet">Nothing needs you right now.</p>
              ) : (
                <table className="t">
                  <caption className="sr-only">Sites that need attention</caption>
                  <thead className="sr-only">
                    <tr>
                      <th>Status</th>
                      <th>Site</th>
                      <th>What is wrong</th>
                      <th>Next step</th>
                    </tr>
                  </thead>
                  <tbody>
                    {needs.map((s) => {
                      const st = siteStatus(s);
                      return (
                        <tr key={s.id}>
                          <td>
                            <Status tone={st.tone === "ok" ? "warning" : st.tone}>{st.tone === "ok" ? "Update" : st.label}</Status>
                          </td>
                          <td className="name">{s.name}</td>
                          <td>{attention(s)}</td>
                          <td className="r">
                            {s.sign_in_again || noTools(s) ? (
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
              {slows.map((s) => (
                <p key={s.id} className="quiet">
                  <Status tone="info">Note</Status> {s.name}. {s.health_detail} It still works.
                </p>
              ))}
            </section>
            <section className="panel" aria-label="Versions">
              <h2>Versions</h2>
              <p className="help">How many of your sites run each version.</p>
              <div className="dist">
                <Dist label="WordPress" versions values={sites.map((s) => s.wp_version ?? UNKNOWN)} />
                <Dist label="PHP" versions values={sites.map((s) => s.php_version?.split(".").slice(0, 2).join(".") ?? UNKNOWN)} />
                <Dist
                  label="Connection"
                  values={sites.map((s) =>
                    s.mode === "basic" ? "Basic mode" : noTools(s) ? "Classic Monks, no tools" : s.capabilities.degraded ? "Classic Monks, older" : "Classic Monks",
                  )}
                />
              </div>
            </section>
          </div>
        </>
      )}
      {sites.length > 0 && <p className="note">Monks Central checks your sites while it is open. Sites cannot send alerts to it on their own.</p>}
    </div>
  );
}
