import { seal, sealStroke } from "../_shims/seal";

/** Hidden web frames can report zero or negative available width before their first visible layout. */
export function sealLayout(batchSha256: string, measuredSize: number) {
  const size = Number.isFinite(measuredSize) && measuredSize > 0 ? measuredSize : 0;
  return { size, rings: size ? seal(batchSha256, size) : [], stroke: sealStroke(size) };
}
