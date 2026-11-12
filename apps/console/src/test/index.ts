// The console's test kit (shared, frozen with the shell; SPLIT.md "Tests"). Slices import from here:
//   renderConsole      the whole console on a route, over a mock world, no network
//   createTestWorld    api-client's mock API over the seed (manual pace) + a driver acting as the people
//   createTestRuntime  a data runtime over a world (for hook and component tests)
//   startMockServer    msw in Node over a world, for HTTP and SSE tests (unhandled requests fail)
//   expectNoAxeViolations / axeViolations   axe-core 4.13.0, WCAG 2.2 AA tags, contrast off in jsdom
//   tracedPhases / momentPhase / clearMomentTrace   moment assertions from __fsMoments and data-moment-phase
//   setViewport / resizeTo / STAGE_WIDTHS   the stage's breakpoints
//   recordRequests     an msw handler that logs every request from the first render on
//   timersBeforeCommit zero-delay timers fire before React's scheduled commit (a loaded machine's order)
//   focusAcrossRemoval where focus is in the commit that removes a drawer or trace, and on the frames after it
//   fakeResizeObserver a layout change jsdom never makes, delivered to the observers watching it
//   openStageMenu / stageMenuItem / clickStageMenuItem   the chevron menu's items (the run log, sound, Reset: round 4)

export { axeViolations, describeViolations, expectNoAxeViolations } from "./axe.js";
export { type FocusSamples, focusAcrossRemoval } from "./focus.js";
export { type FakeLayout, fakeResizeObserver } from "./layout.js";
export { clearMomentTrace, momentPhase, phasesAreCatalogued, tracedPhases } from "./moments.js";
export { type MockServer, startMockServer, TEST_ORIGIN } from "./msw.js";
export { type RenderConsoleOptions, type RenderedConsole, renderConsole } from "./render.js";
export { type RequestLog, recordRequests, type SentRequest } from "./requests.js";
export {
  clickStageMenuItem,
  closeStageMenu,
  openStageMenu,
  queryStageMenuItem,
  stageMenuItem,
} from "./stage-menu.js";
export { timersBeforeCommit } from "./timers.js";
export { resetViewport, resizeTo, STAGE_WIDTHS, setViewport } from "./viewport.js";
export {
  createTestHttpAdapter,
  createTestRuntime,
  createTestWorld,
  seedSnapshot,
  type TestWorld,
} from "./world.js";
