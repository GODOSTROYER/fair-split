"""Fair Split film v7: FS Sans with an open tabular zero.

The product's FS Sans (Mona Sans) reaches a slashed zero through `tnum`: there is no feature for a tabular zero
without the slash. The film wants tabular figures and a plain zero ("US$4,333.50", "No. 0403", "5,000+"), because a
slashed zero reads as code to a non-technical viewer. This cuts the slash contour out of the tabular zero and
writes the film's own copy; nothing else in the font changes, and the product's font is not touched.

    python video/film2/tools/unslash-zero.py     (needs fonttools and brotli: assets/fonts/build/requirements.txt)

Source: assets/fonts/web/FSSans-VF.woff2  ->  video/film2/assets/fonts/FSSans-VF-film.woff2
"""
from pathlib import Path

from fontTools.ttLib import TTFont

FILM = Path(__file__).resolve().parent.parent
REPO = FILM.parent.parent
SOURCE = REPO / "assets" / "fonts" / "web" / "FSSans-VF.woff2"
TARGET = FILM / "assets" / "fonts" / "FSSans-VF-film.woff2"

font = TTFont(SOURCE)
gsub = font["GSUB"].table

# the tabular zero is what `tnum` maps "zero" to
tabular_zero = None
for record in gsub.FeatureList.FeatureRecord:
    if record.FeatureTag != "tnum":
        continue
    for index in record.Feature.LookupListIndex:
        for subtable in gsub.LookupList.Lookup[index].SubTable:
            tabular_zero = getattr(subtable, "mapping", {}).get("zero", tabular_zero)
if tabular_zero is None:
    raise SystemExit("tnum does not map zero: nothing to do")

glyph = font["glyf"][tabular_zero]
# read the variations while the outline still has all its points (gvar is decoded lazily, against the outline)
variations = list(font["gvar"].variations.get(tabular_zero, []))
ends = list(glyph.endPtsOfContours)
if glyph.isComposite() or len(ends) != 3:
    raise SystemExit(f"{tabular_zero}: expected the bowl's two contours and the slash, found {len(ends)} contours")
first = ends[1] + 1
last = ends[2]
count = last - first + 1
total = last + 1
if count != 4:
    raise SystemExit(f"{tabular_zero}: the third contour has {count} points, expected the slash's 4")

# the slash must sit inside the bowl, or this is not the glyph we think it is
xs = [x for x, _ in glyph.coordinates[first : last + 1]]
ys = [y for _, y in glyph.coordinates[first : last + 1]]
outer = glyph.coordinates[0 : ends[0] + 1]
if not (min(x for x, _ in outer) < min(xs) and max(xs) < max(x for x, _ in outer) and min(y for _, y in outer) < min(ys) and max(ys) < max(y for _, y in outer)):
    raise SystemExit(f"{tabular_zero}: the third contour is not inside the bowl")

# cut the contour out of the outline ...
coordinates = glyph.coordinates
glyph.coordinates = type(coordinates)(list(coordinates[:first]))
glyph.flags = glyph.flags[:first]
glyph.endPtsOfContours = ends[:2]
glyph.numberOfContours = 2
glyph.recalcBounds(font["glyf"])

# ... and its deltas out of every variation (the four phantom points at the end stay)
for variation in variations:
    deltas = variation.coordinates
    if len(deltas) != total + 4:
        raise SystemExit(f"{tabular_zero}: a variation has {len(deltas)} deltas, expected {total + 4}")
    variation.coordinates = deltas[:first] + deltas[first + count :]
font["gvar"].variations[tabular_zero] = variations

# the left side bearing follows the outline
advance, _ = font["hmtx"][tabular_zero]
font["hmtx"][tabular_zero] = (advance, glyph.xMin)

font.flavor = "woff2"
TARGET.parent.mkdir(parents=True, exist_ok=True)
font.save(TARGET)
print(f"{tabular_zero}: slash removed ({count} points); wrote {TARGET.relative_to(REPO)} ({TARGET.stat().st_size} bytes)")
