// SPDX-License-Identifier: GPL-3.0-or-later
// Clients, their sites, and what the sites cost you and earn (plan Phase 7).
import { Skeleton, toast } from "../components/feedback";
import { DateInput, MultiSelect, Select } from "../components/controls";
import { useCallback, useEffect, useState } from "react";
import { api, type Client, type Cost, type Every, type Site } from "../api";
import { Button } from "../components/ui";
import { Sheet } from "../components/Sheet";

/** "€12.50"; an unknown code still reads ("XYZ 12.50"). */
export function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(cents / 100);
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

const EVERY: Record<Every, string> = { month: "Every month", year: "Every year", once: "Once" };

function Amounts({ costs, what }: { costs: Cost[]; what: "cost" | "charge" | "left" }) {
  const list = [...sums(costs)].filter(([, t]) => t.cost || t.charge);
  if (list.length === 0) return <span className="dim">none</span>;
  return (
    <>
      {list.map(([cur, t]) => {
        const n = what === "left" ? t.charge - t.cost : t[what];
        return (
          <span key={cur} className={`m ${what === "left" && n < 0 ? "danger" : ""}`} style={{ display: "block" }}>
            {n < 0 ? `minus ${money(-n, cur)}` : money(n, cur)}
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
      <div className="empty" role="alert">
        <h2>Clients didn't load.</h2>
        <p>{error}</p>
        <Button onClick={load}>Try again</Button>
      </div>
    );
  }
  if (!clients) {
    return (
      <Skeleton label="Loading clients…" />
    );
  }

  const siteName = (id: number | null) => sites.find((s) => s.id === id)?.name ?? "a removed site";
  const clientName = (id: number | null) => clients.find((c) => c.id === id)?.name ?? "a removed client";
  const of = (c: Client | null) => {
    const own = sites.filter((s) => s.client_id === (c?.id ?? null));
    const ids = new Set(own.map((s) => s.id));
    return { own, costs: costs.filter((k) => (c && k.client_id === c.id) || (k.site_id != null && ids.has(k.site_id))) };
  };
  const nextRenewal = (list: Cost[]) => list.map((k) => k.renews_on).filter(Boolean).sort()[0] ?? null;
  const currency = costs.at(-1)?.currency ?? "EUR";
  const blankCost = (): Cost => ({ id: 0, site_id: null, client_id: clients[0]?.id ?? null, kind: "cost", label: "", cents: 0, currency, every: "year", renews_on: null });
  const done = (msg: string) => {
    toast(msg);
    setEditing(null);
    load();
  };
  const rows: (Client | null)[] = [...clients, ...(sites.some((s) => s.client_id == null) ? [null] : [])];

  return (
    <div className="scroll">
      <div className="bar">
        <span className="dim">{clients.length === 1 ? "1 client" : `${clients.length} clients`}</span>
        <span className="grow" />
        <Button small onClick={() => setEditing({ cost: blankCost() })} disabled={clients.length === 0 && sites.length === 0}>
          Add a cost or charge
        </Button>
        <Button small kind="primary" onClick={() => setEditing({ client: { id: 0, name: "", email: "", notes: "" } })}>
          Add a client
        </Button>
      </div>
      {clients.length === 0 && costs.length === 0 ? (
        <div className="empty">
          <h2>No clients yet.</h2>
          <p>Add a client, tick their sites, then note what the sites cost you (hosting, domains, licences) and what you charge. Client reports use the same list.</p>
        </div>
      ) : (
        <>
          <p className="legend" id="clients-legend">
            Per month: a yearly amount counts a twelfth, and one-off amounts are left out. Left is what you charge minus what it costs you.
          </p>
          <table className="t" aria-label="Clients" aria-describedby="clients-legend">
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">Sites</th>
                <th scope="col">Costs a month</th>
                <th scope="col">Charges a month</th>
                <th scope="col">Left a month</th>
                <th scope="col">Next renewal</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const { own, costs: list } = of(c);
                return (
                  <tr key={c?.id ?? "none"}>
                    <td className="name">
                      {c ? (
                        <button type="button" className="linkish" onClick={() => setEditing({ client: c })}>
                          {c.name}
                        </button>
                      ) : (
                        <span className="dim">No client</span>
                      )}
                      {c?.email && <span className="why">{c.email}</span>}
                    </td>
                    <td className="wrap-s">{own.length ? own.map((s) => s.name).join(", ") : <span className="dim">none</span>}</td>
                    <td>
                      <Amounts costs={list} what="cost" />
                    </td>
                    <td>
                      <Amounts costs={list} what="charge" />
                    </td>
                    <td>
                      <Amounts costs={list} what="left" />
                    </td>
                    <td className="num">{nextRenewal(list) ?? <span className="dim">none</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <h2 className="sect">Costs and charges</h2>
          {costs.length === 0 ? (
            <p className="dim">None yet. Add what a site costs you, or what a client pays.</p>
          ) : (
            <table className="t" aria-label="Costs and charges">
              <thead>
                <tr>
                  <th scope="col">What</th>
                  <th scope="col">On</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Renews</th>
                </tr>
              </thead>
              <tbody>
                {costs.map((k) => (
                  <tr key={k.id}>
                    <td className="name">
                      <button type="button" className="linkish" onClick={() => setEditing({ cost: k })}>
                        {k.label}
                      </button>
                    </td>
                    <td>{k.site_id != null ? siteName(k.site_id) : clientName(k.client_id)}</td>
                    <td>{k.kind === "cost" ? "Cost" : "Charge"}</td>
                    <td className="m">
                      {money(k.cents, k.currency)} <span className="dim">{EVERY[k.every].toLowerCase()}</span>
                    </td>
                    <td className="num">{k.renews_on ?? <span className="dim">none</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      {editing && "client" in editing && <ClientSheet client={editing.client} sites={sites} onClose={() => setEditing(null)} onDone={done} />}
      {editing && "cost" in editing && <CostSheet cost={editing.cost} sites={sites} clients={clients} onClose={() => setEditing(null)} onDone={done} />}
    </div>
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
      <Button kind="danger" disabled={busy} onClick={remove}>
        Delete the client
      </Button>
    </>
  ) : (
    <>
      {!isNew && (
        <Button kind="danger" className="push" onClick={() => setDeleting(true)}>
          Delete the client
        </Button>
      )}
      <Button onClick={onClose}>Close without saving</Button>
      <Button kind="primary" disabled={busy || !c.name.trim()} onClick={save}>
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
      <label className="field">
        <span>Name</span>
        <input className="input" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
      </label>
      <label className="field">
        <span>Email</span>
        <input className="input" type="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} />
      </label>
      <label className="field">
        <span>Notes</span>
        <textarea className="input" rows={3} value={c.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} />
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
          Delete it
        </Button>
      )}
      <Button onClick={onClose}>Close without saving</Button>
      <Button kind="primary" disabled={busy || !k.label.trim() || cents == null || !on} onClick={save}>
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
      <div className="row">
        <label className="field grow">
          <span>Amount</span>
          <input className="input" inputMode="decimal" placeholder="120.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="field">
          <span>Currency</span>
          <input className="input" maxLength={3} size={4} value={k.currency} onChange={(e) => setK({ ...k, currency: e.target.value.toUpperCase() })} />
        </label>
      </div>
      {amount.trim() !== "" && cents == null && <small className="why danger">Write the amount as a number, like 120 or 9.99.</small>}
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
    </Sheet>
  );
}
