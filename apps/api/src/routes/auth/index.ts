// src/routes/auth: owned by the JUDGE slice (apps/api/SPLIT.md).
// Credential issuance routes: console and frame tokens (2 h, IC-12, never in URLs), single-use pairing (QR 10 min or a 6-digit code), member links `/s/:token` and brand links `/b/:token`, the statement-link exchange, operator login (scrypt). Wire formats live in src/credentials/verify/codec.ts.
// IC-01 commands here: createPairing, claimPairing (each answers 501 NOT_IMPLEMENTED until filled in).
// Replace `notImplemented` with a handler; the shell validates input, credentials and the response contract.
import { notImplemented } from "../../lib/command.js";
import { defineRouteFolder } from "../../lib/slice.js";

export default defineRouteFolder({
  folder: "auth",
  commands: {
    createPairing: notImplemented,
    claimPairing: notImplemented,
  },
});
