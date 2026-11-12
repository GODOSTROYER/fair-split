# assets/objects: the film's shared drawn objects

One script, `objects.js`, already linked by `index.html` (and by `tools/section.mjs`). It adds its own `<style>` and
defines `window.FSO`. Everything is live HTML/SVG; nothing is a raster, nothing blurs. Colours are the film tokens.

Every builder returns one absolutely positioned `<div class="fso …">`. Append it to your section root (or any
positioned element), then tween **that element** with GSAP (`x`, `y`, `scale`, `rotation`, `opacity`). Never put a
CSS `transform` on it yourself.

```js
const root = document.querySelector('[data-composition-id="s5-compare"]');
const slip = FSO.put(root, FSO.slip({ x: 200, y: 300, w: 240 })); // FSO.put(parent, el[, x, y]) appends and returns el
```

Options every builder takes: `x`, `y` (CSS px, `left`/`top` in the parent), `id`, and `anchor`:
`"tl"` (default: x,y is the top-left corner) or `"center"` (x,y is the object's centre; it scales and rotates
about that point). Sizes below are CSS px on the 1920 x 1080 canvas.

| Call                                                                        | What you get                                                                                                                                                                                              | Size                                                  | Extras on the element                                                                                                |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `FSO.slip({ serial: "0403", kg: "38.45", w: 240 })`                         | The weigh-slip: white card, hairline border, the co-op's name small, red "No. 0403", blue handwritten "38.45 kg"                                                                                          | `w` x `1.25 w`                                        | `fsoStrokes` (all pen strokes), `fsoKg` (the weight only)                                                            |
| `FSO.slip({ copy: true, serial: "0457", kg: "42.00", name: false })`        | The pink carbon copy of the same slip. `name: false` swaps the co-op's name for a plain bar (use it whenever the slip is under about 240 px wide). Real weights: 0403 = 38.45, 0457 = 42.00, 0458 = 60.80 | same                                                  | same                                                                                                                 |
| `FSO.slip({ detail: "mini", w: 64, serial: "0419" })`                       | A wordless small slip (red serial bar, two pen lines) for stacks, scatters and the box. `copy: true` makes it pink; `flat: true` drops its shadow                                                         | `w` x `1.25 w`                                        | `fsoStrokes`                                                                                                         |
| `FSO.farmers({ gap: 34, r: 8 })`                                            | The 64 farmers: ink dots, 8 x 8 (`n`, `cols` to change)                                                                                                                                                   | `(cols-1)*gap + 2r` square                            | `fsoDots[i]` (dot i, row by row), `fsoAt(i)` → `{x,y}` centre of dot i in the object's px                            |
| `FSO.token({ amount: "US$4,333.50", h: 72 })`                               | The payment token: a jade pill. Jade is only for money that has arrived                                                                                                                                   | height `h`; about `5.1 h` wide for the default amount | use `anchor: "center"` to place it by its centre                                                                     |
| `FSO.buyer({ size: 44 })`                                                   | The buyer mark: "Lantern Bay" over a spaced "CHOCOLATE"                                                                                                                                                   | about `4.7 size` x `1.7 size`                         |                                                                                                                      |
| `FSO.box({ w: 260, slips: 4, pink: 2 })`                                    | The box of slips: a line-drawn box, front on, mini slips standing in it (`slips: 0` for an empty box; `pink` is the index of a pink one)                                                                  | `w` x `0.77 w`                                        | `fsoSlot` (the layer behind the box front: append your own slips there and tween them down into the box), `fsoSlips` |
| `FSO.notebook({ w: 320, lines: 7, rows: [{ name: 0.5, value: "38.45" }] })` | The notebook page: ruled, with a handwritten row on each of the first lines (`name` 0..1 is the length of the scribbled name; give two rows the same `seed` to make them the same farmer)                 | `w` x `1.25 w`                                        | `fsoRules` (the rules, top to bottom), `fsoRows[i]` → `{ strokes, name, value, group }`                              |
| `FSO.wordmark({ size: 150, n: 12 })`                                        | "Fair Split" with its underline: a row of `n` slips snapped into a line (indigo)                                                                                                                          | `4.131 size` x `1.2 size`                             | `fsoText`, `fsoSegs[i]`, `fsoSeg(i)` → `{x,y,w,h}` of slip i in the object's px                                      |
| `FSO.hand("38.45 kg", { size: 48, color: FSO.C.indigo })`                   | Handwriting drawn as strokes (no font). Glyphs: `0-9 . , k g x + - − ₱ ? = ✓` and space. `size` is a digit's height                                                                                       | see `fsoW`, `fsoH`                                    | `fsoStrokes`                                                                                                         |
| `FSO.tick({ size: 48, color })`                                             | A drawn check mark                                                                                                                                                                                        | `size` square                                         | `fsoStrokes`                                                                                                         |
| `FSO.pin({ size: 44, x, y })`                                               | A map pin whose tip is at x,y                                                                                                                                                                             |                                                       |                                                                                                                      |

`FSO.C` holds the colours (`ink`, `muted`, `hairline`, `indigo`, `jade`, `pink`, `red`, `ground`, `card`).
`FSO.handWidth(text, size)` gives a handwritten string's width, to right-align it.

## Writing things on

`FSO.write(tl, target, position, duration)` draws strokes on in order, starting at `position` (timeline seconds).
`target` is an object with `fsoStrokes` (a slip, a hand, a tick), or any array of `<path pathLength="1">`:
`el.fsoKg`, `notebook.fsoRules`, `notebook.fsoRows[2].strokes`. Before `position` those strokes are invisible;
strokes you never pass to `write` are simply visible.

```js
const page = FSO.put(
  root,
  FSO.notebook({ x: 300, y: 320, w: 300, rows: [{ value: "38.45" }, { value: "21.90" }] }),
);
FSO.write(tl, page.fsoRules, 0.4, 0.8); // the page rules itself
FSO.write(tl, page.fsoRows[0].strokes, 1.4, 0.6); // then a row of handwriting

const mark = FSO.put(root, FSO.wordmark({ x: 960, y: 480, size: 150, anchor: "center" }));
// fly your own slips onto mark.fsoSeg(i), then cross to the line: tl.fromTo(mark.fsoSegs, { opacity: 0 }, { opacity: 1, … })
```

## Rules

- Pink is only the carbon copy. Red is only the slip's serial and the unruled fine (`FSO.hand("− ₱200", { color: FSO.C.red })`).
  Jade is only the token. Indigo is the pen and the underline.
- The full slip carries three words of its own (the co-op's name) plus the serial and the weight: count them
  toward the six-word limit when it is large enough to read; use `detail: "mini"` everywhere else.
- A slip's border is 1 px and scales with it: build it at the size you will show it, and tween `scale` only for the move.
- Numerals: FS Sans's tabular zero is the slashed one, and no feature removes the slash while `tabular-nums` is on. The slip's serial and the token use `font-variant-numeric: lining-nums` (an open zero); do the same for any static figure you set yourself.
