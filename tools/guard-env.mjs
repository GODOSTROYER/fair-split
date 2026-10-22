// Refuses to commit any .env file (other than .env.example) or any file that contains an
// Anthropic, Google or PayPal secret pattern. Runs from the lefthook pre-commit hook and in CI.
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

const patterns = [
  /sk-ant-[a-z]{2,6}\d{0,2}-[A-Za-z0-9_-]{20,}/,
  /AIza[0-9A-Za-z_-]{35}/,
  /AQ\.[A-Za-z0-9_-]{30,}/,
  /PAYPAL_CLIENT_SECRET\s*=\s*[A-Za-z0-9_-]{20,}/,
];
const files = process.argv.slice(2).filter((f) => existsSync(f));
const bad = [];
for (const f of files) {
  const name = basename(f);
  if (name.startsWith(".env") && name !== ".env.example") {
    bad.push(`${f}: env files must never be committed`);
    continue;
  }
  let text = "";
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  for (const p of patterns) if (p.test(text)) bad.push(`${f}: matches secret pattern ${p}`);
}
if (bad.length) {
  console.error(`Secret guard blocked this commit:\n${bad.join("\n")}`);
  process.exit(1);
}
