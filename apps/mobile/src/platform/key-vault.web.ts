/**
 * Web frames and a judge's own phone browser (C-13): the browser makes an ephemeral Ed25519 key for each judge
 * session, named `fs-ernesto-demo-{6}` and labelled "Demo key (this browser)" wherever it shows. It lives in memory
 * only and is gone with the tab or the next `fs.reset`. The hold on the Pirmahi slab is the presence step; the web
 * promises no biometric.
 */
import { createDemoVault } from "../lib/signing";
import { randomBytes } from "./random";

export type { BiometricClass, KeyMeta, KeyVault } from "../lib/signing";

export const keyVault = createDemoVault(randomBytes);
