// The live moment of a change (decision §9, TWEENS.halo): the jade halo plays once, when the simulated PayPal
// confirms while the viewer watches, never on every render of a past confirmation (a Proof load, a row that
// scrolls in, a statement opened later).

import { useEffect, useRef, useState } from "react";

/** True once `on` turns true while mounted; false for a value that mounted already on, and again when it turns off. */
export function useFlip(on: boolean): boolean {
  const was = useRef(on);
  const [flip, setFlip] = useState(false);
  useEffect(() => {
    if (on && !was.current) setFlip(true);
    else if (!on) setFlip(false);
    was.current = on;
  }, [on]);
  return flip;
}
