// Monthly reports for a client's sites, saved as HTML and PDF in Downloads (plan Phase 7).
import { useEffect, useState } from "react";
import { api, type Client, type SavedReport, type Site } from "../api";
import { Button } from "../components/ui";

/** Last month, "2026-09", from a date in this one. */
export function lastMonth(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function Reports({ sites }: { sites: Site[] }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [who, setWho] = useState<"client" | "sites">("client");
  const [clientId, setClientId] = useState<number | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [month, setMonth] = useState(lastMonth());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedReport | null>(null);

  useEffect(() => {
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
  return (
    <div className="scroll">
      <div className="settings">
        <section>
          <h2>A monthly report</h2>
          <p>
            What was done on each site that month, uptime, speed, security, what was published, the store, and search numbers when
            they're on in Settings. Your name, footer and colour come from Settings too.
          </p>
          <div className="segmented" role="group" aria-label="Report on">
            <button type="button" aria-pressed={who === "client"} disabled={clients.length === 0} onClick={() => setWho("client")}>
              A client's sites
            </button>
            <button type="button" aria-pressed={who === "sites"} onClick={() => setWho("sites")}>
              Sites I pick
            </button>
          </div>
          {who === "client" ? (
            <label className="field">
              <span>Client</span>
              <select className="input" value={clientId ?? ""} onChange={(e) => setClientId(Number(e.target.value))}>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({sites.filter((s) => s.client_id === c.id).length} sites)
                  </option>
                ))}
              </select>
              {clientId != null && theirs.length === 0 && <small>This client has no sites yet. Give them some on Clients.</small>}
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
                      <span>{s.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          <label className="field">
            <span>Month</span>
            <input className="input sm" type="month" value={month} max={lastMonth(new Date(Date.now() + 31 * 86_400_000))} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <Button kind="primary" disabled={!ready || busy} onClick={make}>
            {busy ? "Making the report…" : "Make the report"}
          </Button>
        </section>
        <div role="status" className="notice">
          {busy && <p className="dim">Asking each site for its numbers…</p>}
          {error && <p className="alert danger">{error}</p>}
          {saved && (
            <div className="alert ok">
              <p>
                Saved the report on {saved.sites} site{saved.sites === 1 ? "" : "s"} as PDF and HTML in Downloads.
              </p>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <Button small kind="primary" onClick={() => open(saved.pdf)}>
                  Open the PDF
                </Button>
                <Button small onClick={() => open(saved.html)}>
                  Open the HTML
                </Button>
                <Button small onClick={() => api.showFile(saved.pdf).catch((e) => setError(String(e)))}>
                  Show in folder
                </Button>
              </div>
              {saved.notes.length > 0 && (
                <>
                  <p>Left out because the site didn't answer:</p>
                  <ul>
                    {saved.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {/* Same origin so assistive tech and axe can read it; no scripts run in it. */}
      {saved && <iframe className="preview" title="Report preview" sandbox="allow-same-origin" srcDoc={saved.preview} />}
    </div>
  );
}
