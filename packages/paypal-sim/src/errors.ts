// PayPal error envelopes. Invoicing v2 and Reporting use the fixed name/message pairs of their specs'
// error_4xx schemas; Payouts and Webhooks (v1) use free-form names plus `information_link`.
import type { ValidationIssue } from "./contract/openapi.js";
import type { JsonObject } from "./state.js";

export type ApiFamily = "invoicing" | "reporting" | "payouts" | "webhooks" | "oauth";

const V2_ERRORS: Record<number, [string, string]> = {
  400: ["INVALID_REQUEST", "Request is not well-formed, syntactically incorrect, or violates schema."],
  401: [
    "AUTHENTICATION_FAILURE",
    "Authentication failed due to missing authorization header, or invalid authentication credentials.",
  ],
  403: ["NOT_AUTHORIZED", "Authorization failed due to insufficient permissions."],
  404: ["RESOURCE_NOT_FOUND", "The specified resource does not exist."],
  409: ["RESOURCE_CONFLICT", "The server has detected a conflict while processing this request."],
  415: ["UNSUPPORTED_MEDIA_TYPE", "The server does not support the request payload's media type."],
  422: [
    "UNPROCESSABLE_ENTITY",
    "The requested action could not be performed, semantically incorrect, or failed business validation.",
  ],
  500: ["INTERNAL_SERVER_ERROR", "An internal server error occurred."],
  503: ["SERVICE_UNAVAILABLE", "Service Unavailable."],
};

const INFO_LINK: Record<ApiFamily, string> = {
  invoicing: "https://developer.paypal.com/docs/api/invoicing/v2/",
  reporting: "https://developer.paypal.com/docs/api/transaction-search/v1/",
  payouts: "https://developer.paypal.com/docs/api/payments.payouts-batch/#errors",
  webhooks: "https://developer.paypal.com/docs/api/webhooks/#errors",
  oauth: "https://developer.paypal.com/api/rest/authentication/",
};

export class SimHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: JsonObject,
    readonly headers: Record<string, string> = {},
  ) {
    super(typeof body.name === "string" ? body.name : `HTTP ${status}`);
  }
}

export interface ErrorDetail {
  field?: string;
  value?: string;
  location?: "body" | "path" | "query";
  issue: string;
  description?: string;
  link?: JsonObject[];
}

function detailJson(d: ErrorDetail): JsonObject {
  const out: JsonObject = {};
  if (d.field !== undefined) out.field = d.field;
  if (d.value !== undefined) out.value = d.value;
  if (d.location !== undefined) out.location = d.location;
  out.issue = d.issue;
  if (d.description !== undefined) out.description = d.description;
  if (d.link !== undefined) out.link = d.link;
  return out;
}

/** v2 (Invoicing / Reporting) error with the spec's fixed name and message for the status. */
export function v2Error(
  family: "invoicing" | "reporting",
  status: number,
  debugId: string,
  details: ErrorDetail[] = [],
): SimHttpError {
  const [name, message] = V2_ERRORS[status] ?? V2_ERRORS[500] ?? ["INTERNAL_SERVER_ERROR", "error"];
  const body: JsonObject = { name, message, debug_id: debugId };
  if (details.length > 0 && status !== 500 && status !== 503) body.details = details.map(detailJson);
  const issue = details[0]?.issue;
  body.links = [
    {
      href: `${INFO_LINK[family]}${issue ? `#error-${issue}` : ""}`,
      rel: "information_link",
      method: "GET",
    },
  ];
  return new SimHttpError(status, body);
}

/** v1 (Payouts / Webhooks) error: free-form name and message. */
export function v1Error(
  family: "payouts" | "webhooks",
  status: number,
  name: string,
  message: string,
  debugId: string,
  details: ErrorDetail[] = [],
): SimHttpError {
  const body: JsonObject = { name, message, debug_id: debugId, information_link: INFO_LINK[family] };
  if (details.length > 0) body.details = details.map(detailJson);
  body.links = [];
  return new SimHttpError(status, body);
}

export function oauthError(status: number, error: string, description: string): SimHttpError {
  return new SimHttpError(status, { error, error_description: description });
}

/** Schema violations: PayPal's documented 400 INVALID_REQUEST with `details[].issue`. */
export function invalidRequest(family: ApiFamily, debugId: string, issues: ValidationIssue[]): SimHttpError {
  const details: ErrorDetail[] = issues.map((i) => ({
    field: i.field,
    ...(i.value !== undefined ? { value: i.value } : {}),
    location: i.location,
    issue: i.issue,
    description: i.description,
  }));
  if (family === "invoicing" || family === "reporting") return v2Error(family, 400, debugId, details);
  if (family === "oauth") {
    const grant = issues.find((i) => i.field === "/grant_type");
    if (grant)
      return oauthError(
        400,
        "unsupported_grant_type",
        grant.issue === "MISSING_REQUIRED_PARAMETER" ? "Grant Type is NULL" : "Unsupported grant type",
      );
    return oauthError(400, "invalid_request", issues[0]?.description ?? "invalid request");
  }
  return v1Error(
    family,
    400,
    "INVALID_REQUEST",
    "Request is not well-formed, syntactically incorrect, or violates schema.",
    debugId,
    details,
  );
}

export function notFound(family: ApiFamily, debugId: string, what = "resource"): SimHttpError {
  if (family === "invoicing" || family === "reporting")
    return v2Error(family, 404, debugId, [
      { location: "path", issue: "INVALID_RESOURCE_ID", description: `Requested ${what} ID was not found.` },
    ]);
  if (family === "oauth") return oauthError(404, "not_found", "Not found");
  return v1Error(family, 404, "INVALID_RESOURCE_ID", `Requested ${what} ID was not found.`, debugId);
}

export function unauthorized(family: ApiFamily, debugId: string): SimHttpError {
  if (family === "invoicing" || family === "reporting") return v2Error(family, 401, debugId);
  if (family === "oauth") return oauthError(401, "invalid_client", "Client Authentication failed");
  return v1Error(
    family,
    401,
    "AUTHENTICATION_FAILURE",
    "Authentication failed due to invalid authentication credentials or a missing Authorization header.",
    debugId,
  );
}

export function forbidden(family: ApiFamily, debugId: string, scope: string): SimHttpError {
  if (family === "invoicing" || family === "reporting")
    return v2Error(family, 403, debugId, [
      { issue: "PERMISSION_DENIED", description: `The access token lacks the required scope ${scope}.` },
    ]);
  if (family === "oauth") return oauthError(403, "access_denied", "Access denied");
  return v1Error(
    family,
    403,
    "NOT_AUTHORIZED",
    "Authorization failed due to insufficient permissions.",
    debugId,
    [{ issue: "REQUIRED_SCOPE_MISSING", description: `The access token lacks the required scope ${scope}.` }],
  );
}

export function malformedJson(family: ApiFamily, debugId: string): SimHttpError {
  return invalidRequest(family, debugId, [
    {
      field: "/",
      location: "body",
      issue: "MALFORMED_REQUEST_JSON",
      description: "The request JSON is not well formed.",
    },
  ]);
}
