# @fairsplit/console

The web half of Fair Split: one Vite SPA served from the API's origin. It holds the **Judge stage** (`/judge`: the
co-op's console beside the member's phone), the treasurer's screens under `/season/:seasonCode` and
`/runs/:runSlug`, **Proof** (`/proof/:runSlug`, and the brand view through `/b/:token`), `/ops`, and WS-DS's
design prototype at `/prototype`. The console is Tablea (dark cacao lacquer); Proof and the 80 mm print are Adlaw.

Claude writes in pencil. People sign in ink. PayPal makes it carbon.

## Run it

```sh
corepack pnpm install
corepack pnpm --filter @fairsplit/console dev        # mock data: api-client's seeded mock of fs-api, no API needed
```

| Variable (only `VITE_PUBLIC_*` reaches the bundle) | Meaning                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| `VITE_PUBLIC_FS_DATA=mock\|http`                   | Dev defaults to `mock`; a build defaults to `http` (the API on this origin) |
| `VITE_PUBLIC_FS_PAYPAL_RAIL=simulator\|sandbox`    | The PayPal label when `/healthz` cannot report the API's rail (ADR-0002)    |
| `VITE_PUBLIC_FS_API_BASE`                          | An API origin other than this one (http or https only)                      |
| `FS_API_DEV_ORIGIN` (dev server only)              | With `VITE_PUBLIC_FS_DATA=http`, where `/v1`, `/app` and `/media` proxy to  |

In mock mode the stage says so in its top bar and caption, PayPal is labelled as the simulated sandbox, and a
development stand-in answers the phone frames' bridge at `/app` (the real frames are the Expo web export fs-api
serves). `window.__fsMock.driver` acts as the treasurer or the Chair without the UI (`cosign()` signs the second
key while no Chair frame is attached). Nothing reaches PayPal, Claude or Gemini from the browser, ever.

## Check it

```sh
corepack pnpm --filter @fairsplit/console typecheck
corepack pnpm --filter @fairsplit/console test       # Vitest + Testing Library + msw + axe, no network
corepack pnpm --filter @fairsplit/console build
```

## Layout

| Path          | What                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------- |
| `src/routes`  | TanStack file routes, one per register route; each renders `src/screens/<ID>/index.tsx`      |
| `src/screens` | One module per screen (W-JG-01 … W-OP-01) and the props contract the routes pass             |
| `src/stage`   | The Judge stage: layout, the phone dock and frames, the IC-12 FrameBridge, the director      |
| `src/chrome`  | Top bar, rail, run pill, ribbon, What's real, drawers, notices, print beds, Data mode tables |
| `src/data`    | The adapter over `@fairsplit/api-client`, TanStack Query hooks, the SSE hub, the mock wiring |
| `src/theme`   | The console's CSS on the `--fs-*` tokens, and the AG Grid theme                              |
| `src/lib`     | Formatting, moments, shortcuts, Data mode, provenance footers, SHA-256, verify seam          |
| `src/sound`   | The stage's sound (off by default, remembered per viewer)                                    |
| `src/test`    | The test kit the slices share                                                                |

`SPLIT.md` is the working contract between the shell and the slices that build the screens.

## Accessibility

Designed to WCAG 2.2 AA: axe runs on every route in the unit tests; visualisations are hidden from assistive
technology and mirrored as tables in Data mode (D); single-key shortcuts can be turned off; every moment keeps its
phases under reduced motion. Known gaps are listed in the root README when the screens land.
