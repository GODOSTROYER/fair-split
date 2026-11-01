import { describe, expect, it } from "vitest";
import { createApiClient, type FetchLike } from "./client.js";
import { isContractError } from "./errors.js";
import { STATEMENT_ROUTES, statementRoutes } from "./statements.js";

const LINE = "0190f3c2-6c1e-7c3a-8d2b-1a2b3c4d5e6f";

function serving(body: unknown) {
  const seen: string[] = [];
  const fetch: FetchLike = async (input) => {
    seen.push(String(input));
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  };
  return { seen, routes: statementRoutes(createApiClient({ baseUrl: "http://fs.test", fetch })) };
}

describe("typed member statement reads", () => {
  it("looks up the member's line through the mounted authenticated route", async () => {
    const { seen, routes } = serving({ lineId: LINE });
    expect(await routes.memberStatementLine()).toEqual({ lineId: LINE });
    expect(seen).toEqual(["http://fs.test/v1/members/me/statement-line"]);
    expect(STATEMENT_ROUTES.memberStatementLine.auth).toBe("frame_or_session");
  });

  it("rejects a lookup response that cannot identify a statement line", async () => {
    const error = await serving({ lineId: "not-a-uuid" })
      .routes.memberStatementLine()
      .catch((e) => e);
    expect(isContractError(error)).toBe(true);
  });

  it("asks for the selected line and language and rejects an incomplete projection", async () => {
    const { seen, routes } = serving({ lineId: LINE, mobile: {} });
    const error = await routes
      .statement({ params: { lineId: LINE }, query: { lang: "fil" } })
      .catch((e) => e);
    expect(seen).toEqual([`http://fs.test/v1/statements/${LINE}?lang=fil`]);
    expect(isContractError(error)).toBe(true);
  });
});
