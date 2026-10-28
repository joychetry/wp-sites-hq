// SPDX-License-Identifier: GPL-3.0-or-later
// The content editor: TinyMCE 7 in inline mode, so the text sits in the app's own page and takes
// its theme. RichText is a whole body (Visual and Text tabs, WordPress's toolbar, Add media);
// InlineText is one text block of a block page, started when it gets focus.
import { useEffect, useRef, useState } from "react";
import type { Editor as Tiny, RawEditorOptions } from "tinymce";
import type { Media, Site } from "../api";
import { Tabs } from "./controls";
import { MediaPicker } from "./MediaPicker";
import { Button, Glyph } from "./ui";

const load = () => import("./tinymce").then((m) => m.default);

export const BASE: RawEditorOptions = {
  license_key: "gpl",
  inline: true,
  skin: false,
  content_css: false,
  menubar: false,
  promotion: false,
  branding: false,
  // The page scrolls inside the app, so menus and dialogs go to the body.
  ui_mode: "split",
  plugins: "lists link charmap",
  toolbar_mode: "wrap",
  // WordPress keeps text as typed: no &eacute;, no rewritten links.
  entity_encoding: "raw",
  convert_urls: false,
  link_default_target: undefined,
  link_title: false,
  color_map: ["000000", "Black", "56625B", "Grey", "016B3F", "Green", "B42318", "Red", "B54708", "Amber", "1D4ED8", "Blue", "6D28D9", "Purple", "FFFFFF", "White"],
  // Saving any edit sends the whole body: iframes (maps, forms) must go back as the site has them.
  sandbox_iframes: false,
  block_formats: "Paragraph=p; Heading 1=h1; Heading 2=h2; Heading 3=h3; Heading 4=h4; Heading 5=h5; Heading 6=h6; Preformatted=pre",
};

/** WordPress's classic toolbar, both rows ("more" is the Read more tag). */
export const WP_TOOLBAR = "blocks bold italic bullist numlist blockquote alignleft aligncenter alignright link wpmore | strikethrough hr forecolor pastetext removeformat charmap outdent indent undo redo";
/** A text block holds one line of text: inline formats only, no comments. */
const BLOCK_TOOLBAR = "bold italic strikethrough link forecolor removeformat charmap undo redo";

// WordPress's list of block tags (wpautop's $allblocks).
const BLOCKS = "table|thead|tfoot|caption|col|colgroup|tbody|tr|td|th|div|dl|dd|dt|ul|ol|li|pre|form|map|area|blockquote|address|math|style|p|h[1-6]|hr|fieldset|legend|section|article|aside|hgroup|header|footer|nav|figure|figcaption|details|menu|summary";
const AROUND_BLOCKS = new RegExp(`(<(?:${BLOCKS})[\\s/>])|(</(?:${BLOCKS})>)`, "gi");
const STARTS_BLOCK = new RegExp(`^(<(?:${BLOCKS})[\\s/>]|</(?:${BLOCKS})>|<!--)`, "i");

/**
 * WordPress's autop, as the classic editor runs it on load: block tags stand on their own, a blank
 * line ends a paragraph and a single line break inside one is a <br>.
 */
export function autop(html: string): string {
  const text = html.replace(/\r\n?/g, "\n").replace(AROUND_BLOCKS, (m, open) => (open ? `\n\n${m}` : `${m}\n\n`)).trim();
  if (!text) return "";
  return text
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((c) => (STARTS_BLOCK.test(c) ? c : `<p>${c.replace(/\n/g, "<br>\n")}</p>`))
    .join("\n");
}

const SAFE_TAGS = new Set(["A", "ABBR", "B", "BR", "CODE", "DEL", "EM", "I", "INS", "KBD", "MARK", "S", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "U"]);

/**
 * Site HTML shown before an editor starts: inline tags only, no attributes (a link keeps its look
 * but no address, so a click can't take the window away). Parsed in an inert document, so nothing
 * in it runs or loads.
 */
export function safeHtml(html: string): DocumentFragment {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const out = document.createDocumentFragment();
  const copy = (from: Node, to: Node) => {
    for (const n of Array.from(from.childNodes)) {
      if (n.nodeType === Node.TEXT_NODE) to.appendChild(document.createTextNode(n.textContent ?? ""));
      else if (n.nodeType === Node.ELEMENT_NODE) {
        const el = n as Element;
        if (!SAFE_TAGS.has(el.tagName)) {
          copy(el, to);
          continue;
        }
        const made = document.createElement(el.tagName.toLowerCase());
        to.appendChild(made);
        copy(el, made);
      }
    }
  };
  copy(doc.body, out);
  return out;
}

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const words = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** What Add media puts in the text, as WordPress does: an image with its id class, or a link. */
export function mediaHtml(m: Media): string {
  if (m.mime.startsWith("image/")) {
    const size = m.width && m.height ? ` width="${m.width}" height="${m.height}"` : "";
    return `<img class="alignnone size-full wp-image-${m.id}" src="${attr(m.url)}" alt="${attr(m.alt)}"${size} />`;
  }
  return `<a href="${attr(m.url)}">${words(m.title || m.file_name || m.url)}</a>`;
}

type Mode = "visual" | "text";

/**
 * A whole body. `onChange` gets the new HTML, or null while it is the same as when it opened.
 * With a site, Add media inserts from its library.
 */
export function RichText({ label, html, onChange, site, idBase }: { label: string; html: string; onChange: (html: string | null) => void; site?: Site; idBase: string }) {
  const host = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const ed = useRef<Tiny | null>(null);
  const base = useRef<string | null>(null);
  const [mode, setMode] = useState<Mode>("visual");
  const [source, setSource] = useState("");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const report = (now: string) => onChange(base.current === null || now === base.current ? null : now);
  const reportRef = useRef(report);
  reportRef.current = report;

  useEffect(() => {
    let gone = false;
    load()
      .then((tinymce) =>
        tinymce.init({
          ...BASE,
          target: host.current!,
          fixed_toolbar_container_target: bar.current!,
          toolbar_persist: true,
          toolbar: WP_TOOLBAR,
          setup: (e) => {
            e.ui.registry.addButton("wpmore", {
              icon: "page-break",
              tooltip: "Insert Read more tag",
              onAction: () => e.insertContent("<!--more-->"),
            });
            e.on("init", () => {
              e.setContent(autop(html));
              base.current = e.getContent();
              e.undoManager.clear();
            });
            e.on("input change undo redo ExecCommand keyup", () => reportRef.current(e.getContent()));
          },
        }),
      )
      .then(([e]) => {
        if (gone) e?.remove();
        else {
          ed.current = e ?? null;
          setReady(!!e);
        }
      })
      .catch((e) => !gone && setFailed(String(e)));
    return () => {
      gone = true;
      ed.current?.remove();
      ed.current = null;
    };
    // Opened once: the editor page is keyed by the entry.
  }, []);

  const switchTo = (m: Mode) => {
    if (m === mode || !ed.current) return;
    if (m === "text") setSource(ed.current.getContent());
    else {
      ed.current.setContent(source);
      report(ed.current.getContent());
    }
    setMode(m);
  };

  const insert = (m: Media) => {
    const piece = mediaHtml(m);
    setPicking(false);
    if (mode === "visual") {
      ed.current?.insertContent(piece);
      ed.current && report(ed.current.getContent());
      return;
    }
    const t = text.current;
    const at = t ? t.selectionStart : source.length;
    const next = source.slice(0, at) + piece + source.slice(t ? t.selectionEnd : at);
    setSource(next);
    report(next);
  };

  return (
    <div className={`rte ${mode}`}>
      <div className="rte-head">
        {site && (
          <Button small aria-expanded={picking} onClick={() => setPicking(!picking)}>
            <Glyph name="image" />
            Add media
          </Button>
        )}
        <span className="grow" />
        <Tabs label={`${label}: how to edit`} idBase={idBase} value={mode} onChange={switchTo} tabs={[{ id: "visual", label: "Visual" }, { id: "text", label: "Text" }]} />
      </div>
      {picking && site && (
        <div className="rte-media">
          <MediaPicker site={site} kind="" use="Insert" cancel="Close the library" onPick={insert} onCancel={() => setPicking(false)} />
        </div>
      )}
      <div id={`${idBase}-panel`} role="tabpanel" aria-labelledby={`${idBase}-tab-${mode}`}>
        <div ref={bar} className="rte-bar" hidden={mode === "text"} />
        <div ref={host} className="rte-body prose" role="textbox" aria-multiline="true" aria-label={label} hidden={mode === "text"} />
        {mode === "text" && (
          <textarea
            ref={text}
            className="input mono rte-source"
            aria-label={`${label}, as HTML`}
            spellCheck={false}
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              report(e.target.value);
            }}
          />
        )}
        {!ready && !failed && (
          <p className="rte-wait" role="status">
            Opening the editor…
          </p>
        )}
        {failed && (
          <p className="alert danger" role="alert">
            The editor didn't open: {failed}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * One text block of a block page. It shows the text until it gets focus, then a TinyMCE inline
 * editor with inline formats takes over. `onChange` gets the new HTML, or null while unchanged.
 */
export function InlineText({ label, html, pre, heading, onChange }: { label: string; html: string; pre?: boolean; heading?: boolean; onChange: (html: string | null) => void }) {
  const el = useRef<HTMLElement>(null);
  const ed = useRef<Tiny | null>(null);
  const starting = useRef(false);
  const gone = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => {
    el.current?.replaceChildren(safeHtml(html));
    return () => {
      gone.current = true;
      ed.current?.remove();
      ed.current = null;
    };
    // The block's text as it opened; the editor owns it after that.
  }, []);

  const start = () => {
    if (starting.current || !el.current) return;
    starting.current = true;
    setBusy(true);
    const target = el.current;
    load()
      .then((tinymce) =>
        tinymce.init({
          ...BASE,
          target,
          toolbar: BLOCK_TOOLBAR,
          // Enter would start a new block inside this one: a line break instead.
          newline_behavior: "linebreak",
          setup: (e) => {
            let base = "";
            e.on("init", () => {
              e.setContent(html);
              base = e.getContent();
              e.undoManager.clear();
              if (document.activeElement === target) e.focus();
            });
            e.on("input change undo redo ExecCommand keyup", () => {
              const now = e.getContent();
              changeRef.current(now === base ? null : now);
            });
          },
        }),
      )
      .then(([e]) => {
        // Started just as the block went away (a reload): nothing may stay behind on the page.
        if (gone.current) e?.remove();
        else ed.current = e ?? null;
      })
      .catch((e) => {
        if (gone.current) return;
        starting.current = false;
        setFailed(String(e));
      })
      .finally(() => !gone.current && setBusy(false));
  };

  const Tag = pre ? "pre" : "p";
  return (
    <>
      <Tag
        ref={el as never}
        className={`blk-text${heading ? " heading" : ""}`}
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        aria-busy={busy || undefined}
        tabIndex={0}
        onFocus={start}
        onPointerDown={start}
      />
      {failed && (
        <p className="alert danger" role="alert">
          The editor didn't open: {failed}
        </p>
      )}
    </>
  );
}
