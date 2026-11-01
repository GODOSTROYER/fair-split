import { getSnapshot } from "@fairsplit/api-client/seed";
import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { createDataRuntime, DataProvider } from "../../data/provider.js";
import { createTestRuntime } from "../../test/index.js";
import { useProofPage } from "./useProof.js";

describe("Proof metrics on fs-api", () => {
  it("uses the requested run's metrics rather than the season's hold amounts", async () => {
    const snapshot = getSnapshot();
    let reads = 0;
    const world = createTestRuntime(
      undefined,
      [
        http.get("*/v1/proof/:runSlug/metrics", () => {
          reads++;
          return HttpResponse.json({
            runSlug: snapshot.proof.runSlug,
            holds: { caught: 3, keptForMembers: { cents: 2114, display: "US$21.14" } },
          });
        }),
      ],
      async () => ({ ...snapshot, figures: { ...snapshot.figures, redirectedCents: 99999 } }),
    );
    const runtime = createDataRuntime({ ...world.adapter, source: "http" }, world.runtime.client);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DataProvider runtime={runtime}>{children}</DataProvider>
    );
    const { result } = renderHook(
      () =>
        useProofPage(snapshot.proof.runSlug, {
          bundle: snapshot.proof,
          provenance: "simulated_rail",
          isPending: false,
          error: null,
          queryKey: ["test"],
          refetch: () => undefined,
        }),
      { wrapper },
    );
    await waitFor(() => expect(reads).toBe(1));
    await waitFor(() => expect(result.current.figures?.holds).toMatchObject({ caught: 3, keptCents: 2114 }));
    runtime.client.clear();
    runtime.hub.closeAll();
  });
});
