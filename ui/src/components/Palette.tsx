// Ctrl K / Cmd K: every action and page, by typing.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Kbd } from "./ui";

export type Command = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  keys?: string;
  run: () => void;
};

function Marked({ text, term }: { text: string; term: string }) {
  const i = term ? text.toLowerCase().indexOf(term) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + term.length)}</mark>
      {text.slice(i + term.length)}
    </>
  );
}

export function Palette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const term = query.trim().toLowerCase();
  const hits = useMemo(
    () =>
      commands.filter(
        (c) => !term || c.label.toLowerCase().includes(term) || c.hint?.toLowerCase().includes(term),
      ),
    [commands, term],
  );
  useEffect(() => input.current?.focus(), []);
  useEffect(() => setActive(0), [term]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return (
    <div className="palette" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pal" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={input}
          value={query}
          placeholder="Type a command, a page or a site"
          aria-label="Command"
          role="combobox"
          aria-expanded="true"
          aria-controls="pal-list"
          aria-activedescendant={hits[active] ? `pal-${hits[active].id}` : undefined}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (hits.length ? (a + 1) % hits.length : 0));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (hits.length ? (a - 1 + hits.length) % hits.length : 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(hits[active]);
            } else if (e.key === "Tab") {
              // The input is the palette's only stop; arrows move through the list.
              e.preventDefault();
            } else if (e.key === "Escape") {
              e.stopPropagation();
              onClose();
            }
          }}
        />
        <ul id="pal-list" role="listbox" aria-label="Commands">
          {hits.length === 0 && <li className="pal-empty">No matches. Try “add” or a site name.</li>}
          {hits.map((c, i) => (
            <Fragment key={c.id}>
              {(i === 0 || hits[i - 1].group !== c.group) && (
                <li className="pal-group" role="presentation">
                  {c.group}
                </li>
              )}
              <li
                id={`pal-${c.id}`}
                className="pal-row"
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => run(c)}
              >
                <span><Marked text={c.label} term={term} /></span>
                {c.hint && <small>{c.hint}</small>}
                {c.keys && (
                  <span className="keys">
                    {c.keys.split(" ").map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </span>
                )}
              </li>
            </Fragment>
          ))}
        </ul>
        <div className="foot">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> Move
          </span>
          <span>
            <Kbd>Enter</Kbd> Run
          </span>
          <span>
            <Kbd>Esc</Kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
}
