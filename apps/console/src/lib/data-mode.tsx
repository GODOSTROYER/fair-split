// Data mode (D, W-TR-10): swaps the dial, the fan, the arc and the waffle for plain tables and shows the seal
// as its hash (S1.7). Visualisations are hidden from screen readers and mirrored in these tables (S1.12), so
// Data mode is also the accessible reading of every chart. Remembered per viewer; mirrored on <html> as
// data-datamode for CSS.

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { readFlag, writeFlag } from "./storage.js";

export const DATA_MODE_STORAGE = "fs.dataMode";

export interface DataModeApi {
  readonly on: boolean;
  set(on: boolean): void;
  toggle(): void;
}

const DataModeContext = createContext<DataModeApi>({
  on: false,
  set: () => undefined,
  toggle: () => undefined,
});

export function DataModeProvider({
  children,
  initial,
}: {
  readonly children: ReactNode;
  readonly initial?: boolean;
}) {
  const [on, setOn] = useState(() => initial ?? readFlag(DATA_MODE_STORAGE, false));
  const set = useCallback((next: boolean) => {
    setOn(next);
    writeFlag(DATA_MODE_STORAGE, next);
  }, []);
  const toggle = useCallback(() => {
    setOn((prev) => {
      writeFlag(DATA_MODE_STORAGE, !prev);
      return !prev;
    });
  }, []);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-datamode", on);
  }, [on]);
  const value = useMemo(() => ({ on, set, toggle }), [on, set, toggle]);
  return <DataModeContext.Provider value={value}>{children}</DataModeContext.Provider>;
}

export function useDataMode(): DataModeApi {
  return useContext(DataModeContext);
}
