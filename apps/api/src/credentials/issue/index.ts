// Credential issuance (judge slice). The verify side is src/credentials/verify (shell); both use one codec.
// Other slices import from here, never from the files below:
//   - PROOF (print, statements): `issueMemberLink` + `recordLinkIssued` for the 80 mm slip and the statement;
//   - the shell's server.ts: `dbCredentialStore(db, { isLinkRevoked: (jti) => isLinkRevoked(db, jti) })`.
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
  newJti,
  recordLinkIssued,
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
  pairingTokenSha256,
} from "./pairing.js";
export {
  canIssue,
  ISSUER_ROLES,
  isPairableRole,
  PAIRABLE_ROLES,
  type PairableRole,
  type PersonaRef,
  type PersonaResult,
  parsePersonaRef,
  resolvePersona,
} from "./personas.js";
export {
  CONSOLE_PERSONA,
  type MintedToken,
  type MintTokenInput,
  mintBearerToken,
  revokeWorkspaceTokens,
  sessionOfWorkspace,
  tokenExpiry,
} from "./tokens.js";
