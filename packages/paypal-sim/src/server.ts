// Standalone HTTP server (Hono on @hono/node-server).
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import type { SimulatorOptions } from "./config.js";
import { createSimulator, type Simulator } from "./simulator.js";

export interface StartedServer {
  url: string;
  port: number;
  simulator: Simulator;
  close(): Promise<void>;
}

/**
 * Starts the simulator on `host:port` (port 0 picks a free port). Unless `publicBaseUrl` is given, the
 * simulator's pay pages and cert URLs use the bound address.
 */
export async function startServer(
  opts: SimulatorOptions & { port?: number; host?: string } = {},
): Promise<StartedServer> {
  const host = opts.host ?? "127.0.0.1";
  const requestedPort = opts.port ?? 4010;
  let simulator: Simulator | undefined;
  const server = serve({
    fetch: (req, env) => {
      if (!simulator) return new Response("starting", { status: 503 });
      return simulator.fetch(req, env);
    },
    port: requestedPort,
    hostname: host,
    overrideGlobalObjects: false,
  });
  await new Promise<void>((resolve, reject) => {
    if (server.listening) resolve();
    else {
      server.once("listening", () => resolve());
      server.once("error", reject);
    }
  });
  const port = (server.address() as AddressInfo).port;
  const shownHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const url = `http://${shownHost}:${port}`;
  simulator = await createSimulator({ ...opts, publicBaseUrl: opts.publicBaseUrl ?? url });
  const sim = simulator;
  return {
    url,
    port,
    simulator: sim,
    async close() {
      await sim.close();
      await new Promise<void>((resolve) => {
        (server as { closeAllConnections?: () => void }).closeAllConnections?.();
        server.close(() => resolve());
      });
    },
  };
}
