// SPDX-License-Identifier: GPL-3.0-or-later
// Phase 6: security scan results, monitoring and safe updates.
import { render as draw, screen, fireEvent, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Security, fixOf } from "./Security";
import { Monitoring, expiry } from "./Monitoring";
import { site } from "../test-fixtures";
import { HeadSlot } from "../components/ui";
import type { Monitor, SecurityReport, SiteInventory } from "../api";

// The page head's action slot, as App gives it: the screen's main actions render there.
const head = document.body.appendChild(document.createElement("div"));
const InHead = ({ children }: { children: ReactNode }) => <HeadSlot.Provider value={head}>{children}</HeadSlot.Provider>;
const render = (ui: ReactElement) => draw(ui, { wrapper: InHead });

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);
beforeEach(() => {
  mockInvoke.mockReset();
  // Every command answers, as Tauri does.
  mockInvoke.mockResolvedValue(null);
});

const A = site({ id: 1, name: "Alpha" });
const B = site({ id: 2, name: "Beta" });
const WOO = "woocommerce/woocommerce.php";
const inv = (update: string | null): SiteInventory => ({
  site_id: 1,
  fetched_at: 0,
  inventory: {
    wordpress: "7.1.3",
    wordpress_update: null,
    plugins: [{ id: WOO, name: "WooCommerce", version: "10.2.0", active: true, auto_update: false, update }],
    themes: [],
    translations: 0,
    updates_known: true,
    needs_credentials: false,
  },
});
const report: SecurityReport = {
  site_id: 1,
  checked_at: Date.now() / 1000 - 7200,
  vulnerabilities: [
    { kind: "plugin", id: WOO, name: "WooCommerce", installed: "10.2.0", title: "WooCommerce < 10.3 - Stored XSS", severity: "high", fixed_in: "10.3.0", link: "https://wpscan.com/v" },
    { kind: "wordpress", id: "", name: "WordPress", installed: "7.1.3", title: "Core unfixed", severity: null, fixed_in: null, link: null },
  ],
  abandoned: [
    { id: "old/old.php", name: "Old Slider", version: "1.0", last_updated: Date.UTC(2023, 2, 5) / 1000, closed: false, reason: null },
    { id: "gone/gone.php", name: "Gone", version: "2.0", last_updated: null, closed: true, reason: "security-issue" },
  ],
  checksums: { checked: 3, not_verifiable: [], changed: [{ name: "WordPress", modified: ["wp-includes/version.php"], missing: [], added: ["wp-x.php"] }] },
  notes: [],
};

describe("Security", () => {
  test("lists vulnerabilities, abandoned plugins and changed files, and fixes through the plan", () => {
    const onPlan = vi.fn();
    render(<Security sites={[A, B]} reports={[report]} inventory={new Map([[1, inv("10.3.0")]])} onPlan={onPlan} />);
    expect(screen.getByText("2 known vulnerabilities, 2 abandoned plugins and 1 changed install on 1 site.", { exact: false })).toBeInTheDocument();
    const vulns = screen.getByRole("list", { name: "Known vulnerabilities" });
    expect(within(vulns).getByText("Alpha, on 10.2.0")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Security at a glance" })).toHaveTextContent("Sites clear0 of 2");
    expect(within(vulns).getByText("High")).toBeInTheDocument();
    expect(within(vulns).getByText("Not rated")).toBeInTheDocument();
    expect(within(vulns).getByText("No fix yet")).toBeInTheDocument();
    fireEvent.click(within(vulns).getByRole("button", { name: "Update to 10.3.0 on Alpha" }));
    expect(onPlan).toHaveBeenCalledWith("Update WooCommerce on Alpha", [
      expect.objectContaining({ from: "10.2.0", to: "10.3.0", change: { site_id: 1, action: { do: "update_plugin", plugin: WOO } } }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Update 1 vulnerable plugin" }));
    expect(onPlan).toHaveBeenLastCalledWith("Fix 1 vulnerable plugin", [expect.objectContaining({ label: "Update WooCommerce" })]);
    fireEvent.click(within(vulns).getByRole("button", { name: "Read more about WooCommerce < 10.3 - Stored XSS" }));
    expect(mockInvoke).toHaveBeenCalledWith("link_open", { url: "https://wpscan.com/v" });
    expect(screen.getByText("No release since Mar 2023. Look for a maintained one.")).toBeInTheDocument();
    expect(screen.getByText("WordPress.org closed it (security issue): it gets no more updates. Replace it.")).toBeInTheDocument();
    expect(screen.getByText("wp-includes/version.php (changed), wp-x.php (extra)")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Not checked" })).getByText("Not scanned yet.")).toBeInTheDocument();
    expect(screen.getByText("Scanned 2 hr ago")).toBeInTheDocument();
  });

  test("a fix is offered only when the site has an update that new", () => {
    const v = report.vulnerabilities[0];
    expect(fixOf(v, A, inv("10.3.0"))?.to).toBe("10.3.0");
    expect(fixOf(v, A, inv("10.2.5"))).toBeNull();
    expect(fixOf(v, A, inv(null))).toBeNull();
    expect(fixOf(report.vulnerabilities[1], A, inv("10.3.0"))).toBeNull();
  });

  test("all clear, and scanning now", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const clean = { ...report, vulnerabilities: [], abandoned: [], checksums: null, notes: ["Checksums need Classic Monks on the site."] };
    render(<Security sites={[A]} reports={[clean]} inventory={new Map()} onPlan={vi.fn()} />);
    expect(screen.getByText("No known problems on 1 site.", { exact: false })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Sites with nothing known" })).getByText("Clear")).toBeInTheDocument();
    expect(screen.getByText("Checksums need Classic Monks on the site.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Scan all sites now" }));
    expect(mockInvoke).toHaveBeenCalledWith("security_scan", { id: undefined });
    expect(await screen.findByRole("button", { name: "Scan all sites now" })).toBeEnabled();
  });
});

const NOW = Date.now() / 1000;
const mon = (over: Partial<Monitor>): Monitor => ({
  site_id: 1,
  public: false,
  checked_at: NOW - 60,
  up: true,
  status: 200,
  ms: 412,
  error: "",
  down_since: null,
  uptime_day: 100,
  uptime_month: 99.8612,
  cert_expires: NOW + 86400 * 40 + 60,
  domain: null,
  domain_expires: null,
  domain_note: "A local address: there's no domain to renew and PageSpeed can't reach it.",
  pagespeed: null,
  ...over,
});

describe("Monitoring", () => {
  test("expiry gives a month's and a week's notice", () => {
    expect(expiry(null)).toBeNull();
    expect(expiry(NOW + 86400 * 40 + 60, NOW)).toMatchObject({ tone: "ok", text: "40 days left" });
    expect(expiry(NOW + 86400 * 20 + 60, NOW)?.tone).toBe("warning");
    expect(expiry(NOW + 86400 + 60, NOW)).toMatchObject({ tone: "danger", text: expect.stringMatching(/^1 day left/) });
    expect(expiry(NOW - 10, NOW)).toMatchObject({ tone: "danger", text: "Expired" });
  });

  test("shows up and down sites, expiry, and runs PageSpeed only where it can", async () => {
    const C = site({ id: 3, name: "Gamma" });
    const monitors = [
      mon({}),
      mon({ site_id: 2, public: true, ms: 538, uptime_day: 97.2222, domain: "beta.com", domain_expires: NOW + 86400 * 5 + 60, pagespeed: { score: 78, lcp: "1.8 s", cls: "0", tbt: "40 ms", at: NOW - 3600 } }),
      mon({ site_id: 3, public: true, up: false, status: 0, error: "The site didn't answer.", down_since: NOW - 600 }),
    ];
    render(<Monitoring sites={[A, B, C]} monitors={monitors} />);
    expect(screen.getByText(/^1 site is down: Gamma\./)).toBeInTheDocument();
    const stats = screen.getByRole("region", { name: "Fleet health" });
    expect(stats).toHaveTextContent("Home pages up2 of 3");
    expect(stats).toHaveTextContent("Average response475 ms");
    expect(stats).toHaveTextContent("Lowest: Beta at 78.");
    const table = screen.getByRole("table", { name: "Monitoring" });
    const [, alpha, beta, gamma] = within(table).getAllByRole("row");
    expect(within(alpha).getByText("200 OK")).toBeInTheDocument();
    expect(within(alpha).getByText("412 ms")).toBeInTheDocument();
    expect(within(alpha).getByText("99.86%")).toBeInTheDocument();
    expect(within(alpha).getByText(/^40 days left/)).toBeInTheDocument();
    expect(within(alpha).getByText("Public sites only")).toBeInTheDocument();
    expect(within(alpha).queryByRole("button")).toBeNull();
    expect(within(gamma).getByText("Down")).toBeInTheDocument();
    expect(within(gamma).getByText("since 10 min ago")).toBeInTheDocument();
    expect(within(gamma).getByText("The site didn't answer.")).toBeInTheDocument();
    expect(within(gamma).getByText("Couldn't load")).toBeInTheDocument();
    fireEvent.click(within(gamma).getByRole("button", { name: "Check Gamma again" }));
    expect(mockInvoke).toHaveBeenCalledWith("monitors_check");
    expect(within(beta).getByText("97.22%")).toBeInTheDocument();
    expect(within(beta).getByText("78 · Needs work")).toBeInTheDocument();
    expect(within(beta).getByText(/^beta\.com, /)).toBeInTheDocument();
    expect(within(beta).getByText(/^5 days left/).closest(".st")).toHaveClass("danger");
    expect(within(beta).getByText("LCP 1.8 s, CLS 0, TBT 40 ms. Tested 1 hr ago.")).toBeInTheDocument();
    mockInvoke.mockRejectedValue("Google's shared daily limit for PageSpeed tests without a key is used up. Try again tomorrow.");
    fireEvent.click(within(beta).getByRole("button", { name: "Run PageSpeed again on Beta" }));
    expect(mockInvoke).toHaveBeenCalledWith("pagespeed_run", { id: 2 });
    expect(await within(beta).findByText(/^Google.s shared daily limit/)).toBeInTheDocument();
  });
});
