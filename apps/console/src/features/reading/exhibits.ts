import type { SeasonSnapshot } from "@fairsplit/contracts";
import { rowFields } from "./replay-fixture.js";
import type { Frac } from "./slip.js";

interface RecordedField {
  readonly a: { readonly value_text: string } | null;
  readonly b: { readonly value_text: string } | null;
  readonly zoom: { readonly value_text: string } | null;
}

export interface RecordingReport {
  readonly recordings: readonly {
    readonly cache_key: string;
    readonly purpose: string;
    readonly recorded_at: string;
    readonly provenance: string;
  }[];
  readonly cases: readonly {
    readonly id: string;
    readonly error: string | null;
    readonly call_keys: readonly string[];
    readonly rows: readonly { readonly fields: Readonly<Record<string, RecordedField>> }[];
  }[];
}

export interface ExhibitRect {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}
export interface ExhibitMedia {
  readonly assets: Readonly<
    Record<
      string,
      { readonly kind: string; readonly title: string; readonly display: { readonly file: string } }
    >
  >;
  readonly compositions: Readonly<
    Record<
      string,
      {
        readonly label: string;
        readonly image: { readonly file: string; readonly width: number; readonly height: number };
        readonly slips: readonly {
          readonly serial: string;
          readonly rect: ExhibitRect;
          readonly fields: Readonly<Record<string, ExhibitRect>>;
        }[];
      }
    >
  >;
}

const manifest = __FS_EXHIBIT_MEDIA__;

export interface HeroExhibit {
  readonly id: string;
  readonly title: string;
  readonly image: string;
  readonly reading: readonly {
    readonly field: string;
    readonly a: string;
    readonly b: string;
    readonly zoom: string | null;
    readonly standIn: string | null;
  }[];
}

/** Only committed successful reads qualify. A seed date or a case without a real call is never evidence. */
export function heroExhibits(
  snapshot: SeasonSnapshot,
  source: RecordingReport = __FS_EXHIBIT_REPORT__,
): HeroExhibit[] {
  const reads = new Set(
    source.recordings
      .filter(
        (r) => r.provenance === "live" && r.purpose === "read" && r.recorded_at.startsWith("2026-11-01"),
      )
      .map((r) => r.cache_key),
  );
  return source.cases.flatMap((entry) => {
    const asset = manifest.assets[entry.id];
    const row = entry.rows[0];
    if (
      asset?.kind !== "slip_page" ||
      entry.error !== null ||
      !row ||
      !entry.call_keys.some((key) => reads.has(key))
    )
      return [];
    const serial = row.fields.serial?.a?.value_text ?? "";
    const pink = entry.id.endsWith("-pink");
    const seed = snapshot.slips.find(
      (slip) =>
        slip.serial === serial && (pink ? slip.copy === "PINK_DUPLICATE" : slip.copy !== "PINK_DUPLICATE"),
    );
    const standIn = seed ? rowFields(seed) : null;
    return [
      {
        id: entry.id,
        title: asset.title.replace(/^(?:Spike|Hero flat): slip /, "Slip ").replace(", Codex edit", ""),
        image: asset.display.file,
        reading: Object.entries(row.fields).map(([field, value]) => ({
          field,
          a: value.a?.value_text ?? "Illegible",
          b: value.b?.value_text ?? "Illegible",
          zoom: value.zoom?.value_text ?? null,
          standIn: standIn?.[field]?.display ?? null,
        })),
      },
    ];
  });
}

export function photoExhibit(id: string): {
  readonly image: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
} | null {
  const photo = manifest.compositions[id];
  return photo
    ? { image: photo.image.file, label: photo.label, width: photo.image.width, height: photo.image.height }
    : null;
}

function fraction(rect: ExhibitRect): Frac {
  return { left: rect.x1, top: rect.y1, width: rect.x2 - rect.x1, height: rect.y2 - rect.y1 };
}

export function photoFieldFrac(photoId: string, serial: string, field: string): Frac | null {
  const rect = manifest.compositions[photoId]?.slips.find((slip) => slip.serial === serial)?.fields[field];
  return rect ? fraction(rect) : null;
}

/**
 * The by-hand witness (round 8): the real photograph cropped to one slip, at the slip's own width and centred on its
 * gross and net rows, so the stained digits show as the clerk's photo has them (never a redrawn form). Fractions of
 * the photo; null when the photo or the slip's boxes are not in the manifest.
 */
export function photoSlipCrop(
  photoId: string,
  serial: string,
): {
  readonly image: string;
  /** The slip's left edge and width, as fractions of the photo's width. */
  readonly left: number;
  readonly width: number;
  /** The middle of the gross and net rows, as a fraction of the photo's height. */
  readonly centreY: number;
} | null {
  const photo = manifest.compositions[photoId];
  const slip = photo?.slips.find((entry) => entry.serial === serial);
  const gross = slip?.fields.gross_kg;
  const net = slip?.fields.net_kg;
  if (!photo || !slip || !gross || !net) return null;
  const width = slip.rect.x2 - slip.rect.x1;
  if (width <= 0) return null;
  return {
    image: photo.image.file,
    left: slip.rect.x1,
    width,
    centreY: (Math.min(gross.y1, net.y1) + Math.max(gross.y2, net.y2)) / 2,
  };
}

export function photoBandFrac(photoId: string, serial: string): Frac | null {
  const slip = manifest.compositions[photoId]?.slips.find((entry) => entry.serial === serial);
  const net = slip?.fields.net_kg;
  return slip && net ? { ...fraction(net), left: slip.rect.x1, width: slip.rect.x2 - slip.rect.x1 } : null;
}
