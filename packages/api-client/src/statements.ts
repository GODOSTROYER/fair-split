// Typed member lookup and served statement projection, checked against fs-api's mounted schemas.
import type { Lang } from "@fairsplit/contracts";
import { z } from "zod";
import type { ApiClient, CallOptions } from "./client.js";
import type { RouteSpec } from "./routes.js";
import { StatementView } from "./statement-shapes.js";

export { MobileStatement, StatementView } from "./statement-shapes.js";
export const MemberStatementLine = z.strictObject({ lineId: z.uuid() });
export type MemberStatementLine = z.infer<typeof MemberStatementLine>;
export const StatementQuery = z.strictObject({ lang: z.enum(["ceb", "fil", "en"]).optional() });

export const STATEMENT_ROUTES = {
  memberStatementLine: {
    method: "GET",
    path: "/v1/members/me/statement-line",
    auth: "frame_or_session",
    request: null,
    response: MemberStatementLine,
    success: [200],
  },
  statement: {
    method: "GET",
    path: "/v1/statements/:lineId",
    auth: "public",
    request: StatementQuery,
    response: StatementView,
    success: [200],
  },
} as const satisfies Record<string, RouteSpec>;

export interface StatementRouteMethods {
  memberStatementLine(options?: CallOptions): Promise<MemberStatementLine>;
  statement(
    args: { params: { lineId: string }; query?: { lang?: Lang } } & CallOptions,
  ): Promise<StatementView>;
}

export function statementRoutes(api: ApiClient): StatementRouteMethods {
  return {
    memberStatementLine: (options = {}) => {
      const route = STATEMENT_ROUTES.memberStatementLine;
      return api.request({
        ...options,
        name: "statements.memberStatementLine",
        method: route.method,
        path: route.path,
        schema: route.response,
      });
    },
    statement: ({ params, query, ...options }) => {
      const route = STATEMENT_ROUTES.statement;
      return api.request({
        ...options,
        name: "statements.statement",
        method: route.method,
        path: route.path,
        params,
        ...(query?.lang ? { query: { lang: query.lang } } : {}),
        schema: route.response,
      });
    },
  };
}
