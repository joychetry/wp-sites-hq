// SPDX-License-Identifier: GPL-3.0-or-later
// Phase 7: a WooCommerce store's overview and products, and Classic Monks' reports.
import { render as draw, screen, fireEvent, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Store, price, productChange, label } from "./Store";
import { ClassicMonks } from "./ClassicMonks";
import { site } from "../test-fixtures";
import type { Product } from "../api";
import { HeadSlot } from "../components/ui";
import { JobSheet } from "../components/JobSheet";

// The page head's action slot, as App gives it: the site and period pickers render there.
const head = document.body.appendChild(document.createElement("div"));
const InHead = ({ children }: { children: ReactNode }) => <HeadSlot.Provider value={head}>{children}</HeadSlot.Provider>;
const render = (ui: ReactElement) => draw(ui, { wrapper: InHead });

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
const mockInvoke = vi.mocked(invoke);
afterEach(() => mockInvoke.mockReset());

const SHOP = ["list-products", "get-store-overview", "update-products", "get-features", "get-404-report", "get-2fa-report"];
const A = site({ id: 1, name: "Shop", capabilities: { abilities: SHOP } });
const B = site({ id: 2, name: "Blog", capabilities: { abilities: ["get-features"] } });
const RYE: Product = { id: 62, name: "Rye", type: "simple", status: "publish", sku: "RY", price: "3.00", regular_price: "3.50", sale_price: "3.00", stock_status: "instock", manage_stock: true, stock_quantity: 1, permalink: "" };
const OVERVIEW = { currency: "EUR", from: "2026-09-28", to: "2026-10-28", orders: 3, revenue: "120.00", average_order: "40.00", by_status: {}, low_stock: [{ id: 62, name: "Rye", stock_quantity: 1 }], out_of_stock: 0, processing: 1 };

function core() {
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "store_overview") return OVERVIEW;
    if (cmd === "store_products") return { products: [RYE, { ...RYE, id: 70, name: "Gift card", type: "variable", sale_price: "" }], total: 2, pages: 1, currency: "EUR" };
    if (cmd === "cm_reports")
      return {
        not_found: { count: 1, urls: [{ id: 1, url: "/old", hits: 5, last_seen: "2026-10-27", status: "new", referrer: "" }] },
        searches: null,
        unused_media: { has_results: false, scanned_at: "", counts: {}, listed_size: 0, items: [] },
        logins: null,
        two_factor: { stats: { total_users: 4, users_with_2fa: 3 }, enforcement: { enabled: false, roles: [] }, roles: [] },
        failed: [["get-search-report", "Timed out."]],
      };
    if (cmd === "cm_features") return [];
    throw new Error(cmd);
  });
}

test("prices read in the store's currency, and a change sends only what differs", () => {
  expect(price("4.5", "EUR")).toBe("€4.50");
  expect(price("", "EUR")).toBe("not set");
  expect(productChange(RYE, "3.50", "3.00", "1")).toBe("Nothing changed yet.");
  expect(productChange(RYE, "3,50", "", "1")).toMatch(/like 12.50/);
  expect(productChange(RYE, "3.50", "4", "1")).toMatch(/lower than the price/);
  expect(productChange(RYE, "3.50", "", "1.5")).toMatch(/whole number/);
  const a = productChange(RYE, "3.80", "", "12");
  expect(a).toEqual({ do: "update_product", product_id: 62, name: "Rye", regular_price: "3.80", sale_price: "", stock_quantity: 12 });
  expect(label(a as never)).toBe("Change “Rye”: price 3.80, no sale price, stock 12");
});

test("the store shows how it did, what runs low, and plans a product change to confirm", async () => {
  core();
  const plan = vi.fn();
  render(<Store sites={[A, B]} onPlan={plan} />);
  expect(await screen.findByText("€120.00")).toBeInTheDocument();
  expect(screen.getByText("Running low: Rye (1 left)")).toBeInTheDocument();
  const table = await screen.findByRole("table", { name: "Products" });
  expect(within(table).getByRole("row", { name: /Gift card/ })).toHaveTextContent("Change it in wp-admin");
  fireEvent.click(screen.getByRole("button", { name: "Change price or stock of Rye" }));
  fireEvent.change(screen.getByRole("textbox", { name: /^Stock/ }), { target: { value: "20" } });
  fireEvent.click(screen.getByRole("button", { name: "Review the change" }));
  expect(plan).toHaveBeenCalledWith("Change Rye", [{ change: { site_id: 1, action: { do: "update_product", product_id: 62, name: "Rye", stock_quantity: 20 } }, site: "Shop", label: "Change “Rye”: stock 20" }], "confirm");
  fireEvent.click(screen.getByRole("group", { name: "Period" }).querySelectorAll("button")[0]);
  expect(mockInvoke).toHaveBeenCalledWith("store_overview", { id: 1, days: 7 });
});

test("the form starts from the product's prices, and removing the sale reaches the review", async () => {
  core();
  const plan = vi.fn();
  render(<Store sites={[A, B]} onPlan={plan} />);
  fireEvent.click(await screen.findByRole("button", { name: "Change price or stock of Rye" }));
  expect(screen.getByRole("textbox", { name: /^Price/ })).toHaveValue("3.50");
  expect(screen.getByRole("textbox", { name: /^Sale price/ })).toHaveValue("3.00");
  expect(screen.getByRole("textbox", { name: /^Stock/ })).toHaveValue("1");
  fireEvent.change(screen.getByRole("textbox", { name: /^Sale price/ }), { target: { value: "" } });
  fireEvent.change(screen.getByRole("textbox", { name: /^Stock/ }), { target: { value: "30" } });
  fireEvent.click(screen.getByRole("button", { name: "Review the change" }));
  const rows = plan.mock.calls[0][1];
  expect(rows[0].change.action).toEqual({ do: "update_product", product_id: 62, name: "Rye", sale_price: "", stock_quantity: 30 });
  render(<JobSheet state={{ title: "Change Rye", rows, start: "confirm" }} onClose={() => {}} />);
  expect(screen.getByRole("region", { name: "On Shop" })).toHaveTextContent("Change “Rye”: no sale price, stock 30");
});

test("a slow answer for an older period never replaces the newer one", async () => {
  core();
  let slow: (v: unknown) => void = () => {};
  const base = mockInvoke.getMockImplementation()!;
  mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    const a = args as { days?: number };
    if (cmd === "store_overview" && a.days === 30) return new Promise((r) => (slow = r));
    return base(cmd, args as never);
  });
  render(<Store sites={[A, B]} onPlan={() => {}} />);
  fireEvent.click(screen.getByRole("group", { name: "Period" }).querySelectorAll("button")[0]);
  expect(await screen.findByText("€120.00")).toBeInTheDocument();
  slow({ ...OVERVIEW, revenue: "999.00" });
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByText("€999.00")).toBeNull();
  expect(screen.getByText("€120.00")).toBeInTheDocument();
});

test("a site without the store tools says what it needs", () => {
  core();
  render(<Store sites={[B]} onPlan={() => {}} />);
  expect(screen.getByRole("heading", { name: "Blog has no store WP Sites HQ can read" })).toBeInTheDocument();
});

test("Classic Monks' reports show what the site has and name what failed", async () => {
  core();
  render(<ClassicMonks sites={[A]} />);
  fireEvent.click(await screen.findByRole("tab", { name: "Reports" }));
  expect(await screen.findByRole("table", { name: "Pages not found" })).toHaveTextContent("/old");
  expect(screen.getByText("75%")).toBeInTheDocument();
  expect(screen.getByText("Not scanned yet")).toBeInTheDocument();
  expect(screen.getByText("Not read: Searches (Timed out.)")).toBeInTheDocument();
  expect(mockInvoke).toHaveBeenCalledWith("cm_reports", { id: 1, days: 30 });
});
