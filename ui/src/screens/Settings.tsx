// Settings: how the app looks. Both choices are remembered on this computer.
import type { Density, ThemeChoice } from "../theme";

function Choice<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

type Props = {
  theme: ThemeChoice;
  setTheme: (t: ThemeChoice) => void;
  density: Density;
  setDensity: (d: Density) => void;
};

export function Settings({ theme, setTheme, density, setDensity }: Props) {
  return (
    <div className="scroll">
      <div className="settings">
        <section>
          <h2>Theme</h2>
          <p>Light, dark, or the same as your computer.</p>
          <Choice
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              ["system", "Same as my computer"],
              ["light", "Light"],
              ["dark", "Dark"],
            ]}
          />
        </section>
        <section>
          <h2>Row height</h2>
          <p>Comfortable is easier to read. Compact fits more sites on the screen.</p>
          <Choice
            label="Row height"
            value={density}
            onChange={setDensity}
            options={[
              ["comfortable", "Comfortable"],
              ["compact", "Compact"],
            ]}
          />
        </section>
      </div>
    </div>
  );
}
