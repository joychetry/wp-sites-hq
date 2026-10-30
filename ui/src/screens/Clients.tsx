// SPDX-License-Identifier: GPL-3.0-or-later
// Clients, their sites, and what the sites cost you and earn (plan Phase 7).
import "../styles/screens/clients.css";
import { Empty, Skeleton, toast } from "../components/feedback";
import { Page } from "../components/page";
import { DateInput, dayLabel, MultiSelect, Select } from "../components/controls";
import { Fragment, useCallback, useEffect, useState } from "react";
import { api, type Client, type Cost, type Every, type Site } from "../api";
import { initials, SiteTile } from "../components/SiteTile";
import { Button, Glyph, HeadActions } from "../components/ui";
import { Sheet } from "../components/Sheet";

/** "€12.50"; an unknown code still reads ("XYZ 12.50"). `whole` drops ".00" (the stat cards: "€340"). */
export function money(cents: number, currency: string, whole = false): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, ...(whole && cents % 100 === 0 ? { minimumFractionDigits: 0 } : {}) }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

/** What it comes to each month: a year counts a twelfth, a one-off nothing. */
export const perMonth = (c: Cost) => (c.every === "month" ? c.cents : c.every === "year" ? Math.round(c.cents / 12) : 0);

/** Monthly costs and charges by currency. */
export function sums(costs: Cost[]): Map<string, { cost: number; charge: number }> {
  const out = new Map<string, { cost: number; charge: number }>();
  for (const c of costs) {
    const t = out.get(c.currency) ?? { cost: 0, charge: 0 };
    t[c.kind] += perMonth(c);
    out.set(c.currency, t);
  }
  return out;
}

/** "12", "12.5", "12,50" to cents, or null. */
export function toCents(s: string): number | null {
  const m = s.trim().match(/^(\d{1,10})(?:[.,](\d{1,2}))?$/);
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0")) : null;
}

const EVERY: Record<Every, string> = { month: "Monthly", year: "Yearly", once: "Once" };

/** Days from today to a "2026-12-01" date; negative when it has passed. */
export function daysTo(day: string, now = new Date()): number {
  const [y, m, d] = day.split("-").map(Number);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 86400000);
}

/** Monthly amounts by currency, a line each; Left is red with its minus sign when it is below zero. */
function Amounts({ costs, what }: { costs: Cost[]; what: "cost" | "charge" | "left" }) {
  // Charged and Costs leave out a currency with nothing in that column; Left shows each.
  const list = [...sums(costs)].filter(([, t]) => (what === "left" ? t.cost || t.charge : t[what]));
  if (list.length === 0) return <span className="dim">none</span>;
  return (
    <>
      {list.map(([cur, t]) => {
        const n = what === "left" ? t.charge - t.cost : t[what];
        return (
          <span key={cur} className={`m ${what === "left" ? "left" : ""} ${what === "left" && n < 0 ? "danger" : ""}`}>
            {money(n, cur)}
          </span>
        );
      })}
    </>
  );
}

type Editing = { client: Client } | { cost: Cost } | null;

export function Clients({ sites }: { sites: Site[] }) {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [costs, setCosts] = useState<Cost[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);

  const load = useCallback(() => {
    Promise.all([api.clients(), api.costs()]).then(
      ([c, k]) => {
        setClients(c);
        setCosts(k);
        setError(null);
      },
      (e) => setError(String(e)),
    );
  }, []);
  useEffect(load, [load]);

  if (error) {
    return (
      <Page>
        <Empty alert title="Clients didn't load." action={<Button onClick={load}>Try again</Button>}>
          <p>{error}</p>
        </Empty>
      </Page>
    );
  }
  if (!clients) {
    return (
      <Skeleton label="Loading clients…" />
    );
  }

  const siteOf = (id: number | null) => sites.find((s) => s.id === id);
  const clientName = (id: number | null) => clients.find((c) => c.id === id)?.name;
  const known = (id: number | null | undefined) => (id != null && clients.some((c) => c.id === id) ? id : null);
  // Each cost or charge sits under one row: its client, else its site's client, else No client yet.
  const groupOf = (k: Cost) => known(k.client_id) ?? (k.site_id != null ? known(siteOf(k.site_id)?.client_id) : null);
  const of = (c: Client | null) => ({
    own: sites.filter((s) => known(s.client_id) === (c?.id ?? null)),
    // Charges first, then costs, as on the design.
    costs: costs.filter((k) => groupOf(k) === (c?.id ?? null)).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "charge" ? -1 : 1)),
  });
  const currency = costs.at(-1)?.currency ?? "EUR";
  const blankCost = (): Cost => ({ id: 0, site_id: null, client_id: clients[0]?.id ?? null, kind: "cost", label: "", cents: 0, currency, every: "year", renews_on: null });
  const done = (msg: string) => {
    toast(msg);
    setEditing(null);
    load();
  };
  const rows: (Client | null)[] = [...clients, ...(of(null).own.length > 0 || of(null).costs.length > 0 ? [null] : [])];
  const open = editing && "client" in editing ? editing.client.id : null;

  // The stat cards count the currency most amounts are in; any other currency is named beside it.
  const counts = new Map<string, number>();
  for (const k of costs) counts.set(k.currency, (counts.get(k.currency) ?? 0) + 1);
  const main = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? currency;
  const totals = sums(costs);
  const t = totals.get(main) ?? { cost: 0, charge: 0 };
  // Other currencies, a quiet line under the number: "Also $23.25".
  const also = (what: "cost" | "charge" | "left") => {
    const rest = [...totals].filter(([cur, x]) => cur !== main && (what === "left" ? x.charge - x.cost : x[what]) !== 0).map(([cur, x]) => money(what === "left" ? x.charge - x.cost : x[what], cur, true));
    return rest.length > 0 && <p className="stat-note">Also {rest.join(" and ")}</p>;
  };
  const paying = new Set(costs.filter((k) => k.kind === "charge" && perMonth(k) > 0).map(groupOf).filter((g) => g != null)).size;
  const costWords = [...new Set(costs.filter((k) => k.kind === "cost").map((k) => k.label.toLowerCase()))].slice(0, 3).join(", ");
  const left = t.charge - t.cost;
  const renewing = costs
    .filter((k) => k.renews_on)
    .map((k) => ({ k, days: daysTo(k.renews_on!) }))
    .sort((a, b) => a.k.renews_on!.localeCompare(b.k.renews_on!))
    .slice(0, 5);
  const whose = (k: Cost) => clientName(k.client_id) ?? siteOf(k.site_id)?.name ?? "a removed site";

  return (
    <Page className="clients">
      <HeadActions>
        <Button onClick={() => setEditing({ cost: blankCost() })} disabled={clients.length === 0 && sites.length === 0}>
          <Glyph name="plus" />
          Add a cost or charge
        </Button>
        <Button kind="primary" className="disc" onClick={() => setEditing({ client: { id: 0, name: "", email: "", notes: "" } })}>
          <span className="btn-disc">
            <Glyph name="plus" />
          </span>
          Add a client
        </Button>
      </HeadActions>
      {clients.length === 0 && costs.length === 0 ? (
        <section className="card">
          <Empty title="No clients yet.">
            <p>Add a client, tick their sites, then note what the sites cost you (hosting, domains, licences) and what you charge. Client reports use the same list.</p>
          </Empty>
        </section>
      ) : (
        <>
          <section className="g3" aria-label="This month">
            <div className="stat">
              <h2 className="label">Charged each month</h2>
              <p className="stat-n">
                <strong>{money(t.charge, main, true)}</strong> <span className="cut">{paying === 1 ? "from 1 client" : `from ${paying} clients`}</span>
              </p>
              {also("charge")}
            </div>
            <div className="stat">
              <h2 className="label">Costs each month</h2>
              <p className="stat-n">
                <strong>{money(t.cost, main, true)}</strong> <span className="cut" data-tip={costWords || undefined}>{costWords}</span>
              </p>
              {also("cost")}
            </div>
            <div className="stat">
              <h2 className="label">Left over</h2>
              <p className="stat-n">
                <strong className={left < 0 ? "danger" : undefined}>{money(left, main, true)}</strong> <span className="cut">a month</span>
              </p>
              {t.charge > 0 && (
                <div className="mix" role="img" aria-label={`Costs are ${Math.round((t.cost / t.charge) * 100)}% of charges`}>
                  <i className="k-off" style={{ flex: Math.min(t.cost, t.charge) }} />
                  {left > 0 && <i className="k-up" style={{ flex: left }} />}
                </div>
              )}
              {also("left")}
            </div>
          </section>
          <div className="cl-split">
            <section className="card" aria-label="Clients and costs">
              <table className="t" aria-label="Clients" aria-describedby="clients-legend">
                <thead>
                  <tr>
                    <th scope="col">Client or cost</th>
                    <th scope="col">Sites</th>
                    <th scope="col" className="r">
                      Charged
                    </th>
                    <th scope="col" className="r">
                      Costs
                    </th>
                    <th scope="col" className="r">
                      Monthly
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const { own, costs: list } = of(c);
                    return (
                      <Fragment key={c?.id ?? "none"}>
                        <tr className={c && c.id === open ? "sel" : undefined}>
                          <td>
                            <div className="site">
                              <span className={c ? "av lg well" : "av lg none"} aria-hidden="true">
                                {c ? initials(c.name) : "?"}
                              </span>
                              <span>
                                {c ? (
                                  <button type="button" className="linkish" onClick={() => setEditing({ client: c })}>
                                    {c.name}
                                  </button>
                                ) : (
                                  <b>No client yet</b>
                                )}
                                <small>{c ? c.email || "no email" : "Costs you pay yourself"}</small>
                              </span>
                            </div>
                          </td>
                          <td>
                            {own.length ? (
                              <span className="pchips">
                                {own.map((s) => (
                                  <span key={s.id} className="pchip">
                                    <SiteTile site={s} size="sm" />
                                    {s.name}
                                  </span>
                                ))}
                              </span>
                            ) : (
                              <span className="dim">none</span>
                            )}
                          </td>
                          <td className="r">
                            <Amounts costs={list} what="charge" />
                          </td>
                          <td className="r">
                            <Amounts costs={list} what="cost" />
                          </td>
                          <td className="r">
                            <Amounts costs={list} what="left" />
                          </td>
                        </tr>
                        {list.map((k) => {
                          const on = k.site_id != null && own.length > 1 ? siteOf(k.site_id)?.name : null;
                          const when = k.renews_on ? `${k.every === "once" ? "due" : "renews"} ${dayLabel(k.renews_on) || k.renews_on}` : null;
                          return (
                            <tr key={k.id} className="item">
                              <td>
                                <div className="item-t">
                                  <button type="button" className="linkish" onClick={() => setEditing({ cost: k })}>
                                    {k.label}
                                  </button>
                                  <span>{[k.kind === "cost" ? "Cost" : "Charge", EVERY[k.every].toLowerCase(), on, when].filter(Boolean).join(" · ")}</span>
                                </div>
                              </td>
                              <td />
                              <td className="r">{k.kind === "charge" && <span className="m">{money(k.cents, k.currency)}</span>}</td>
                              <td className="r">{k.kind === "cost" && <span className="m">{money(k.cents, k.currency)}</span>}</td>
                              <td />
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              <div className="card-foot">
                <span className="count" id="clients-legend">
                  Monthly: a yearly amount counts a twelfth, and one-off amounts are left out. Monthly is what you charge minus what it costs you.
                </span>
              </div>
            </section>
            <section className="card" aria-labelledby="renew-t">
              <div className="card-head">
                <h2 id="renew-t">
                  <Glyph name="calendar" />
                  Renewing soon
                </h2>
              </div>
              {renewing.length === 0 ? (
                <Empty small title="Nothing has a renewal date yet. Add one to a cost or charge." />
              ) : (
                <ul className="fixes">
                  {renewing.map(({ k, days }) => (
                    <li key={k.id} className="fix">
                      <span className="tile sm neutral">
                        <Glyph name={/domain/i.test(k.label) ? "globe" : /host/i.test(k.label) ? "monitor" : "package"} />
                      </span>
                      <div>
                        <b>
                          {k.label} · {whose(k)}
                        </b>
                        <span>
                          {dayLabel(k.renews_on!) || k.renews_on} · {EVERY[k.every].toLowerCase()} · {money(k.cents, k.currency, true)}
                        </span>
                      </div>
                      <span className={`tag ${days < 0 ? "danger" : days <= 30 ? "warning" : ""}`}>
                        {days < 0 ? `${-days} ${days === -1 ? "day" : "days"} ago` : days === 0 ? "today" : `${days} ${days === 1 ? "day" : "days"}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
      {editing && "client" in editing && <ClientSheet client={editing.client} sites={sites} onClose={() => setEditing(null)} onDone={done} />}
      {editing && "cost" in editing && <CostSheet cost={editing.cost} sites={sites} clients={clients} onClose={() => setEditing(null)} onDone={done} />}
    </Page>
  );
}

function ClientSheet({ client, sites, onClose, onDone }: { client: Client; sites: Site[]; onClose: () => void; onDone: (msg: string) => void }) {
  const isNew = client.id === 0;
  const [c, setC] = useState(client);
  const [picked, setPicked] = useState(() => new Set(sites.filter((s) => s.client_id === client.id && !isNew).map((s) => s.id)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await api.saveClient(c);
      for (const s of sites) {
        const want = picked.has(s.id);
        if (want && s.client_id !== saved.id) await api.setClient(s.id, saved.id);
        if (!want && s.client_id === saved.id) await api.setClient(s.id, null);
      }
      onDone(isNew ? `Added ${saved.name}.` : `Saved ${saved.name}.`);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteClient(client.id);
      onDone(`Deleted ${client.name}. Their sites are still here, with no client.`);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const footer = deleting ? (
    <>
      <span className="sum">Delete {client.name} and the costs and charges on them? Their sites stay.</span>
      <Button onClick={() => setDeleting(false)}>Keep {client.name}</Button>
      <Button kind="danger" className="solid" disabled={busy} onClick={remove}>
        <Glyph name="trash" />
        Delete the client
      </Button>
    </>
  ) : (
    <>
      {!isNew && (
        <Button kind="danger" className="push" onClick={() => setDeleting(true)}>
          <Glyph name="trash" />
          Delete the client
        </Button>
      )}
      <Button className="ghost" onClick={onClose}>
        Close without saving
      </Button>
      <Button kind="primary" className="disc" disabled={busy || !c.name.trim()} onClick={save}>
        <span className="btn-disc">
          <Glyph name={isNew ? "plus" : "check"} />
        </span>
        {busy ? "Saving…" : isNew ? "Add the client" : "Save changes"}
      </Button>
    </>
  );

  return (
    <Sheet title={isNew ? "Add a client" : `Edit ${client.name}`} onClose={onClose} footer={footer}>
      {error && (
        <p className="alert danger" role="alert">
          {error}
        </p>
      )}
      <div className="g2 pair">
        <label className="field">
          <span>Name</span>
          <input className="input" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
        </label>
        <label className="field">
          <span>Email</span>
          <input className="input" type="email" spellCheck={false} value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} />
        </label>
      </div>
      <label className="field">
        <span>Notes</span>
        <textarea className="input notes-box" rows={3} value={c.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} />
      </label>
      <div className="field">
        <span>Their sites</span>
        {sites.length === 0 ? (
          <span className="dim">No sites yet.</span>
        ) : (
          <MultiSelect
            label="Their sites"
            placeholder="Type a site name, Enter to add it"
            options={sites.map((s) => ({ value: s.id, label: s.client && s.client_id !== client.id ? `${s.name} (now with ${s.client})` : s.name }))}
            value={[...picked]}
            onChange={(ids) => setPicked(new Set(ids))}
          />
        )}
      </div>
    </Sheet>
  );
}

function CostSheet({ cost, sites, clients, onClose, onDone }: { cost: Cost; sites: Site[]; clients: Client[]; onClose: () => void; onDone: (msg: string) => void }) {
  const isNew = cost.id === 0;
  const [k, setK] = useState(cost);
  const [amount, setAmount] = useState(isNew ? "" : (cost.cents / 100).toFixed(2));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const on = k.site_id != null ? `s${k.site_id}` : k.client_id != null ? `c${k.client_id}` : "";
  const cents = toCents(amount);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await api.saveCost({ ...k, cents: cents ?? 0, currency: k.currency.trim().toUpperCase() });
      onDone(isNew ? `Added ${saved.label}.` : `Saved ${saved.label}.`);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteCost(cost.id);
      onDone(`Deleted ${cost.label}.`);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const footer = (
    <>
      {!isNew && (
        <Button kind="danger" className="push" disabled={busy} onClick={remove}>
          <Glyph name="trash" />
          Delete it
        </Button>
      )}
      <Button className="ghost" onClick={onClose}>
        {isNew ? "Close" : "Close without saving"}
      </Button>
      <Button kind="primary" className="disc" disabled={busy || !k.label.trim() || cents == null || !on} onClick={save}>
        <span className="btn-disc">
          <Glyph name={isNew ? "plus" : "check"} />
        </span>
        {busy ? "Saving…" : isNew ? "Add it" : "Save changes"}
      </Button>
    </>
  );

  return (
    <Sheet title={isNew ? "Add a cost or charge" : `Edit ${cost.label}`} onClose={onClose} footer={footer}>
      {error && (
        <p className="alert danger" role="alert">
          {error}
        </p>
      )}
      <div className="segmented" role="group" aria-label="Kind">
        <button type="button" aria-pressed={k.kind === "cost"} onClick={() => setK({ ...k, kind: "cost" })}>
          A cost to you
        </button>
        <button type="button" aria-pressed={k.kind === "charge"} onClick={() => setK({ ...k, kind: "charge" })}>
          A charge to the client
        </button>
      </div>
      <div className="g2 pair">
      <label className="field">
        <span>On</span>
        <Select
          className="input"
          aria-label="On"
          value={on}
          onChange={(e) => {
            const v = e.target.value;
            const id = Number(v.slice(1));
            setK({ ...k, site_id: v.startsWith("s") ? id : null, client_id: v.startsWith("c") ? id : null });
          }}
        >
          <option value="" disabled>
            Pick a client or a site
          </option>
          {clients.length > 0 && (
            <optgroup label="Clients">
              {clients.map((c) => (
                <option key={c.id} value={`c${c.id}`}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Sites">
            {sites.map((s) => (
              <option key={s.id} value={`s${s.id}`}>
                <SiteTile site={s} size="sm" />
                {s.name}
              </option>
            ))}
          </optgroup>
        </Select>
      </label>
      <label className="field">
        <span>What it is</span>
        <input className="input" placeholder="Hosting, domain, care plan" value={k.label} onChange={(e) => setK({ ...k, label: e.target.value })} />
      </label>
      <div className="field amount">
        <label htmlFor="cost-amount">
          Amount
        </label>
        <input id="cost-amount" className="input mono" inputMode="decimal" placeholder="120.00" aria-describedby={cents == null ? "cost-amount-why" : undefined} value={amount} onChange={(e) => setAmount(e.target.value)} />
        {amount.trim() !== "" && cents == null && (
          <small id="cost-amount-why" className="why danger">
            Write the amount as a number, like 120 or 9.99.
          </small>
        )}
      </div>
      <label className="field">
        <span>Currency</span>
        <input className="input mono" maxLength={3} value={k.currency} onChange={(e) => setK({ ...k, currency: e.target.value.toUpperCase() })} />
      </label>
      <label className="field">
        <span>How often</span>
        <Select className="input" aria-label="How often" value={k.every} onChange={(e) => setK({ ...k, every: e.target.value as Every })}>
          {(Object.keys(EVERY) as Every[]).map((e) => (
            <option key={e} value={e}>
              {EVERY[e]}
            </option>
          ))}
        </Select>
      </label>
      <div className="field">
        <span>{k.every === "once" ? "Due on" : "Renews on"}</span>
        <DateInput type="date" aria-label={k.every === "once" ? "Due on" : "Renews on"} value={k.renews_on ?? ""} onChange={(e) => setK({ ...k, renews_on: e.target.value || null })} />
      </div>
      </div>
    </Sheet>
  );
}
