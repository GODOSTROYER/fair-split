// Every focus move on the console goes through this module (WCAG 2.4.3, 2.4.7, 2.4.11). A move that hands focus
// back after something went away (a drawer, a dialog, the Proof trace, the phone lowering, a control the answer
// removed: "Count it once", "Pay in cash", a slip's zoom controls) is `returnFocus`; a deliberate move (a step's
// pre-focus, J and K, the skip link, the phone rising) is `focusAndReveal`, which `returnFocus` ends in too.
//   - Commit, never a timer. `returnFocus` runs in the commit that removed what held focus: from a layout effect
//     after it, or from the layout cleanup of the component that goes (React runs a deleted component's layout
//     cleanups before it takes its DOM away, so the target takes focus before a browser could drop it to <body>).
//     No frame is ever painted with focus on <body>. A timer can fire before React commits (a loaded machine),
//     find the control still focused or the screen still inert, and give up just before focus falls.
//   - Resolved when it returns, not when it opened. An opener that was removed or redrawn meanwhile (the M-007 row
//     once "Count it once" resolves H1: the grid draws the row again) is found again by its stable key
//     (`data-focus-key`, its test ID, a grid cell's row and column) before the screen's main control (the step's
//     pre-focused control, else its first control); #fsc-main only when the screen has no control, never <body>.
//   - Seen. After focus({ preventScroll: true }) the target scrolls the least it can (block and inline "nearest")
//     when it sits outside the viewport or a scrollport around it, inside that scrollport's scroll-padding (so a
//     sticky head never covers it). The scroll is instant: a focus return never animates, in reduced motion or not.
//   - Polite. It moves focus only when focus is lost: on <body>, under an inert subtree, or inside what is going
//     away. A control the person (or a new screen) focused meanwhile keeps it.
//   - Backed. Each part that knows its successor hands focus on itself (useFocusOnLeave before its DOM goes,
//     useFocusAfterRemoval in the commit after). Whatever is left (a link that changes the route takes its screen
//     away; a control nobody hands on from) is the root's useFocusGuard: before anything paints, never <body>.

import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

/** A place focus can go back to: the element, and a stable key that finds its successor once it is redrawn. */
export interface FocusPlace {
  readonly el: HTMLElement;
  /** A selector for its successor: `data-focus-key`, its test ID, a grid cell's row and column, or its ID. */
  readonly key: string | null;
}

/** A control, a remembered place, or a getter run when focus returns (it finds what the commit left). */
export type FocusTarget =
  | HTMLElement
  | FocusPlace
  | null
  | undefined
  | (() => HTMLElement | FocusPlace | null | undefined);

export interface ReturnFocusOptions {
  /** What this commit takes away (a drawer, a dialog): focus inside it is lost, and nothing inside it is a target. */
  readonly leaving?: Element | null;
  /** "lost" (the default): only when focus is lost. "always": move it even from a live control. */
  readonly when?: "lost" | "always";
  /** false: only the targets given, not the screen after them. */
  readonly fallback?: boolean;
}

const TABBABLE = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/** The console's scrollports by name, for a document without its styles (component tests). */
const SCROLLPORTS =
  ".fsc-console__screen, .fsc-drawer, .ag-grid-viewport, .ag-body-viewport, [data-scrollport]";

function attr(name: string, value: string): string {
  return `[${name}="${value.replace(/["\\]/g, "\\$&")}"]`;
}

/** Focus is lost: on <body> (or nowhere), on a detached control, under an inert subtree, or inside `leaving`. */
export function focusIsLost(leaving?: Element | null): boolean {
  const active = document.activeElement;
  if (active === null || active === document.body || !active.isConnected) return true;
  if (active.closest("[inert]")) return true;
  return Boolean(leaving?.contains(active));
}

/** Connected, not hidden, not under an inert subtree and not inside `leaving`: a browser lets it take focus. */
export function isLive(el: Element | null | undefined, leaving?: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement) || !el.isConnected) return false;
  if (el.closest("[inert], [hidden]")) return false;
  return !leaving?.contains(el);
}

function rendered(el: HTMLElement): boolean {
  const check = (el as { checkVisibility?: (options?: object) => boolean }).checkVisibility;
  return typeof check === "function"
    ? check.call(el, { visibilityProperty: true, checkVisibilityCSS: true })
    : true;
}

/**
 * The stable key of `el`: its `data-focus-key`, its test ID, the row and column of the grid cell it is in (AG Grid
 * draws a row's cells again when its data changes), an ancestor's `data-focus-key`, or its ID.
 */
export function focusKey(el: Element): string | null {
  if (!(el instanceof HTMLElement)) return null;
  if (el.dataset.focusKey) return attr("data-focus-key", el.dataset.focusKey);
  if (el.dataset.testid) return attr("data-testid", el.dataset.testid);
  const cell = el.closest(".ag-cell[col-id]");
  const row = cell?.closest(".ag-row[row-id]");
  const col = cell?.getAttribute("col-id");
  const rowId = row?.getAttribute("row-id");
  if (col && rowId) return `.ag-row${attr("row-id", rowId)} .ag-cell${attr("col-id", col)}`;
  const keyed = el.closest<HTMLElement>("[data-focus-key]")?.dataset.focusKey;
  if (keyed) return attr("data-focus-key", keyed);
  return el.id ? attr("id", el.id) : null;
}

/**
 * Where useFocusGuard put focus, until the person acts or focus moves on: nobody chose it (a route change landed
 * on the new screen's first control while its step's control is not drawn yet), so it is no one's opener.
 */
let placed: Element | null = null;

/**
 * Remembers where focus is (or `el`) to hand it back later; null on <body>, inside `leaving`, or where the
 * backstop put it (a phone a moment raises over the scrim meanwhile lowers to the step's control instead).
 */
export function rememberFocus(
  el: Element | null = document.activeElement,
  leaving?: Element | null,
): FocusPlace | null {
  if (!(el instanceof HTMLElement) || el === document.body || leaving?.contains(el)) return null;
  if (el === placed) return null;
  return { el, key: focusKey(el) };
}

function resolve(target: FocusTarget, leaving: Element | null): HTMLElement | null {
  const value = typeof target === "function" ? target() : target;
  if (!value) return null;
  if (value instanceof HTMLElement) return isLive(value, leaving) ? value : null;
  if (isLive(value.el, leaving)) return value.el;
  if (!value.key) return null;
  for (const found of document.querySelectorAll<HTMLElement>(value.key)) {
    if (isLive(found, leaving) && rendered(found)) return found;
  }
  return null;
}

// ------------------------------------------------------------------------------------------- the screen

type ControlSource = HTMLElement | (() => HTMLElement | null | undefined);

let stepControl: ControlSource | null = null;

/**
 * usePrefocus: the control the run pill's step pre-focuses is its screen's main control while it is the step. A
 * getter is read when focus returns, so a control the screen drew again meanwhile (the press remounted at rest)
 * is the one found, never the element that was there when the step began.
 */
export function registerScreenControl(control: ControlSource): () => void {
  stepControl = control;
  return () => {
    if (stepControl === control) stepControl = null;
  };
}

function stepControlEl(): HTMLElement | null {
  if (!stepControl) return null;
  return (typeof stepControl === "function" ? stepControl() : stepControl) ?? null;
}

function screenRoot(): HTMLElement | null {
  return document.getElementById("fsc-main") ?? document.querySelector<HTMLElement>("main");
}

/** The screen's main control: the step's pre-focused control when it is there, else the screen's first control. */
export function screenControl(leaving: Element | null = null): HTMLElement | null {
  const main = screenRoot();
  if (!isLive(main, leaving)) return null;
  const step = stepControlEl();
  if (step && main.contains(step) && isLive(step, leaving) && rendered(step)) return step;
  for (const el of main.querySelectorAll<HTMLElement>(TABBABLE)) {
    if (isLive(el, leaving) && rendered(el)) return el;
  }
  return null;
}

/** After the targets: the screen's main control, the title of a drawer that covers it, the screen itself. */
const SCREEN_FALLBACKS: readonly ((leaving: Element | null) => HTMLElement | null)[] = [
  screenControl,
  () => document.querySelector<HTMLElement>(".fsc-drawer .fsc-drawer__title"),
  () => document.querySelector<HTMLElement>(".fsc-drawer"),
  screenRoot,
];

// --------------------------------------------------------------------------------------------- in view

interface Frame {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

function px(value: string): number {
  return Number.parseFloat(value) || 0;
}

function isScrollport(el: HTMLElement): boolean {
  if (el.matches(SCROLLPORTS)) return true;
  const style = getComputedStyle(el);
  return /auto|scroll/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`);
}

/**
 * What sticks to a scrollport's top or bottom edge and covers what scrolls under it: the drawer's head, AG Grid's
 * header with the pinned decision row, and its pinned totals row. A focused control under one is unseen too.
 */
const STICKY_EDGES =
  ".fsc-drawer__head, .ag-grid-pinned-top-rows, .ag-grid-pinned-bottom-rows, [data-sticky-edge]";

/**
 * What floats over the lower part of the stage, above whatever scrolls beneath it: the one-time sound offer. A
 * control under one is covered; the scrollport it floats over scrolls it clear.
 */
const FLOATING = ".fsc-offer, [data-floating-chip]";

/** How far a floating chip over `box`'s column reaches up into a frame whose bottom is `bottom`. */
function floatingInset(top: number, bottom: number, box: DOMRect, el: Element): number {
  let inset = 0;
  for (const chip of document.querySelectorAll<HTMLElement>(FLOATING)) {
    if (chip.contains(el)) continue;
    const r = chip.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= box.left || r.left >= box.right) continue;
    if (r.top <= top || r.top >= bottom) continue;
    inset = Math.max(inset, bottom - r.top);
  }
  return inset;
}

/** The nearest scrollport around `el` (not `el` itself). */
function scrollportOf(el: Element): HTMLElement | null {
  for (let at = el.parentElement; at && at !== document.body; at = at.parentElement) {
    if (isScrollport(at)) return at;
  }
  return null;
}

/** How far `scroller`'s sticky edges reach in from its top and bottom (one holding `el` covers nothing). */
function stickyInsets(scroller: HTMLElement, box: DOMRect, el: Element): { top: number; bottom: number } {
  let top = 0;
  let bottom = 0;
  for (const edge of scroller.querySelectorAll<HTMLElement>(STICKY_EDGES)) {
    if (edge.contains(el) || scrollportOf(edge) !== scroller) continue;
    const style = getComputedStyle(edge);
    if (style.position !== "sticky" && style.position !== "fixed") continue;
    const r = edge.getBoundingClientRect();
    if (r.height === 0) continue;
    if (style.top !== "auto" && style.top !== "") top = Math.max(top, r.bottom - box.top);
    else if (style.bottom !== "auto" && style.bottom !== "") bottom = Math.max(bottom, box.bottom - r.top);
  }
  return { top, bottom };
}

/**
 * A scrollport's visible box for `el`: inside its borders and scrollbars, less its scroll-padding or what its
 * sticky edges or a chip floating over it cover, whichever is more.
 */
function frameOf(scroller: HTMLElement, el: Element): Frame | null {
  const box = scroller.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return null;
  const style = getComputedStyle(scroller);
  const sticky = stickyInsets(scroller, box, el);
  const top = box.top + scroller.clientTop;
  const left = box.left + scroller.clientLeft;
  const bottom = top + (scroller.clientHeight || box.height);
  const floating = floatingInset(top, bottom, el.getBoundingClientRect(), el);
  return {
    top: top + Math.max(px(style.scrollPaddingTop), sticky.top),
    left: left + px(style.scrollPaddingLeft),
    bottom: bottom - Math.max(px(style.scrollPaddingBottom), sticky.bottom, floating),
    right: left + (scroller.clientWidth || box.width) - px(style.scrollPaddingRight),
  };
}

function outside(box: DOMRect, f: Frame): boolean {
  return box.top < f.top || box.bottom > f.bottom || box.left < f.left || box.right > f.right;
}

/**
 * True when `el` is not wholly inside the viewport and every scrollport around it, clear of their sticky edges:
 * focused there, it is unseen or covered (WCAG 2.4.11).
 */
export function outOfView(el: Element): boolean {
  const box = el.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return false;
  const viewport = window.innerHeight;
  const below = floatingInset(0, viewport, box, el);
  if (outside(box, { top: 0, left: 0, bottom: viewport - below, right: window.innerWidth })) return true;
  for (let at = el.parentElement; at && at !== document.body; at = at.parentElement) {
    const frame = isScrollport(at) ? frameOf(at, el) : null;
    if (frame && outside(box, frame)) return true;
  }
  return false;
}

/**
 * After scrollIntoView (which knows scroll-padding but not what sticks over an edge): each scrollport around
 * `el` scrolls on, the least it can, until its sticky edges no longer cover it.
 */
function clearStickyEdges(el: Element): void {
  for (let at = el.parentElement; at && at !== document.body; at = at.parentElement) {
    if (!isScrollport(at)) continue;
    const frame = frameOf(at, el);
    if (!frame) continue;
    const box = el.getBoundingClientRect();
    if (box.top < frame.top) at.scrollTop -= frame.top - box.top;
    else if (box.bottom > frame.bottom)
      at.scrollTop += Math.min(box.bottom - frame.bottom, box.top - frame.top);
  }
}

/** Scrolls `el` into view the least it can, at once, clear of sticky edges, when it is out of view. */
export function reveal(el: Element): void {
  if (!outOfView(el)) return;
  el.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "instant" });
  clearStickyEdges(el);
}

/**
 * How long a focused control is kept in view while the layout around it settles: the answer that moved focus
 * often moves the layout a frame or two later (Count it once's result line unfolds above Next, the grid draws
 * its ten columns again once the drawer has gone), which can carry the control out of its scrollport.
 */
export const REVEAL_SETTLE_MS = 1500;

/** What stops the settling at once: the person scrolling or acting on their own. */
const OWN_INPUT = ["pointerdown", "wheel", "touchstart", "keydown"] as const;

let settling: (() => void) | null = null;

/** Keeps `el` in view each animation frame while it holds focus, for `ms`, unless the person acts first. */
function keepInView(el: HTMLElement, ms: number = REVEAL_SETTLE_MS): void {
  settling?.();
  if (typeof requestAnimationFrame !== "function") return;
  const until = performance.now() + ms;
  let frame = 0;
  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    for (const type of OWN_INPUT) window.removeEventListener(type, stop, true);
    if (settling === stop) settling = null;
  };
  const tick = () => {
    frame = 0;
    if (document.activeElement !== el || performance.now() > until) {
      stop();
      return;
    }
    reveal(el);
    frame = requestAnimationFrame(tick);
  };
  for (const type of OWN_INPUT) window.addEventListener(type, stop, true);
  settling = stop;
  frame = requestAnimationFrame(tick);
}

/**
 * Focuses `el` without the browser's jump, then reveals it, and keeps it in view while the layout settles. False
 * when the browser refused the focus.
 */
export function focusAndReveal(el: HTMLElement): boolean {
  el.focus({ preventScroll: true });
  if (document.activeElement !== el) return false;
  reveal(el);
  keepInView(el);
  return true;
}

// ------------------------------------------------------------------------------------------ the return

function listOf(targets: FocusTarget | readonly FocusTarget[]): readonly FocusTarget[] {
  return Array.isArray(targets) ? (targets as readonly FocusTarget[]) : [targets as FocusTarget];
}

/**
 * Focuses a landmark (a page's <main>, which ScreenRoot draws with no tabindex) from script, for as long as it holds
 * focus: tabindex="-1" is lent as focus lands and taken back once focus has moved on, as for a skip link's target.
 * A static tabindex would let a click in the page's text focus the landmark, which moves the sequential focus
 * starting point to the top of the page (the next Tab jumps up). One with a tabindex of its own (the stage's
 * #fsc-main) keeps it. A blur while the window loses focus leaves focus where it was, so the loan stands.
 */
function focusLandmark(el: HTMLElement): boolean {
  if (el.hasAttribute("tabindex")) return focusAndReveal(el);
  el.setAttribute("tabindex", "-1");
  const giveBack = () => {
    queueMicrotask(() => {
      if (document.activeElement === el) el.addEventListener("blur", giveBack, { once: true });
      else el.removeAttribute("tabindex");
    });
  };
  if (!focusAndReveal(el)) {
    el.removeAttribute("tabindex");
    return false;
  }
  el.addEventListener("blur", giveBack, { once: true });
  return true;
}

function land(
  targets: readonly FocusTarget[],
  leaving: Element | null,
  fallback: boolean,
): HTMLElement | null {
  for (const target of targets) {
    const el = resolve(target, leaving);
    if (el && focusAndReveal(el)) return el;
  }
  if (!fallback) return null;
  for (const next of SCREEN_FALLBACKS) {
    const el = next(leaving);
    if (isLive(el, leaving) && (next === screenRoot ? focusLandmark(el) : focusAndReveal(el))) return el;
  }
  return null;
}

/**
 * The console's one focus return. Call it in the commit that removed what held focus: from a layout effect after
 * it, or from the layout cleanup of what goes (with `leaving`, before React takes its DOM away). When focus is
 * lost (or `when: "always"`), focuses the first target that is still there (or its successor by key), else the
 * screen's main control, and reveals it. Returns what took focus, or null when nothing moved.
 */
export function returnFocus(
  targets: FocusTarget | readonly FocusTarget[],
  options: ReturnFocusOptions = {},
): HTMLElement | null {
  const leaving = options.leaving ?? null;
  const fallback = options.fallback ?? true;
  if ((options.when ?? "lost") === "lost" && !focusIsLost(leaving)) return null;
  const list = listOf(targets);
  const landed = land(list, leaving, fallback);
  if (leaving) {
    // The same commit may take the target away too (a route change removes the screen with its drawer): once it
    // has finished, before anything paints, a focus that fell to <body> after all goes to what is there now.
    queueMicrotask(() => {
      if (focusIsLost()) land(list, null, fallback);
    });
  }
  return landed;
}

/** The removed control as a place: its successor by key (the same control drawn again) is found first. */
function placeOf(el: Element): FocusPlace | null {
  return el instanceof HTMLElement ? { el, key: focusKey(el) } : null;
}

/**
 * Watches `root` (an element from a callback ref): when the control focused inside it is removed and focus fell
 * to <body>, focuses that control's successor by key (the slab remounted at rest under a new key), else
 * `target()` (or the screen's main control). It checks after every commit of the component that calls it (a
 * layout effect), and after any other commit that changes `root` (a mutation observer, still before the browser
 * paints). A focus the person moved elsewhere is left alone.
 */
export function useFocusAfterRemoval(
  root: HTMLElement | null,
  target: () => FocusTarget | readonly FocusTarget[],
): void {
  const targetRef = useRef(target);
  targetRef.current = target;
  const rootRef = useRef(root);
  rootRef.current = root;
  const watched = useRef<Element | null>(null);
  const after = useRef(() => {
    const last = watched.current;
    if (!last || last.isConnected || !focusIsLost()) return;
    watched.current = null;
    // `root` itself went (the trace folded away): what owned it hands focus back, not this watch.
    if (!rootRef.current?.isConnected) return;
    returnFocus([placeOf(last), ...listOf(targetRef.current())]);
  });

  useEffect(() => {
    const el = root;
    if (!el) return;
    watched.current = el.contains(document.activeElement) ? document.activeElement : null;
    const onIn = (event: FocusEvent) => {
      watched.current = event.target instanceof Element ? event.target : null;
    };
    const onOut = (event: FocusEvent) => {
      // Focus went somewhere else on purpose: nothing to keep.
      if (event.relatedTarget instanceof Node && !el.contains(event.relatedTarget)) watched.current = null;
    };
    const check = after.current;
    const observer = new MutationObserver(check);
    el.addEventListener("focusin", onIn);
    el.addEventListener("focusout", onOut);
    observer.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener("focusin", onIn);
      el.removeEventListener("focusout", onOut);
      observer.disconnect();
    };
  }, [root]);

  // In the commit itself: the caller re-rendered, so whatever it removed is gone by now.
  useLayoutEffect(() => {
    after.current();
  });
}

/**
 * Hands focus on from the element in `ref` when it leaves while it holds focus (Reset once the session has gone,
 * "Use the phone" once the phone rises): from its layout cleanup, which React runs before it takes the element's
 * DOM away, so focus is on `targets()` (or the screen's main control) in that commit, never on <body>, not even
 * between removeChild and the next microtask. For a successor already in the document; one that the same commit
 * inserts (the committed value's Next link) is useFocusAfterRemoval's. A focus held elsewhere is left alone.
 */
export function useFocusOnLeave(
  ref: RefObject<HTMLElement | null>,
  targets: () => FocusTarget | readonly FocusTarget[] = () => null,
): void {
  const latest = useRef(targets);
  latest.current = targets;
  useLayoutEffect(() => {
    const el = ref.current;
    return () => {
      if (el) returnFocus(latest.current(), { leaving: el });
    };
  }, [ref]);
}

// ------------------------------------------------------------------------------------------- the guard

/** Library focus plumbing, never a place to land: Base UI's and AG Grid's focus guards. */
const NOT_A_PLACE = "[data-base-ui-focus-guard], .ag-tab-guard, [aria-hidden='true']";

/** Where a removed control's neighbours may take its focus: inside a screen, or a drawer beside it. */
const REGIONS = "#fsc-main, main, .fsc-drawer";

/** AG Grid draws a cell again on its own and focuses the new one: the grid's own focus, given a frame. */
const GRID = ".ag-root-wrapper";

/** It can no longer hold focus: gone from the document, turned disabled, hidden, or no longer rendered. */
function cannotHoldFocus(el: HTMLElement): boolean {
  return !el.isConnected || el.matches(":disabled") || el.closest("[hidden]") !== null || !rendered(el);
}

/**
 * The control nearest where a removed one stood: the first control in the nearest container that stayed, inside
 * a screen or a drawer, outside a grid (the screen or the drawer itself is the screen's main control's turn).
 */
function neighbourOf(chain: readonly Element[]): HTMLElement | null {
  for (const at of chain) {
    if (!at.isConnected || at.closest(GRID)) continue;
    if (at.matches(REGIONS) || !at.closest(REGIONS)) return null;
    for (const el of at.querySelectorAll<HTMLElement>(TABBABLE)) {
      if (isLive(el) && rendered(el) && !el.closest(NOT_A_PLACE)) return el;
    }
  }
  return null;
}

interface Held {
  readonly place: FocusPlace;
  /** Its ancestors when it took focus, nearest first: the containers that may still stand once it has gone. */
  readonly chain: readonly Element[];
}

/**
 * The console's backstop, mounted once at the root (every surface: the stage, Proof, the brand view, /ops): the
 * focused control taken away by a commit that hands nothing on (a link that changes the route takes its screen,
 * and itself, away; a control a screen swaps for its answer), or one the browser stops letting hold focus (turned
 * disabled), leaves focus on its successor by key, else the first control of the nearest container that stayed
 * in the screen or drawer, else the screen's main control. It runs from a mutation observer (or, for a control
 * turned disabled, the focusout that follows), at the first microtask: after the commit's own layout effects,
 * which hand focus on themselves where they know better, and before the browser paints or a key lands. With
 * nothing to land on yet (the next page draws a commit later, a lazy route), it waits: the first commit that
 * draws a place takes the focus, until the person acts or focuses something themselves. Focus the person let go
 * of (a press on the page) is theirs, and a window that lost focus keeps its focused control.
 */
export function useFocusGuard(): void {
  useEffect(() => {
    let held: Held | null = null;
    let waiting = false;
    const record = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement) || target === document.body) return;
      const chain: Element[] = [];
      for (let at = target.parentElement; at && at !== document.body; at = at.parentElement) chain.push(at);
      held = { place: { el: target, key: focusKey(target) }, chain };
    };
    const land = (was: Held) => {
      const at = returnFocus([was.place, () => neighbourOf(was.chain)]);
      if (!at) {
        if (focusIsLost()) waiting = true;
        return;
      }
      // The control drawn again is still the person's place; anywhere else is the backstop's.
      placed = was.place.key && at.matches(was.place.key) ? null : at;
    };
    const handOn = () => {
      const was = held;
      if (!was || !focusIsLost()) return;
      held = null;
      const inGrid = was.chain.some((at) => at.matches(GRID) && at.isConnected);
      if (inGrid && !returnFocus(was.place, { fallback: false })) {
        // The grid draws the cell again on its own, and gives it back its focus: a frame for that, then the rest.
        requestAnimationFrame(() => {
          if (focusIsLost()) land(was);
        });
        return;
      }
      land(was);
    };
    const onIn = (event: FocusEvent) => {
      waiting = false;
      if (event.target !== placed) placed = null;
      record(event.target);
    };
    const ownInput = () => {
      waiting = false;
      placed = null;
    };
    const onOut = (event: FocusEvent) => {
      const el = event.target;
      if (event.relatedTarget !== null || el !== held?.place.el) return;
      // Focus left for nowhere: a press on the page, the window losing focus, or the browser's focus fixup (the
      // control turned disabled or stopped rendering). Told apart at the next microtask, before anything paints.
      queueMicrotask(() => {
        if (held?.place.el !== el || !focusIsLost()) return;
        if (cannotHoldFocus(held.place.el)) handOn();
        else if (document.activeElement === document.body) held = null;
      });
    };
    const observer = new MutationObserver(() => {
      if (held && !held.place.el.isConnected) {
        handOn();
        return;
      }
      if (!waiting || !focusIsLost()) return;
      const at = returnFocus(null);
      if (!at) return;
      waiting = false;
      placed = at;
    });
    record(document.activeElement);
    document.addEventListener("focusin", onIn, true);
    document.addEventListener("focusout", onOut, true);
    for (const type of ["keydown", "pointerdown"] as const) document.addEventListener(type, ownInput, true);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("focusin", onIn, true);
      document.removeEventListener("focusout", onOut, true);
      for (const type of ["keydown", "pointerdown"] as const)
        document.removeEventListener(type, ownInput, true);
      observer.disconnect();
      placed = null;
    };
  }, []);
}

/**
 * Rendered inside a Base UI dialog's popup (given `finalFocus={false}`: its own return comes after Base UI has
 * already taken the popup's portal away, so a frame has focus on <body>, and it is never revealed). Remembers what
 * held focus as the popup first rendered, and hands focus back to that opener (or its successor) in the commit
 * that closes the dialog (`open` turns false; the popup is still there while it animates out), or at the latest
 * in the layout cleanup of the commit that removes it. `leaving` finds the popup, still in the document.
 */
export function FocusReturn({
  open,
  leaving,
}: {
  readonly open: boolean;
  readonly leaving: () => Element | null;
}): null {
  const opener = useRef<FocusPlace | null | undefined>(undefined);
  if (opener.current === undefined) opener.current = rememberFocus(document.activeElement, leaving());
  const find = useRef(leaving);
  find.current = leaving;
  useLayoutEffect(() => {
    if (!open) returnFocus(opener.current ?? null, { leaving: find.current() });
  }, [open]);
  useLayoutEffect(() => {
    const from = opener.current ?? null;
    return () => {
      returnFocus(from, { leaving: find.current() });
    };
  }, []);
  return null;
}

/** How long `focusInto` keeps trying: well past any transition's delay, even on a loaded machine. */
export const FOCUS_INTO_PATIENCE_MS = 2000;

/**
 * Moves focus into `container`, to `target()`: now (call it in the commit that made the container live), then
 * again each animation frame while it has not landed there, up to `patienceMs`. A browser refuses focus to a
 * control it does not render (visibility: hidden while a transition's delay runs) without a word, and the control
 * that held focus may be going inert, so focus would fall to <body>. It keeps trying only while focus is lost (on
 * <body>, or held under an inert subtree) or still where it was at the call; a focus the person moved somewhere
 * live is left alone. Returns the cancel (for the effect's cleanup).
 */
export function focusInto(
  container: HTMLElement,
  target: () => HTMLElement | null,
  patienceMs: number = FOCUS_INTO_PATIENCE_MS,
): () => void {
  const from = document.activeElement;
  const deadline = performance.now() + patienceMs;
  let frame = 0;
  const attempt = () => {
    frame = 0;
    if (!container.isConnected) return;
    const active = document.activeElement;
    if (active && container.contains(active)) return;
    if (!focusIsLost() && active !== from) return;
    const el = target();
    if (el && container.contains(el) && focusAndReveal(el)) return;
    if (performance.now() < deadline) frame = requestAnimationFrame(attempt);
  };
  attempt();
  return () => {
    if (frame) cancelAnimationFrame(frame);
  };
}
