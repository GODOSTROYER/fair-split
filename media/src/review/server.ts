import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import sharp from "sharp";
import { Fixture, type Fixture as FixtureT } from "../fixtures/schema.js";
import { readJson, writeJson } from "../util/json.js";
import { renderReviewPage } from "./page.js";
import {
  applySubmission,
  type ReviewItem,
  reviewItems,
  type SessionRecord,
  SubmissionError,
} from "./session.js";

/**
 * The localhost review server behind `imagegen review` (S4.10 "Review grid"). It binds 127.0.0.1 only,
 * checks the Host header (no DNS rebinding) and a random per-session token on every request, serves the
 * page and one crop per field from the master, and accepts exactly one complete submission, which it
 * writes to the fixture (fields `checkedBy: "human"`) and to `media/review/sessions/`. Marking the
 * fixture human-reviewed is left to the terminal confirmation that follows.
 */

export interface ReviewServerOptions {
  mediaRoot: string;
  fixtureId: string;
  reviewer: string;
  title?: string;
  port?: number;
  now?: () => Date;
  /** Called after the fixture is written, e.g. to regenerate its eval label. */
  afterWrite?: (f: FixtureT) => Promise<void>;
}

export interface SubmitResult {
  fixture: FixtureT;
  session: SessionRecord;
  sessionFile: string;
}

export interface ReviewServer {
  url: string;
  token: string;
  /** Resolves with the first accepted submission. */
  submitted: Promise<SubmitResult>;
  close(): Promise<void>;
}

const MAX_BODY = 512 * 1024;

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy":
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, v: unknown): void {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(v));
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const parts: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new SubmissionError("request body too large");
    parts.push(chunk as Buffer);
  }
  return Buffer.concat(parts).toString("utf8");
}

/** A crop of one field from the master, with a margin of context, scaled up for reading. */
export async function cropPng(
  master: string,
  rect: ReviewItem["rect"],
  width: number,
  height: number,
): Promise<Buffer> {
  const h = (rect.y2 - rect.y1) * height;
  const margin = Math.max(6, h * 0.35);
  const left = Math.max(0, Math.floor(rect.x1 * width - margin));
  const top = Math.max(0, Math.floor(rect.y1 * height - margin));
  const right = Math.min(width, Math.ceil(rect.x2 * width + margin));
  const bottom = Math.min(height, Math.ceil(rect.y2 * height + margin));
  const w = Math.max(1, right - left);
  const ch = Math.max(1, bottom - top);
  const scale = Math.min(3, 140 / ch, 900 / w);
  return sharp(master)
    .extract({ left, top, width: w, height: ch })
    .resize({
      width: Math.max(1, Math.round(w * scale)),
      height: Math.max(1, Math.round(ch * scale)),
      kernel: "lanczos3",
    })
    .png()
    .toBuffer();
}

export async function startReviewServer(opts: ReviewServerOptions): Promise<ReviewServer> {
  const now = opts.now ?? (() => new Date());
  const fixturePath = join(opts.mediaRoot, "fixtures", `${opts.fixtureId}.json`);
  const fixture = Fixture.parse(await readJson(fixturePath));
  const master = join(opts.mediaRoot, fixture.image.master);
  const { fields: items, traps } = reviewItems(fixture);
  const token = randomBytes(16).toString("hex");
  const startedAt = now().toISOString();
  let done = false;
  let resolveSubmitted: (r: SubmitResult) => void = () => undefined;
  const submitted = new Promise<SubmitResult>((r) => {
    resolveSubmitted = r;
  });
  let port = 0;

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const host = req.headers.host ?? "";
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)
        return send(res, 421, "text/plain", "wrong host");
      const tokenOk = url.searchParams.get("t") === token || req.headers["x-review-token"] === token;
      if (!tokenOk) return send(res, 403, "text/plain", "missing or wrong review token");
      if (req.method === "GET" && url.pathname === "/") {
        return send(
          res,
          200,
          "text/html; charset=utf-8",
          renderReviewPage({
            id: fixture.id,
            title: opts.title ?? fixture.id,
            reviewer: opts.reviewer,
            token,
            items,
            traps,
          }),
        );
      }
      const crop = /^\/crop\/(\d+)$/.exec(url.pathname);
      if (req.method === "GET" && crop) {
        const item = items[Number(crop[1])];
        if (!item) return send(res, 404, "text/plain", "no such field");
        return send(
          res,
          200,
          "image/png",
          await cropPng(master, item.rect, fixture.image.width, fixture.image.height),
        );
      }
      if (req.method === "POST" && url.pathname === "/submit") {
        if (done) return sendJson(res, 409, { error: "this session is already saved" });
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
          return sendJson(res, 415, { error: "expected application/json" });
        }
        try {
          const body = JSON.parse(await readBody(req)) as unknown;
          const fresh = Fixture.parse(await readJson(fixturePath));
          if (fresh.image.sha256 !== fixture.image.sha256)
            throw new SubmissionError("the fixture changed under this session; reload");
          const submittedAt = now().toISOString();
          const session = applySubmission(fresh, body as never, {
            reviewer: opts.reviewer,
            startedAt,
            submittedAt,
          });
          const written = Fixture.parse(fresh);
          await writeJson(fixturePath, written);
          const stamp = submittedAt.replace(/[-:]/g, "").slice(0, 15);
          const sessionFile = join(opts.mediaRoot, "review", "sessions", `${fixture.id}.${stamp}.json`);
          await writeJson(sessionFile, session);
          await opts.afterWrite?.(written);
          done = true;
          const crops = written.review.cropIssues.length;
          sendJson(res, 200, {
            ok: true,
            message: crops
              ? `Saved. ${crops} crop(s) marked wrong: they will be redrafted, so the fixture stays a draft. You can close this tab.`
              : "Saved. Go back to the terminal to confirm the review; you can close this tab.",
          });
          resolveSubmitted({ fixture: written, session, sessionFile });
        } catch (e) {
          const status = e instanceof SubmissionError || e instanceof SyntaxError ? 400 : 500;
          sendJson(res, status, { error: (e as Error).message.slice(0, 500) });
        }
        return;
      }
      send(res, 404, "text/plain", "not found");
    })().catch((e: Error) => {
      if (!res.headersSent) send(res, 500, "text/plain", e.message);
    });
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/?t=${token}`,
    token,
    submitted,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
