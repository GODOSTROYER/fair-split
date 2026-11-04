// The instrument numeral is ui-web's DotMatrix (UI gate round 3: one shared component, unlit dots at 5%). This
// module keeps the console's class name on it for the screens that style it, and its old import path.

import { DotMatrix as Base, type DotMatrixProps } from "@fairsplit/ui-web";

export { type DotMatrixProps, dotsOf, drawable } from "@fairsplit/ui-web";

export function DotMatrix(props: DotMatrixProps) {
  return <Base {...props} className={["fsr-dm", props.className].filter(Boolean).join(" ")} />;
}
