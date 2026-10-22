# Material Symbols (Sharp)

System icons for every surface (design §2.6, S2 §2.6), copied as SVG from
[google/material-design-icons](https://github.com/google/material-design-icons) at commit
`49d4db35df873165d6bd6ba09b063c7dafbac2f4` (9 Oct 2026), under the Apache License 2.0 (`LICENSE` here).

- Style: Sharp, weight 500, optical size 24.
- Paths: `symbols/web/<name>/materialsymbolssharp/<name>_wght500_24px.svg` and the filled
  `<name>_wght500fill1_24px.svg`.
- Not `@material-symbols/svg-500`: its SVGs are optical size 48, and the package unpacks to 19 MB.

The starting set: close, check, arrow_back, expand_more, expand_less, search, settings, volume_up, volume_off,
restart_alt, help, open_in_new, filter_list, qr_code_2, content_copy, schedule, wifi_off, play_arrow, pause,
translate, contrast, fingerprint, lock, visibility, keyboard, print.

`@fairsplit/tokens` turns these files and the domain glyphs in `assets/glyphs/` into one generated module
(`@fairsplit/tokens/glyphs`) that the web and native renderers share. Icons always come with words.
