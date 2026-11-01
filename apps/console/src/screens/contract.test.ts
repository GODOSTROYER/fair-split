// The frozen contract between the shell's route files and the slices' screen modules (SPLIT.md): every
// src/screens/<SCREEN-ID>/index.tsx exports the components the routes render. A slice may rewrite a screen
// entirely, but it keeps these exports and their props (contract.ts), or this test fails.

import { SCREENS } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import { CONSOLE_SCREEN_IDS, SCREEN_SLICE, SCREEN_STATES } from "../lib/screens.js";

const modules = import.meta.glob<Record<string, unknown>>("./*/index.tsx", { eager: true });

const EXPORTS: Readonly<Record<string, readonly string[]>> = {
  "W-JG-01": ["Screen", "StageExtras"],
  "W-AU-01": ["Screen"],
  "W-TR-01": ["Screen"],
  "W-TR-02": ["Screen"],
  "W-TR-03": ["Screen"],
  "W-TR-04": ["Screen"],
  "W-TR-05": ["Screen"],
  "W-TR-06": ["Screen"],
  "W-TR-07": ["Screen"],
  "W-TR-08": ["Screen"],
  "W-TR-09": ["Screen", "PrintScreen"],
  "W-TR-10": ["ShortcutSheet"],
  "W-PF-01": ["Screen"],
  "W-BR-01": ["Screen"],
  "W-OP-01": ["Screen"],
};

describe("screen modules", () => {
  it("one module per console screen in the register, and nothing else", () => {
    const ids = Object.keys(modules).map((p) => p.split("/")[1]);
    expect(ids.sort()).toEqual([...CONSOLE_SCREEN_IDS].sort());
    for (const id of CONSOLE_SCREEN_IDS) expect(SCREENS[id].surface).toBe("web");
  });

  it.each(Object.entries(EXPORTS))("%s exports %s", (id, names) => {
    const mod = modules[`./${id}/index.tsx`];
    for (const name of names) expect(typeof mod?.[name], `${id}.${name}`).toBe("function");
  });

  it("every screen has its S1 states and a slice that owns it", () => {
    for (const id of CONSOLE_SCREEN_IDS) {
      expect(SCREEN_STATES[id].length, id).toBeGreaterThan(0);
      expect(["season", "runs", "proof", "shell"]).toContain(SCREEN_SLICE[id]);
    }
  });
});
