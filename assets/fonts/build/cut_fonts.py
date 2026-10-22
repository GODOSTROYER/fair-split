#!/usr/bin/env python3
"""Cut Fair Split's web and native fonts from pinned upstream sources.

Toolchain (pinned in requirements.txt): Python 3.12, fonttools 4.66.1, brotli 1.2.0, skia-pathops 0.9.2.
Run every command with `python -I` from the repository root, inside a virtualenv that has requirements.txt
installed. The cache directory holds downloaded, untrusted upstream files; keep it outside this folder.

  python -I assets/fonts/build/cut_fonts.py fetch  --cache <dir>
  python -I assets/fonts/build/cut_fonts.py verify --cache <dir>
  python -I assets/fonts/build/cut_fonts.py build  --cache <dir> --out assets/fonts

`fetch` downloads every source listed in fonts.lock.json and checks its sha256. `verify` prints the
spike S8 report (peso sign and slashed zero per face). `build` writes web/*.woff2, native/*.ttf and
fonts.report.json.

Names: Mona Sans reserves the name "Mona", and subsetting counts as modification (OFL-FAQ 2.6), so every
Mona-derived file is named FS Sans / FS Numerals. Files that carry the grafted Noto peso sign list both
copyrights in name ID 0.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

from fontTools import subset
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = Path(__file__).resolve().parent
LOCK = HERE.parent / "fonts.lock.json"

PESO = 0x20B1
MINUS = 0x2212

# Basic Latin, Latin-1 Supplement, Latin Extended-A, General Punctuation, minus sign.
LATIN = (
    list(range(0x20, 0x7F))
    + list(range(0xA0, 0x100))
    + list(range(0x100, 0x180))
    + list(range(0x2000, 0x2070))
    + [MINUS]
)
LATIN1 = list(range(0x20, 0x7F)) + list(range(0xA0, 0x100)) + list(range(0x2010, 0x2028)) + [MINUS]

# Layout features kept in the web faces. tnum turns zero into Mona's slashed tabular zero (zero.tf);
# ss08 (zero.tf -> straight bar) stays available so the G1 prototype can show both zeros side by side.
WEB_FEATURES = ["kern", "tnum", "ss08", "case", "locl", "ccmp", "mark", "mkmk"]
# Proof is Latin-1 only (precomposed letters, no all-caps), and must stay inside its 80 KB font budget.
PROOF_FEATURES = ["kern", "tnum", "locl"]
NATIVE_FEATURES = ["kern", "case", "locl", "ccmp", "mark", "mkmk"]

NOTO_COPYRIGHT = "Copyright 2022 The Noto Project Authors (https://github.com/notofonts/latin-greek-cyrillic)"

# Native static cuts: React Native cannot drive font axes (design §2.3).
NATIVE_CUTS = [
    ("FSSans-CondXBold", 75.0, 800),
    ("FSSans-SemiCondMedium", 87.5, 500),
    ("FSSans-Regular", 100.0, 400),
    ("FSSans-SemiExpBold", 112.5, 700),
]


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_lock() -> dict:
    return json.loads(LOCK.read_text(encoding="utf-8"))


def cache_path(cache: Path, key: str, name: str) -> Path:
    return cache / key / name


# ---------------------------------------------------------------- fetch


def fetch(cache: Path) -> None:
    lock = load_lock()
    for key, src in lock["sources"].items():
        target_dir = cache / key
        target_dir.mkdir(parents=True, exist_ok=True)
        for item in src["files"]:
            out = target_dir / item["name"]
            if out.exists() and sha256(out.read_bytes()) == item["sha256"]:
                print(f"ok    {key}/{item['name']}")
                continue
            if "zip" in src:
                data = download(src["zip"]["url"], src["zip"]["sha256"])
                with zipfile.ZipFile(io.BytesIO(data)) as zf:
                    blob = zf.read(item["member"])
            else:
                blob = download(item["url"], item["sha256"])
            if sha256(blob) != item["sha256"]:
                raise SystemExit(f"sha256 mismatch for {key}/{item['name']}")
            out.write_bytes(blob)
            print(f"fetch {key}/{item['name']} ({len(blob):,} B)")


def download(url: str, expected: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as resp:  # noqa: S310 - pinned https URLs from the lock file
        data = resp.read()
    if sha256(data) != expected:
        raise SystemExit(f"sha256 mismatch for {url}")
    return data


def source(cache: Path, key: str) -> Path:
    lock = load_lock()
    item = lock["sources"][key]["files"][0]
    path = cache_path(cache, key, item["name"])
    if not path.exists():
        raise SystemExit(f"missing {path}; run `fetch` first")
    if sha256(path.read_bytes()) != item["sha256"]:
        raise SystemExit(f"{path} does not match fonts.lock.json")
    return path


# ---------------------------------------------------------------- helpers


def single_subst_map(font: TTFont, tag: str) -> dict[str, str]:
    """Union of every single substitution reachable from GSUB feature `tag`."""
    if "GSUB" not in font:
        return {}
    gsub = font["GSUB"].table
    indices: set[int] = set()
    for record in gsub.FeatureList.FeatureRecord:
        if record.FeatureTag == tag:
            indices.update(record.Feature.LookupListIndex)
    mapping: dict[str, str] = {}
    for index in sorted(indices):
        lookup = gsub.LookupList.Lookup[index]
        for sub in lookup.SubTable:
            table = sub.ExtSubTable if lookup.LookupType == 7 else sub
            if hasattr(table, "mapping"):
                mapping.update(table.mapping)
    return mapping


def freeze_features(font: TTFont, tags: list[str]) -> None:
    """Point the cmap straight at the feature's alternates (tnum frozen in, as design §2.3 asks)."""
    for tag in tags:
        mapping = single_subst_map(font, tag)
        for table in font["cmap"].tables:
            if not table.isUnicode():
                continue
            for cp, glyph in list(table.cmap.items()):
                if glyph in mapping:
                    table.cmap[cp] = mapping[glyph]


def rename(font: TTFont, family: str, postscript: str, *, flat: bool, extra_copyright: str | None = None) -> None:
    """Rewrite family names. `flat` makes IDs 1, 4 and 6 identical (expo-font reads the file name on Android
    and the font's own name on iOS, design S2.3)."""
    name = font["name"]
    keep = {0, 7, 8, 9, 11, 12, 13, 14}
    for record in list(name.names):
        if record.nameID in keep or record.nameID >= 256:
            continue
        text = record.toUnicode()
        for old, new in (
            ("Mona Sans VF", family),
            ("MonaSansVF", postscript.split("-")[0]),
            ("Mona Sans", family),
            ("MonaSans", postscript.split("-")[0]),
            ("Noto Sans", family),
            ("NotoSans", postscript.split("-")[0]),
            ("Big Shoulders Stencil", family),
            ("BigShouldersStencil", postscript.split("-")[0]),
        ):
            text = text.replace(old, new)
        record.string = text
    if flat:
        for nid in (16, 17, 21, 22, 25):
            name.removeNames(nameID=nid)
        for nid, text in ((1, postscript), (2, "Regular"), (4, postscript), (6, postscript)):
            name.setName(text, nid, 3, 1, 0x409)
            name.setName(text, nid, 1, 0, 0)
    else:
        name.setName(family, 1, 3, 1, 0x409)
        name.setName(postscript, 6, 3, 1, 0x409)
        if "fvar" not in font:
            # A static web cut is its own family: drop the source instance's style names ("Thin").
            for nid in (16, 17, 21, 22):
                name.removeNames(nameID=nid)
            name.setName("Regular", 2, 3, 1, 0x409)
            name.setName(family, 4, 3, 1, 0x409)
    if extra_copyright:
        for record in name.names:
            if record.nameID == 0:
                text = record.toUnicode()
                if extra_copyright not in text:
                    record.string = f"{text}\n{extra_copyright}"
    for record in name.names:
        if record.nameID in (1, 3, 4, 6, 16, 17, 21, 22, 25) and "Mona" in record.toUnicode():
            raise SystemExit(f"reserved name survived in name ID {record.nameID}: {record.toUnicode()}")


def subset_font(font: TTFont, unicodes: list[int], features: list[str], *, flavor: str | None) -> None:
    opts = subset.Options()
    opts.layout_features = features
    opts.name_IDs = ["*"]
    opts.name_languages = [0x409]
    opts.notdef_outline = True
    opts.hinting = False
    opts.drop_tables += ["DSIG"]
    opts.flavor = flavor
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=unicodes)
    sub.subset(font)


def graft_peso(target: TTFont, noto_path: Path, wdth: float, wght: float) -> None:
    """Copy Noto Sans' peso sign into a static TrueType instance, scaled by cap height (729/714)."""
    noto = static_instance(noto_path, {"wdth": max(62.5, min(100.0, wdth)), "wght": wght})
    noto_glyphs = noto.getGlyphSet()
    peso_name = noto.getBestCmap()[PESO]
    scale = target["OS/2"].sCapHeight / noto["OS/2"].sCapHeight
    recording = DecomposingRecordingPen(noto_glyphs)
    noto_glyphs[peso_name].draw(recording)
    pen = TTGlyphPen(None)
    recording.replay(TransformPen(pen, (scale, 0, 0, scale, 0, 0)))
    glyph = pen.glyph()
    glyph.recalcBounds(None)
    name = "uni20B1"
    order = target.getGlyphOrder()
    if name in order:
        return
    target.setGlyphOrder([*order, name])
    glyf = target["glyf"]
    glyf.glyphOrder = target.getGlyphOrder()
    glyf.glyphs[name] = glyph
    advance = round(noto_glyphs[peso_name].width * scale)
    target["hmtx"].metrics[name] = (advance, getattr(glyph, "xMin", 0))
    target["maxp"].numGlyphs = len(target.getGlyphOrder())
    for table in target["cmap"].tables:
        if table.isUnicode():
            table.cmap[PESO] = name


def reload(font: TTFont) -> TTFont:
    """Round-trip through bytes so lazily loaded tables (gvar) are complete before subsetting."""
    buffer = io.BytesIO()
    font.save(buffer)
    buffer.seek(0)
    return TTFont(buffer)


def instance(path: Path, location: dict, *, remove_overlaps: bool = False) -> TTFont:
    overlap = instancer.OverlapMode.REMOVE if remove_overlaps else instancer.OverlapMode.KEEP_AND_SET_FLAGS
    return reload(instancer.instantiateVariableFont(TTFont(path), location, overlap=overlap))


def static_instance(path: Path, location: dict[str, float]) -> TTFont:
    return instance(path, location, remove_overlaps=True)


def save(font: TTFont, out: Path, *, flavor: str | None = None) -> int:
    font.flavor = flavor
    font.recalcTimestamp = False
    font["head"].modified = font["head"].created
    out.parent.mkdir(parents=True, exist_ok=True)
    buffer = io.BytesIO()
    font.save(buffer)
    data = buffer.getvalue()
    out.write_bytes(data)
    return len(data)


# ---------------------------------------------------------------- verify (spike S8)


def describe(path: Path) -> dict:
    font = TTFont(path)
    cmap = font.getBestCmap()
    tnum = single_subst_map(font, "tnum")
    zero = cmap.get(0x30)
    feats = sorted({r.FeatureTag for r in font["GSUB"].table.FeatureList.FeatureRecord}) if "GSUB" in font else []
    return {
        "file": path.name,
        "version": font["name"].getDebugName(5),
        "peso": PESO in cmap,
        "zeroFeature": "zero" in feats,
        "tnumZero": tnum.get(zero) if zero else None,
        "ss08": single_subst_map(font, "ss08"),
        "axes": {a.axisTag: [a.minValue, a.defaultValue, a.maxValue] for a in font["fvar"].axes} if "fvar" in font else {},
    }


def verify(cache: Path) -> dict:
    report = {key: describe(source(cache, key)) for key in ("mona", "atkinson", "stencil", "noto")}
    print(json.dumps(report, indent=2))
    return report


# ---------------------------------------------------------------- build


def build(cache: Path, out: Path) -> None:
    mona, atkinson, stencil, noto = (source(cache, k) for k in ("mona", "atkinson", "stencil", "noto"))
    web, native = out / "web", out / "native"
    sizes: dict[str, int] = {}

    # FS Sans variable, console and stage. opsz pinned to its text default.
    font = instance(mona, {"opsz": 0})
    subset_font(font, LATIN, WEB_FEATURES, flavor="woff2")
    rename(font, "FS Sans", "FSSans-Regular", flat=False)
    sizes["web/FSSans-VF.woff2"] = save(font, web / "FSSans-VF.woff2", flavor="woff2")

    # FS Sans for Proof: Latin-1 only, wdth 75-100, wght 400-800.
    font = instance(mona, {"opsz": 0, "wdth": (75, 100), "wght": (400, 800)})
    subset_font(font, LATIN1, PROOF_FEATURES, flavor="woff2")
    rename(font, "FS Sans", "FSSans-Regular", flat=False)
    sizes["web/FSSans-Proof.woff2"] = save(font, web / "FSSans-Proof.woff2", flavor="woff2")

    # The peso sign alone, from Noto Sans, joined to "FS Sans" through unicode-range.
    font = TTFont(noto)
    subset_font(font, [PESO], [], flavor="woff2")
    rename(font, "FS Sans Peso", "FSSansPeso-Regular", flat=False)
    sizes["web/FSSansPeso.woff2"] = save(font, web / "FSSansPeso.woff2", flavor="woff2")

    # Hollow amounts: a static cut with merged contours, so a text stroke draws no overlaps.
    font = static_instance(mona, {"wdth": 75, "wght": 800, "opsz": 0})
    freeze_features(font, ["tnum"])
    graft_peso(font, noto, 75, 800)
    subset_font(font, [ord(c) for c in "0123456789$.,-US "] + [PESO, MINUS], ["kern"], flavor="woff2")
    rename(font, "FS Numerals Hollow", "FSNumeralsHollow-Regular", flat=False, extra_copyright=NOTO_COPYRIGHT)
    sizes["web/FSNumeralsHollow.woff2"] = save(font, web / "FSNumeralsHollow.woff2", flavor="woff2")

    # Season and lot marks.
    font = static_instance(stencil, {"wght": 800, "opsz": 72})
    subset_font(font, [ord(c) for c in "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ- "], ["kern"], flavor="woff2")
    rename(font, "FS Stencil", "FSStencil-Regular", flat=False)
    sizes["web/FSStencil.woff2"] = save(font, web / "FSStencil.woff2", flavor="woff2")

    # Statement prose, lazy-loaded on the web.
    font = instance(atkinson, {"wght": (400, 700)})
    subset_font(font, LATIN, ["kern", "tnum", "case", "locl", "ccmp", "mark", "mkmk"], flavor="woff2")
    sizes["web/AtkinsonNext-VF.woff2"] = save(font, web / "AtkinsonNext-VF.woff2", flavor="woff2")

    # Native static cuts with tnum frozen into the cmap and the peso grafted in.
    for postscript, wdth, wght in NATIVE_CUTS:
        font = static_instance(mona, {"wdth": wdth, "wght": wght, "opsz": 0})
        freeze_features(font, ["tnum"])
        graft_peso(font, noto, wdth, wght)
        if font.getBestCmap()[0x30] != "zero.tf":
            raise SystemExit(f"{postscript}: tnum did not freeze into the cmap")
        subset_font(font, [*LATIN, PESO], NATIVE_FEATURES, flavor=None)
        rename(font, postscript, postscript, flat=True, extra_copyright=NOTO_COPYRIGHT)
        sizes[f"native/{postscript}.ttf"] = save(font, native / f"{postscript}.ttf")
    for postscript, wght in (("AtkinsonNext-Regular", 400), ("AtkinsonNext-Bold", 700)):
        font = static_instance(atkinson, {"wght": wght})
        subset_font(font, LATIN, NATIVE_FEATURES, flavor=None)
        rename(font, postscript, postscript, flat=True)
        sizes[f"native/{postscript}.ttf"] = save(font, native / f"{postscript}.ttf")

    report = {"sizes": sizes, "checks": check_outputs(out)}
    (out / "fonts.report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(report, indent=2))


def contours(font: TTFont, glyph: str) -> int:
    pen = DecomposingRecordingPen(font.getGlyphSet())
    font.getGlyphSet()[glyph].draw(pen)
    return sum(1 for op, _ in pen.value if op == "closePath")


def check_outputs(out: Path) -> dict:
    """Peso coverage, the zero that `0` reaches by default, and the reserved name, for every output."""
    checks: dict[str, dict] = {}
    for path in sorted((out / "web").glob("*.woff2")) + sorted((out / "native").glob("*.ttf")):
        font = TTFont(path)
        cmap = font.getBestCmap()
        names = {nid: font["name"].getDebugName(nid) for nid in (1, 4, 6)}
        zero = cmap.get(0x30)
        tnum_zero = single_subst_map(font, "tnum").get(zero, zero) if zero else None
        checks[f"{path.parent.name}/{path.name}"] = {
            "peso": PESO in cmap,
            "zeroContours": contours(font, zero) if zero else None,
            "tnumZeroContours": contours(font, tnum_zero) if tnum_zero else None,
            "names": names,
            "glyphs": len(font.getGlyphOrder()),
        }
        if any(n and "Mona" in n for n in names.values()):
            raise SystemExit(f"{path.name} still carries the reserved name")
    # A slashed zero has three contours: the outer ring and the counter split in two by the slash.
    for key in [f"native/{p}.ttf" for p, _, _ in NATIVE_CUTS] + ["web/FSNumeralsHollow.woff2"]:
        entry = checks[key]
        if not entry["peso"] or entry["zeroContours"] != 3:
            raise SystemExit(f"{key}: peso or slashed tabular zero missing")
    if checks["web/FSSans-VF.woff2"]["tnumZeroContours"] != 3:
        raise SystemExit("FSSans-VF: tnum no longer reaches the slashed zero")
    return checks


def main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["fetch", "verify", "build"])
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=HERE.parent)
    args = parser.parse_args(argv)
    if args.command == "fetch":
        fetch(args.cache)
    elif args.command == "verify":
        verify(args.cache)
    else:
        build(args.cache, args.out)


if __name__ == "__main__":
    main(sys.argv[1:])
