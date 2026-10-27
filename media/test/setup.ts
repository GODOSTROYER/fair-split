import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODEX_LEDGER_ENV } from "../src/imagegen/ledger.js";

// The Codex ledger is machine-wide ($CODEX_HOME/fairsplit-codex-ledger.json), so a test that reached it
// would spend or read the user's real budget. Every test file gets its own ledger file instead.
process.env[CODEX_LEDGER_ENV] = join(mkdtempSync(join(tmpdir(), "fs-codex-ledger-")), "ledger.json");
