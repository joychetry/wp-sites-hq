// SPDX-License-Identifier: GPL-3.0-or-later
// The shell: sidebar, top bar, page head, Ctrl K palette, theme (docs/design/redesign).
import { Empty, Skeleton, Toaster, Tooltips, dismissAll, toast } from "./components/feedback";
import { useEffect, useMemo, useState } from "react";
import { ago, api, hasTool, useInventory, useMonitors, usePlans, useSecurity, useSites, type Change, type CoreStatus, type Site } from "./api";
import { useDensity, useTheme, type ThemeChoice } from "./theme";
import { Button, Glyph, HeadSlot, Kbd, Logo, type GlyphName } from "./components/ui";
import { Palette, type Command } from "./components/Palette";
import { Select } from "./components/controls";
import { attention, Overview, summary } from "./screens/Overview";
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
  ["App", ["AI", "Settings", "Search"]],
] as const;

export const SECTIONS = GROUPS.flatMap(([, items]) => items);

// One of the design's line icons per sidebar item (Classic Monks shows its own mark).
const NAV_ICONS: Record<(typeof SECTIONS)[number], GlyphName | null> = {
  Overview: "dashboard",
  Sites: "globe",
  Updates: "download",
  Plugins: "plug",
  Themes: "palette",
  Content: "file",
  Media: "image",
  Users: "users",
  Comments: "message",
  "Classic Monks": null,
  Monitoring: "activity",
  Security: "shield",
  Clients: "briefcase",
  Store: "bag",
  Reports: "chart",
  AI: "sparkle",
  Settings: "gear",
  Search: "search",
};
type Section = (typeof SECTIONS)[number];
const LABEL: Partial<Record<Section, string>> = { Search: "Search everything" };

// The line under each page title.
const ABOUT: Record<Section, string> = {
  Overview: "What needs you across the fleet, right now.",
  Sites: "See every site, open it, and keep its notes.",
  Updates: "Every pending update across the fleet. Pick what to run, review exactly what changes, then run it.",
  Plugins: "Every plugin on every site in one grid. Open a cell to manage that plugin on that site.",
  Themes: "Every theme on every site in one grid. Open a cell to manage that theme on that site.",
  Content: "Posts, pages and every custom post type, site by site.",
  Media: "Browse a site's media library and bring in images by link.",
  Users: "Every user on every site. Add people, change roles, and remove them.",
  Comments: "Moderate every site's comments in one queue.",
  "Classic Monks": "Switch module features on each site, change their settings, and undo what changed.",
  Monitoring: "Uptime and speed of every home page.",
  Security: "Known vulnerabilities across the fleet, fixed in one place.",
  Clients: "Who owns which sites, and what each one costs you and earns you.",
  Store: "WooCommerce sales and stock, site by site.",
  Reports: "A monthly client report, as a PDF and a web page, with your branding.",
  AI: "Confirm what AI agents plan to change, and decide which sites they can reach. Nothing runs without your OK.",
  Settings: "How the app looks, how your reports are branded, where numbers come from, and your data.",
  Search: "Find any post, page or product across every site.",
};
const CHECK_EVERY = 15 * 60;

const THEME_NEXT: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };
const THEMES: [ThemeChoice, GlyphName, string][] = [
  ["system", "monitor", "Theme: same as my computer"],
  ["light", "sun", "Theme: light"],
  ["dark", "moon", "Theme: dark"],
];

export default function App() {
  const [section, setSection] = useState<Section>("Overview");
  // Messages belong to the screen they came from; on another screen they would only cover it.
  useEffect(() => dismissAll(), [section]);
  const [status, setStatus] = useState<CoreStatus | null>(null);
  const [coreError, setCoreError] = useState<string | null>(null);
  const { sites, error, reload } = useSites();
  const { inventory } = useInventory();
  const { plans } = usePlans();
  const livePlans = (plans ?? []).filter((p) => !p.expired).length;
  const { reports } = useSecurity();
  const monitors = useMonitors();
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [installing, setInstalling] = useState(false);
  // Errors float as toasts, so the screen under them doesn't move.
  const setJobError = (text: string) => toast(text, { tone: "danger" });
  const [scopeChoice, setScope] = useState("");
  const [focusId, setFocusId] = useState<number | null>(null);
  const [searchFor, setSearchFor] = useState("");
  const [focusPlan, setFocusPlan] = useState<number | null>(null);
  const [palette, setPalette] = useState(false);
  const [adding, setAdding] = useState<{ again?: Site } | null>(null);
  const [checking, setChecking] = useState(false);
  const [headSlot, setHeadSlot] = useState<HTMLDivElement | null>(null);
  const { choice, setChoice } = useTheme();
  const { density, setDensity } = useDensity();

  useEffect(() => {
    api.status().then(setStatus, (e) => setCoreError(String(e)));
    // Offline or GitHub unreachable: say nothing; Settings checks on request.
    api.updateCheck().then(
      (v) => v && toast(`Monks Central ${v} is ready. Install it in Settings, under Updates for Monks Central.`, { tone: "info", stay: true }),
      () => {},
    );
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
  // A group that no longer has sites falls back to all sites instead of an empty app.
  const scope = groups.includes(scopeChoice) ? scopeChoice : "";
  const scoped = scope ? all.filter((s) => s.group === scope) : all;
  const lastCheck = Math.max(0, ...all.map((s) => s.checked_at ?? 0)) || null;
  // A check that is already due shows the next round, never a time in the past.
  const nextCheck = lastCheck
    ? new Date(Math.max(lastCheck + CHECK_EVERY, Date.now() / 1000 + 60) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
  const needs = scoped.filter((s) => attention(s)).length;
  const { lead, rest } = summary(scoped);
  const sentence = rest ? `${lead} ${rest}` : lead;
  const inv = inventory ?? new Map();
  const waiting = scoped.flatMap((s) => updatesOf(s, inv.get(s.id)));
  const offline = (monitors ?? []).filter((m) => m.up === false).length;
  const vulnerable = (reports ?? []).reduce((n, r) => n + r.vulnerabilities.length, 0);
  const approvals = scoped.reduce((n, s) => n + (Number(s.capabilities.pending_approvals) || 0), 0);
  const ofKind = (k: string) => new Set(waiting.filter((w) => w.kind === k).map((w) => w.name)).size;
  // The design's sidebar counts: what waits on each page, amber where something is wrong.
  const counts: Partial<Record<Section, { n: number; say: string; alert?: boolean }>> = Object.fromEntries(
    (
      [
        ["Overview", needs, "need attention", true],
        ["Sites", scoped.length, scoped.length === 1 ? "site" : "sites"],
        ["Updates", waiting.length, "waiting"],
        ["Plugins", ofKind("Plugin"), "with an update waiting"],
        ["Themes", ofKind("Theme"), "with an update waiting"],
        ["Classic Monks", approvals, "waiting for approval"],
        ["Monitoring", offline, "down", true],
        ["Security", vulnerable, "known vulnerabilities", true],
        ["AI", livePlans, "to confirm"],
      ] as const
    )
      .filter(([, n]) => n > 0)
      .map(([s, n, say, alert]) => [s, { n, say, alert }]),
  );

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
    ...(plans ?? []).filter((p) => !p.expired).map((p) => ({
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
        waiting={waiting}
        plans={plans ?? []}
        reports={reports ?? []}
        monitors={monitors ?? []}
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
        <div className="brand">
          <Logo />
          <p>
            Monks Central
            <small>by Classic Monks</small>
          </p>
        </div>
        <div className="scope-field">
          <span className="label" aria-hidden="true">
            Sites to show
          </span>
          <Select className="scope sm" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Sites to show">
            <option value="">All sites ({all.length})</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                Group: {g}
              </option>
            ))}
          </Select>
        </div>
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
                    {NAV_ICONS[s] ? <Glyph name={NAV_ICONS[s]} /> : <Logo />}
                    {LABEL[s] ?? s}
                    {counts[s] && (
                      <span className={counts[s].alert ? "n alert" : "n"}>
                        {counts[s].n}
                        <span className="sr-only"> {counts[s].say}</span>
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="foot">
          <p className="next">
            <Glyph name="clock" />
            <span>
              <b>{nextCheck ? `Next check at ${nextCheck}.` : "Checks every 15 minutes."}</b> Automatic checks run only while the app
              or its tray agent is open.
            </span>
          </p>
          <div className="foot-row">
            <div className="themes" role="group" aria-label="Theme">
              {THEMES.map(([t, icon, label]) => (
                <button key={t} type="button" aria-label={label} aria-pressed={choice === t} data-tip={label} onClick={() => setChoice(t)}>
                  <Glyph name={icon} />
                </button>
              ))}
            </div>
            {status && <span className="ver">v{status.version}</span>}
          </div>
        </div>
      </nav>
      <div className="main">
        <header className="top">
          {sites && sites.length > 0 && (
            <p className="fresh" role="status">
              <span className="pulse" aria-hidden="true" />
              {checking ? (
                "Checking all sites…"
              ) : (
                lastCheck && (
                  <span>
                    Last checked <b>{ago(lastCheck)}</b>
                  </span>
                )
              )}
              {needs > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <button type="button" className={section === "Overview" ? "link go" : "link quiet"} onClick={() => setSection("Sites")}>
                    {needs === 1 ? "1 site needs attention" : `${needs} sites need attention`}
                  </button>
                </>
              )}
            </p>
          )}
          <div className="top-end">
            <button type="button" className="kbar" onClick={() => setPalette(true)}>
              <Glyph name="search" />
              <span>Search or run a command</span>
              <Kbd>Ctrl K</Kbd>
            </button>
            {sites && sites.length > 0 && (
              section === "Overview" ? (
                <Button kind="primary" className="disc" disabled={checking} onClick={checkAll}>
                  {checking ? "Checking…" : "Check all sites now"}
                  <span className="btn-disc">
                    <Glyph name="refresh" />
                  </span>
                </Button>
              ) : (
                // The page head holds this page's main action, so checking steps back to a plain button.
                <Button disabled={checking} onClick={checkAll}>
                  <Glyph name="refresh" />
                  {checking ? "Checking…" : "Check all sites now"}
                </Button>
              )
            )}
          </div>
        </header>
        <main className="body" id="content" tabIndex={-1}>
          <header className="phead">
            <div>
              <h1>{LABEL[section] ?? section}</h1>
              <p>{section === "Overview" && all.length > 0 ? sentence : ABOUT[section]}</p>
            </div>
            <div className="phead-acts" ref={setHeadSlot}>
              {section === "Overview" && all.length > 0 && (
                <Button keys="A" onClick={() => setAdding({})}>
                  <Glyph name="plus" />
                  Add a site
                </Button>
              )}
            </div>
          </header>
          <HeadSlot.Provider value={headSlot}>{body}</HeadSlot.Provider>
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
