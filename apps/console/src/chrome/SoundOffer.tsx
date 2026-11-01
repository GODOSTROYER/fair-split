// S1.6: "The first deliberate press shows a one-time chip, 'Sound on? Payments play a chord.', with 'Turn
// on' and 'No thanks'. The choice is remembered per viewer." A press means a slab: pointer or keyboard.
// It asks; it never turns sound on by itself (S2.10: web sound starts off and never autoplays).

import { Glyph } from "@fairsplit/ui-web";
import { useEffect, useState } from "react";
import { soundDecided, useSound } from "../sound/sound.js";
import { SOUND_OFFER } from "./copy.js";

const SLAB = ".fs-slab, [data-slab]";

export function SoundOffer() {
  const sound = useSound();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (soundDecided()) return;
    const onPress = (event: Event) => {
      const target = event.target as Element | null;
      if (!target?.closest?.(SLAB)) return;
      setShow(true);
      document.removeEventListener("click", onPress, true);
    };
    document.addEventListener("click", onPress, true);
    return () => document.removeEventListener("click", onPress, true);
  }, []);
  if (!show || soundDecided()) return null;
  const answer = (on: boolean) => {
    sound.set(on);
    setShow(false);
  };
  return (
    <section className="fsc-offer" aria-label={SOUND_OFFER.label} data-testid="W-JG-01.soundOffer">
      <Glyph name="ms:volume-up" size={18} />
      <p className="fsc-offer__text fs-t-label">{SOUND_OFFER.question}</p>
      <button
        type="button"
        className="fs-flat"
        onClick={() => answer(true)}
        data-testid="W-JG-01.soundOffer.yes"
      >
        {SOUND_OFFER.yes}
      </button>
      <button
        type="button"
        className="fs-link fs-t-label"
        onClick={() => answer(false)}
        data-testid="W-JG-01.soundOffer.no"
      >
        {SOUND_OFFER.no}
      </button>
    </section>
  );
}
