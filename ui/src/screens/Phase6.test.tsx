// Phase 6: security scan results, monitoring and safe updates.
import { render, screen, fireEvent, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { Security, fixOf } from "./Security";
import { site } from "../test-fixtures";
import type { SecurityReport, SiteInventory } from "../api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);
beforeEach(() => mockInvoke.mockReset());

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
    const vulns = screen.getByRole("table", { name: "Known vulnerabilities" });
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
    expect(screen.getByText("Checksums need Classic Monks on the site.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Scan all sites now" }));
    expect(mockInvoke).toHaveBeenCalledWith("security_scan", { id: undefined });
    expect(await screen.findByRole("button", { name: "Scan all sites now" })).toBeEnabled();
  });
});
