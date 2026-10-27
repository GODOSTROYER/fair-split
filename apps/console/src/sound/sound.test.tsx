// Sound and haptics plumbing (S2.10): web sound starts off, sits behind a visible toggle, is remembered per
// viewer and never autoplays; the stage plays what its phone frames post (fs.feedback), and only when the
// viewer turned sound on. The web promises no haptics.

import { feedback } from "@fairsplit/ui-web";
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installSound, playFromFrame, SOUND_KEY, soundDecided, useSound } from "./sound.js";

function Probe() {
  const sound = useSound();
  return (
    <button type="button" data-testid="sound" aria-pressed={sound.on} onClick={() => sound.toggle()}>
      {sound.on ? "on" : "off"}
    </button>
  );
}

afterEach(() => {
  act(() => feedback.setSound(false));
  window.localStorage.clear();
});

describe("sound", () => {
  it("starts off, and the first choice is remembered per viewer", () => {
    window.localStorage.clear();
    const uninstall = installSound(window);
    expect(feedback.isSoundOn()).toBe(false);
    expect(soundDecided()).toBe(false);
    const view = render(<Probe />);
    expect(view.getByTestId("sound").textContent).toBe("off");
    act(() => view.getByTestId("sound").click());
    expect(view.getByTestId("sound").textContent).toBe("on");
    expect(window.localStorage.getItem(SOUND_KEY)).toBe("on");
    expect(soundDecided()).toBe(true);
    uninstall();
  });

  it("plays a frame's feedback through the stage's one mixer, silently while sound is off", () => {
    const before = feedback.log.length;
    playFromFrame("row.printed");
    expect(feedback.log.length).toBe(before + 1);
    expect(feedback.log.at(-1)?.event).toBe("row.printed");
  });
});
