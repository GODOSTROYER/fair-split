// A route that returns a bearer secret (console, frame and device tokens, pairing URLs, signed links) never
// takes an Idempotency-Key: the shell stores a keyed POST's response so a retry can replay it (S3.10), and
// that would put the secret in plaintext in `idempotency_keys` and hand it to any credential of the workspace
// that sends the same key. S3.8 stores secrets as sha256 only. The shell claims the key before a handler
// runs, so refusing here stores this 400 (no secret) under the key, and a retry replays the same 400.
import { problem } from "../../lib/problem.js";

export function refuseReplayOfSecret(header: (name: string) => string | undefined): void {
  if (header("idempotency-key") === undefined) return;
  throw problem.validation(
    "This request returns a secret, which is never stored for replay. Send it again without an Idempotency-Key.",
    [
      {
        path: "headers.idempotency-key",
        message: "not accepted on a request that returns a secret",
        code: "not_accepted",
      },
    ],
  );
}
