// The visible sound toggle (S2.10: off by default, remembered per viewer). Its click is the gesture that lets
// the browser start audio.

import { Glyph } from "@fairsplit/ui-web";
import { useSound } from "../sound/sound.js";
import { STAGE } from "./copy.js";

export function SoundToggle({ testId, className }: { readonly testId: string; readonly className?: string }) {
  const sound = useSound();
  return (
    <button
      type="button"
      className={["fsc-barlink", className].filter(Boolean).join(" ")}
      aria-pressed={sound.on}
      onClick={() => sound.toggle()}
      data-testid={testId}
    >
      <Glyph name={sound.on ? "ms:volume-up" : "ms:volume-off"} size={16} />
      <span className="fs-t-label">{sound.on ? STAGE.soundOn : STAGE.soundOff}</span>
    </button>
  );
}
