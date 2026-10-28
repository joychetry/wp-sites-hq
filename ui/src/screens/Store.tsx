// A WooCommerce store on one site: how it did over a period, what runs low, and
// its products with their prices and stock, changed as a job (plan Phase 7).
import { Skeleton } from "../components/feedback";
import { Select } from "../components/controls";
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, hasTool, type Action, type Product, type ProductQuery, type Products, type Site, type StoreOverview } from "../api";
import { Button } from "../components/ui";
import { Sheet } from "../components/Sheet";
import type { PlanRow } from "../components/JobSheet";
import { money } from "./Clients";

const PERIODS: [number, string][] = [
  [7, "7 days"],
  [30, "30 days"],
  [90, "90 days"],
];
const STOCK: Record<string, string> = { instock: "In stock", outofstock: "Out of stock", onbackorder: "On backorder" };
const STATUS: Record<string, string> = { publish: "Published", draft: "Draft", pending: "Pending review", private: "Private" };

/** WooCommerce's "12.50" in the store's currency; "" is "not set". */
export function price(p: string, currency: string): string {
  const n = Number(p);
  return p === "" || Number.isNaN(n) ? "not set" : money(Math.round(n * 100), currency || "USD");
}

/** The change a form asks for, or why it can't be made. Only fields that differ are sent. */
export function productChange(p: Product, regular: string, sale: string, stock: string): Action | string {
  const num = /^\d{1,9}(\.\d{1,4})?$/;
  const r = regular.trim();
  const sp = sale.trim();
  const st = stock.trim();
  if (!num.test(r)) return "Write the price as a number, like 12.50.";
  if (sp !== "" && !num.test(sp)) return "Write the sale price as a number, like 9.99, or leave it empty.";
  if (sp !== "" && Number(sp) >= Number(r)) return "The sale price has to be lower than the price.";
  if (st !== "" && !/^-?\d{1,9}$/.test(st)) return "Write the stock as a whole number.";
  const a: Action = { do: "update_product", product_id: p.id, name: p.name };
  if (r !== p.regular_price) a.regular_price = r;
  if (sp !== p.sale_price) a.sale_price = sp;
  if (st !== "" && Number(st) !== p.stock_quantity) a.stock_quantity = Number(st);
  if (a.regular_price === undefined && a.sale_price === undefined && a.stock_quantity === undefined) return "Nothing changed yet.";
  return a;
}

const shop = (s: Site) => hasTool(s, "list-products");

type Props = { sites: Site[]; onPlan: (title: string, rows: PlanRow[], start?: "plan" | "confirm") => void };

export function Store({ sites, onPlan }: Props) {
  const [siteId, setSiteId] = useState<number | null>(() => (sites.find(shop) ?? sites[0])?.id ?? null);
  const site = sites.find((s) => s.id === siteId) ?? sites.find(shop) ?? null;
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState<StoreOverview | null>(null);
  const [list, setList] = useState<Products | null>(null);
  const [query, setQuery] = useState<ProductQuery>({});
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [round, setRound] = useState(0);

  const can = !!site && shop(site);
  // Only the newest request's answer is shown: a slow site's products must never appear
  // under another site, where a change would go to that site's product with the same id.
  const asked = useRef(0);
  const load = useCallback(async () => {
    const n = ++asked.current;
    if (!site || !can) return;
    setError(null);
    try {
      const [o, p] = await Promise.all([api.storeOverview(site.id, days), api.products(site.id, query)]);
      if (n !== asked.current) return;
      setOverview(o);
      setList(p);
    } catch (e) {
      if (n === asked.current) setError(String(e));
    }
  }, [site?.id, can, days, query, round]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);
  // A product change ran: read the store again.
  useEffect(() => {
    const un = listen("jobs-changed", () => setRound((r) => r + 1));
    return () => {
      un.then((f) => f());
    };
  }, []);

  if (sites.length === 0) {
    return (
      <div className="empty">
        <h2>No sites yet.</h2>
        <p>Add a site with WooCommerce and Classic Monks on Sites, then its store shows here.</p>
      </div>
    );
  }

  const cur = list?.currency || overview?.currency || "USD";
  return (
    <div className="scroll">
      <div className="bar">
        <label className="row pick">
          <span>Site</span>
          <Select
            className="input sm"
            aria-label="Site"
            value={site?.id ?? ""}
            onChange={(e) => {
              setSiteId(Number(e.target.value));
              setOverview(null);
              setList(null);
            }}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {shop(s) ? "" : " (no store)"}
              </option>
            ))}
          </Select>
        </label>
        {can && (
          <div className="segmented types" role="group" aria-label="Period">
            {PERIODS.map(([d, l]) => (
              <button key={d} type="button" aria-pressed={d === days} onClick={() => setDays(d)}>
                {l}
              </button>
            ))}
          </div>
        )}
      </div>
      {!can ? (
        <div className="empty">
          <h2>{site?.name ?? "This site"} has no store Monks Central can read.</h2>
          <p>It needs WooCommerce and Classic Monks Pro with the store tools. Update Classic Monks on the site, then check it again on Sites.</p>
        </div>
      ) : (
        <>
          {error && <p className="alert danger">{error}</p>}
          {overview ? (
            <section aria-label="How the store did">
              <p className="legend" id="store-legend">
                {overview.from} to {overview.to}. Revenue counts paid orders, less refunds.
              </p>
              <div className="kpis">
                <div className="kpi">
                  <div className="v">{price(overview.revenue, overview.currency)}</div>
                  <div className="l">Revenue</div>
                </div>
                <div className="kpi">
                  <div className="v">{overview.orders}</div>
                  <div className="l">Paid orders</div>
                </div>
                <div className="kpi">
                  <div className="v">{price(overview.average_order, overview.currency)}</div>
                  <div className="l">Average order</div>
                </div>
                <div className="kpi">
                  <div className={`v ${overview.processing ? "warning" : ""}`}>{overview.processing}</div>
                  <div className="l">To send now</div>
                </div>
                <div className="kpi">
                  <div className={`v ${overview.out_of_stock ? "danger" : ""}`}>{overview.out_of_stock}</div>
                  <div className="l">Out of stock</div>
                </div>
              </div>
              {overview.low_stock.length > 0 && (
                <p className="alert">
                  Running low: {overview.low_stock.map((l) => `${l.name} (${l.stock_quantity} left)`).join(", ")}
                </p>
              )}
            </section>
          ) : (
            !error && (
              <Skeleton label="Reading the store…" />
            )
          )}
          <h2 className="sect">Products</h2>
          <form
            className="bar"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery({ ...query, search: typed.trim() || undefined, page: 1 });
            }}
          >
            <input className="input" aria-label="Search products" placeholder="Name or SKU" value={typed} onChange={(e) => setTyped(e.target.value)} />
            <Button type="submit">Search</Button>
            <Select
              className="input sm"
              aria-label="Stock"
              value={query.stock_status ?? ""}
              onChange={(e) => setQuery({ ...query, stock_status: e.target.value || undefined, page: 1 })}
            >
              <option value="">Any stock</option>
              {Object.entries(STOCK).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </form>
          {list && list.products.length === 0 && <p className="dim">No products match.</p>}
          {list && list.products.length > 0 && (
            <p className="legend" id="products-legend">
              Struck-through prices are the regular price during a sale. Products with options are changed in wp-admin.
            </p>
          )}
          {list && list.products.length > 0 && (
            <table className="t" aria-label="Products" aria-describedby="products-legend">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">SKU</th>
                  <th scope="col" className="r">
                    Price
                  </th>
                  <th scope="col">Stock</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Change</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.products.map((p) => (
                  <tr key={p.id}>
                    <td className="name cut" data-tip={p.name}>
                      {p.name}
                    </td>
                    <td className="dim">{p.sku || "none"}</td>
                    <td className="r m">
                      {p.sale_price ? (
                        <>
                          <s className="dim">{price(p.regular_price, cur)}</s> {price(p.sale_price, cur)}
                        </>
                      ) : (
                        price(p.regular_price || p.price, cur)
                      )}
                    </td>
                    <td>
                      <span className={`tag ${p.stock_status === "outofstock" ? "danger" : ""}`}>
                        {STOCK[p.stock_status] ?? p.stock_status}
                        {p.manage_stock && p.stock_quantity != null ? `, ${p.stock_quantity}` : ""}
                      </span>
                    </td>
                    <td>{STATUS[p.status] ?? p.status}</td>
                    <td>
                      {p.type === "simple" || p.type === "external" ? (
                        <Button small aria-label={`Change price or stock of ${p.name}`} onClick={() => setEditing(p)}>
                          Change
                        </Button>
                      ) : (
                        <span className="dim">Change it in wp-admin</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {list && list.pages > 1 && (
            <div className="bar">
              <Button disabled={(query.page ?? 1) <= 1} onClick={() => setQuery({ ...query, page: (query.page ?? 1) - 1 })}>
                Newer
              </Button>
              <span className="dim">
                Page {query.page ?? 1} of {list.pages}, {list.total} products
              </span>
              <Button disabled={(query.page ?? 1) >= list.pages} onClick={() => setQuery({ ...query, page: (query.page ?? 1) + 1 })}>
                Older
              </Button>
            </div>
          )}
        </>
      )}
      {editing && site && (
        <ProductSheet
          product={editing}
          currency={cur}
          onClose={() => setEditing(null)}
          onPlan={(a) => {
            setEditing(null);
            onPlan(`Change ${editing.name}`, [{ change: { site_id: site.id, action: a }, site: site.name, label: label(a) }], "confirm");
          }}
        />
      )}
    </div>
  );
}

/** As the core labels it in the job list. */
export function label(a: Action): string {
  if (a.do !== "update_product") return "";
  const what = [
    a.regular_price !== undefined && `price ${a.regular_price}`,
    a.sale_price !== undefined && (a.sale_price === "" ? "no sale price" : `sale price ${a.sale_price}`),
    a.stock_quantity !== undefined && `stock ${a.stock_quantity}`,
  ].filter(Boolean);
  return `Change “${a.name}”: ${what.join(", ")}`;
}

function ProductSheet({ product, currency, onClose, onPlan }: { product: Product; currency: string; onClose: () => void; onPlan: (a: Action) => void }) {
  const [regular, setRegular] = useState(product.regular_price || product.price);
  const [sale, setSale] = useState(product.sale_price);
  const [stock, setStock] = useState(product.stock_quantity == null ? "" : String(product.stock_quantity));
  const change = productChange(product, regular, sale, stock);
  const footer = (
    <>
      <Button onClick={onClose}>Close without changing</Button>
      <Button kind="primary" disabled={typeof change === "string"} onClick={() => typeof change !== "string" && onPlan(change)}>
        Review the change
      </Button>
    </>
  );
  return (
    <Sheet title={`Change ${product.name}`} intro={`Prices in ${currency}, as the store writes them.`} onClose={onClose} footer={footer}>
      <label className="field">
        <span>Price</span>
        <input className="input" inputMode="decimal" value={regular} onChange={(e) => setRegular(e.target.value)} />
      </label>
      <label className="field">
        <span>Sale price</span>
        <input className="input" inputMode="decimal" value={sale} onChange={(e) => setSale(e.target.value)} />
        <small>Leave it empty for no sale.</small>
      </label>
      <label className="field">
        <span>Stock</span>
        <input className="input" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} />
        <small>{product.manage_stock ? "How many the store has." : "The store doesn't count this product yet. A number turns counting on."}</small>
      </label>
      <p className="dim" role="status">
        {typeof change === "string" ? change : label(change)}
      </p>
    </Sheet>
  );
}
