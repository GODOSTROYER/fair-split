# Fonts

Every face here is licensed under the SIL Open Font License 1.1, which allows self-hosting on the web and
bundling in apps. The licence texts are in [`licences/`](licences/). Upstream sources are pinned by URL and
sha256 in [`fonts.lock.json`](fonts.lock.json); only the cut files are committed.

| Family                     | Version and source                                                                                                                        | Licence                            | Used for                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------- |
| Mona Sans                  | 2.027, [github/mona-sans release v2.0.27](https://github.com/github/mona-sans/releases/tag/v2.0.27), `MonaSansVF[wdth,opsz,wght].ttf`     | OFL 1.1, Reserved Font Name "Mona" | All UI text and every number, as **FS Sans** |
| Atkinson Hyperlegible Next | 2.001, [google/fonts@45e3d52](https://github.com/google/fonts/tree/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/atkinsonhyperlegiblenext) | OFL 1.1                            | Member statement prose only                  |
| Big Shoulders Stencil      | 2.001, [google/fonts@45e3d52](https://github.com/google/fonts/tree/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/bigshouldersstencil)      | OFL 1.1                            | Season and lot marks only, as **FS Stencil** |
| Noto Sans                  | 2.015, [google/fonts@45e3d52](https://github.com/google/fonts/tree/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/notosans)                 | OFL 1.1                            | The peso sign (U+20B1) only                  |

**Names.** Mona Sans reserves the name "Mona", and OFL-FAQ 2.6 treats subsetting as modification, so every
Mona-derived file is named FS Sans (or FS Numerals Hollow). Files that carry the grafted Noto peso sign list
both copyrights in name ID 0.

## Spike S8: peso sign and slashed zero

Checked on 22 Oct 2026 by reading the pinned files with fontTools 4.66.1 (`cut_fonts.py verify`).

| Face                       | ₱ (U+20B1) | Slashed zero                                                                                     |
| -------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| Mona Sans 2.027            | **No**     | Yes, through `tnum`: `zero` → `zero.tf`, a tabular zero with a diagonal slash. No `zero` feature |
| Atkinson Hyperlegible Next | **No**     | Yes, by default (its `zero` is slashed)                                                          |
| Big Shoulders Stencil      | Yes        | Not needed (marks only)                                                                          |
| Noto Sans 2.015            | Yes        | Has a `zero` feature (not used)                                                                  |

S8's fail branch applies to the peso: a Noto Sans subset that covers only ₱ joins the "FS Sans" family through
`unicode-range` on the web, and is grafted into every native FS Sans cut (scaled by cap height, 729/714).
Money is always set in FS Sans, including inside Atkinson prose, so Atkinson needs no peso.

**The zero.** S2 §2.3 says to turn on `ss08` for the distinct zero. Rendering the glyphs shows that `tnum`
alone already reaches Mona's slashed tabular zero, and that `ss08` replaces the slash with a straight
horizontal bar ("Tabular zero with straight bar"). The design direction asks for the slashed zero, so money,
kilos and hashes use `font-feature-settings: "tnum" 1` only. `ss08` stays in the console font so the G1
prototype can show both zeros at 13 px for sign-off (S2's open check "Legibility of the ss08 zero").

## Files

| File                               | Recipe                                                                                                                                                                             | Size      | Use                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------- |
| `web/FSSans-VF.woff2`              | Mona Sans, opsz pinned to 0 (text); wdth 75–125, wght 200–900; Basic Latin, Latin-1, Latin Extended-A, general punctuation, U+2212; kern, tnum, ss08, case, locl, ccmp, mark, mkmk | 120,260 B | Console, Judge stage         |
| `web/FSSans-Proof.woff2`           | Latin-1 only; wdth 75–100, wght 400–800; kern, tnum, locl                                                                                                                          | 67,892 B  | Proof                        |
| `web/FSSansPeso.woff2`             | Noto Sans, U+20B1 only, variable                                                                                                                                                   | 2,076 B   | Web peso fallback            |
| `web/FSNumeralsHollow.woff2`       | Static 75/800, overlaps removed, tnum frozen, peso grafted; `0-9 $ ₱ . , − - U S`                                                                                                  | 2,348 B   | Hollow amounts (text stroke) |
| `web/FSStencil.woff2`              | Big Shoulders Stencil 800 at opsz 72; `0-9 A-Z -`                                                                                                                                  | 3,728 B   | Season and lot marks         |
| `web/AtkinsonNext-VF.woff2`        | Atkinson Hyperlegible Next, wght 400–700, Latin and Latin Extended-A                                                                                                               | 22,388 B  | Statements (lazy on the web) |
| `native/FSSans-CondXBold.ttf`      | Static 75/800, overlaps removed, tnum frozen into the cmap, peso grafted                                                                                                           | 49,384 B  | amount-hero, amount-l        |
| `native/FSSans-SemiCondMedium.ttf` | Static 87.5/500, same treatment                                                                                                                                                    | 49,616 B  | figure, hash                 |
| `native/FSSans-Regular.ttf`        | Static 100/400, same treatment                                                                                                                                                     | 49,712 B  | body, caption, label         |
| `native/FSSans-SemiExpBold.ttf`    | Static 112.5/700, same treatment                                                                                                                                                   | 49,676 B  | slab, titles, stamp          |
| `native/AtkinsonNext-Regular.ttf`  | Static 400                                                                                                                                                                         | 36,656 B  | Statements                   |
| `native/AtkinsonNext-Bold.ttf`     | Static 700                                                                                                                                                                         | 36,624 B  | Statements                   |

Budgets (design §9): Proof loads 67,892 + 2,076 + 2,348 + 3,728 = 76,044 B (≤ 80 KB). The console loads
120,260 + 2,076 + 2,348 + 3,728 = 128,412 B (≤ 170 KB), plus Atkinson's 22,388 B lazily.

On native, each file name equals its PostScript name and name IDs 1, 4 and 6, because the expo-font plugin
takes the family name from the file name on Android and from the font on iOS. `fonts.report.json` records the
checks the build ran on every output (peso coverage, the zero `0` reaches, glyph counts, names).

The web `@font-face` rules are generated by `@fairsplit/tokens` (`fonts.css`, `fonts-proof.css`). The peso
face is declared with the same `font-weight` and `font-stretch` ranges as the main face, so browsers treat
the two as one composite family and never fall back to a system peso at 112.5% width.

## Rebuilding

```sh
python -m venv <venv>                     # outside the repository
<venv>/Scripts/python -m pip install -r assets/fonts/build/requirements.txt
<venv>/Scripts/python -I assets/fonts/build/cut_fonts.py fetch  --cache <cache-dir>
<venv>/Scripts/python -I assets/fonts/build/cut_fonts.py verify --cache <cache-dir>
<venv>/Scripts/python -I assets/fonts/build/cut_fonts.py build  --cache <cache-dir> --out assets/fonts
```

`fetch` refuses any download whose sha256 differs from `fonts.lock.json`. Keep the cache outside the
repository, or in `assets/fonts/.cache/`, which is ignored.
