// The boot shell (UI gate round 6): what the page shows before its first screen can draw, so it is never a blank
// ground. index.html carries the same markup and its few rules for the time before this script runs; the router
// draws this one while a route's first loader waits (the stage's seeded snapshot, Proof's run). It keeps the bar's
// name and says what it is waiting for, in one line.

export const BOOT_COPY = {
  name: "Fair Split",
  season: "Loading season 2026-A",
  proof: "Loading the proof",
} as const;

export function BootShell() {
  return (
    <div className="fsc-boot" data-testid="boot" data-state="loading">
      <div className="fsc-boot__bar">{BOOT_COPY.name}</div>
      <p className="fsc-boot__panel" role="status" style={{ margin: 0 }}>
        <span className="fsc-boot__dot" aria-hidden />
        <span className="fsc-boot__season">{BOOT_COPY.season}</span>
        <span className="fsc-boot__proof">{BOOT_COPY.proof}</span>
      </p>
    </div>
  );
}
