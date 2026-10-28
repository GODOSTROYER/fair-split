/**
 * "Ipadala isip ako": the confirm before the paired clerk sends a capture someone else filed on this phone (or one
 * filed before it kept who filed it). The co-op files an upload under the pairing that sends it, so this is never a
 * tap that just sends: the dialog names who filed it and when, and says the co-op will record it under this pairing,
 * not theirs. Confirming hands the outbox the filer the dialog showed; if that changed meanwhile, nothing happens.
 */
import { useCallback, useState } from "react";
import { format } from "../../_shims/domain";
import type { CaptureRecord } from "../../lib/outbox";
import { ConfirmDialog } from "../../ui/overlay";
import { filerName } from "./capture-view";
import { useOutbox } from "./outbox-provider";
import { useT } from "./use-t";

export function useTakeOver(opts: { onTaken(text: string): void; testID: string }) {
  const { takeOver } = useOutbox();
  const tr = useT();
  const [target, setTarget] = useState<CaptureRecord | null>(null);
  const { onTaken, testID } = opts;

  const confirm = useCallback(async () => {
    const r = target;
    setTarget(null);
    if (r && (await takeOver(r.id, r.filedBy?.persona ?? null))) onTaken(tr("M-CL-02.takenOver"));
  }, [target, takeOver, onTaken, tr]);

  const time = target ? format.time(new Date(target.createdAt).toISOString()) : "";
  const dialog = (
    <ConfirmDialog
      visible={target !== null}
      spec={{
        title: tr("M-CL-02.takeOverTitle"),
        body: target?.filedBy
          ? tr("M-CL-02.takeOverBody", { name: filerName(target.filedBy), time })
          : tr("M-CL-02.takeOverBodyUnknown", { time }),
        confirmLabel: tr("M-CL-02.takeOverConfirm"),
        cancelLabel: tr("M-CL-02.takeOverCancel"),
      }}
      onConfirm={() => void confirm()}
      onCancel={() => setTarget(null)}
      testID={testID}
    />
  );

  return { ask: setTarget, dialog };
}
