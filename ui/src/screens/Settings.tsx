// SPDX-License-Identifier: GPL-3.0-or-later
// Settings: how the app looks (remembered on this computer), how reports look,
// Search Console and AgentedSEO, and your site list in and out.
import { ColorInput, FilePicker, Slider } from "../components/controls";
import { useEffect, useState, type ReactNode } from "react";
import "../styles/screens/settings.css";
import { api, useAppUpdate, type AppSettings, type GscStatus, type Imported } from "../api";
import { when } from "./Overview";
import { Button, Glyph, type GlyphName } from "../components/ui";
import { Sheet } from "../components/Sheet";
import { toast } from "../components/feedback";
import { Page } from "../components/page";
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

const fail = (e: unknown) => toast(String(e), { tone: "danger" });

/** A card with an icon and a title in its head. */
function Card({ icon, title, id, children }: { icon: GlyphName; title: string; id: string; children: ReactNode }) {
  return (
    <section className="card" aria-labelledby={id}>
      <div className="card-head">
        <h2 id={id}>
          <Glyph name={icon} />
          {title}
        </h2>
      </div>
      <div className="card-body">{children}</div>
    </section>
  );
}

function YourData() {
  const [busy, setBusy] = useState(false);
  const exportAs = async (csv: boolean) => {
    setBusy(true);
    try {
      const path = await api.exportSites(csv);
      toast(`Saved ${path}`, { action: { label: "Show in folder", icon: "folder", run: () => api.showFile(path).catch(fail) } });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await api.importSites(await file.text());
      // A list of sites left out is worth reading at leisure.
      toast(importNote(r), { stay: r.not_connected.length > 0 });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card icon="folder" title="Your data" id="set-data">
      <p className="hint">
        Take your sites, groups, tags, notes, clients and costs with you, or bring them in from another computer. Exports go into
        Downloads; passwords and sign-ins never go in the file. CSV has the site list only, for a spreadsheet.
      </p>
      <div className="row acts-row">
        <Button small disabled={busy} onClick={() => exportAs(false)}>
          Export as JSON
          <Glyph name="download" />
        </Button>
        <Button small disabled={busy} onClick={() => exportAs(true)}>
          Export as CSV
          <Glyph name="download" />
        </Button>
        <FilePicker label="Import a JSON or CSV file" accept=".json,.csv,application/json,text/csv" disabled={busy} onFile={importFile} />
      </div>
    </Card>
  );
}

/** Report branding, and the search numbers reports may add. Both integrations start off. */
function useReportSettings() {
  const [s, setS] = useState<AppSettings | null>(null);
  const [gsc, setGsc] = useState<GscStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.appSettings().then(setS, fail);
    api.gscStatus().then(setGsc, () => {});
  }, []);
  const run = async (what: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await what();
      toast(done);
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const save = (next: AppSettings, done = "Saved.") =>
    run(async () => {
      setS(await api.saveAppSettings(next));
      setGsc(await api.gscStatus());
    }, done);
  return { s, setS, gsc, setGsc, busy, run, save };
}
type ReportSettings = ReturnType<typeof useReportSettings>;

function Reports({ s, setS, busy, save }: ReportSettings & { s: AppSettings }) {
  const accent = /^#[0-9a-f]{6}$/i.test(s.report_accent) ? s.report_accent : "#111111";
  return (
    <Card icon="file" title="Reports" id="set-reports">
      <label className="field">
        <span>Your business name</span>
        <input className="input" placeholder="Shown at the top of every report" value={s.report_name} onChange={(e) => setS({ ...s, report_name: e.target.value })} />
      </label>
      <label className="field">
        <span>Line at the bottom of each page</span>
        <input className="input" placeholder="For example, your website and phone number" value={s.report_footer} onChange={(e) => setS({ ...s, report_footer: e.target.value })} />
      </label>
      <div className="field">
        <span>Accent colour</span>
        <ColorInput label="Accent colour" value={s.report_accent} onChange={(c) => setS({ ...s, report_accent: c })} />
        <small>Empty uses black.</small>
      </div>
      <label className="row check">
        <input type="checkbox" checked={s.white_label} onChange={(e) => setS({ ...s, white_label: e.target.checked })} />
        <span>White label: leave out &ldquo;Made with WP Sites HQ&rdquo;</span>
      </label>
      <div className="rpreview" aria-label="Preview" role="group">
        <span className="label">Preview</span>
        <div style={{ borderTopColor: accent }}>
          <b>{s.report_name || "[Your business name]"}</b>
          <span>Monthly report · your client</span>
          {(s.report_footer || !s.white_label) && (
            <small>
              <span>{s.report_footer}</span>
              {!s.white_label && <span>Made with WP Sites HQ</span>}
            </small>
          )}
        </div>
      </div>
      <div>
        <Button kind="primary" className="disc" disabled={busy} onClick={() => save(s)}>
          Save report settings
          <span className="btn-disc">
            <Glyph name="check" />
          </span>
        </Button>
      </div>
    </Card>
  );
}

function DataSources({ s, gsc, setGsc, busy, run, save }: ReportSettings & { s: AppSettings }) {
  const [setup, setSetup] = useState(false);
  const [client, setClient] = useState({ id: "", secret: "" });
  const gscLine = !s.search_console
    ? "Clicks and searches for each site. Nothing is sent to Google while this is off."
    : gsc?.connected
      ? "Your Google account is connected, read only."
      : gsc?.client
        ? "Your Google client is saved. Connect your Google account next."
        : "Needs your own Google client. Set it up to start.";
  return (
    <Card icon="chart" title="Data sources" id="set-sources">
      <div className="dsrc">
        <input
          type="checkbox"
          role="switch"
          id="ds-seo"
          aria-describedby="ds-seo-d"
          checked={s.agentedseo}
          disabled={busy}
          onChange={(e) => save({ ...s, agentedseo: e.target.checked }, e.target.checked ? "AgentedSEO numbers go into reports for sites that have it." : "AgentedSEO is off.")}
        />
        <div>
          <label htmlFor="ds-seo">Read SEO numbers from AgentedSEO</label>
          <span id="ds-seo-d">On sites that have it installed.</span>
        </div>
      </div>
      <div className="dsrc">
        <input
          type="checkbox"
          role="switch"
          id="ds-gsc"
          aria-describedby="ds-gsc-d"
          checked={s.search_console}
          disabled={busy}
          onChange={async (e) => {
            const on = e.target.checked;
            const ok = await save({ ...s, search_console: on }, on ? "Search Console is on. Add your Google client next." : "Search Console is off.");
            if (ok && on && !gsc?.client) setSetup(true);
          }}
        />
        <div>
          <label htmlFor="ds-gsc">Add Google Search Console to reports</label>
          <span id="ds-gsc-d">{gscLine}</span>
          {s.search_console && gsc?.client && (
            <div className="row acts-row">
              {!gsc.connected && (
                <Button small kind="primary" disabled={busy} onClick={() => run(async () => setGsc(await api.gscConnect()), "Connected to Search Console.")}>
                  Connect your Google account
                </Button>
              )}
              <Button small className="ghost" disabled={busy} onClick={() => run(async () => setGsc(await api.gscForget()), "Removed the Google client and sign-in from this computer.")}>
                Remove the Google client
              </Button>
            </div>
          )}
          {busy && s.search_console && gsc?.client && !gsc.connected && <span>Finish signing in to Google in your browser.</span>}
        </div>
        {s.search_console && gsc && !gsc.client && (
          <Button small onClick={() => setSetup(true)}>
            Set up
          </Button>
        )}
      </div>
      {setup && (
        <Sheet
          dialog
          title="Google Search Console"
          icon={
            <span className="tile neutral">
              <Glyph name="chart" />
            </span>
          }
          intro="Add your own OAuth client so reports can read clicks and searches."
          onClose={() => setSetup(false)}
          footer={
            <>
              <Button onClick={() => setSetup(false)}>Cancel</Button>
              <Button
                kind="primary"
                className="disc"
                disabled={busy || !client.id.trim() || !client.secret.trim()}
                onClick={async () => {
                  if (await run(async () => setGsc(await api.gscSetClient(client.id, client.secret)), "Saved your Google client.")) setSetup(false);
                }}
              >
                Save the client
                <span className="btn-disc">
                  <Glyph name="check" />
                </span>
              </Button>
            </>
          }
        >
          <p className="callout">
            <Glyph name="info" />
            <span>Make an OAuth client of the Desktop app type in Google Cloud, with the Search Console API turned on, then paste its ID and secret here.</span>
          </p>
          <label className="field">
            <span>Client ID</span>
            <input className="input mono" spellCheck={false} autoComplete="off" value={client.id} onChange={(e) => setClient({ ...client, id: e.target.value })} />
          </label>
          <div className="field">
            <label className="field">
              <span>Client secret</span>
              <input className="input" type="password" autoComplete="off" aria-describedby="gsc-kept" value={client.secret} onChange={(e) => setClient({ ...client, secret: e.target.value })} />
            </label>
            <small className="lockline" id="gsc-kept">
              <Glyph name="lock" />
              Kept in this computer&rsquo;s keychain.
            </small>
          </div>
        </Sheet>
      )}
    </Card>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: [T, string, GlyphName?][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented inline" role="group" aria-label={label}>
      {options.map(([v, text, icon]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
          {icon && <Glyph name={icon} />}
        </button>
      ))}
    </div>
  );
}

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

/**
 * New versions come from GitHub Releases, signed. Off by default a click installs; with "Install updates
 * automatically" on, the app downloads in the background and installs when nothing is running (see App).
 */
function AppUpdate({ s, save, saving }: { s: AppSettings | null; save: ReportSettings["save"]; saving: boolean }) {
  const { data: st, reload } = useAppUpdate();
  const [busy, setBusy] = useState<"check" | "install" | null>(null);
  const check = async () => {
    setBusy("check");
    try {
      if (!(await api.updateCheck()).found) toast("You have the newest version of WP Sites HQ.");
      reload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  // A successful install restarts the app, so only a failure comes back.
  const install = async () => {
    setBusy("install");
    try {
      await api.updateInstall();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const found = st?.found;
  const progress = st?.progress;
  return (
    <Card icon="refresh" title="Updates for WP Sites HQ" id="set-app">
      <p className="hint">
        New versions come from the WP Sites HQ releases on GitHub. Each one is signed, and WP Sites HQ checks the signature before it
        installs anything. It looks for one at start and every six hours. Installing restarts the app; your sites and settings stay.
      </p>
      <dl className="upd-facts">
        <dt>This version</dt>
        <dd>{st?.current ?? "…"}</dd>
        <dt>Last checked</dt>
        <dd>{st?.checked_at ? when(st.checked_at) : "Not yet"}</dd>
        <dt>New version</dt>
        <dd>{found ? found.version + (found.date ? `, released ${new Date(found.date * 1000).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })}` : "") : "None, you have the newest"}</dd>
      </dl>
      {found && (
        <section className="upd-notes" aria-label={`What's new in ${found.version}`}>
          <b>What&rsquo;s new in {found.version}</b>
          {/* Plain text: React escapes it, so nothing in latest.json can run as HTML. */}
          <p>{found.notes.replace(/^#+\s*/gm, "").trim() || "This version has no notes."}</p>
        </section>
      )}
      {progress && (
        <p className="hint" aria-live="polite">
          Downloading {found?.version}: {mb(progress[0])}
          {progress[1] ? ` of ${mb(progress[1])}` : ""}
        </p>
      )}
      {st?.ready && s?.auto_update && <p className="hint">Downloaded and checked. It installs when no job or site change is running and nothing is unsaved.</p>}
      {s && (
        <div className="dsrc">
          <input
            type="checkbox"
            role="switch"
            id="upd-auto"
            aria-describedby="upd-auto-d"
            checked={s.auto_update}
            disabled={saving}
            onChange={async (e) => {
              const on = e.target.checked;
              const ok = await save({ ...s, auto_update: on }, on ? "New versions now install by themselves when nothing is running." : "New versions now wait for your click.");
              // Start the download now rather than at the next check.
              if (ok && on) api.updateCheck().catch(() => {});
            }}
          />
          <div>
            <label htmlFor="upd-auto">Install updates automatically</label>
            <span id="upd-auto-d">Downloads in the background, then installs and restarts when no job or site change is running and nothing is unsaved.</span>
          </div>
        </div>
      )}
      <div className="row acts-row">
        <Button small disabled={!!busy} onClick={check}>
          {busy === "check" ? "Checking…" : "Check now"}
        </Button>
        {found && (
          <Button small kind="primary" disabled={!!busy || !!progress} onClick={install}>
            {busy === "install" ? "Installing…" : `Install ${found.version} now`}
          </Button>
        )}
      </div>
    </Card>
  );
}

type Props = {
  theme: ThemeChoice;
  setTheme: (t: ThemeChoice) => void;
  density: Density;
  setDensity: (d: Density) => void;
};

export function Settings({ theme, setTheme, density, setDensity }: Props) {
  const [pct, setPct] = useState(textSize);
  const rs = useReportSettings();
  return (
    <Page className="setpage">
      <div className="g2">
        <div className="stack">
          <Card icon="sun" title="Look" id="set-look">
            <div className="field">
              <span>Theme</span>
              <Choice
                label="Theme"
                value={theme}
                onChange={setTheme}
                options={[
                  ["system", "Same as my computer", "monitor"],
                  ["light", "Light", "sun"],
                  ["dark", "Dark", "moon"],
                ]}
              />
            </div>
            <div className="field">
              <span>Density</span>
              <Choice
                label="Density"
                value={density}
                onChange={setDensity}
                options={[
                  ["comfortable", "Comfortable"],
                  ["compact", "Compact"],
                ]}
              />
              <small>Comfortable is easier to read. Compact fits more sites on the screen.</small>
            </div>
            <div className="field">
              <span>Text size</span>
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
              <small>Makes every word in WP Sites HQ bigger or smaller. Your computer&rsquo;s own text size still applies.</small>
            </div>
          </Card>
          {rs.s && <DataSources {...rs} s={rs.s} />}
          <YourData />
          <AppUpdate s={rs.s} save={rs.save} saving={rs.busy} />
        </div>
        {rs.s && <Reports {...rs} s={rs.s} />}
      </div>
    </Page>
  );
}
