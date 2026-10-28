// SPDX-License-Identifier: GPL-3.0-or-later
// Monthly reports for a client's sites, saved as HTML and PDF in Downloads (plan Phase 7).
import "../styles/screens/reports.css";
import { Select, DateInput } from "../components/controls";
import { useEffect, useState } from "react";
import { api, type AppSettings, type Client, type SavedReport, type Site } from "../api";
import { Button, Glyph } from "../components/ui";
import { SiteTile } from "../components/SiteTile";

/** Last month, "2026-09", from a date in this one. */
export function lastMonth(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "Corner Bakery", "MC A and MC B", "MC A, MC B and 2 more". */
const names = (sites: Site[]) =>
  sites.length <= 3 ? sites.map((s) => s.name).join(", ").replace(/, ([^,]*)$/, " and $1") : `${sites.slice(0, 2).map((s) => s.name).join(", ")} and ${sites.length - 2} more`;

const monthName = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return y && mo ? new Date(y, mo - 1, 1).toLocaleDateString([], { month: "long", year: "numeric" }) : "";
};

/** What every report holds, in the order the report shows it. */
const COVERS = ["Uptime and speed of each home page", "Updates made and what changed", "Security: known vulnerabilities and fixes", "What was published, and the store", "Search numbers, when they're on in Settings"];

/** `onSettings`: the footnote's link to where branding is set. */
export function Reports({ sites, onSettings }: { sites: Site[]; onSettings?: () => void }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [who, setWho] = useState<"client" | "sites">("client");
  const [clientId, setClientId] = useState<number | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [month, setMonth] = useState(lastMonth());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedReport | null>(null);
  const [brand, setBrand] = useState<AppSettings | null>(null);

  useEffect(() => {
    api.appSettings().then((b) => setBrand(b ?? null), () => setBrand(null));
    api.clients().then(
      (c) => {
        setClients(c);
        setClientId((id) => id ?? c[0]?.id ?? null);
        if (c.length === 0) setWho("sites");
      },
      () => setWho("sites"),
    );
  }, []);

  const theirs = sites.filter((s) => s.client_id === clientId);
  const ready = /^\d{4}-\d{2}$/.test(month) && (who === "client" ? clientId != null && theirs.length > 0 : picked.size > 0);
  const make = async () => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      setSaved(await api.makeReport(who === "client" ? { client_id: clientId, site_ids: [], month } : { client_id: null, site_ids: [...picked], month }));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const open = (path: string) => api.openFile(path).catch((e) => setError(String(e)));

  if (sites.length === 0) {
    return (
      <div className="empty">
        <h2>No sites yet.</h2>
        <p>Add a site on Sites, then make a report for it here.</p>
      </div>
    );
  }
  const client = clients.find((c) => c.id === clientId);
  const on = who === "client" ? theirs : sites.filter((s) => picked.has(s.id));
  const title = who === "client" ? client?.name ?? "Your client" : on.length === 1 ? on[0].name : "Website report";
  const accent = brand?.report_accent || "#0d1411";
  return (
    <div className="scroll page reports">
      <div className="rep-split">
        <div className="stack">
          <section className="card" aria-labelledby="rep-make">
            <div className="card-head">
              <h2 id="rep-make">Make a report</h2>
            </div>
            <div className="card-body">
              <div className="field">
                <span id="rep-who">Which sites</span>
                <div className="segmented" role="group" aria-labelledby="rep-who">
                  <button type="button" aria-pressed={who === "client"} disabled={clients.length === 0} onClick={() => setWho("client")}>
                    A client's sites
                  </button>
                  <button type="button" aria-pressed={who === "sites"} onClick={() => setWho("sites")}>
                    Sites I pick
                  </button>
                </div>
              </div>
              {who === "client" ? (
                <label className="field">
                  <span>Client</span>
                  <Select className="input" aria-label="Client" value={clientId ?? ""} onChange={(e) => setClientId(Number(e.target.value))}>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({sites.filter((s) => s.client_id === c.id).length} sites)
                      </option>
                    ))}
                  </Select>
                  <small>{clientId != null && theirs.length === 0 ? "This client has no sites yet. Give them some on Clients." : `Covers ${names(theirs)}`}</small>
                </label>
              ) : (
                <fieldset className="field">
                  <legend>Sites</legend>
                  <ul className="plain">
                    {sites.map((s) => (
                      <li key={s.id}>
                        <label className="row check">
                          <input
                            type="checkbox"
                            checked={picked.has(s.id)}
                            onChange={(e) => {
                              const next = new Set(picked);
                              if (e.target.checked) next.add(s.id);
                              else next.delete(s.id);
                              setPicked(next);
                            }}
                          />
                          <SiteTile site={s} size="sm" />
                          <span>{s.name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              )}
              <div className="field">
                <span>Month</span>
                <DateInput type="month" aria-label="Month" value={month} max={lastMonth(new Date(Date.now() + 31 * 86_400_000))} onChange={(e) => setMonth(e.target.value)} />
              </div>
              <div>
                <Button kind="primary" className="disc" disabled={!ready || busy} onClick={make}>
                  {busy ? "Making the report…" : "Make the report"}
                  <span className="btn-disc">
                    <Glyph name="arrow" />
                  </span>
                </Button>
              </div>
            </div>
          </section>
          <div role="status" className="notice">
            {busy && <p className="quiet">Asking each site for its numbers…</p>}
            {error && (
              <p className="callout danger">
                <Glyph name="x-circle" />
                <span>{error}</span>
              </p>
            )}
            {saved && (
              <section className="card rep-ready" aria-labelledby="rep-ready">
                <div className="card-body">
                  <h2 id="rep-ready">
                    <span className="tile sm" aria-hidden="true">
                      <Glyph name="check" />
                    </span>
                    {monthName(month)} report on {saved.sites} site{saved.sites === 1 ? "" : "s"} is ready
                  </h2>
                  <p className="dim">Saved as PDF and HTML in Downloads.</p>
                  <div className="row">
                    <Button small kind="soft" onClick={() => open(saved.pdf)}>
                      <Glyph name="file" />
                      Open the PDF
                    </Button>
                    <Button small onClick={() => open(saved.html)}>
                      <Glyph name="globe" />
                      Open the HTML
                    </Button>
                  </div>
                  <div>
                    <button type="button" className="link quiet" onClick={() => api.showFile(saved.pdf).catch((e) => setError(String(e)))}>
                      <Glyph name="folder" />
                      Show in folder
                    </button>
                  </div>
                  {saved.notes.length > 0 && (
                    <div className="callout warning">
                      <Glyph name="alert" />
                      <div>
                        <p>Left out because the site didn't answer:</p>
                        <ul>
                          {saved.notes.map((n) => (
                            <li key={n}>{n}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
          <p className="dim rep-foot">
            Branding, the footer line and data sources live in{" "}
            <button type="button" className="link go" onClick={onSettings}>
              Settings
            </button>
            .
          </p>
        </div>
        <section className="card rep-well" aria-label={saved ? "The report" : "What the report looks like"}>
          {saved ? (
            // Same origin so assistive tech and axe can read it; no scripts run in it.
            <iframe className="preview" title="Report preview" sandbox="allow-same-origin" srcDoc={saved.preview} />
          ) : (
            <div className="rep-page" style={{ ["--accent-r" as string]: accent }}>
              <header>
                <div>
                  <span className="label">Monthly report · {monthName(month)}</span>
                  <b>{title}</b>
                  <span>{on.length ? names(on) : "Pick the sites to report on"}</span>
                </div>
                <span className="biz">{brand?.report_name || "[Your business name]"}</span>
              </header>
              <b className="rep-h">What it covers</b>
              <ul>
                {COVERS.map((c) => (
                  <li key={c}>
                    <Glyph name="check" />
                    {c}
                  </li>
                ))}
              </ul>
              <p className="dim">The numbers are read from each site when you make the report.</p>
              {(brand?.report_footer || !brand?.white_label) && (
                <footer>
                  <span>{brand?.report_footer || "[Line at the bottom of each page]"}</span>
                  {!brand?.white_label && <span>Made with Monks Central</span>}
                </footer>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
