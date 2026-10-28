// SPDX-License-Identifier: GPL-3.0-or-later
// Settings: how the app looks (remembered on this computer), how reports look,
// Search Console and AgentedSEO, and your site list in and out.
import { ColorInput, FilePicker, Menu, Slider } from "../components/controls";
import { useEffect, useState } from "react";
import { api, type AppSettings, type GscStatus, type Imported } from "../api";
import { Button } from "../components/ui";
import { toast } from "../components/feedback";
import { setTextSize, textSize, type Density, type ThemeChoice } from "../theme";

/** What an import did, in a sentence or two. */
export function importNote(r: Imported): string {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const parts = [n(r.sites, "site", "sites") + " updated", n(r.clients, "client", "clients") + " added", n(r.costs, "cost or charge", "costs and charges") + " added"];
  const missing = r.not_connected.length
    ? ` Not connected here, so left out: ${r.not_connected.join(", ")}. Add them with Add a site, then import again.`
    : "";
  return `Imported: ${parts.join(", ")}.${missing}`;
}

function YourData() {
  const [note, setNote] = useState<{ tone: "ok" | "danger"; text: string; path?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const exportAs = async (csv: boolean) => {
    setBusy(true);
    try {
      const path = await api.exportSites(csv);
      setNote({ tone: "ok", text: `Saved ${path}`, path });
    } catch (e) {
      setNote({ tone: "danger", text: String(e) });
    } finally {
      setBusy(false);
    }
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      setNote({ tone: "ok", text: importNote(await api.importSites(await file.text())) });
    } catch (e) {
      setNote({ tone: "danger", text: String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <h2>Your site list, in and out</h2>
      <p>
        Export saves your sites with their groups, tags, notes, clients and costs into Downloads. Passwords and sign-ins
        never go in the file. CSV has the site list only, for a spreadsheet. Import reads either back: connected sites
        get the file's groups, tags, clients and notes, and costs are added once.
      </p>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Menu
          small
          label="Export the sites"
          items={[
            { label: "Export as JSON (for importing again)", run: () => exportAs(false), disabled: busy },
            { label: "Export as CSV (for a spreadsheet)", run: () => exportAs(true), disabled: busy },
          ]}
        >
          Export the sites
        </Menu>
        <FilePicker label="Import a JSON or CSV file" accept=".json,.csv,application/json,text/csv" disabled={busy} onFile={importFile} />
      </div>
      <div role="status" className="notice">
        {note && (
          <p className={`alert ${note.tone}`}>
            {note.text}{" "}
            {note.path && (
              <Button small onClick={() => api.showFile(note.path!).catch((e) => setNote({ tone: "danger", text: String(e) }))}>
                Show in folder
              </Button>
            )}
          </p>
        )}
      </div>
    </section>
  );
}

/** Report branding, and the search numbers reports may add. Both integrations start off. */
function Reports() {
  const [s, setS] = useState<AppSettings | null>(null);
  const [gsc, setGsc] = useState<GscStatus | null>(null);
  const [client, setClient] = useState({ id: "", secret: "" });
  const [note, setNote] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.appSettings().then(setS, (e) => setNote({ tone: "danger", text: String(e) }));
    api.gscStatus().then(setGsc, () => {});
  }, []);
  if (!s) return null;
  const run = async (what: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setNote(null);
    try {
      await what();
      setNote({ tone: "ok", text: done });
    } catch (e) {
      setNote({ tone: "danger", text: String(e) });
    } finally {
      setBusy(false);
    }
  };
  const save = (next: AppSettings, done = "Saved.") =>
    run(async () => {
      setS(await api.saveAppSettings(next));
      setGsc(await api.gscStatus());
    }, done);
  return (
    <>
      <section>
        <h2>Reports</h2>
        <p>How monthly reports for your clients look. Leave the name empty to show none.</p>
        <label className="field">
          <span>Your business name</span>
          <input className="input" value={s.report_name} onChange={(e) => setS({ ...s, report_name: e.target.value })} />
        </label>
        <label className="field">
          <span>Line at the bottom of each page</span>
          <input className="input" placeholder="hello@yourstudio.com, +44 20 7946 0000" value={s.report_footer} onChange={(e) => setS({ ...s, report_footer: e.target.value })} />
        </label>
        <div className="field">
          <span>Accent colour</span>
          <ColorInput label="Accent colour" value={s.report_accent} onChange={(c) => setS({ ...s, report_accent: c })} />
          <small>Empty uses black.</small>
        </div>
        <label className="row check">
          <input type="checkbox" checked={s.white_label} onChange={(e) => setS({ ...s, white_label: e.target.checked })} />
          <span>White label: leave out &ldquo;Made with Monks Central&rdquo;</span>
        </label>
        <Button small kind="primary" disabled={busy} onClick={() => save(s)}>
          Save report settings
        </Button>
      </section>
      <section>
        <h2>Search numbers in reports</h2>
        <p>Both are off until you turn them on. Nothing is sent to Google while Search Console is off.</p>
        <label className="row check">
          <input type="checkbox" role="switch" checked={s.agentedseo} disabled={busy} onChange={(e) => save({ ...s, agentedseo: e.target.checked }, e.target.checked ? "AgentedSEO numbers go into reports for sites that have it." : "AgentedSEO is off.")} />
          <span>Read SEO numbers from AgentedSEO on sites that have it</span>
        </label>
        <label className="row check">
          <input type="checkbox" role="switch" checked={s.search_console} disabled={busy} onChange={(e) => save({ ...s, search_console: e.target.checked }, e.target.checked ? "Search Console is on. Add your Google client next." : "Search Console is off.")} />
          <span>Add Google Search Console clicks and searches to reports</span>
        </label>
        {s.search_console && gsc && (
          <div className="indent">
            <p className="dim">
              {gsc.connected
                ? "Your Google account is connected, read only."
                : gsc.client
                  ? "Your Google client is saved. Connect your Google account next."
                  : "Make an OAuth client of the Desktop app type in Google Cloud, with the Search Console API turned on, then paste its ID and secret here. They stay in this computer's keychain."}
            </p>
            {!gsc.client && (
              <>
                <label className="field">
                  <span>Client ID</span>
                  <input className="input" autoComplete="off" value={client.id} onChange={(e) => setClient({ ...client, id: e.target.value })} />
                </label>
                <label className="field">
                  <span>Client secret</span>
                  <input className="input" type="password" autoComplete="off" value={client.secret} onChange={(e) => setClient({ ...client, secret: e.target.value })} />
                </label>
              </>
            )}
            <div className="row" style={{ flexWrap: "wrap" }}>
              {!gsc.client && (
                <Button small disabled={busy || !client.id.trim() || !client.secret.trim()} onClick={() => run(async () => setGsc(await api.gscSetClient(client.id, client.secret)), "Saved your Google client.")}>
                  Save the client
                </Button>
              )}
              {gsc.client && !gsc.connected && (
                <Button small kind="primary" disabled={busy} onClick={() => run(async () => setGsc(await api.gscConnect()), "Connected to Search Console.")}>
                  Connect your Google account
                </Button>
              )}
              {gsc.client && (
                <Button small disabled={busy} onClick={() => run(async () => setGsc(await api.gscForget()), "Removed the Google client and sign-in from this computer.")}>
                  Remove the Google client
                </Button>
              )}
            </div>
            {busy && !gsc.connected && gsc.client && <p className="dim">Finish signing in to Google in your browser.</p>}
          </div>
        )}
        <div role="status" className="notice">
          {note && <p className={`alert ${note.tone}`}>{note.text}</p>}
        </div>
      </section>
    </>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** New versions come from GitHub Releases, signed; nothing installs without a click. */
function AppUpdate() {
  const [state, setState] = useState<{ busy?: "check" | "install"; ready?: string | null }>({});
  const check = async () => {
    setState({ busy: "check" });
    try {
      const ready = await api.updateCheck();
      setState({ ready });
      if (!ready) toast("You have the newest version of Monks Central.");
    } catch (e) {
      setState({});
      toast(String(e), { tone: "danger" });
    }
  };
  const install = async () => {
    setState({ ...state, busy: "install" });
    try {
      await api.updateInstall();
    } catch (e) {
      setState({ ready: state.ready });
      toast(String(e), { tone: "danger" });
    }
  };
  return (
    <section>
      <h2>Updates for Monks Central</h2>
      <p>New versions come from the Monks Central releases on GitHub. Each one is signed, and Monks Central checks the signature before it installs anything. Installing one restarts the app; your sites and settings stay.</p>
      <div className="row">
        {state.ready ? (
          <Button kind="primary" disabled={!!state.busy} onClick={install}>
            {state.busy === "install" ? "Installing…" : `Install ${state.ready} and restart`}
          </Button>
        ) : (
          <Button disabled={!!state.busy} onClick={check}>
            {state.busy === "check" ? "Checking…" : "Check for a new version"}
          </Button>
        )}
      </div>
    </section>
  );
}

function TextSize() {
  const [pct, setPct] = useState(textSize);
  return (
    <section>
      <h2>Text size</h2>
      <p>Makes every word in Monks Central bigger or smaller. Your computer's own text size still applies.</p>
      <Slider
        label="Text size"
        value={pct}
        min={90}
        max={130}
        step={10}
        format={(n) => `${n}%`}
        onChange={(n) => {
          setPct(n);
          setTextSize(n);
        }}
      />
    </section>
  );
}

type Props = {
  theme: ThemeChoice;
  setTheme: (t: ThemeChoice) => void;
  density: Density;
  setDensity: (d: Density) => void;
};

export function Settings({ theme, setTheme, density, setDensity }: Props) {
  return (
    <div className="scroll">
      <div className="settings">
        <section>
          <h2>Theme</h2>
          <p>Light, dark, or the same as your computer.</p>
          <Choice
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              ["system", "Same as my computer"],
              ["light", "Light"],
              ["dark", "Dark"],
            ]}
          />
        </section>
        <section>
          <h2>Row height</h2>
          <p>Comfortable is easier to read. Compact fits more sites on the screen.</p>
          <Choice
            label="Row height"
            value={density}
            onChange={setDensity}
            options={[
              ["comfortable", "Comfortable"],
              ["compact", "Compact"],
            ]}
          />
        </section>
        <TextSize />
        <AppUpdate />
        <Reports />
        <YourData />
      </div>
    </div>
  );
}
