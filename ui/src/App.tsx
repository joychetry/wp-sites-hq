// The shell: left rail, top bar, Ctrl K palette, theme. Direction B "Console".
import { useEffect, useMemo, useState } from "react";
import { ago, api, siteStatus, useSites, type CoreStatus, type Site } from "./api";
import { useTheme, type ThemeChoice } from "./theme";
import { Button, Kbd, Logo } from "./components/ui";
import { Palette, type Command } from "./components/Palette";
import { Overview } from "./screens/Overview";
import { Sites } from "./screens/Sites";
import { AddSite } from "./screens/AddSite";

export type { CoreStatus };

const GROUPS = [
  ["", ["Overview"]],
  ["Fleet", ["Sites", "Updates", "Plugins", "Themes"]],
  ["Content", ["Content", "Media", "Users", "Comments"]],
  ["Care", ["Security", "Reports"]],
  ["App", ["AI", "Settings"]],
] as const;

export const SECTIONS = GROUPS.flatMap(([, items]) => items);
type Section = (typeof SECTIONS)[number];
const BUILT: Section[] = ["Overview", "Sites"];
const CHECK_EVERY = 15 * 60;

const THEME_NEXT: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };
const THEME_LABEL: Record<ThemeChoice, string> = {
  system: "Theme: follows the system",
  light: "Theme: light",
  dark: "Theme: dark",
};

export default function App() {
  const [section, setSection] = useState<Section>("Overview");
  const [status, setStatus] = useState<CoreStatus | null>(null);
  const [coreError, setCoreError] = useState<string | null>(null);
  const { sites, error } = useSites();
  const [scope, setScope] = useState("");
  const [focusId, setFocusId] = useState<number | null>(null);
  const [palette, setPalette] = useState(false);
  const [adding, setAdding] = useState<{ again?: Site } | null>(null);
  const [checking, setChecking] = useState(false);
  const { choice, setChoice } = useTheme();

  useEffect(() => {
    api.status().then(setStatus, (e) => setCoreError(String(e)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const all = sites ?? [];
  const groups = useMemo(() => [...new Set(all.flatMap((s) => (s.group ? [s.group] : [])))].sort(), [all]);
  const scoped = scope ? all.filter((s) => s.group === scope) : all;
  const lastCheck = Math.max(0, ...all.map((s) => s.checked_at ?? 0)) || null;
  const nextCheck = lastCheck ? Math.max(1, Math.ceil((lastCheck + CHECK_EVERY - Date.now() / 1000) / 60)) : null;
  const down = all.filter((s) => siteStatus(s).tone === "danger").length;

  const openSite = (id: number) => {
    setFocusId(id);
    setSection("Sites");
  };
  const checkAll = async () => {
    setChecking(true);
    await api.check().catch(() => {});
    setChecking(false);
  };
  const signInAgain = (id: number) => {
    const site = all.find((s) => s.id === id);
    if (site) setAdding({ again: site });
  };

  const commands: Command[] = [
    ...BUILT.map((s) => ({ id: `go-${s}`, group: "Go to", label: s, run: () => setSection(s) })),
    { id: "add", group: "Actions", label: "Add a site", keys: "A", run: () => setAdding({}) },
    { id: "check", group: "Actions", label: "Check all sites now", run: checkAll },
    {
      id: "theme",
      group: "Actions",
      label: `Switch theme (now ${choice === "system" ? "following the system" : choice})`,
      run: () => setChoice(THEME_NEXT[choice]),
    },
    ...all.map((s) => ({
      id: `site-${s.id}`,
      group: "Sites",
      label: s.name,
      hint: s.url.replace(/^https?:\/\//, ""),
      run: () => openSite(s.id),
    })),
    ...all
      .filter((s) => s.sign_in_again)
      .map((s) => ({ id: `again-${s.id}`, group: "Sites", label: `Sign in to ${s.name} again`, run: () => signInAgain(s.id) })),
  ];

  let body;
  if (coreError) {
    body = (
      <div className="empty" role="alert">
        <h2>Monks Central couldn't start.</h2>
        <p>{coreError}</p>
      </div>
    );
  } else if (error) {
    body = (
      <div className="empty" role="alert">
        <p>{error}</p>
      </div>
    );
  } else if (!sites) {
    body = <p className="empty">Starting…</p>;
  } else if (section === "Overview") {
    body = (
      <Overview
        sites={scoped}
        onOpen={openSite}
        onCheck={(id) => api.check(id)}
        onSignInAgain={signInAgain}
        onAdd={() => setAdding({})}
      />
    );
  } else if (section === "Sites") {
    body = (
      <Sites
        sites={scoped}
        groups={groups}
        focusId={focusId}
        setFocusId={setFocusId}
        onAdd={() => setAdding({})}
        onSignInAgain={(s) => setAdding({ again: s })}
      />
    );
  } else {
    body = (
      <div className="empty">
        <h2>{section}</h2>
        <p>{section} arrives in a later phase.</p>
      </div>
    );
  }

  return (
    <div className="app">
      <nav className="rail" aria-label="Main">
        <p className="brand">
          <Logo />
          Monks Central
        </p>
        <label className="scope">
          <span className="sr-only">Show</span>
          <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Sites to show">
            <option value="">All sites</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <span className="mono dim">{scoped.length}</span>
          <span className="dim" aria-hidden="true">
            ▾
          </span>
        </label>
        <button type="button" className="search" onClick={() => setPalette(true)}>
          Search or run
          <Kbd>Ctrl K</Kbd>
        </button>
        {GROUPS.map(([g, items]) => (
          <div key={g || "top"}>
            {g && <p className="navgroup">{g}</p>}
            <ul>
              {items.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    className={`navitem ${BUILT.includes(s) ? "" : "later"}`}
                    aria-current={s === section ? "page" : undefined}
                    onClick={() => setSection(s)}
                  >
                    {s}
                    {s === "Sites" && sites && (
                      <span className={`n ${down ? "alert" : ""}`}>{down ? `${down} down` : all.length}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="foot">
          <p>
            Checks run while the app is open.
            {nextCheck != null && ` Next check in ${nextCheck} min.`}
          </p>
          {status && (
            <p className="mono">
              {status.version} · {status.role}
            </p>
          )}
          <button type="button" onClick={() => setChoice(THEME_NEXT[choice])}>
            {THEME_LABEL[choice]}
          </button>
        </div>
      </nav>
      <div className="main">
        <header className="top">
          <h1 className="crumb">
            {section}
            {section === "Sites" && <span>/ {scope || "All"}</span>}
          </h1>
          {sites && sites.length > 0 && (
            <div className="fresh">
              {lastCheck && `Checked ${ago(lastCheck)}`}
              <Button small disabled={checking} onClick={checkAll}>
                {checking ? "Checking…" : "Check all sites now"}
              </Button>
            </div>
          )}
        </header>
        <main className="body">{body}</main>
      </div>
      {palette && <Palette commands={commands} onClose={() => setPalette(false)} />}
      {adding && (
        <AddSite
          again={adding.again}
          onClose={() => setAdding(null)}
          onDone={(site) => {
            setAdding(null);
            openSite(site.id);
          }}
        />
      )}
    </div>
  );
}
