/**
 * "Tangtanga sa telepono": the confirm before a refused capture leaves the phone. It cannot be undone, so it is a
 * dialog that names what goes (the photo) and what follows (scan the slip again; for a cash receipt, the member shows
 * as ready at the bodega again until a new receipt is filed). Only a refusal is ever offered this; the outbox refuses
 * anything else on its own.
 */
import { useCallback, useState } from "react";
import type { CaptureRecord } from "../../lib/outbox";
import { ConfirmDialog } from "../../ui/overlay";
import { useOutbox } from "./outbox-provider";
import { useT } from "./use-t";

export function useRemoveCapture(opts: { onRemoved(text: string): void; testID: string }) {
  const { discard } = useOutbox();
  const tr = useT();
  const [target, setTarget] = useState<CaptureRecord | null>(null);
  const { onRemoved, testID } = opts;

  const confirm = useCallback(async () => {
    const r = target;
    setTarget(null);
    if (r && (await discard(r.id))) onRemoved(tr("M-CL-02.removed"));
  }, [target, discard, onRemoved, tr]);

  const dialog = (
    <ConfirmDialog
      visible={target !== null}
      spec={{
        title: tr("M-CL-02.removeTitle"),
        body:
          target?.kind === "nadawat" && target.nadawat
            ? tr("M-CL-02.removeReceipt", { name: target.nadawat.memberName })
            : tr("M-CL-02.removeSlip"),
        confirmLabel: tr("M-CL-02.removeConfirm"),
        cancelLabel: tr("M-CL-02.keepIt"),
      }}
      onConfirm={() => void confirm()}
      onCancel={() => setTarget(null)}
      testID={testID}
    />
  );

  return { ask: setTarget, dialog };
}
