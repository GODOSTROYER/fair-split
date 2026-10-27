// Loaded before every test file (vitest.config.ts `setupFiles`). A server in a test binds port 0 and reads the
// bound port back (`server.address().port`, `StartedServer.port`), so concurrent runs of this suite, and other
// worktrees' suites, never clash on a port. This makes it a rule: listen() on a fixed TCP port throws.
import { Server } from "node:net";

/** The fixed TCP port a `server.listen(...)` call asks for, or null (port 0, no port, a pipe path or a handle). */
export function fixedPort(args: readonly unknown[]): number | null {
  const [first] = args;
  let port: unknown = first;
  if (typeof first === "object" && first !== null) {
    const options = first as { port?: unknown; path?: unknown };
    if (options.path !== undefined) return null;
    port = options.port;
  } else if (typeof first === "string" && Number.isNaN(Number(first))) {
    return null; // a pipe path
  }
  if (typeof port !== "number" && typeof port !== "string") return null;
  const n = Number(port);
  return Number.isNaN(n) || n === 0 ? null : n;
}

const GUARD = Symbol.for("fairsplit.paypal-sim.test.ephemeral-ports");
const proto = Server.prototype as Server & { [GUARD]?: true };
if (!proto[GUARD]) {
  const listen = proto.listen as (this: Server, ...args: unknown[]) => Server;
  proto.listen = function listenOnPortZeroOnly(this: Server, ...args: unknown[]): Server {
    const port = fixedPort(args);
    if (port !== null)
      throw new Error(
        `tests bind port 0 (an ephemeral port) and read the bound port back; refusing listen() on fixed port ${port}`,
      );
    return listen.apply(this, args);
  } as Server["listen"];
  proto[GUARD] = true;
}
