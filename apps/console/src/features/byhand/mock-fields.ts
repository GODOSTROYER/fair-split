// Mock-only. The one fs-api that can already say which field a by-hand entry goes to is the mock API: its
// world is the session run, and it hands that world to the page as `window.__fsMock` (src/data/mock/browser.ts,
// mock builds only). Against fs-api there is no handle, so this reads nothing and the by-hand slab waits for
// IC-01's field IDs instead of guessing one. Nothing here copies the mock's own ID scheme.

import type { FieldRef } from "./field-id.js";

/** The run's fields as the mock's world holds them, or null outside the mock. */
export function mockWorldFields(): readonly FieldRef[] | null {
  if (typeof window === "undefined") return null;
  const world = window.__fsMock?.mock.world;
  return world ? world.fields() : null;
}
