// The token sheet (G1): every colour in both themes with its OKLCH and hex, the contrast results the CI gate
// enforces, the type scale on real copy, space, depth, motion curves and the glyph set.

import {
  cubicBezier,
  EASE,
  SPRING_NAMES,
  SPRING_SPECS,
  SPRINGS,
  springResponse,
  TWEENS,
} from "@fairsplit/motion";
import {
  COLOUR_NAMES,
  COLOUR_ROLES,
  type ColourName,
  type ContrastResult,
  contrastResults,
  DEPTH,
  LAYERS,
  RADII,
  RESOLVED,
  SPACE,
  THEME_INFO,
  THEMES,
  type ThemeName,
  TYPE_ROLES,
  type TypeRoleName,
} from "@fairsplit/tokens";
import { GLYPH_MEANINGS, GLYPHS, type GlyphName } from "@fairsplit/tokens/glyphs";
import { Glyph, Paper, Print, Slab } from "@fairsplit/ui-web";
import type { ReactNode } from "react";
import { HERO_SLIPS, RATE_CARD_SHA256, SEASON } from "../fixture.js";
import { hashPrefix } from "../format.js";
import { PageTitle, Section } from "../Shell.js";
import { SlipSheet } from "../slips.js";

const GROUPS: readonly { readonly title: string; readonly names: readonly ColourName[] }[] = [
  { title: "Surfaces", names: ["ground", "plate", "plate-2", "rule", "rule-strong"] },
  { title: "Ink and pencil", names: ["ink", "ink-2", "ink-3", "pencil", "pencil-faint"] },
  {
    title: "Jade: money only",
    names: ["jade", "on-jade", "jade-text", "jade-flush-border", "jade-wash", "jade-halo"],
  },
  {
    title: "Marigold (canary): a person must decide",
    names: ["canary", "on-canary", "canary-text", "canary-wash", "canary-border"],
  },
  { title: "Red: PayPal failures only", names: ["red", "red-face", "on-red-face", "red-wash"] },
  { title: "Ballpoint: a person's hand", names: ["pod", "pod-wash"] },
  { title: "Instruments and materials", names: ["hatch", "steel-line", "steel-face", "pencil-wash"] },
  { title: "Evidence", names: ["copy-white", "copy-pink", "copy-yellow", "paper-ink"] },
  {
    title: "Slabs",
    names: [
      "slab-chalk-face",
      "slab-chalk-right",
      "slab-chalk-bottom",
      "slab-chalk-label",
      "slab-jade-face",
      "slab-jade-right",
      "slab-jade-bottom",
      "slab-jade-label",
    ],
  },
  { title: "Overlays and chrome", names: ["scrim", "highlight", "drawer-highlight", "bezel"] },
];

function Swatch({ theme, name }: { readonly theme: ThemeName; readonly name: ColourName }) {
  const c = RESOLVED[theme][name];
  return (
    <li className="tok-swatch">
      <span className="tok-swatch__chip" style={{ background: `var(--fs-${name})` }} aria-hidden />
      <span className="tok-swatch__name">
        <span className="fs-t-label">--fs-{name}</span>
        <span className="fs-t-caption tok-muted">{COLOUR_ROLES[name]}</span>
      </span>
      <span className="tok-swatch__values fs-t-caption">
        <span>{c.alpha === 1 ? c.hex : `${c.hex} at ${Math.round(c.alpha * 100)}%`}</span>
        <span className="tok-muted">{c.cssOklch.replace("oklch", "")}</span>
      </span>
    </li>
  );
}

function ThemePane({ theme, children }: { readonly theme: ThemeName; readonly children: ReactNode }) {
  return (
    <div className="proto-pane" data-theme={theme} data-testid={`W-DP-01.pane.${theme}`}>
      <p className="proto-pane__name">
        <span className="fs-t-title-2">{THEME_INFO[theme].display}</span>
        <span className="fs-t-caption">{THEME_INFO[theme].use}</span>
      </p>
      {children}
    </div>
  );
}

function ContrastMatrix({
  theme,
  results,
}: {
  readonly theme: ThemeName;
  readonly results: ContrastResult[];
}) {
  const text = results.filter((r) => r.theme === theme && r.group === "console-text");
  const fgs = [...new Set(text.map((r) => r.fg))];
  const bgs = [...new Set(text.map((r) => r.bg))];
  const rest = results.filter((r) => r.theme === theme && r.group !== "console-text");
  return (
    <div className="tok-contrast">
      <table className="proto-table tok-matrix">
        <caption className="fs-t-caption tok-muted">Console text, 4.5:1 floor</caption>
        <thead>
          <tr>
            <th scope="col">Text</th>
            {bgs.map((bg) => (
              <th key={bg} scope="col">
                on {bg}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fgs.map((fg) => (
            <tr key={fg}>
              <th scope="row" className="fs-t-label">
                {fg}
              </th>
              {bgs.map((bg) => {
                const r = text.find((x) => x.fg === fg && x.bg === bg);
                if (!r) return <td key={bg} />;
                return (
                  <td key={bg}>
                    <span
                      className="tok-sample"
                      style={{ color: `var(--fs-${fg})`, background: `var(--fs-${bg})` }}
                    >
                      Aa 64.45
                    </span>
                    <span className="tok-ratio" data-pass={r.pass ? "" : undefined}>
                      {r.ratio.toFixed(2)}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <table className="proto-table">
        <caption className="fs-t-caption tok-muted">
          Statement copy, faces, washes, non-text and hatching
        </caption>
        <thead>
          <tr>
            <th scope="col">Pair</th>
            <th scope="col">Sample</th>
            <th scope="col">Ratio</th>
            <th scope="col">Floor</th>
          </tr>
        </thead>
        <tbody>
          {rest.map((r) => (
            <tr key={`${r.group}-${r.fg}-${r.bg}`}>
              <td className="fs-t-caption">
                {r.fg} on {r.bg}
              </td>
              <td>
                {r.group === "hatch" || r.group === "non-text" ? (
                  <span className="tok-sample" style={{ background: `var(--fs-${r.bg})` }}>
                    <span className="tok-bar" style={{ background: `var(--fs-${r.fg})` }} />
                  </span>
                ) : (
                  <span
                    className="tok-sample"
                    style={{ color: `var(--fs-${r.fg})`, background: `var(--fs-${r.bg})` }}
                  >
                    Aa
                  </span>
                )}
              </td>
              <td>
                <span className="tok-ratio" data-pass={r.pass ? "" : undefined}>
                  {r.ratio.toFixed(2)}
                </span>
              </td>
              <td className="tok-muted">{r.min}:1</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SPECIMENS: Readonly<Record<TypeRoleName, string>> = {
  display: "A cacao co-op pays 64 farmers from one brand invoice",
  "amount-hero": "US$368.39",
  "amount-l": "US$17.94",
  "title-1": "Season 2026-A is ready to pay.",
  "title-2": "Slip 0457 counted twice",
  body: "Counting both moves US$17.94 from 63 members to Nong Dioning and puts shrink at 2.05%.",
  figure: "148.0 kg   43.69   21.85   −1.09   64.45",
  lede: "Code computes every amount. People settle three holds, two officers sign, PayPal pays.",
  label: "Count it once",
  caption: "Read by Claude (claude-opus-5-5), replay of a recorded run from 29 Oct.",
  hash: "",
  slab: "Approve 8 payouts",
  stamp: "AS",
  "statement-lead": "Maayong adlaw, Nang Celing. Salamat sa inyong paghago.",
  "statement-body": "Nagdala mo og 148.0 kg nga uga nga cacao, tanan Grade 1.",
  "statement-status": "Bayad na",
  mark: "LB-PH-2026-03",
};

function TypeSpecimen({ role }: { readonly role: TypeRoleName }) {
  const r = TYPE_ROLES[role];
  const text = role === "hash" ? hashPrefix(RATE_CARD_SHA256, 4) : SPECIMENS[role];
  const family =
    r.family === "statement" ? "Atkinson Hyperlegible Next" : r.family === "mark" ? "FS Stencil" : "FS Sans";
  return (
    <div className="tok-type" data-testid={`W-DP-01.type.${role}`}>
      <p className="tok-type__meta fs-t-caption">
        <span className="fs-t-label">{role}</span>
        <span className="tok-muted">
          {family}
          {r.family === "ui" ? `, width ${r.stretch}` : ""}, weight {r.weight}, {r.size}/{r.line}
          {"app" in r && r.app ? `; app ${r.app.size}/${r.app.line} sp` : ""}
          {"numerals" in r && r.numerals ? `, ${r.numerals} figures` : ""}
        </span>
      </p>
      <p className={role === "stamp" ? "tok-type__sample tok-stamp-sample" : `tok-type__sample fs-t-${role}`}>
        {role === "stamp" ? <span className="fs-stamp fs-t-stamp">{text}</span> : text}
      </p>
    </div>
  );
}

function SpringCurve({ name }: { readonly name: (typeof SPRING_NAMES)[number] }) {
  const p = SPRINGS[name];
  const w = 200;
  const h = 80;
  const points = Array.from({ length: 61 }, (_, i) => {
    const t = (p.settleMs * i) / 60;
    const v = springResponse(name, t);
    return `${((i / 60) * w).toFixed(1)},${(h - v * (h - 16) - 8).toFixed(1)}`;
  });
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="tok-curve" aria-hidden>
      <line x1={0} x2={w} y1={16 - 8} y2={16 - 8} className="tok-curve__target" />
      <polyline points={points.join(" ")} className="tok-curve__line" />
    </svg>
  );
}

function EaseCurve({ name }: { readonly name: keyof typeof EASE }) {
  const w = 72;
  const h = 48;
  const points = Array.from({ length: 41 }, (_, i) => {
    const x = i / 40;
    return `${(x * w).toFixed(1)},${(h - cubicBezier(EASE[name], x) * h).toFixed(1)}`;
  });
  return (
    <svg width={w} height={h} viewBox={`-2 -2 ${w + 4} ${h + 4}`} className="tok-curve" aria-hidden>
      <polyline points={points.join(" ")} className="tok-curve__line" />
    </svg>
  );
}

export function TokensPage() {
  const results = contrastResults();
  const failing = results.filter((r) => !r.pass);
  const domain = Object.keys(GLYPH_MEANINGS) as (keyof typeof GLYPH_MEANINGS)[];
  const material = (Object.keys(GLYPHS) as GlyphName[]).filter(
    (n) => n.startsWith("ms:") && !n.endsWith("-fill"),
  );
  return (
    <div data-testid="W-DP-01.tokens">
      <PageTitle
        title="Tokens"
        lede={
          <>
            One hand-edited source, <code>packages/tokens/src/tokens.ts</code>, generates{" "}
            <code>theme.web.css</code> (the <code>--fs-*</code> variables under <code>[data-theme]</code>) and{" "}
            <code>tokens.native.ts</code> for the app. Colours are OKLCH with hex fallbacks. Hayag (day, the{" "}
            <code>adlaw</code> slot) is the default for the console, the stage, Proof and the app; Gabii
            (night, the <code>tablea</code> slot) is for the film’s cards and an opt-in night console
            (ADR-0016).
          </>
        }
      />

      <Section
        title="Colour"
        brief="One job per colour. Jade is money (flush only when the simulated PayPal confirms), marigold means a person must decide, ballpoint indigo is a person’s hand, graphite pencil is the machine, ink is a checked fact, red is only PayPal saying no."
        testId="W-DP-01.colour"
      >
        <div className="proto-panes">
          {THEMES.map((theme) => (
            <ThemePane key={theme} theme={theme}>
              {GROUPS.map((g) => (
                <div key={g.title} className="tok-group">
                  <p className="fs-t-caption tok-muted">{g.title}</p>
                  <ul className="tok-swatches">
                    {g.names.map((n) => (
                      <Swatch key={n} theme={theme} name={n} />
                    ))}
                  </ul>
                </div>
              ))}
            </ThemePane>
          ))}
        </div>
        <p className="proto-note">
          {COLOUR_NAMES.length} colours per theme. “mix” washes are blended over plate in sRGB and emitted
          opaque, because AG Grid needs opaque fills.
        </p>
      </Section>

      <Section
        title="Contrast"
        brief={
          <>
            The CI gate (<code>packages/tokens/test/contrast.test.ts</code>) fails the build if any of these{" "}
            {results.length} pairs drops below its floor: 4.5:1 console text and faces, 7:1 statement copy,
            3:1 non-text, 1.8:1 hatching.{" "}
            {failing.length === 0 ? "Every pair passes." : `${failing.length} pairs fail.`}
          </>
        }
        testId="W-DP-01.contrast"
      >
        <div className="proto-panes">
          {THEMES.map((theme) => (
            <ThemePane key={theme} theme={theme}>
              <ContrastMatrix theme={theme} results={results} />
            </ThemePane>
          ))}
        </div>
      </Section>

      <Section
        title="Type"
        brief="Mona Sans (as FS Sans) for the interface and every number, Atkinson Hyperlegible Next for statement prose, Big Shoulders Stencil for season and lot marks only. No monospace anywhere."
        testId="W-DP-01.type"
      >
        <div className="tok-types">
          {(Object.keys(TYPE_ROLES) as TypeRoleName[]).map((role) => (
            <TypeSpecimen key={role} role={role} />
          ))}
        </div>
      </Section>

      <Section
        title="The zero and the peso"
        brief="Amounts read as money: proportional lining figures with a plain zero, and the US$ prefix at half size, raised. Tabular figures (Mona’s slashed zero) stay only for hashes and grid columns that align on the decimal. The peso sign comes from Noto Sans, joined to FS Sans for that glyph alone."
        testId="W-DP-01.zero"
      >
        <div className="tok-zero">
          <div>
            <p className="fs-t-caption tok-muted">Hashes and aligned columns: tabular, slashed zero</p>
            <p className="fs-t-hash">
              {SEASON.invoiceNumber} {hashPrefix(RATE_CARD_SHA256, 4)} 0403 0457 1,600 ms
            </p>
            <p className="fs-t-amount-l fs-figures">US$4,333.50 ₱270,844</p>
          </div>
          <div>
            <p className="fs-t-caption tok-muted">Amounts: proportional, US$ raised (the default)</p>
            <p className="fs-t-amount-l">
              <span className="fs-cur">US$</span>4,333.50 ₱270,844
            </p>
          </div>
          <div>
            <p className="fs-t-caption tok-muted">Straight bar (ss08)</p>
            <p className="fs-t-hash fs-zero-bar">
              {SEASON.invoiceNumber} {hashPrefix(RATE_CARD_SHA256, 4)} 0403 0457 1,600 ms
            </p>
            <p className="fs-t-amount-l fs-zero-bar">US$4,333.50 ₱270,844</p>
          </div>
          <div>
            <p className="fs-t-caption tok-muted">The peso at three widths</p>
            <p className="tok-peso">
              <span style={{ fontStretch: "75%", fontWeight: 800 }}>₱4,028</span>
              <span style={{ fontStretch: "100%", fontWeight: 450 }}>mga ₱4,028 (gibanabana)</span>
              <span style={{ fontStretch: "112.5%", fontWeight: 700 }}>Return the ₱200 as a credit</span>
            </p>
          </div>
        </div>
      </Section>

      <Section
        title="Space, radii and depth"
        brief="A 4-based space scale. Corners: 0 for evidence paper, 6 for cells and chips, 10 for controls, 14 for slabs and cards, 22 for panels, pills for chips and segmented controls. Slab lips are 3, 5 and 8 px (depth equals consequence); chips lift on e1, panels on e2, drawers and dialogs on e3, and paper keeps the strongest shadow."
        testId="W-DP-01.space"
      >
        <div className="tok-space">
          {SPACE.map((s) => (
            <div key={s} className="tok-space__row">
              <span className="fs-t-caption tok-muted">{s}</span>
              <span className="tok-space__bar" style={{ width: s * 3 }} />
            </div>
          ))}
        </div>
        <div className="tok-depths">
          {(Object.keys(DEPTH) as (keyof typeof DEPTH)[]).map((d) => (
            <div key={d} className="proto-state">
              <p className="proto-state__name fs-t-caption">
                <code>{d}</code> {DEPTH[d]} px lip
              </p>
              <Slab
                label={d === "d1" ? "Request rescan" : d === "d2" ? "Count it once" : "Approve 8 payouts"}
                srLabel={d}
                depth={d}
                tone={d === "d3" ? "jade" : "chalk"}
                testId={`W-DP-01.depth.${d}`}
                onCommit={() => undefined}
                frame={{ state: "rest" }}
              />
            </div>
          ))}
          <div className="proto-state">
            <p className="proto-state__name fs-t-caption">Radii {Object.values(RADII).join(", ")}</p>
            {(Object.keys(RADII) as (keyof typeof RADII)[]).map((r) => (
              <span key={r} className="tok-radius" style={{ borderRadius: `var(--fs-radius-${r})` }}>
                {r}
              </span>
            ))}
          </div>
          {(["e1", "e2", "e3", "halo"] as const).map((e) => (
            <div key={e} className="proto-state" data-testid={`W-DP-01.shadow.${e}`}>
              <p className="proto-state__name fs-t-caption">
                <code>--fs-shadow-{e}</code>
              </p>
              <span className="tok-elevation" style={{ boxShadow: `var(--fs-shadow-${e})` }} />
            </div>
          ))}
          <div className="proto-state">
            <p className="proto-state__name fs-t-caption">Paper, the strongest shadow</p>
            <Paper alt={`Weigh slip ${HERO_SLIPS[0]}`}>
              <SlipSheet serial={HERO_SLIPS[0]} copy="white" width={180} />
            </Paper>
          </div>
        </div>
        <table className="proto-table tok-layers">
          <caption className="fs-t-caption tok-muted">Layers</caption>
          <tbody>
            {Object.entries(LAYERS).map(([name, z]) => (
              <tr key={name}>
                <td>{name}</td>
                <td className="tok-muted">{z}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="Motion"
        brief="Machines print with tweens; people and PayPal use springs and depth. Each spring is mass 1 with k = (2π/d)² and c = 4π(1−b)/d, so Motion and Reanimated move identically. The line above each curve is the target."
        testId="W-DP-01.motion"
      >
        <div className="tok-springs">
          {SPRING_NAMES.map((name) => (
            <figure key={name} className="tok-spring">
              <SpringCurve name={name} />
              <figcaption>
                <span className="fs-t-label">{name}</span>
                <span className="fs-t-caption tok-muted">
                  {SPRING_SPECS[name].duration * 1000} ms, bounce {SPRING_SPECS[name].bounce}; k{" "}
                  {SPRINGS[name].stiffness}, c {SPRINGS[name].damping}, ζ{" "}
                  {SPRINGS[name].dampingRatio.toFixed(2)}; settles in {Math.round(SPRINGS[name].settleMs)} ms
                </span>
                <span className="fs-t-caption">{SPRING_SPECS[name].use}</span>
              </figcaption>
            </figure>
          ))}
        </div>
        <div className="tok-eases">
          {(Object.keys(EASE) as (keyof typeof EASE)[]).map((name) => (
            <figure key={name} className="tok-ease">
              <EaseCurve name={name} />
              <figcaption className="fs-t-caption">
                <span className="fs-t-label">{name}</span>
                <span className="tok-muted">{EASE[name].join(", ")}</span>
              </figcaption>
            </figure>
          ))}
        </div>
        <table className="proto-table tok-tweens">
          <thead>
            <tr>
              <th scope="col">Tween</th>
              <th scope="col">Time</th>
              <th scope="col">Curve</th>
              <th scope="col">Use</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(TWEENS).map(([name, t]) => (
              <tr key={name}>
                <td className="fs-t-label">{name}</td>
                <td className="fs-t-figure">{t.ms} ms</td>
                <td className="tok-muted">{t.ease}</td>
                <td className="fs-t-caption">{t.use}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="Glyphs"
        brief="Fourteen domain glyphs on a 24 px grid with 2 px strokes, square caps, mitre joins and 45° chamfers that echo the slab edges; the filled variant marks state. System icons are Material Symbols Sharp. Icons always come with words."
        testId="W-DP-01.glyphs"
      >
        <ul className="tok-glyphs">
          {domain.map((name) => (
            <li key={name} className="tok-glyph">
              <span className="tok-glyph__pair">
                <Glyph name={name} size={32} />
                <Glyph name={`${name}-fill` as GlyphName} size={32} />
              </span>
              <span className="fs-t-label">{name}</span>
              <span className="fs-t-caption tok-muted">{GLYPH_MEANINGS[name]}</span>
            </li>
          ))}
        </ul>
        <ul className="tok-material">
          {material.map((name) => (
            <li key={name} className="tok-material__item">
              <Glyph name={name} size={24} />
              <span className="fs-t-caption tok-muted">{name.replace("ms:", "")}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Materials"
        brief="Machine output is flat print; low-confidence reads wait in a You cell; cash is hatched and always worded; bolted edges are steel."
        testId="W-DP-01.materials"
      >
        <div className="tok-materials">
          <div className="proto-state">
            <p className="proto-state__name fs-t-caption">Print, pencil</p>
            <Print
              value="38.45"
              provenance="claude"
              state="pencil"
              footer="Read by Claude (claude-opus-5-5)"
              typeRole="amount-l"
            />
          </div>
          <div className="proto-state">
            <p className="proto-state__name fs-t-caption">You cell, read at 0.40</p>
            <Print value="6?.80" provenance="claude" state="pencil" confidence={0.4} typeRole="figure" />
          </div>
          <div className="proto-state">
            <p className="proto-state__name fs-t-caption">Hollow: approved, not yet received</p>
            <Print value="US$64.45" provenance="engine" state="hollow" typeRole="amount-l" />
          </div>
          <div className="proto-state">
            <p className="proto-state__name fs-t-caption">Hatch: cash at the bodega</p>
            <span className="tok-hatch fs-t-caption">
              <span>Cash</span>
            </span>
          </div>
          <div className="proto-state">
            <p className="proto-state__name fs-t-caption">Steel: bolted edges</p>
            <span className="tok-steel" />
          </div>
        </div>
      </Section>
    </div>
  );
}
