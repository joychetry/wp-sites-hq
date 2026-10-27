// Add a site (or sign one in again): Classic Monks OAuth in the browser, or
// Basic mode with an application password.
import { useState } from "react";
import { api, type Site } from "../api";
import { Button } from "../components/ui";
import { Sheet } from "../components/Sheet";

type Mode = Site["mode"];

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
  const ready = url.trim() && (mode === "classic_monks" || (username.trim() && password.trim()));

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
            placeholder="https://example.com"
            readOnly={!!again}
            autoComplete="url"
            spellCheck={false}
          />
        </label>
        {!again && (
          <div className="segmented" role="group" aria-label="How to connect">
            <button type="button" aria-pressed={mode === "classic_monks"} onClick={() => setMode("classic_monks")}>
              Classic Monks
            </button>
            <button type="button" aria-pressed={mode === "basic"} onClick={() => setMode("basic")}>
              Basic mode
            </button>
          </div>
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
