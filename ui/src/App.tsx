// The shell: left rail, top bar, Ctrl K palette, theme. Direction B "Console".
import { Empty, Skeleton, Toaster, Tooltips, toast } from "./components/feedback";
import { useEffect, useMemo, useState } from "react";
import { ago, api, hasTool, siteStatus, useInventory, useMonitors, usePlans, useSecurity, useSites, type Change, type CoreStatus, type Site } from "./api";
import { useDensity, useTheme, type ThemeChoice } from "./theme";
import { Button, Kbd, Logo } from "./components/ui";
import { Palette, type Command } from "./components/Palette";
import { Select } from "./components/controls";
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
import { Security } from "./screens/Security";
import { Monitoring } from "./screens/Monitoring";
import { Clients } from "./screens/Clients";
import { Search } from "./screens/Search";
import { Store } from "./screens/Store";
import { Reports } from "./screens/Reports";
import { JobSheet, type PlanRow, type SheetState } from "./components/JobSheet";

export type { CoreStatus };

const GROUPS = [
  ["", ["Overview"]],
  ["Fleet", ["Sites", "Updates", "Plugins", "Themes"]],
  ["Content", ["Content", "Media", "Users", "Comments"]],
  ["Care", ["Classic Monks", "Monitoring", "Security"]],
  ["Business", ["Clients", "Store", "Reports"]],
  ["App", ["AI", "Settings"]],
] as const;

export const SECTIONS = GROUPS.flatMap(([, items]) => items);

// One line drawing per rail item, 16px, so the rail can be scanned by shape as well as by word.
const NAV_ICONS: Record<(typeof SECTIONS)[number], string> = {
  Overview: "M2.5 2.5h4.5v4.5h-4.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5h-4.5zM9 9h4.5v4.5H9z",
  Sites: "M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM1.5 8h13M8 1.5c2.2 2.2 2.2 10.8 0 13M8 1.5c-2.2 2.2-2.2 10.8 0 13",
  Updates: "M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3.5H10",
  Plugins: "M6 1.5v3M10 1.5v3M4 4.5h8v3a4 4 0 0 1-8 0zM8 11.5v3",
  Themes: "M2.5 2.5h11v11h-11zM2.5 6h11M6 6v7.5",
  Content: "M4 1.5h5.5l3 3v10H4zM9.5 1.5v3h3M6 8h4.5M6 10.5h4.5",
  Media: "M2 3h12v10H2zM2 11l3.5-3.5 3 3 2-2L14 12M10.5 6.2v.1",
  Users: "M8 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM2.5 14.5c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5",
  Comments: "M2 3h12v8H6.5L3.5 14v-3H2z",
  "Classic Monks": "M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM5.5 9.5c1.4 1.4 3.6 1.4 5 0M8 5.4v.2",
  Monitoring: "M1.5 8.5h3l1.5-4 3 7 1.5-3h4",
  Security: "M8 1.5l5.5 2v4c0 3.5-2.4 6-5.5 7-3.1-1-5.5-3.5-5.5-7v-4z",
  Clients: "M2 5h12v8.5H2zM5.5 5V3h5v2M2 9h12",
  Store: "M3 5h10l-.8 9.5H3.8zM5.5 5a2.5 2.5 0 0 1 5 0",
  Reports: "M2.5 13.5h11M4.5 11V7.5M8 11V3.5M11.5 11V6",
  AI: "M8 1.5l1.5 5 5 1.5-5 1.5-1.5 5-1.5-5-5-1.5 5-1.5z",
  Settings: "M2.5 4.5h11M2.5 11.5h11M5.5 2.5v4M10.5 9.5v4",
};
// Search is reached from the palette, not the rail.
type Section = (typeof SECTIONS)[number] | "Search";
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
  const { reports } = useSecurity();
  const monitors = useMonitors();
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [installing, setInstalling] = useState(false);
  // Errors float as toasts, so the screen under them doesn't move.
  const setJobError = (text: string) => toast(text, { tone: "danger" });
  const [scope, setScope] = useState("");
  const [focusId, setFocusId] = useState<number | null>(null);
  const [searchFor, setSearchFor] = useState("");
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
  const offline = (monitors ?? []).filter((m) => m.up === false).length;
  const vulnerable = (reports ?? []).reduce((n, r) => n + r.vulnerabilities.length, 0);

  const plan = (title: string, rows: PlanRow[], start: "plan" | "confirm" = "plan", danger?: boolean) =>
    setSheet({ title, rows, start, danger });
  const runNow = async (title: string, changes: Change[]) => {
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
    ...SECTIONS.map((s) => ({ id: `go-${s}`, group: "Go to", label: s, run: () => setSection(s) })),
    { id: "add", group: "Actions", label: "Add a site", keys: "A", run: () => setAdding({}) },
    { id: "check", group: "Actions", label: "Check all sites now", run: checkAll },
    {
      id: "update-all",
      group: "Actions",
      label: waiting.length ? `Update everything waiting (${waiting.length})` : "Update everything waiting (nothing now)",
      run: () => (waiting.length ? plan(planTitle(waiting), waiting) : setSection("Updates")),
    },
    { id: "install", group: "Actions", label: "Install a plugin", run: () => setInstalling(true) },
    { id: "scan", group: "Actions", label: "Scan all sites for security problems", run: () => api.scanSecurity().catch(() => {}) },
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
      <Skeleton label="Loading your sites…" />
    );
  } else if (all.length === 0 && !["Overview", "Sites", "Settings", "AI", "Clients"].includes(section)) {
    body = (
      <div className="scroll">
        <Empty
          picture="sites"
          title={`${section} fills in once you add a site.`}
          action={
            <Button kind="primary" keys="A" onClick={() => setAdding({})}>
              Add a site
            </Button>
          }
        >
          <p>Add a site with Classic Monks for full control, or any WordPress 7.1 site in Basic mode.</p>
        </Empty>
      </div>
    );
  } else if (section === "Overview") {
    body = (
      <Overview
        sites={scoped}
        onOpen={openSite}
        onCheck={(id) => api.check(id)}
        onSignInAgain={signInAgain}
        onAdd={() => setAdding({})}
        onGo={(s) => (s === "palette" ? setPalette(true) : setSection(s))}
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
    body = <Content sites={scoped} onPlan={plan} />;
  } else if (section === "Media") {
    body = <Media sites={scoped} />;
  } else if (section === "Users") {
    body = <Users sites={scoped} />;
  } else if (section === "Comments") {
    body = <Comments sites={scoped} />;
  } else if (section === "Classic Monks") {
    body = <ClassicMonks sites={scoped} />;
  } else if (section === "Monitoring") {
    body = <Monitoring sites={scoped} monitors={monitors ?? []} />;
  } else if (section === "Security") {
    body = <Security sites={scoped} reports={reports ?? []} inventory={inv} onPlan={(t, r) => plan(t, r)} />;
  } else if (section === "Clients") {
    body = <Clients sites={all} />;
  } else if (section === "Store") {
    body = <Store sites={scoped} onPlan={plan} />;
  } else if (section === "Reports") {
    body = <Reports sites={scoped} />;
  } else if (section === "Search") {
    body = (
      <Search
        key={searchFor}
        sites={all}
        inventory={inv}
        query={searchFor}
        onGo={(s, id) => (id ? openSite(id) : setSection(s))}
      />
    );
  } else if (section === "AI") {
    body = <Ai sites={all} plans={plans ?? []} focusPlan={focusPlan} onWatch={(job) => setSheet({ title: job.title, jobId: job.id })} />;
  } else {
    body = <Settings theme={choice} setTheme={setChoice} density={density} setDensity={setDensity} />;
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
        <Select className="scope" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Sites to show">
          <option value="">All sites ({all.length})</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g} ({all.filter((s) => s.group === g).length})
            </option>
          ))}
        </Select>
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
                    className="navitem"
                    aria-current={s === section ? "page" : undefined}
                    onClick={() => setSection(s)}
                  >
                    <svg className="nav-ico" viewBox="0 0 16 16" aria-hidden="true">
                      <path d={NAV_ICONS[s]} />
                    </svg>
                    {s}
                    {s === "Sites" && down > 0 && <span className="n alert">{down} down</span>}
                    {s === "AI" && (plans?.length ?? 0) > 0 && (
                      <span className="n alert">
                        {plans!.length}
                        <span className="sr-only"> to confirm</span>
                      </span>
                    )}
                    {s === "Monitoring" && offline > 0 && (
                      <span className="n alert">{offline} down</span>
                    )}
                    {s === "Security" && vulnerable > 0 && (
                      <span className="n alert">
                        {vulnerable}
                        <span className="sr-only"> known vulnerabilities</span>
                      </span>
                    )}
                    {s === "Updates" && waiting.length > 0 && (
                      <span className="n">
                        {waiting.length}
                        <span className="sr-only"> waiting</span>
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="foot">
          <p>
            Checks every 15 min, also from the tray.
            {nextCheck != null && ` Next in ${nextCheck} min.`}
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
        <main className="body" id="content" tabIndex={-1}>
          {body}
        </main>
      </div>
      {palette && (
        <Palette
          commands={commands}
          onClose={() => setPalette(false)}
          onSearch={(q) => {
            setSearchFor(q);
            setSection("Search");
          }}
        />
      )}
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
      <Toaster />
      <Tooltips />
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
