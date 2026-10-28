// The shell: left rail, top bar, Ctrl K palette, theme. Direction B "Console".
import { useEffect, useMemo, useState } from "react";
import { ago, api, hasTool, siteStatus, useInventory, usePlans, useSites, type Change, type CoreStatus, type Site } from "./api";
import { useDensity, useTheme, type ThemeChoice } from "./theme";
import { Button, Kbd, Logo } from "./components/ui";
import { Palette, type Command } from "./components/Palette";
import { Overview } from "./screens/Overview";
import { Sites } from "./screens/Sites";
import { AddSite } from "./screens/AddSite";
import { Settings } from "./screens/Settings";
import { planTitle, Updates, updatesOf } from "./screens/Updates";
import { Matrix } from "./screens/Matrix";
import { Install } from "./screens/Install";
import { Content } from "./screens/Content";
import { Media } from "./screens/Media";
import { Users } from "./screens/Users";
import { Comments } from "./screens/Comments";
import { ClassicMonks } from "./screens/ClassicMonks";
import { Ai } from "./screens/Ai";
import { JobSheet, type PlanRow, type SheetState } from "./components/JobSheet";

export type { CoreStatus };

const GROUPS = [
  ["", ["Overview"]],
  ["Fleet", ["Sites", "Updates", "Plugins", "Themes"]],
  ["Content", ["Content", "Media", "Users", "Comments"]],
  ["Care", ["Classic Monks", "Security", "Reports"]],
  ["App", ["AI", "Settings"]],
] as const;

export const SECTIONS = GROUPS.flatMap(([, items]) => items);
type Section = (typeof SECTIONS)[number];
const BUILT: Section[] = ["Overview", "Sites", "Updates", "Plugins", "Themes", "Content", "Media", "Users", "Comments", "Classic Monks", "AI", "Settings"];
const CHECK_EVERY = 15 * 60;

const THEME_NEXT: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };
const THEME_LABEL: Record<ThemeChoice, string> = {
  system: "Theme: same as my computer",
  light: "Theme: light",
  dark: "Theme: dark",
};

export default function App() {
  const [section, setSection] = useState<Section>("Overview");
  const [status, setStatus] = useState<CoreStatus | null>(null);
  const [coreError, setCoreError] = useState<string | null>(null);
  const { sites, error, reload } = useSites();
  const { inventory } = useInventory();
  const { plans } = usePlans();
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [installing, setInstalling] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);
  const [scope, setScope] = useState("");
  const [focusId, setFocusId] = useState<number | null>(null);
  const [focusPlan, setFocusPlan] = useState<number | null>(null);
  const [palette, setPalette] = useState(false);
  const [adding, setAdding] = useState<{ again?: Site } | null>(null);
  const [checking, setChecking] = useState(false);
  const { choice, setChoice } = useTheme();
  const { density, setDensity } = useDensity();

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
  const inv = inventory ?? new Map();
  const waiting = scoped.flatMap((s) => updatesOf(s, inv.get(s.id)));

  const plan = (title: string, rows: PlanRow[], start: "plan" | "confirm" = "plan", danger?: boolean) =>
    setSheet({ title, rows, start, danger });
  const runNow = async (title: string, changes: Change[]) => {
    setJobError(null);
    try {
      const job = await api.startJob(title, changes);
      setSheet({ title, jobId: job.id });
    } catch (e) {
      setJobError(`${title}: ${e}`);
    }
  };

  const openSite = (id: number) => {
    setFocusId(id);
    setSection("Sites");
  };
  const checkAll = async () => {
    setChecking(true);
    await api.check().catch(() => {});
    setChecking(false);
  };
  const login = (s: Site) => api.login(s.id).catch((e) => setJobError(`Log in to ${s.name}: ${e}`));
  const signInAgain = (id: number) => {
    const site = all.find((s) => s.id === id);
    if (site) setAdding({ again: site });
  };

  const commands: Command[] = [
    ...BUILT.map((s) => ({ id: `go-${s}`, group: "Go to", label: s, run: () => setSection(s) })),
    { id: "add", group: "Actions", label: "Add a site", keys: "A", run: () => setAdding({}) },
    { id: "check", group: "Actions", label: "Check all sites now", run: checkAll },
    {
      id: "update-all",
      group: "Actions",
      label: waiting.length ? `Update everything waiting (${waiting.length})` : "Update everything waiting (nothing now)",
      run: () => (waiting.length ? plan(planTitle(waiting), waiting) : setSection("Updates")),
    },
    { id: "install", group: "Actions", label: "Install a plugin", run: () => setInstalling(true) },
    { id: "read", group: "Actions", label: "Read every site's plugins and themes again", run: () => api.refreshInventory().catch(() => {}) },
    {
      id: "theme",
      group: "Actions",
      label: `Switch theme (now ${choice === "system" ? "the same as your computer" : choice})`,
      run: () => setChoice(THEME_NEXT[choice]),
    },
    {
      id: "density",
      group: "Actions",
      label: density === "compact" ? "Use comfortable rows" : "Use compact rows",
      run: () => setDensity(density === "compact" ? "comfortable" : "compact"),
    },
    ...(plans ?? []).map((p) => ({
      id: `plan-${p.id}`,
      group: "Actions",
      label: `Review the AI agent's plan: ${p.title}`,
      run: () => {
        setFocusPlan(p.id);
        setSection("AI");
      },
    })),
    ...all.map((s) => ({
      id: `site-${s.id}`,
      group: "Sites",
      label: s.name,
      hint: s.url.replace(/^https?:\/\//, ""),
      run: () => openSite(s.id),
    })),
    ...all
      .filter((s) => hasTool(s, "create-login-link") && !s.sign_in_again)
      .map((s) => ({ id: `login-${s.id}`, group: "Sites", label: `Log in to ${s.name}'s dashboard`, run: () => login(s) })),
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
        <p>Close Monks Central and open it again. If it keeps happening, restart the computer.</p>
        <Button onClick={() => location.reload()}>Try again</Button>
      </div>
    );
  } else if (error) {
    body = (
      <div className="empty" role="alert">
        <h2>Your sites didn't load.</h2>
        <p>{error}</p>
        <Button onClick={reload}>Try again</Button>
      </div>
    );
  } else if (!sites) {
    body = (
      <p className="empty" role="status">
        Loading your sites…
      </p>
    );
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
  } else if (section === "Updates") {
    body = <Updates sites={scoped} inventory={inv} onPlan={(t, r) => plan(t, r)} />;
  } else if (section === "Plugins" || section === "Themes") {
    body = (
      <Matrix
        key={section}
        kind={section === "Plugins" ? "plugins" : "themes"}
        sites={scoped}
        inventory={inv}
        onPlan={plan}
        onRun={runNow}
        onInstall={section === "Plugins" ? () => setInstalling(true) : undefined}
      />
    );
  } else if (section === "Content") {
    body = <Content sites={scoped} />;
  } else if (section === "Media") {
    body = <Media sites={scoped} />;
  } else if (section === "Users") {
    body = <Users sites={scoped} />;
  } else if (section === "Comments") {
    body = <Comments sites={scoped} />;
  } else if (section === "Classic Monks") {
    body = <ClassicMonks sites={scoped} />;
  } else if (section === "AI") {
    body = <Ai sites={all} plans={plans ?? []} focusPlan={focusPlan} onWatch={(job) => setSheet({ title: job.title, jobId: job.id })} />;
  } else if (section === "Settings") {
    body = <Settings theme={choice} setTheme={setChoice} density={density} setDensity={setDensity} />;
  } else {
    body = (
      <div className="empty">
        <h2>{section} is coming soon.</h2>
        <p>It arrives in a later version of Monks Central. Your sites, their health and their versions are on Sites.</p>
        <Button onClick={() => setSection("Sites")}>Go to Sites</Button>
      </div>
    );
  }

  return (
    <div className="app">
      <a className="skip" href="#content">
        Skip to content
      </a>
      <nav className="rail" aria-label="Main">
        <p className="brand">
          <Logo />
          Monks Central
        </p>
        <label className="scope">
          <span className="sr-only">Show</span>
          <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Sites to show">
            <option value="">All sites ({all.length})</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g} ({all.filter((s) => s.group === g).length})
              </option>
            ))}
          </select>
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
                    {s === "Sites" && down > 0 && <span className="n alert">{down} down</span>}
                    {s === "AI" && (plans?.length ?? 0) > 0 && (
                      <span className="n alert">
                        {plans!.length}
                        <span className="sr-only"> to confirm</span>
                      </span>
                    )}
                    {s === "Updates" && waiting.length > 0 && (
                      <span className="n">
                        {waiting.length}
                        <span className="sr-only"> waiting</span>
                      </span>
                    )}
                    {!BUILT.includes(s) && <span className="n">Soon</span>}
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
          {status && <p>Version {status.version}</p>}
          <button type="button" onClick={() => setChoice(THEME_NEXT[choice])}>
            {THEME_LABEL[choice]}
          </button>
        </div>
      </nav>
      <div className="main">
        <header className="top">
          <h1 className="crumb">
            {section}
            {["Sites", "Plugins", "Themes"].includes(section) && <span>/ {scope || "All sites"}</span>}
            {section === "Updates" && <span>/ {waiting.length} waiting</span>}
          </h1>
          {sites && sites.length > 0 && (
            <div className="fresh">
              <span role="status">{checking ? "Checking all sites…" : lastCheck && `Checked ${ago(lastCheck)}`}</span>
              <Button small disabled={checking} onClick={checkAll}>
                {checking ? "Checking…" : "Check all sites now"}
              </Button>
            </div>
          )}
        </header>
        <div role="status" className="notice">
          {jobError && <p className="alert danger">{jobError}</p>}
        </div>
        <main className="body" id="content" tabIndex={-1}>
          {body}
        </main>
      </div>
      {palette && <Palette commands={commands} onClose={() => setPalette(false)} />}
      {sheet && <JobSheet key={"jobId" in sheet ? sheet.jobId : sheet.title} state={sheet} onClose={() => setSheet(null)} />}
      {installing && (
        <Install
          sites={scoped}
          inventory={inv}
          onClose={() => setInstalling(false)}
          onPlan={(t, r) => {
            setInstalling(false);
            plan(t, r, "confirm");
          }}
        />
      )}
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
