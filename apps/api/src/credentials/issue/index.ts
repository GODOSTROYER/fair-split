// Credential issuance (judge slice). The verify side is src/credentials/verify (shell); both use one codec.
// Other slices import from here, never from the files below:
//   - PROOF (print, statements): `issueMemberLink` + `recordLinkIssued` for the statement, `recordPrintedLink`
//     for the 80 mm slip's QR (recorded once, the first time it is printed, so it can be revoked);
//     a route that returns a link calls `refuseReplayOfSecret(ctx.header)` first (no secret in idempotency_keys);
//   - the shell's server.ts: `dbCredentialStore(db, { isLinkRevoked: (workspaceId, jti) => isLinkRevoked(db, workspaceId, jti) })`, so a
//     revoked statement link stops opening every route, not only GET /v1/credential.
export {
  type JudgeCookieRead,
  judgeCookieValue,
  readJudgeCookie,
  setJudgeCookie,
} from "./judge-cookie.js";
export {
  checkLink,
  type IssuedLink,
  isLinkRevoked,
  issueBrandLink,
  issueMemberLink,
  type LinkCheck,
  type LinkKind,
  linkWasIssued,
  liveLinksOfLine,
  newJti,
  recordLinkIssued,
  recordPrintedLink,
  revokeLink,
} from "./links.js";
export {
  clearOperatorCookie,
  DEFAULT_SCRYPT,
  hashOperatorPassword,
  parseScryptHash,
  setOperatorCookie,
  verifyOperatorPassword,
} from "./operator.js";
export {
  type CreatedPairing,
  code6Digest,
  consumePairing,
  createPairingRow,
  findPairing,
  generateCode6,
  generatePairingToken,
  isPairingToken,
  PAIRING_TOKEN_PREFIX,
  type PairingLookup,
  pairingCap,
  pairingTokenSha256,
} from "./pairing.js";
export {
  canIssue,
  ISSUER_ROLES,
  isPairableRole,
  mayPair,
  PAIRABLE_ROLES,
  type PairableRole,
  type PersonaRef,
  type PersonaResult,
  parsePersonaRef,
  resolvePersona,
} from "./personas.js";
export { refuseReplayOfSecret } from "./secrets.js";
export {
  CONSOLE_PERSONA,
  type MintedToken,
  type MintTokenInput,
  mintBearerToken,
  revokeWorkspaceTokens,
  sessionOfWorkspace,
  tokenExpiry,
} from "./tokens.js";
