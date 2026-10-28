import "react-native";

// react-native-web renders `dataSet` as data-* attributes (data-state, data-moment-phase, data-amount-state) for
// Playwright on the web export; native ignores it and uses testID markers instead (S2.9).
type DataSet = Record<string, string | number | boolean | undefined>;

/** Web only: react-native-web forwards it to the DOM; native ignores it. */
type ContextMenuHandler = (e: { preventDefault(): void }) => void;

declare module "react-native" {
  interface ViewProps {
    dataSet?: DataSet;
    onContextMenu?: ContextMenuHandler;
  }
  interface TextProps {
    dataSet?: DataSet;
    /** Web: marks Cebuano and Filipino spans for screen readers (S1.11 "Language of parts"). */
    lang?: string;
  }
  interface PressableProps {
    dataSet?: DataSet;
    onContextMenu?: ContextMenuHandler;
  }
}
