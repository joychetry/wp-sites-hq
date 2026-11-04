// SPDX-License-Identifier: GPL-3.0-or-later
// Users on every site shown: find, add, change a role, delete with a new owner
// for their content, and email a password reset (plan Phase 4).
import "../styles/screens/users.css";
import { askSignIn, Blocked, Empty, Skeleton, toast } from "../components/feedback";
import { Page, Toolbar } from "../components/page";
import { Menu, Select, SearchInput } from "../components/controls";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, peopleBlocked, type Role, type Site, type User, type Users as SiteUsers } from "../api";
import { initials, SiteTile } from "../components/SiteTile";
import { Button, Glyph, HeadActions } from "../components/ui";
import { Sheet } from "../components/Sheet";
import { day } from "../format";

type Loaded = { site: Site; users?: SiteUsers; error?: string };
type Action = { kind: "add" } | { kind: "role" | "delete"; site: Site; user: User; roles: Role[] };

const roleName = (roles: Role[], id: string) => roles.find((r) => r.id === id)?.name ?? (id || "No role");
/** A role inside a sentence: "an editor", "a shop manager". */
export const aRole = (roles: Role[], id: string) => {
  const n = roleName(roles, id).toLowerCase();
  return `${/^[aeiou]/.test(n) ? "an" : "a"} ${n}`;
};

export function Users({ sites }: { sites: Site[] }) {
  const usable = sites.filter((s) => !peopleBlocked(s, "get-users"));
  const [loaded, setLoaded] = useState<Loaded[] | null>(null);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState<Action | null>(null);
  // Site and Role filters work on the rows already read.
  const [siteF, setSiteF] = useState<number | null>(null);
  const [roleF, setRoleF] = useState<string | null>(null);
  const ids = usable.map((s) => s.id).join(",");

  // Only the newest request's answer is shown, so a slow older search or tab can't replace it.
  const asked = useRef(0);
  // A refresh after an action keeps the rows on screen, so nothing jumps under the pointer.
  const load = useCallback((keep = false) => {
    const n = ++asked.current;
    if (!keep) setLoaded(null);
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
  useEffect(() => load(), [load]);
  // Search as you type, once the typing pauses (as Media does).
  useEffect(() => {
    const t = setTimeout(() => setSearch(typed.trim()), 300);
    return () => clearTimeout(t);
  }, [typed]);

  if (sites.length === 0) {
    return (
      <Page>
        <Empty picture="sites" title="No sites yet">
          <p>Add a site on Sites, then its users show here.</p>
        </Empty>
      </Page>
    );
  }

  const done = (text: string, ok = true) => {
    setAction(null);
    toast(text, { tone: ok ? "ok" : "danger" });
    load(true);
  };
  const reset = async (site: Site, user: User) => {
    try {
      const to = await api.sendReset(site.id, user.id);
      toast(`Sent ${user.name || user.username} a link to set a new password (${to}).`);
    } catch (e) {
      toast(String(e), { tone: "danger" });
    }
  };

  const all = (loaded ?? []).flatMap((l) => (l.users?.users ?? []).map((u) => ({ l, u })));
  const rows = all.filter(({ l, u }) => (siteF == null || l.site.id === siteF) && (roleF == null || u.role === roleF));
  const blocked = sites.filter((s) => peopleBlocked(s, "get-users"));
  // Every role any shown site has, once, for the Role filter.
  const roleList = [...new Map((loaded ?? []).flatMap((l) => l.users?.roles ?? []).map((r) => [r.id, r])).values()];
  const people = new Set(rows.map(({ u }) => (u.email || u.username).toLowerCase())).size;
  const onSites = new Set(rows.map(({ l }) => l.site.id)).size;
  const filtered = search || siteF != null || roleF != null;
  // The only site, and it can't list users: the blocked state with its fix, not an empty table.
  const lone = usable.length === 0 && blocked.length === 1 ? blocked[0] : null;
  let body;
  if (lone) {
    body = <Blocked site={lone} reason={peopleBlocked(lone, "get-users")!} title={`${lone.name}'s users aren't available here`} />;
  } else if (!loaded) {
    body = (
      <Skeleton label={`Reading users on ${usable.length} ${usable.length === 1 ? "site" : "sites"}…`} />
    );
  } else if (rows.length === 0) {
    body = (
      <Empty
        picture="search"
        title={filtered ? "Nobody matches" : "No users to show"}
        action={
          filtered && (
            <Button
              onClick={() => {
                setTyped("");
                setSearch("");
                setSiteF(null);
                setRoleF(null);
              }}
            >
              Clear the filters
            </Button>
          )
        }
      >
        <p>{filtered ? "Try part of a name, username or email address, or another site or role." : "The sites below can't list their users here."}</p>
      </Empty>
    );
  } else {
    body = (
      <>
        <p className="sr-only" id="users-legend">
          Users on every site shown, by name. Deleting a user hands their posts and pages to another user on the same site.
        </p>
        <table className="t" aria-label="Users" aria-describedby="users-legend">
          <colgroup>
            <col className="c-fill" />
            <col className="c-text" />
            <col className="c-status" />
            <col className="c-date" />
            <col className="c-act-lg" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">User</th>
              <th scope="col">Site</th>
              <th scope="col">Role</th>
              <th scope="col">Joined</th>
              <th scope="col" className="act">
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
                  <td>
                    <div className="site">
                      <span className="av lg well" aria-hidden="true">
                        {initials(who)}
                      </span>
                      <span>
                        <b data-tip={who}>{who}</b>
                        <small data-tip={u.email || u.username}>{u.email || u.username}</small>
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className="conn" data-tip={l.site.name}>
                      <SiteTile site={l.site} size="sm" />
                      <span className="cut">{l.site.name}</span>
                    </span>
                  </td>
                  <td>
                    <span className={u.role === "administrator" ? "pchip brand" : "pchip"}>{roleName(roles, u.role)}</span>
                  </td>
                  <td>
                    <span className="when" data-tip={u.registered || undefined}>
                      {day(u.registered) || "not known"}
                    </span>
                  </td>
                  <td className="act">
                    {/* Three fixed slots, icons with tips, so every row's buttons line up. */}
                    <div className="rowacts">
                      <button type="button" className="icon-btn" aria-label={`Change role for ${who} on ${l.site.name}`} data-tip="Change role" disabled={roles.length === 0} onClick={() => setAction({ kind: "role", site: l.site, user: u, roles })}>
                        <Glyph name="user" />
                      </button>
                      {/* aria-disabled, not disabled: it stays focusable so its tip says why. */}
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Send password reset to ${who} on ${l.site.name}`}
                        aria-disabled={!l.users!.can_reset || undefined}
                        data-tip={l.users!.can_reset ? "Send password reset" : "This site can't send password emails from here"}
                        onClick={() => l.users!.can_reset && reset(l.site, u)}
                      >
                        <Glyph name="mail" />
                      </button>
                      <button type="button" className="icon-btn" aria-label={`Delete ${who} from ${l.site.name}`} data-tip="Delete the user" onClick={() => setAction({ kind: "delete", site: l.site, user: u, roles })}>
                        <Glyph name="trash" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="card-foot">
          <span className="count">
            {/* Accounts only when someone has more than one. */}
            {people === rows.length ? "" : `${rows.length} accounts for `}
            {people === 1 ? "1 person" : `${people} people`} on {onSites === 1 ? "1 site" : `${onSites} sites`}
          </span>
        </div>
      </>
    );
  }

  const partial = (loaded ?? []).filter((l) => l.users && l.users.total > l.users.users.length);
  const failed = (loaded ?? []).filter((l) => l.error);
  const siteName = usable.find((s) => s.id === siteF)?.name;

  return (
    <Page className="users">
      <HeadActions>
        <Button kind="primary" className="disc" disabled={usable.length === 0} onClick={() => setAction({ kind: "add" })}>
          Add a user
          <span className="btn-disc">
            <Glyph name="plus" />
          </span>
        </Button>
      </HeadActions>
      <Toolbar label="Which users to show">
          <SearchInput aria-label="Search users" placeholder="Search users by name or email" value={typed} onChange={(e) => setTyped(e.target.value)} />
          <Menu label="Site" className={siteF == null ? "chip" : "chip on"} items={[{ label: "Any", run: () => setSiteF(null) }, ...usable.map((s) => ({ label: s.name, run: () => setSiteF(s.id) }))]}>
            Site: <b>{siteName ?? "Any"}</b>
          </Menu>
          <Menu label="Role" className={roleF == null ? "chip" : "chip on"} items={[{ label: "Any", run: () => setRoleF(null) }, ...roleList.map((r) => ({ label: r.name, run: () => setRoleF(r.id) }))]}>
            Role: <b>{roleF == null ? "Any" : roleName(roleList, roleF)}</b>
          </Menu>
      </Toolbar>
      <section className="card" aria-label="Users on every site">
        {body}
      </section>
      {(partial.length > 0 || failed.length > 0 || (blocked.length > 0 && !lone)) && (
        <ul className="pnotes" aria-label="Sites not fully shown">
          {partial.map((l) => (
            <li key={l.site.id} className="callout">
              <Glyph name="info" />
              <span>
                {l.site.name}: showing {l.users!.users.length} of {l.users!.total} users. Search to find the others.
              </span>
            </li>
          ))}
          {failed.map((l) => (
            <li key={l.site.id} className="callout warning">
              <Glyph name="alert" />
              <span>
                {l.site.name}: the users didn't load. {l.error}
              </span>
            </li>
          ))}
          {!lone && blocked.map((s) => (
            <li key={s.id} className="callout go">
              <Glyph name="lock" />
              <span>
                {s.name}: {peopleBlocked(s, "get-users")}
              </span>
              <Button small onClick={() => askSignIn(s.id)}>
                Sign in again
              </Button>
            </li>
          ))}
        </ul>
      )}
      {action?.kind === "add" && <AddUser sites={usable} onClose={() => setAction(null)} onDone={done} />}
      {action?.kind === "role" && <ChangeRole {...action} onClose={() => setAction(null)} onDone={done} />}
      {action?.kind === "delete" && <DeleteUser {...action} onClose={() => setAction(null)} onDone={done} />}
    </Page>
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
  // Add stays pressable; a press with a field missing says which one.
  const [tried, setTried] = useState(false);
  const site = sites.find((s) => s.id === siteId);
  useEffect(() => {
    setInfo(null);
    api.users(siteId, "").then(setInfo, (e) => setError(String(e)));
  }, [siteId]);
  const roles = info?.roles ?? [];
  const admin = role === "administrator";

  const save = async () => {
    if (!username.trim() || !email.trim()) return setTried(true);
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
    const added = `Added ${u.username} to ${site?.name} as ${aRole(roles, u.role)}.`;
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
          <Button className="ghost" onClick={onClose}>
            Close without saving
          </Button>
          <Button kind="primary" className="disc" disabled={busy || !info} onClick={save}>
            {busy ? "Adding…" : admin ? "Add the administrator" : "Add the user"}
            <span className="btn-disc">
              <Glyph name="plus" />
            </span>
          </Button>
        </>
      }
    >
      <label className="field">
        <span>Site</span>
        <Select className="input" aria-label="Site" value={siteId} onChange={(e) => setSiteId(Number(e.target.value))}>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              <SiteTile site={s} size="sm" />
              {s.name}
            </option>
          ))}
        </Select>
      </label>
      <div className="g2 pair">
      <label className="field">
        <span>Username</span>
        <input className="input" autoComplete="off" aria-invalid={(tried && !username.trim()) || undefined} value={username} onChange={(e) => setUsername(e.target.value)} />
        {tried && !username.trim() ? <small className="err">Fill in the username.</small> : <small>Letters, numbers and _ . - @. It can't be changed later.</small>}
      </label>
      <label className="field">
        <span>Email address</span>
        <input className="input" type="email" autoComplete="off" aria-invalid={(tried && !email.trim()) || undefined} value={email} onChange={(e) => setEmail(e.target.value)} />
        {tried && !email.trim() && <small className="err">Fill in the email address.</small>}
      </label>
      </div>
      <label className="field">
        <span>Role</span>
        <Select className="input" aria-label="Role" value={role} disabled={!info} onChange={(e) => setRole(e.target.value)}>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </label>
      {admin && <AdminNote site={site?.name} />}
      {info?.can_reset ? (
        <label className="row check">
          <input type="checkbox" checked={sendReset} onChange={(e) => setSendReset(e.target.checked)} />
          <span>Email them a link to set their password</span>
        </label>
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
      onDone(`${who} is now ${aRole(roles, role)} on ${site.name}.`);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`Change ${who}'s role`}
      intro={`On ${site.name}. ${user.role ? `They're ${aRole(roles, user.role)} now.` : "They have no role now."}`}
      onClose={onClose}
      footer={
        <>
          <Button className="ghost" onClick={onClose}>
            Close without saving
          </Button>
          <Button kind="primary" className="disc" disabled={busy || role === user.role} onClick={save}>
            {busy ? "Changing…" : `Make them ${aRole(roles, role)}`}
            <span className="btn-disc">
              <Glyph name="check" />
            </span>
          </Button>
        </>
      }
    >
      <label className="field">
        <span>New role</span>
        <Select className="input" aria-label="New role" value={role} onChange={(e) => setRole(e.target.value)}>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </label>
      {role === "administrator" && role !== user.role && <AdminNote site={site.name} />}
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
          <Button className="ghost" onClick={onClose}>
            Keep it
          </Button>
          <Button kind="danger" className="solid" disabled={busy || !to} onClick={save}>
            {busy ? "Deleting…" : `Delete ${who}`}
            <Glyph name="trash" />
          </Button>
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
          <Select className="input" aria-label="Give their posts and pages to" placeholder="Choose a user" value={to || ""} onChange={(e) => setTo(Number(e.target.value))}>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name || o.username} ({o.username})
              </option>
            ))}
          </Select>
          <small>Their posts and pages move to this user before {who} is deleted from {site.name}.</small>
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

/** What making someone an administrator means, before it is done. */
function AdminNote({ site }: { site?: string }) {
  return (
    <p className="callout warning admin-note">
      <Glyph name="alert" />
      <span>
        <b>An administrator can change everything on {site},</b> including plugins, users and settings.
      </span>
    </p>
  );
}
