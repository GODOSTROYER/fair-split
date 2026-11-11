# Fonts bundled with the film

The film ships its own FS Sans files; every bundled face is under the SIL Open Font License 1.1, and the licence
texts are beside this file.

| File                   | What it is                                                                                                                                                                                                                                                                                                                           | Source                                                                                                                                     | Licence                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| `FSSans-VF-film.woff2` | FS Sans: the product's cut of Mona Sans 2.027 (`assets/fonts/web/FSSans-VF.woff2`), with one change for the film: the slash is removed from the tabular zero, so tabular figures show a plain zero. Made by `tools/unslash-zero.py`. Named FS Sans because Mona Sans reserves the name "Mona" and a modified version may not use it. | [github/mona-sans v2.0.27](https://github.com/github/mona-sans/releases/tag/v2.0.27), through `assets/fonts/` (see its README for the cut) | OFL 1.1, `OFL-MonaSans.txt` |
| `FSSansPeso.woff2`     | The peso sign (U+20B1) only, from Noto Sans 2.015, as in the product. Unchanged copy of `assets/fonts/web/FSSansPeso.woff2`.                                                                                                                                                                                                         | [google/fonts, ofl/notosans](https://github.com/google/fonts/tree/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/notosans)                   | OFL 1.1, `OFL-NotoSans.txt` |

**The mono is not bundled.** The mono captions under the architecture labels use the product's mono stack, loaded
from the machine that renders the film: `film.css` declares "FS Mono" as `local("Cascadia Mono")`, then SF Mono,
Roboto Mono, Menlo and Consolas. On the build machine (Windows 11) that is the installed Cascadia Mono 2102.025
(© Microsoft Corporation; the upstream project, microsoft/cascadia-code, is under the SIL OFL 1.1). No Cascadia
file is in this repository, and none was downloaded. A render on a machine without Cascadia Mono uses the next
installed face in that list.

The film's picture contains these fonts only as rendered text. The files themselves are in the repository so the
film can be rebuilt.
