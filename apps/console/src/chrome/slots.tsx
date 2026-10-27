// Named places in the frozen chrome that slices fill without editing it: the chrome renders an empty element
// for each slot, and a slice portals its content into it while mounted. Portals (not state) keep the chrome
// from re-rendering whenever a slice does.
//
//   pill.accessory        beside the run pill's words: "Play it for me" (season slice, W-JG-01)
//   whatsReal.tryToBreak  the "Try to break it" controls in the What's real sheet (season slice)
//   stage.film            the film on the phone-visit layout under 1024 px (season slice)
//   stage.overlay         full-stage layers above the console: the autoplay cursor, flights (any slice)
//   console.drawer        the drawer beside the screen (W-TR-06, W-TR-09); use <StageDrawer>, not the slot
//
// Two contexts: the registrar is stable for the provider's lifetime (a slot's ref callback must never
// change identity, or React would detach and re-attach it on every registration), and the targets change.

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";

export const CHROME_SLOTS = [
  "pill.accessory",
  "whatsReal.tryToBreak",
  "stage.film",
  "stage.overlay",
  "console.drawer",
] as const;
export type ChromeSlotName = (typeof CHROME_SLOTS)[number];

type Targets = Readonly<Partial<Record<ChromeSlotName, HTMLElement>>>;
type Register = (name: ChromeSlotName, el: HTMLElement | null) => void;

const RegisterContext = createContext<Register | null>(null);
const TargetsContext = createContext<Targets>({});

export function ChromeSlotsProvider({ children }: { readonly children: ReactNode }) {
  const [targets, setTargets] = useState<Targets>({});
  const register = useCallback<Register>((name, el) => {
    setTargets((prev) => {
      if ((prev[name] ?? null) === el) return prev;
      const next = { ...prev };
      if (el) next[name] = el;
      else delete next[name];
      return next;
    });
  }, []);
  return (
    <RegisterContext.Provider value={register}>
      <TargetsContext.Provider value={targets}>{children}</TargetsContext.Provider>
    </RegisterContext.Provider>
  );
}

/** Where the chrome offers a slot. Renders nothing visible until a slice portals into it. */
export function ChromeSlot({
  name,
  className,
  as: Tag = "div",
}: {
  readonly name: ChromeSlotName;
  readonly className?: string;
  readonly as?: "div" | "span";
}) {
  const register = useContext(RegisterContext);
  const ref = useMemo(
    () => (el: HTMLElement | null) => {
      register?.(name, el);
    },
    [register, name],
  );
  return <Tag ref={ref} className={className} data-slot={name} />;
}

/** The element a slot renders into, or null while the chrome does not show that slot. */
export function useChromeSlotTarget(name: ChromeSlotName): HTMLElement | null {
  return useContext(TargetsContext)[name] ?? null;
}

/** A slice's content for a chrome slot, portalled into it while both are mounted. */
export function ChromePortal({
  name,
  children,
}: {
  readonly name: ChromeSlotName;
  readonly children: ReactNode;
}) {
  const target = useChromeSlotTarget(name);
  return target ? createPortal(children, target) : null;
}
