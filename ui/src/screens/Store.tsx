// SPDX-License-Identifier: GPL-3.0-or-later
// A WooCommerce store on one site: how it did over a period, what runs low, and
// its products with their prices and stock, changed as a job (plan Phase 7).
import { Skeleton, toast } from "../components/feedback";
import { SearchInput, Select } from "../components/controls";
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import "../styles/screens/store.css";
import { api, hasTool, type Action, type Product, type ProductQuery, type Products, type Site, type StoreOverview } from "../api";
import { Button, Glyph, HeadActions } from "../components/ui";
import { SiteTile } from "../components/SiteTile";
import { Sheet } from "../components/Sheet";
import type { PlanRow } from "../components/JobSheet";
import { money } from "./Clients";

const PERIODS: [number, string][] = [
  [7, "7 days"],
  [30, "30 days"],
  [90, "90 days"],
];
const STOCK: Record<string, string> = { instock: "In stock", outofstock: "Out of stock", onbackorder: "On backorder" };
/** An order status in words, and its colour in the split bar. */
const ORDER: Record<string, [string, string]> = {
  completed: ["completed", "k-up"],
  processing: ["to send", "k-sign"],
  "on-hold": ["on hold", "k-plugin"],
  pending: ["waiting for payment", "k-off"],
  refunded: ["refunded", "k-down"],
  cancelled: ["cancelled", "k-off"],
  failed: ["failed", "k-down"],
};
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
  const shown = useRef(false);
  shown.current = !!overview;
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
      // With numbers on screen, a failed refresh floats as a toast so the table doesn't move.
      if (n === asked.current) shown.current ? toast(String(e), { tone: "danger" }) : setError(String(e));
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
  const low = new Set(overview?.low_stock.map((l) => l.id));
  const orders = Object.entries(overview?.by_status ?? {}).filter(([, n]) => n > 0);
  const word = (s: string) => ORDER[s] ?? [s, "k-off"];
  return (
    <div className="scroll page store">
      <HeadActions>
        <label className="row pick store-pick">
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
                <SiteTile site={s} size="sm" />
                {s.name}
                {shop(s) ? "" : " (no store)"}
              </option>
            ))}
          </Select>
        </label>
        {can && (
          <div className="segmented inline" role="group" aria-label="Period">
            {PERIODS.map(([d, l]) => (
              <button key={d} type="button" aria-pressed={d === days} onClick={() => setDays(d)}>
                {l}
              </button>
            ))}
          </div>
        )}
      </HeadActions>
      {!can || !site ? (
        <section className="card">
          <div className="empty">
            <h2>{site?.name ?? "This site"} has no store Monks Central can read.</h2>
            <p>It needs WooCommerce and Classic Monks Pro with the store tools. Update Classic Monks on the site, then check it again on Sites.</p>
          </div>
        </section>
      ) : (
        <div className="stack">
          {error && <p className="alert danger">{error}</p>}
          <section className="card" aria-labelledby="store-sales">
            <div className="card-head">
              <h2 id="store-sales">
                Orders and revenue on {site.name}, last {days} days
              </h2>
              {overview && (
                <span className="dim m">
                  {overview.from} to {overview.to}
                </span>
              )}
            </div>
            {overview ? (
              <div className="card-body sales">
                <div className="sales-nums">
                  <div>
                    <span className="label">Revenue</span>
                    <p className="stat-n">
                      <strong>{price(overview.revenue, overview.currency)}</strong>
                    </p>
                  </div>
                  <div className="row">
                    <div>
                      <span className="label">Paid orders</span>
                      <p className="stat-n sm">
                        <strong>{overview.orders}</strong>
                      </p>
                    </div>
                    <div>
                      <span className="label">Average order</span>
                      <p className="stat-n sm">
                        <strong>{price(overview.average_order, overview.currency)}</strong>
                      </p>
                    </div>
                  </div>
                </div>
                <div className="sales-side">
                  <span className="label">Orders by status</span>
                  {orders.length > 0 ? (
                    <>
                      <div className="mix" role="img" aria-label={orders.map(([s, n]) => `${n} ${word(s)[0]}`).join(", ")}>
                        {orders.map(([s, n]) => (
                          <i key={s} className={word(s)[1]} style={{ flex: n }} />
                        ))}
                      </div>
                      <ul className="mix-key">
                        {orders.map(([s, n]) => (
                          <li key={s} className={word(s)[1]}>
                            <i aria-hidden="true" />
                            <b>{n}</b> {word(s)[0]}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="dim">No orders in this period.</p>
                  )}
                  <div className="sales-now">
                    {!orders.some(([s]) => s === "processing") && (
                      <p>
                        <b className={overview.processing ? "warn-n" : undefined}>{overview.processing}</b> to send now
                      </p>
                    )}
                    <p>
                      <b className={overview.out_of_stock ? "danger-n" : undefined}>{overview.out_of_stock}</b> out of stock
                    </p>
                  </div>
                  {overview.low_stock.length > 0 && (
                    <p className="callout warning">
                      <Glyph name="alert" />
                      <span>Running low: {overview.low_stock.map((l) => `${l.name} (${l.stock_quantity} left)`).join(", ")}</span>
                    </p>
                  )}
                </div>
              </div>
            ) : (
              !error && <Skeleton label="Reading the store…" />
            )}
            {overview && <p className="card-foot dim">Revenue counts paid orders, less refunds.</p>}
          </section>
          <section className="card" aria-labelledby="store-products">
            <form
              className="card-head"
              role="search"
              aria-label="Find products"
              onSubmit={(e) => {
                e.preventDefault();
                setQuery({ ...query, search: typed.trim() || undefined, page: 1 });
              }}
            >
              <h2 id="store-products">Products</h2>
              {/* Enter searches; clearing the box shows every product again. */}
              <SearchInput
                className="sm"
                aria-label="Search products"
                placeholder="Search products"
                value={typed}
                onChange={(e) => {
                  setTyped(e.target.value);
                  if (!e.target.value && query.search) setQuery({ ...query, search: undefined, page: 1 });
                }}
              />
              <label className="row pick">
                <span>Stock</span>
                <Select
                  className="input sm"
                  aria-label="Stock"
                  value={query.stock_status ?? ""}
                  onChange={(e) => setQuery({ ...query, stock_status: e.target.value || undefined, page: 1 })}
                >
                  <option value="">Any</option>
                  {Object.entries(STOCK).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </label>
            </form>
            {list && list.products.length === 0 && <p className="quiet">No products match.</p>}
            {list && list.products.length > 0 && (
              <table className="t" aria-label="Products" aria-describedby="products-legend">
                <thead>
                  <tr>
                    <th scope="col">Product</th>
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
                  {list.products.map((p, i) => {
                    const isLow = low.has(p.id);
                    const out = p.stock_status === "outofstock";
                    const counted = p.manage_stock && p.stock_quantity != null;
                    return (
                      <tr key={p.id} className={isLow ? "warn" : undefined}>
                        <td>
                          <div className="site">
                            <span className={`pthumb t${i % 3}`} aria-hidden="true">
                              <Glyph name="image" />
                            </span>
                            <span>
                              <b>{p.name}</b>
                              <small>{p.sku ? `SKU ${p.sku}` : "No SKU"}</small>
                            </span>
                          </div>
                        </td>
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
                          <span className="row nowrap">
                            {counted && <span className="m">{p.stock_quantity}</span>}
                            {out || p.stock_status === "onbackorder" ? (
                              <span className={`tag ${out ? "danger" : "warning"}`}>{STOCK[p.stock_status]}</span>
                            ) : isLow ? (
                              <span className="tag warning">Low</span>
                            ) : (
                              !counted && <span className="tag">{STOCK[p.stock_status] ?? p.stock_status}</span>
                            )}
                          </span>
                        </td>
                        <td className="dim">{STATUS[p.status] ?? p.status}</td>
                        <td className="r">
                          {p.type === "simple" || p.type === "external" ? (
                            <Button
                              small
                              className={isLow || out ? undefined : "ghost"}
                              aria-label={`Change price or stock of ${p.name}`}
                              onClick={() => setEditing(p)}
                            >
                              Change price or stock
                            </Button>
                          ) : (
                            <span className="dim">Change it in wp-admin</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {list && list.products.length > 0 && (
              <div className="card-foot">
                <span className="dim grow" id="products-legend">
                  Struck-through prices are the regular price during a sale. Products with options are changed in wp-admin.
                </span>
                {list.pages > 1 && (
                  <>
                    <Button small disabled={(query.page ?? 1) <= 1} onClick={() => setQuery({ ...query, page: (query.page ?? 1) - 1 })}>
                      Newer
                    </Button>
                    <span className="dim">
                      Page {query.page ?? 1} of {list.pages}, {list.total} products
                    </span>
                    <Button small disabled={(query.page ?? 1) >= list.pages} onClick={() => setQuery({ ...query, page: (query.page ?? 1) + 1 })}>
                      Older
                    </Button>
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      )}
      {editing && site && (
        <ProductSheet
          product={editing}
          site={site}
          thumb={`t${list ? Math.max(0, list.products.indexOf(editing)) % 3 : 0}`}
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

type SheetProps = { product: Product; site: Site; thumb: string; currency: string; onClose: () => void; onPlan: (a: Action) => void };

function ProductSheet({ product, site, thumb, currency, onClose, onPlan }: SheetProps) {
  const [regular, setRegular] = useState(product.regular_price || product.price);
  const [sale, setSale] = useState(product.sale_price);
  const [stock, setStock] = useState(product.stock_quantity == null ? "" : String(product.stock_quantity));
  const change = productChange(product, regular, sale, stock);
  const footer = (
    <>
      <Button onClick={onClose}>Close without changing</Button>
      <Button kind="primary" className="disc" disabled={typeof change === "string"} onClick={() => typeof change !== "string" && onPlan(change)}>
        Review the change
        <span className="btn-disc">
          <Glyph name="arrow" />
        </span>
      </Button>
    </>
  );
  return (
    <Sheet
      dialog
      title={`Change ${product.name}`}
      icon={
        <span className={`pthumb lg ${thumb}`} aria-hidden="true">
          <Glyph name="image" />
        </span>
      }
      intro={
        <span className="mono meta">
          {site.name}
          {product.sku ? ` · SKU ${product.sku}` : ""} · prices in {currency}
        </span>
      }
      onClose={onClose}
      footer={footer}
    >
      <div className="g2 prodf">
        <label className="field">
          <span>Price</span>
          <input className="input m" inputMode="decimal" value={regular} onChange={(e) => setRegular(e.target.value)} />
        </label>
        <label className="field">
          <span>Sale price</span>
          <input className="input m" inputMode="decimal" value={sale} onChange={(e) => setSale(e.target.value)} />
          <small>Leave it empty for no sale.</small>
        </label>
      </div>
      <label className="field">
        <span>Stock</span>
        <input className="input m" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} />
        <small>
          {product.manage_stock
            ? `How many the store has.${product.stock_quantity != null ? ` Now ${product.stock_quantity}.` : ""}`
            : "The store doesn't count this product yet. A number turns counting on."}
        </small>
      </label>
      <p className="dim" role="status">
        {typeof change === "string" ? change : label(change)}
      </p>
    </Sheet>
  );
}
