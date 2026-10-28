// SPDX-License-Identifier: GPL-3.0-or-later
// Add a site (or sign one in again): Classic Monks OAuth in the browser, or
// Basic mode with an application password.
import { useState } from "react";
import { api, type Site } from "../api";
import { Button } from "../components/ui";
import { Sheet } from "../components/Sheet";

type Mode = Site["mode"];

/** What is wrong with a typed site address, in words, or null when it can be tried. */
export function addressProblem(typed: string): string | null {
  const t = typed.trim();
  if (!t) return null;
  if (/\s/.test(t)) return "An address has no spaces. Write it like https://example.com.";
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(t)?.[1]?.toLowerCase();
  if (scheme && scheme !== "https" && scheme !== "http") return "Use an address that starts with https://.";
  try {
    const host = new URL(scheme ? t : `https://${t}`).hostname;
    if (!host.includes(".") && host !== "localhost") return "Write the whole address, like https://example.com.";
  } catch {
    return "Write the site's address, like https://example.com.";
  }
  return null;
}

type Props = {
  /** Sign this site in again instead of adding a new one. */
  again?: Site;
  onClose: () => void;
  onDone: (site: Site) => void;
};

export function AddSite({ again, onClose, onDone }: Props) {
  const [url, setUrl] = useState(again?.url ?? "");
  const [mode, setMode] = useState<Mode>(again?.mode ?? "classic_monks");
  const [username, setUsername] = useState(again?.username ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<null | "browser" | "saving">(null);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const problem = again ? null : addressProblem(url);

  const submit = async () => {
    setError(null);
    setBusy(mode === "classic_monks" ? "browser" : "saving");
    try {
      const site =
        mode === "classic_monks"
          ? again
            ? await api.signInAgain(again.id)
            : await api.addOAuth(url)
          : again
            ? await api.signInAgain(again.id, username, password)
            : await api.addBasic(url, username, password);
      onDone(site);
    } catch (e) {
      setError(String(e));
      setBusy(null);
    }
  };

  const close = () => {
    if (busy === "browser") api.cancelSignIn();
    onClose();
  };

  const title = again ? `Sign in to ${again.name} again` : "Add a site";
  const ready = url.trim() && !problem && (mode === "classic_monks" || (username.trim() && password.trim()));

  return (
    <Sheet
      title={title}
      intro={again ? "Group, tags and notes stay as they are." : "The site needs WordPress 7.1 or newer."}
      onClose={close}
      footer={
        <>
          {busy === "browser" ? (
            <span className="sum waiting" role="status">
              Waiting for you in the browser
            </span>
          ) : (
            <span className="sum" />
          )}
          <Button onClick={close}>{busy === "browser" ? "Cancel the sign-in" : "Close without adding"}</Button>
          <Button kind="primary" disabled={!ready || busy !== null} onClick={submit} keys="Enter">
            {mode === "classic_monks" ? "Open the sign-in page" : again ? "Sign in" : "Add the site"}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) submit();
        }}
      >
        {error && (
          <p className="alert danger" role="alert">
            {error}
          </p>
        )}
        <label className="field">
          <span>Site address</span>
          <input
            className="input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={(touched && !!problem) || undefined}
            aria-describedby={touched && problem ? "address-problem" : undefined}
            placeholder="https://example.com"
            readOnly={!!again}
            autoComplete="url"
            spellCheck={false}
          />
          {/* The line is always there, so the cards below don't move when you click one and the box checks itself. */}
          <span id="address-problem" className="err reserve">
            {touched && problem}
          </span>
        </label>
        {!again && (
          <fieldset className="radios cards">
            <legend>How to connect</legend>
            <label>
              <input type="radio" name="mode" checked={mode === "classic_monks"} onChange={() => setMode("classic_monks")} />
              <span>
                Classic Monks
                <small>Full control: updates, content, people, one-click login. Signs in through the browser.</small>
              </span>
            </label>
            <label>
              <input type="radio" name="mode" checked={mode === "basic"} onChange={() => setMode("basic")} />
              <span>
                Basic mode
                <small>Any WordPress 7.1 site, with an application password. Fewer tools.</small>
              </span>
            </label>
          </fieldset>
        )}
        {mode === "classic_monks" ? (
          <ol className="steps">
            <li>Your browser opens the site's sign-in page.</li>
            <li>Sign in as an administrator.</li>
            <li>Tick the tool groups Monks Central may use. With none ticked it can't do anything.</li>
            <li>
              Tick <b>This is my Monks Central app (operator)</b>, then press Connect.
            </li>
            <li>Come back here. The site appears on its own.</li>
          </ol>
        ) : (
          <>
            <p style={{ marginTop: 0, color: "var(--text-2)" }}>
              For sites without Classic Monks. Make an application password under Users &gt; Profile on the site.
              Updates, one-click login and Classic Monks modules need Classic Monks.
            </p>
            <label className="field">
              <span>WordPress user name</span>
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </label>
            <label className="field">
              <span>Application password</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
              />
              <small>Kept encrypted on this computer. Never shown again.</small>
            </label>
          </>
        )}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
