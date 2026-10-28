// Users on every site shown: find, add, change a role, delete with a new owner
// for their content, and email a password reset (plan Phase 4).
import { useCallback, useEffect, useRef, useState } from "react";
import { api, peopleBlocked, type Role, type Site, type User, type Users as SiteUsers } from "../api";
import { Button } from "../components/ui";
import { Sheet } from "../components/Sheet";

type Loaded = { site: Site; users?: SiteUsers; error?: string };
type Action = { kind: "add" } | { kind: "role" | "delete"; site: Site; user: User; roles: Role[] };

const roleName = (roles: Role[], id: string) => roles.find((r) => r.id === id)?.name ?? (id || "No role");

export function Users({ sites }: { sites: Site[] }) {
  const usable = sites.filter((s) => !peopleBlocked(s, "get-users"));
  const [loaded, setLoaded] = useState<Loaded[] | null>(null);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const ids = usable.map((s) => s.id).join(",");

  // Only the newest request's answer is shown, so a slow older search or tab can't replace it.
  const asked = useRef(0);
  const load = useCallback(() => {
    const n = ++asked.current;
    setLoaded(null);
    Promise.all(
      usable.map((site) =>
        api.users(site.id, search).then(
          (users) => ({ site, users }),
          (e) => ({ site, error: String(e) }),
        ),
      ),
    ).then((l) => n === asked.current && setLoaded(l));
    // `ids` stands for the usable sites.
  }, [ids, search]);
  useEffect(load, [load]);

  if (sites.length === 0) {
    return (
      <div className="empty">
        <h2>No sites yet.</h2>
        <p>Add a site on Sites, then its users show here.</p>
      </div>
    );
  }

  const done = (text: string, ok = true) => {
    setAction(null);
    setNote({ ok, text });
    load();
  };
  const reset = async (site: Site, user: User) => {
    setNote(null);
    try {
      const to = await api.sendReset(site.id, user.id);
      setNote({ ok: true, text: `Sent ${user.username} a link to set a new password (${to}).` });
    } catch (e) {
      setNote({ ok: false, text: String(e) });
    }
  };

  const rows = (loaded ?? []).flatMap((l) => (l.users?.users ?? []).map((u) => ({ l, u })));
  const blocked = sites.filter((s) => peopleBlocked(s, "get-users"));
  let body;
  if (!loaded) {
    body = (
      <p className="empty" role="status">
        Reading users on {usable.length} {usable.length === 1 ? "site" : "sites"}…
      </p>
    );
  } else if (rows.length === 0) {
    body = (
      <div className="empty">
        <h2>{search ? "Nobody matches." : "No users to show."}</h2>
        <p>{search ? "Try part of a name, username or email address." : "The sites below can't list their users here."}</p>
        {search && (
          <Button
            onClick={() => {
              setTyped("");
              setSearch("");
            }}
          >
            Clear the search
          </Button>
        )}
      </div>
    );
  } else {
    body = (
      <>
        <p className="legend" id="users-legend">
          Users on every site shown, by name. Deleting a user hands their posts and pages to another user on the same site.
        </p>
        <table className="t" aria-label="Users" aria-describedby="users-legend">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Site</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ l, u }) => {
              const roles = l.users!.roles;
              const who = u.name || u.username;
              return (
                <tr key={`${l.site.id}-${u.id}`}>
                  <td className="name">
                    <span className="cut" title={who}>
                      {who}
                    </span>
                    {u.name && u.name !== u.username && <span className="dim"> {u.username}</span>}
                  </td>
                  <td className="cut" title={u.email}>
                    {u.email || "none"}
                  </td>
                  <td>{roleName(roles, u.role)}</td>
                  <td>{l.site.name}</td>
                  <td>
                    <div className="row">
                    <Button small aria-label={`Change role for ${who} on ${l.site.name}`} disabled={roles.length === 0} onClick={() => setAction({ kind: "role", site: l.site, user: u, roles })}>
                      Change role
                    </Button>
                    {l.users!.can_reset && (
                      <Button small aria-label={`Send password reset to ${who} on ${l.site.name}`} onClick={() => reset(l.site, u)}>
                        Send password reset
                      </Button>
                    )}
                    <Button small kind="danger" aria-label={`Delete ${who} from ${l.site.name}`} onClick={() => setAction({ kind: "delete", site: l.site, user: u, roles })}>
                      Delete
                    </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </>
    );
  }

  const partial = (loaded ?? []).filter((l) => l.users && l.users.total > l.users.users.length);
  const failed = (loaded ?? []).filter((l) => l.error);

  return (
    <div className="scroll">
      <form
        className="bar"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(typed.trim());
        }}
      >
        <input className="input sm" aria-label="Search users" placeholder="Search by name, username or email" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <Button small type="submit">
          Search
        </Button>
        <span className="grow" />
        <Button kind="primary" small disabled={usable.length === 0} onClick={() => setAction({ kind: "add" })}>
          Add a user
        </Button>
      </form>
      <div role="status" className="notice">
        {note && <p className={`alert ${note.ok ? "ok" : "danger"}`}>{note.text}</p>}
      </div>
      {body}
      {(partial.length > 0 || failed.length > 0 || blocked.length > 0) && (
        <ul className="notes" aria-label="Sites not fully shown">
          {partial.map((l) => (
            <li key={l.site.id}>
              {l.site.name}: showing {l.users!.users.length} of {l.users!.total} users. Search to find the others.
            </li>
          ))}
          {failed.map((l) => (
            <li key={l.site.id}>
              {l.site.name}: the users didn't load. {l.error}
            </li>
          ))}
          {blocked.map((s) => (
            <li key={s.id}>
              {s.name}: {peopleBlocked(s, "get-users")}
            </li>
          ))}
        </ul>
      )}
      {action?.kind === "add" && <AddUser sites={usable} onClose={() => setAction(null)} onDone={done} />}
      {action?.kind === "role" && <ChangeRole {...action} onClose={() => setAction(null)} onDone={done} />}
      {action?.kind === "delete" && <DeleteUser {...action} onClose={() => setAction(null)} onDone={done} />}
    </div>
  );
}

type SheetProps = { onClose: () => void; onDone: (text: string, ok?: boolean) => void };

function AddUser({ sites, onClose, onDone }: { sites: Site[] } & SheetProps) {
  const [siteId, setSiteId] = useState(sites[0]?.id ?? 0);
  const [info, setInfo] = useState<SiteUsers | null>(null);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("subscriber");
  const [sendReset, setSendReset] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const site = sites.find((s) => s.id === siteId);
  useEffect(() => {
    setInfo(null);
    api.users(siteId, "").then(setInfo, (e) => setError(String(e)));
  }, [siteId]);
  const roles = info?.roles ?? [];
  const admin = role === "administrator";

  const save = async () => {
    setBusy(true);
    setError(null);
    let u: User;
    try {
      u = await api.createUser(siteId, { username, email, role });
    } catch (e) {
      setError(String(e));
      setBusy(false);
      return;
    }
    const added = `Added ${u.username} to ${site?.name} as ${roleName(roles, u.role)}.`;
    if (!info?.can_reset || !sendReset) return onDone(added);
    try {
      await api.sendReset(siteId, u.id);
      onDone(`${added} They were emailed a link to set their password.`);
    } catch (e) {
      // The user exists either way: close the sheet so they aren't added twice.
      onDone(`${added} The password email didn't go out: ${e}`, false);
    }
  };

  return (
    <Sheet
      title="Add a user"
      intro="Nobody sees their password. They set their own."
      onClose={onClose}
      footer={
        <>
          <Button kind="primary" disabled={busy || !username.trim() || !email.trim() || !info} onClick={save}>
            {busy ? "Adding…" : admin ? "Add the administrator" : "Add the user"}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <label className="field">
        <span>Site</span>
        <select className="input" aria-label="Site" value={siteId} onChange={(e) => setSiteId(Number(e.target.value))}>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Username</span>
        <input className="input" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
        <small>Letters, numbers and _ . - @. It can't be changed later.</small>
      </label>
      <label className="field">
        <span>Email address</span>
        <input className="input" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        <span>Role</span>
        <select className="input" aria-label="Role" value={role} disabled={!info} onChange={(e) => setRole(e.target.value)}>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {admin && <small>An administrator can change everything on {site?.name}, including other users.</small>}
      </label>
      {info?.can_reset ? (
        <p className="row">
          <button type="button" className="box" role="checkbox" aria-checked={sendReset} aria-labelledby="reset-label" onClick={() => setSendReset((v) => !v)} />
          <span id="reset-label">Email them a link to set their password</span>
        </p>
      ) : (
        info && <p className="help-text">They set their password with "Lost your password?" on the site's login screen.</p>
      )}
      {error && (
        <p className="alert danger" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}

function ChangeRole({ site, user, roles, onClose, onDone }: { site: Site; user: User; roles: Role[] } & SheetProps) {
  const [role, setRole] = useState(user.role || roles[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const who = user.name || user.username;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.setRole(site.id, user.id, role);
      onDone(`${who} is now ${roleName(roles, role)} on ${site.name}.`);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`Change ${who}'s role`}
      intro={`On ${site.name}. Now ${roleName(roles, user.role)}.`}
      onClose={onClose}
      footer={
        <>
          <Button kind="primary" disabled={busy || role === user.role} onClick={save}>
            {busy ? "Changing…" : `Make them ${roleName(roles, role)}`}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <label className="field">
        <span>New role</span>
        <select className="input" aria-label="New role" value={role} onChange={(e) => setRole(e.target.value)}>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {role === "administrator" && role !== user.role && <small>An administrator can change everything on {site.name}, including other users.</small>}
      </label>
      {error && (
        <p className="alert danger" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}

function DeleteUser({ site, user, onClose, onDone }: { site: Site; user: User } & SheetProps) {
  // The whole site, not the search the table shows.
  const [others, setOthers] = useState<User[] | null>(null);
  const [to, setTo] = useState(0);
  useEffect(() => {
    api.users(site.id, "").then(
      (u) => {
        const rest = u.users.filter((o) => o.id !== user.id);
        setOthers(rest);
        setTo(rest[0]?.id ?? 0);
      },
      (e) => setError(String(e)),
    );
  }, [site.id, user.id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const who = user.name || user.username;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteUser(site.id, user.id, to);
      const heir = others?.find((o) => o.id === to);
      onDone(`Deleted ${who} from ${site.name}. Their posts and pages now belong to ${heir?.name || heir?.username}.`);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`Delete ${who}`}
      intro={`From ${site.name}. This can't be undone.`}
      onClose={onClose}
      footer={
        <>
          <Button kind="danger" disabled={busy || !to} onClick={save}>
            {busy ? "Deleting…" : `Delete ${who}`}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      {!others ? (
        !error && <p role="status">Reading {site.name}'s users…</p>
      ) : others.length === 0 ? (
        <p className="help-text">There is nobody else on this site to receive their posts and pages, so they can't be deleted here.</p>
      ) : (
        <label className="field">
          <span>Give their posts and pages to</span>
          <select className="input" aria-label="Give their posts and pages to" value={to} onChange={(e) => setTo(Number(e.target.value))}>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name || o.username} ({o.username})
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p className="alert danger" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}
