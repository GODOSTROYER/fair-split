// Key 1 of MM-5 (S3.8, register C-13). In Judge Mode the treasurer signs with a session-only demo key made in
// this browser: WebCrypto's non-extractable Ed25519 where the browser has it (not even this page can read the
// private half), else a labelled demo key from @noble/curves held in memory for the session. Before it signs
// anything the page proves it holds the key by signing fs-api's registration statement, and fs-api registers it
// as a `web_demo` key with C-13's ID, `fs-analyn-demo-{6}`: approvals verify against that registry, never against a
// key the page presents, and a demo ID can never be a real key's. Only the signature and the public half ever leave
// the page. The treasurer's own key, `fs-analyn-w1` (kind `web`), is another key: made and registered from /ops
// (src/lib/keystore.ts), and never made in a judge's browser.

import { type ApiClient, judgeRoutes } from "@fairsplit/api-client";
import { keyIdFitsKind } from "@fairsplit/contracts";
import { ed25519 } from "@noble/curves/ed25519.js";
import { jcs, utf8 } from "../../lib/jcs.js";
import { toHex } from "../../lib/sha256.js";

export type BrowserKeyKind = "webcrypto" | "demo";

/** A key made in this browser, before fs-api has registered it. */
export interface BrowserKey {
  readonly kind: BrowserKeyKind;
  /** The raw 32-byte public key, hex: shown in groups of four so a person can compare it. */
  readonly publicKeyHex: string;
  /** Ed25519 over `bytes`; 64 bytes as 128 hex characters. */
  sign(bytes: Uint8Array): Promise<string>;
}

/** A browser key fs-api has registered: the key every approval names. */
export interface SigningKey extends BrowserKey {
  /** The ID fs-api gave it (C-13 `fs-{persona}-demo-{6}`, a `web_demo` key). */
  readonly keyId: string;
}

/** Who a demo key signs as, in which judge workspace (the session's). */
export interface DemoSigner {
  readonly workspaceId: string;
  /** `treasurer:analyn`: the approver the key may sign as. */
  readonly approverId: string;
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function webCryptoKey(): Promise<BrowserKey | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const pair = (await subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"])) as CryptoKeyPair;
    // A key that could be exported is not the key the design promises: fall back rather than use it.
    if (pair.privateKey.extractable) return null;
    const publicKey = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
    return {
      kind: "webcrypto",
      publicKeyHex: toHex(publicKey),
      sign: async (bytes) =>
        toHex(new Uint8Array(await subtle.sign({ name: "Ed25519" }, pair.privateKey, bufferOf(bytes)))),
    };
  } catch {
    return null;
  }
}

function demoKey(): BrowserKey {
  const secret = ed25519.utils.randomSecretKey();
  return {
    kind: "demo",
    publicKeyHex: toHex(ed25519.getPublicKey(secret)),
    sign: async (bytes) => toHex(ed25519.sign(bytes, secret)),
  };
}

/** Makes a key: WebCrypto's non-extractable Ed25519 when the browser has it, else the labelled demo key. */
export async function makeBrowserKey(prefer: BrowserKeyKind = "webcrypto"): Promise<BrowserKey> {
  if (prefer === "webcrypto") {
    const key = await webCryptoKey();
    if (key) return key;
  }
  return demoKey();
}

/**
 * The statement a browser signs to register its demo key (fs-api `demoKeyStatement`): the judge workspace, the
 * approver and the public key, so a registration cannot be replayed for another workspace, approver or key.
 */
export function demoKeyStatement(signer: DemoSigner, publicKeyHex: string) {
  return {
    v: 1,
    purpose: "fs.register-demo-key",
    ws: signer.workspaceId,
    approverId: signer.approverId,
    publicKeyHex,
  } as const;
}

/**
 * Registers a browser key as this session's demo key (`POST /v1/judge/keys`), proving possession by signing the
 * statement. The answer must name this public key and a `web_demo` ID, or the key is not used.
 */
export async function registerDemoKey(
  api: ApiClient,
  key: BrowserKey,
  signer: DemoSigner,
): Promise<SigningKey> {
  const statement = jcs(demoKeyStatement(signer, key.publicKeyHex));
  const signatureHex = await key.sign(utf8(statement));
  const registered = await judgeRoutes(api).registerDemoKey({
    body: { publicKeyHex: key.publicKeyHex, signatureHex },
  });
  if (registered.publicKeyHex !== key.publicKeyHex || !keyIdFitsKind("web_demo", registered.keyId)) {
    throw new Error("fs-api registered another key than this browser's demo key.");
  }
  return { ...key, keyId: registered.keyId };
}

const keys = new Map<string, Promise<SigningKey>>();

/**
 * One registered key per signer and judge session: the same scope gets the same key back (a re-render never makes
 * or registers a second key), and a new session makes a new one. A registration that fails is forgotten, so the
 * next press tries again.
 */
export function sessionKey(
  scope: string,
  register: (key: BrowserKey) => Promise<SigningKey>,
): Promise<SigningKey> {
  let key = keys.get(scope);
  if (!key) {
    key = makeBrowserKey().then(register);
    keys.set(scope, key);
    key.catch(() => {
      if (keys.get(scope) === key) keys.delete(scope);
    });
  }
  return key;
}

/** The key a scope already holds, if one was made (tests check what signed). */
export function heldSessionKey(scope: string): Promise<SigningKey> | undefined {
  return keys.get(scope);
}

/** Tests: forget every key made in this page. */
export function forgetBrowserKeys(): void {
  keys.clear();
}
