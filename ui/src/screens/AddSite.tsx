// SPDX-License-Identifier: GPL-3.0-or-later
// Add a site (or sign one in again): OAuth in the browser through the site's plugin
// (the WP Sites HQ plugin, Classic Monks or Classic Monks Pro), or
// Basic mode with an application password.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, pluginName, type Site } from "../api";
import { Button, Glyph, Logo } from "../components/ui";
import { Sheet } from "../components/Sheet";
import "../styles/screens/addsite.css";

type Mode = Site["mode"];

/** The one sentence on which plugins give full control (Add a site, the Sites panel, the empty pages). */
export const ANY_PLUGIN = "Any of these plugins on the site works: the WP Sites HQ plugin, Classic Monks or Classic Monks Pro.";

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
  // Basic mode asks for the address first, then the sign-in (the design's two steps).
  const [step, setStep] = useState<1 | 2>(1);
  const [username, setUsername] = useState(again?.username ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<null | "browser" | "saving">(null);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const problem = again ? null : addressProblem(url);
  const basic = mode === "basic";
  const host = (() => {
    try {
      return new URL(/:\/\//.test(url) ? url : `https://${url.trim()}`).host;
    } catch {
      return url;
    }
  })();

  const submit = async () => {
    setError(null);
    setBusy(basic ? "saving" : "browser");
    try {
      const site = !basic
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

  // Signing in again through a plugin needs nothing typed, so the browser opens at once (Basic mode asks for the password first).
  const started = useRef(false);
  useEffect(() => {
    if (again && !basic && !started.current) {
      started.current = true;
      submit();
    }
  }, []);

  const close = () => {
    if (busy === "browser") api.cancelSignIn();
    onClose();
  };

  const addressOk = !!url.trim() && !problem;
  const signedIn = !!username.trim() && !!password.trim();
  const toStep2 = !again && basic && step === 1;
  const ready = addressOk && (!basic || toStep2 || signedIn);
  const go = () => {
    setTouched(true);
    if (!ready || busy) return;
    if (toStep2) setStep(2);
    else submit();
  };

  const waiting = busy ? (
    <span className="sum waiting" role="status">
      {busy === "browser" ? "Waiting for you in the browser" : "Checking the password…"}
    </span>
  ) : (
    <span className="sum" />
  );
  // A typed address with a problem can still be pressed: the press shows the problem instead of doing nothing.
  const pressable = ready || (!!url.trim() && !!problem);
  // While the browser is open the footer holds the waiting line and the way out, nothing to press twice.
  const primary = busy !== "browser" && (
    <Button kind="primary" className="disc" disabled={!pressable || busy !== null} onClick={go} keys={again ? undefined : "Enter"}>
      {toStep2 ? "Next" : !basic ? (again ? "Sign in again" : "Open the sign-in page") : again ? "Sign in" : "Add the site"}
      <span className="btn-disc">
        <Glyph name={toStep2 ? "arrow" : again ? "login" : basic ? "check" : "external"} />
      </span>
    </Button>
  );
  const errorLine = error && (
    <p className="alert danger" role="alert">
      {error}
    </p>
  );
  const credentials = (
    <>
      <label className="field">
        <span>WordPress user name</span>
        <input className="input" autoFocus={step === 2} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" spellCheck={false} />
      </label>
      <label className="field">
        <span>Application password</span>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
        <small className="lockline">
          <Glyph name="lock" />
          Kept encrypted on this computer. Never shown again.
        </small>
      </label>
    </>
  );
  const form = (children: ReactNode) => (
    <form
      className="addsite"
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      {errorLine}
      {children}
      <button type="submit" hidden />
    </form>
  );

  if (again) {
    const expired = again.sign_in_again;
    return (
      <Sheet
        dialog
        title={expired ? `${again.name}: sign-in expired` : `${again.name}: sign in again`}
        icon={
          <span className="tile warning">
            <Glyph name="login" />
          </span>
        }
        intro={
          <span className="mono meta">
            {host} · {basic ? "Basic mode" : pluginName(again)}
          </span>
        }
        onClose={close}
        footer={
          <>
            {waiting}
            <Button onClick={close}>{busy === "browser" ? "Cancel the sign-in" : "Close"}</Button>
            {primary}
          </>
        }
      >
        {form(
          <>
            <p className="lead">
              {expired
                ? "Sign in on the site once and WP Sites HQ picks up where it left off. Your notes, tags and group stay as they are."
                : "Sign in on the site again and allow what WP Sites HQ may do. Your notes, tags and group stay as they are."}
            </p>
            {basic && credentials}
            <p className="callout">
              <Glyph name="info" />
              <span>Until you sign in, {again.name} is left out of updates, AI plans and publishing on several sites.</span>
            </p>
          </>,
        )}
      </Sheet>
    );
  }

  const on = basic && step === 2 ? 2 : busy === "browser" ? 2 : 1;
  const steps = (
    <ol className="jobsteps" aria-label="Steps">
      {["Address", "Sign in"].map((label, i) => (
        <li key={label} className={i + 1 < on ? "done" : undefined} aria-current={i + 1 === on ? "step" : undefined}>
          <i aria-hidden="true">{i + 1 < on ? <Glyph name="check" /> : i + 1}</i>
          <span>{label}</span>
          {i + 1 < on && <span className="sr-only">, done</span>}
        </li>
      ))}
    </ol>
  );

  if (basic && step === 2) {
    const where = `${/:\/\//.test(url) ? url.trim().replace(/\/+$/, "") : `https://${url.trim()}`}/wp-admin/profile.php#application-passwords-section`;
    return (
      <Sheet
        dialog
        title="Add a site"
        steps={steps}
        onClose={close}
        footer={
          <>
            {waiting}
            <Button onClick={() => setStep(1)}>
              <Glyph name="arrow-left" />
              Back
            </Button>
            {primary}
          </>
        }
      >
        {form(
          <>
            <div className="row chips">
              <span className="pchip">
                <Glyph name="globe" />
                {host}
              </span>
              <span className="pchip">Basic mode</span>
            </div>
            {credentials}
            <button type="button" className="golink" onClick={() => api.openLink(where).catch((e) => setError(String(e)))}>
              Where do I make one?
              <Glyph name="external" />
            </button>
          </>,
        )}
      </Sheet>
    );
  }

  return (
    <Sheet
      dialog
      title="Add a site"
      steps={steps}
      onClose={close}
      footer={
        <>
          {waiting}
          <Button onClick={close}>{busy === "browser" ? "Cancel the sign-in" : "Close without saving"}</Button>
          {primary}
        </>
      }
    >
      {form(
        <>
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
              autoComplete="url"
              spellCheck={false}
            />
            {/* The line is always there, so the cards below don't move when you click one and the box checks itself. */}
            <span id="address-problem" className="err reserve">
              {touched && problem}
            </span>
          </label>
          <fieldset className="choices">
            <legend>How to connect</legend>
            <label className="choice">
              <input className="sr-only" type="radio" name="mode" checked={!basic} onChange={() => setMode("classic_monks")} />
              <span className="tile">
                <Logo />
              </span>
              <b>
                WP Sites HQ plugin <span className="tag ok">Recommended</span>
              </b>
              <span>{ANY_PLUGIN} Sign in on the site once and every tool works, including undo.</span>
            </label>
            <label className="choice">
              <input className="sr-only" type="radio" name="mode" checked={basic} onChange={() => setMode("basic")} />
              <span className="tile neutral">
                <Glyph name="link" />
              </span>
              <b>Basic mode</b>
              <span>Use a WordPress application password. Fewer tools.</span>
            </label>
          </fieldset>
          {!basic && (
            <div className="callout">
              <Glyph name="info" />
              <div>
                <ol>
                  <li>Your browser opens the site. Sign in as an administrator.</li>
                  <li>
                    Choose what WP Sites HQ may do, and check <b>This is my WP Sites HQ app</b>.
                  </li>
                  <li>Press Connect. The site appears here on its own.</li>
                </ol>
                <p>It needs WordPress 7.1 or newer.</p>
              </div>
            </div>
          )}
        </>,
      )}
    </Sheet>
  );
}
