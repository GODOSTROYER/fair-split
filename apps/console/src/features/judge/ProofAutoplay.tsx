import { useEffect } from "react";
import { takeProofContinuation } from "./proof-autoplay.js";

/** Completes the requested stage tour after the standalone Proof route mounts. */
export function ProofAutoplay({ runSlug }: { readonly runSlug: string }) {
  useEffect(() => {
    if (!takeProofContinuation(runSlug)) return;
    let phase = "verify";
    const deadline = Date.now() + 30_000;
    const stop = () => {
      clearInterval(timer);
      window.removeEventListener("pointerdown", input, true);
      window.removeEventListener("keydown", input, true);
    };
    const input = (event: Event) => {
      if (event.isTrusted) stop();
    };
    const timer = setInterval(() => {
      if (Date.now() > deadline) {
        stop();
        return;
      }
      if (phase === "verify") {
        const verify = document.querySelector<HTMLElement>('[data-testid="W-PF-01.verify.face"]');
        if (verify) {
          verify.click();
          phase = "peso";
        }
      } else {
        const verdict = document.querySelector('[data-testid="W-PF-01.verdict"]');
        if (verdict?.getAttribute("data-state") === "checking") return;
        const peso = document.querySelector<HTMLElement>('[data-testid="W-PF-01.peso.M-014"]');
        if (!peso) {
          const computed = document.querySelector<HTMLElement>(
            '[data-testid="W-PF-01.plate.computed.toggle"]',
          );
          if (computed && computed.getAttribute("aria-expanded") !== "true") computed.click();
          return;
        }
        if (peso) {
          peso.scrollIntoView({ block: "center" });
          peso.click();
          stop();
        }
      }
    }, 500);
    window.addEventListener("pointerdown", input, true);
    window.addEventListener("keydown", input, true);
    return stop;
  }, [runSlug]);
  return null;
}
