// Settings: how the app looks (remembered on this computer), and your site list in and out.
import { useState } from "react";
import { api, type Imported } from "../api";
import { Button } from "../components/ui";
import type { Density, ThemeChoice } from "../theme";

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
        <Button small disabled={busy} onClick={() => exportAs(false)}>
          Export as JSON
        </Button>
        <Button small disabled={busy} onClick={() => exportAs(true)}>
          Export as CSV
        </Button>
        <label className="btn sm file">
          Import a JSON or CSV file
          <input type="file" accept=".json,.csv,application/json,text/csv" disabled={busy} onChange={(e) => importFile(e.target.files?.[0]).then(() => (e.target.value = ""))} />
        </label>
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
        <YourData />
      </div>
    </div>
  );
}
