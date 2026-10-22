// Prototype chrome controls: segmented choices and the sound toggle. Flat, radius 2, never slabs: slabs are
// for human commits in the product, not for settings.

import { feedback } from "@fairsplit/ui-web";
import { type ReactNode, useEffect, useId, useState } from "react";

export interface SegmentedProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
  readonly testId: string;
}

export function Segmented<T extends string>({ label, value, options, onChange, testId }: SegmentedProps<T>) {
  const id = useId();
  return (
    <fieldset className="proto-seg proto-group" aria-labelledby={id} data-testid={testId}>
      <span id={id} className="proto-seg__label fs-t-caption">
        {label}
      </span>
      <span className="proto-seg__options">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className="proto-seg__option fs-t-label"
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </span>
    </fieldset>
  );
}

/** Sound is off by default, remembered per viewer, and starts only from this click (design §4). */
export function SoundToggle({ testId }: { readonly testId: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(feedback.restore());
    return feedback.onChange(setOn);
  }, []);
  return (
    <button
      type="button"
      className="proto-sound fs-t-label"
      aria-pressed={on}
      data-testid={testId}
      onClick={() => feedback.setSound(!on)}
    >
      {on ? "Sound on" : "Sound off"}
    </button>
  );
}

export function Note({ children }: { readonly children: ReactNode }) {
  return <p className="proto-note fs-t-caption">{children}</p>;
}
