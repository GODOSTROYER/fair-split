import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { draftReview } from "../fixtures/build.js";
import {
  apply,
  homography,
  invert,
  type Mat3,
  projectBox,
  type Quad,
  UNIT_SQUARE,
} from "../fixtures/geometry.js";
import { type FieldFixture, type SlipFixture, SlipImageFixture } from "../fixtures/schema.js";
import { sha256 } from "../util/hash.js";
import { drawSlip, jsonBytes, type SeedSlip, writtenFields, xml } from "./drawn.js";
import { Composition, type Placement } from "./schema.js";

const WIDTH = 2400,
  HEIGHT = 3200;
const DISPLAY_WIDTH = 1200,
  DISPLAY_HEIGHT = 1600;
const SLOTS = ["TL", "TR", "BL", "BR"] as const;
const HERO: Record<string, string> = {
  "0436": "spike-0436",
  "0449": "spike-0449",
  "0457:WHITE_ORIGINAL": "spike-0457-white",
  "0457:PINK_DUPLICATE": "spike-0457-pink",
  "0458": "spike-0458",
  "0462": "spike-0462",
  "0467": "spike-0467",
  "0471": "spike-0471",
};
const readJson = (root: string, file: string) => JSON.parse(readFileSync(join(root, file), "utf8"));

/** C-24: existing checked crops follow the pixels; nominal boxes are used only for code-drawn paper. */
export function projectSlipFixture(source: SlipFixture, matrix: Mat3, slot: Placement["slot"]): SlipFixture {
  const field = <T extends FieldFixture>(f: T): T => ({ ...f, ...projectBox(matrix, f) });
  const quad = source.quad.map((p) => [...apply(matrix, p)]) as SlipFixture["quad"];
  return {
    ...source,
    slot,
    quad,
    rect: {
      x1: Math.min(...quad.map((p) => p[0])),
      y1: Math.min(...quad.map((p) => p[1])),
      x2: Math.max(...quad.map((p) => p[0])),
      y2: Math.max(...quad.map((p) => p[1])),
    },
    fields: Object.fromEntries(
      Object.entries(source.fields).map(([k, f]) => [k, field(f)]),
    ) as SlipFixture["fields"],
    deductions: [field(source.deductions[0]), field(source.deductions[1])],
    signature: field(source.signature),
    anomalies: source.anomalies.map(field),
    trapChecks: source.trapChecks.map(({ trap }) => ({
      trap,
      status: "UNVERIFIED",
      by: null,
      at: null,
      evidence: "",
    })),
  };
}

/** Slight camera perspective and independent paper rotations, always with a clear gap around every slip. */
function paperQuad(photo: number, slot: number): Quad {
  const cx = slot % 2 === 0 ? 0.265 : 0.735;
  const cy = slot < 2 ? 0.275 : 0.735;
  const angle = Math.sin(photo * 2.3 + slot * 1.9) * 0.035;
  const w = 0.397,
    h = 0.397;
  return UNIT_SQUARE.map(([u, v]) => {
    const x = (u - 0.5) * w,
      y = (v - 0.5) * h;
    return [
      cx + x * Math.cos(angle) - (y * Math.sin(angle) * HEIGHT) / WIDTH + (v - 0.5) * 0.006,
      cy + (x * Math.sin(angle) * WIDTH) / HEIGHT + y * Math.cos(angle),
    ] as const;
  }) as unknown as Quad;
}

function desk(photo: number): Buffer {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      // Continuous wood grain, board seams and stable sensor noise. All procedural, no remote assets.
      const grain =
        Math.sin(x * 0.19 + 3 * Math.sin(y * 0.002 + photo)) * 2.3 + Math.sin(x * 0.037 + y * 0.0009) * 4;
      const seam = x % 602 < 3 ? -18 : 0;
      const noise = (((x * 73 + y * 151 + photo * 31) % 101) / 101 - 0.5) * 2;
      const light = 1.06 - (0.13 * (x / WIDTH + y / HEIGHT)) / 2;
      const i = (y * WIDTH + x) * 3;
      for (let c = 0; c < 3; c++) pixels[i + c] = ([112, 83, 57][c] as number) * light + grain + seam + noise;
    }
  return pixels;
}

/** Inverse homography sampling preserves original paper text; lighting and shadow never invent marks. */
async function place(pixels: Buffer, bytes: Buffer, placement: Placement) {
  const { data, info } = await sharp(bytes)
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const back = invert(placement.transform);
  const paperBack = invert(homography(UNIT_SQUARE, placement.targetQuad));
  const xs = placement.targetQuad.map((p) => p[0] * WIDTH),
    ys = placement.targetQuad.map((p) => p[1] * HEIGHT);
  const left = Math.max(0, Math.floor(Math.min(...xs) - 45)),
    right = Math.min(WIDTH, Math.ceil(Math.max(...xs) + 70));
  const top = Math.max(0, Math.floor(Math.min(...ys) - 45)),
    bottom = Math.min(HEIGHT, Math.ceil(Math.max(...ys) + 80));
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) {
      const p = [x / WIDTH, y / HEIGHT] as const;
      const [u, v] = apply(paperBack, p);
      const i = (y * WIDTH + x) * 3;
      if (u < 0 || v < 0 || u > 1 || v > 1) {
        const [sx, sy] = apply(paperBack, [(x - 12) / WIDTH, (y - 22) / HEIGHT]);
        const distance = Math.hypot(Math.max(-sx, 0, sx - 1) * 952, Math.max(-sy, 0, sy - 1) * 1270);
        const opacity = 0.24 * Math.exp(-(distance * distance) / (2 * 16 * 16));
        for (let c = 0; c < 3; c++) pixels[i + c] = (pixels[i + c] as number) * (1 - opacity);
        continue;
      }
      const [sx, sy] = apply(back, p);
      const fx = Math.min(info.width - 1, Math.max(0, sx * info.width));
      const fy = Math.min(info.height - 1, Math.max(0, sy * info.height));
      const x0 = Math.floor(fx),
        y0 = Math.floor(fy),
        x1 = Math.min(info.width - 1, x0 + 1),
        y1 = Math.min(info.height - 1, y0 + 1);
      const dx = fx - x0,
        dy = fy - y0;
      const light = 1.025 - (0.065 * (x / WIDTH + y / HEIGHT)) / 2;
      for (let c = 0; c < 3; c++) {
        const sample = (xx: number, yy: number) => data[(yy * info.width + xx) * 3 + c] as number;
        const value =
          sample(x0, y0) * (1 - dx) * (1 - dy) +
          sample(x1, y0) * dx * (1 - dy) +
          sample(x0, y1) * (1 - dx) * dy +
          sample(x1, y1) * dx * dy;
        pixels[i + c] = Math.min(255, value * light);
      }
    }
}

export function captionSvg(id: string, placements: readonly Pick<Placement, "slot" | "serial" | "label">[]) {
  const captions = placements.map((p, i) => {
    const x = i % 2 === 0 ? 150 : 1280,
      y = i < 2 ? 1590 : 3060;
    return `<text x="${x}" y="${y}" font-size="27">${xml(`${p.slot} · ${p.serial} · ${p.label}`)}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}"><g font-family="Arial, sans-serif" fill="#fcf2dd"><text x="130" y="85" font-size="34">${id} / Code-composed · synthetic</text>${captions.join("")}<text x="130" y="3150" font-size="23">Fictional demo evidence · hero-flat text retained; seeded readings are a separate stand-in</text></g></svg>`;
}

export async function composePhoto(id: string, root: string, options: { bootstrap?: boolean } = {}) {
  if (!/^[A-L]$/.test(id)) throw new Error(`not a replay photo: ${id}`);
  const snapshot = readJson(root, "../packages/seed/snapshot/season-2026A.json");
  const rows = (snapshot.slips as SeedSlip[]).filter((s) => s.photoId === id);
  if (rows.length !== 4) throw new Error(`${id}: expected four seed slips`);
  const photoIndex = id.charCodeAt(0) - 65;
  const pixels = desk(photoIndex);
  const placements: Placement[] = [],
    slips: SlipFixture[] = [];
  const sources: { file: string; bytes: Buffer }[] = [];
  for (const [i, slot] of SLOTS.entries()) {
    const row = rows.find((s) => s.position === slot);
    if (!row) throw new Error(`${id} missing ${slot}`);
    const hero = HERO[`${row.serial}:${row.copy}`] ?? HERO[row.serial];
    let file: string, bytes: Buffer, fixtureFile: string, fixtureBytes: Buffer;
    if (hero) {
      file = `masters/${hero}.jpg`;
      fixtureFile = `fixtures/${hero}.json`;
      bytes = readFileSync(join(root, file));
      fixtureBytes = readFileSync(join(root, fixtureFile));
    } else {
      file = `slips/code/code-${row.serial}.webp`;
      fixtureFile = `fixtures/code/code-${row.serial}.json`;
      if (existsSync(join(root, file)) && existsSync(join(root, fixtureFile))) {
        bytes = readFileSync(join(root, file));
        fixtureBytes = readFileSync(join(root, fixtureFile));
      } else {
        if (!options.bootstrap) throw new Error(`${id}: missing frozen code-drawn source ${row.serial}`);
        const drawn = await drawSlip(row, root);
        bytes = drawn.bytes;
        fixtureBytes = jsonBytes(drawn.fixture);
        sources.push({ file, bytes }, { file: fixtureFile, bytes: fixtureBytes });
      }
    }
    const source = SlipImageFixture.parse(JSON.parse(fixtureBytes.toString("utf8"))).slips[0];
    if (!source || source.serial !== row.serial || source.copy !== row.copy)
      throw new Error(`${id}: source identity mismatch`);
    const transform = homography(source.quad, paperQuad(photoIndex, i));
    const projected = projectSlipFixture(source, transform, slot);
    projected.duplicateOf = row.copy === "PINK_DUPLICATE" ? "B#BL" : null;
    const expected = writtenFields(row);
    const visible = {
      ...source.fields,
      deduction_1: source.deductions[0],
      deduction_2: source.deductions[1],
      signature: source.signature,
    };
    const seedDifferences = Object.entries(visible)
      .filter(([key, f]) => f.visible !== expected[key as keyof typeof expected])
      .map(([field, f]) => ({ field, seed: expected[field as keyof typeof expected], visible: f.visible }));
    if (!hero && seedDifferences.length)
      throw new Error(`${id}: frozen code-drawn source differs from seed; redraw ${row.serial} explicitly`);
    const placement: Placement = {
      slot,
      serial: row.serial,
      copy: row.copy,
      synthetic: true,
      kind: hero ? "hero-flat" : "code-drawn",
      label: hero ? "Codex-made · synthetic" : "code-drawn · synthetic",
      sourceFile: file,
      sourceSha256: sha256(bytes),
      sourceFixture: fixtureFile,
      sourceFixtureSha256: sha256(fixtureBytes),
      sourceQuad: source.quad,
      targetQuad: projected.quad,
      transform: [...transform],
      seedDifferences,
    };
    await place(pixels, bytes, placement);
    placements.push(placement);
    slips.push(projected);
  }
  const overlay = captionSvg(id, placements);
  const captionFile = `slips/code/caption-${id}.png`;
  let captionBytes: Buffer;
  if (existsSync(join(root, captionFile))) captionBytes = readFileSync(join(root, captionFile));
  else {
    if (!options.bootstrap) throw new Error(`${id}: missing frozen caption layer`);
    captionBytes = await sharp(Buffer.from(overlay)).png().toBuffer();
    sources.push({ file: captionFile, bytes: captionBytes });
  }
  const caption = {
    file: captionFile,
    sha256: sha256(captionBytes),
    textSha256: sha256(overlay),
    synthetic: true as const,
    label: "code-drawn · synthetic" as const,
  };
  // Frozen rasters make reconstruction independent of system fonts. The manifest binds their text spec too.
  if (!options.bootstrap) {
    const pinned = readJson(root, "manifest.json").compositions[id];
    if (pinned?.caption?.sha256 !== caption.sha256 || pinned?.caption?.textSha256 !== caption.textSha256)
      throw new Error(`${id}: caption layer does not match the committed composition`);
  }
  const labelled = await sharp(pixels, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .composite([{ input: captionBytes }])
    .removeAlpha()
    .raw()
    .toBuffer();
  const bytes = await sharp(labelled, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .resize(DISPLAY_WIDTH, DISPLAY_HEIGHT)
    .webp({ quality: 92, effort: 4 })
    .toBuffer();
  const file = `photos/${id}.webp`;
  const fixture = SlipImageFixture.parse({
    v: 2,
    id,
    group: "replay-composed",
    synthetic: true,
    kind: "slip_photo",
    template: "slip-v1",
    image: {
      master: file,
      display: file,
      width: DISPLAY_WIDTH,
      height: DISPLAY_HEIGHT,
      sha256: sha256(bytes),
    },
    slips,
    review: draftReview(
      "Source fixture crops projected by recorded homographies; code-drawn boxes from slip-v1.json",
      [
        "Composition has no human review or live Claude reading. Hero-flat text is retained; manifest lists differences from seed. Behavioural traps have not been tested on these compositions.",
      ],
    ),
  });
  const fixtureBytes = jsonBytes(fixture);
  const entry = Composition.parse({
    id,
    synthetic: true,
    label: "Code-composed · synthetic",
    renderer: "desk-photo-v1",
    caption,
    contentSha256: sha256(jsonBytes(rows)),
    template: {
      file: "template/slip-v1.json",
      sha256: sha256(readFileSync(join(root, "template/slip-v1.json"))),
    },
    image: { file, sha256: sha256(bytes), width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT, bytes: bytes.length },
    fixture: `fixtures/composed/${id}.json`,
    fixtureSha256: sha256(fixtureBytes),
    light: { topLeftGain: 1.025, bottomRightGain: 0.96 },
    shadow: { offsetX: 12, offsetY: 22, blur: 16, opacity: 0.24 },
    placements,
  });
  return { entry, bytes, fixtureBytes, sources };
}
