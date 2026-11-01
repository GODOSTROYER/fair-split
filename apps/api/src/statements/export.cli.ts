// Run from any directory: corepack pnpm --filter @fairsplit/api exec tsx src/statements/export.cli.ts
// No real credentials or external network: seed two disposable local databases, verify both exports, stop.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createDb } from "@fairsplit/db";
import { loadShowcase } from "../proof/testing/world.js";
import { findRepoRoot } from "../static.js";
import { exportStatementPlans, serializeStatementPlans } from "./export.js";

const root = findRepoRoot();
// The testing barrel imports Vitest's inject(); the standalone CLI uses just its cluster/template helpers.
const { startTestCluster } = await import(
  pathToFileURL(path.join(root, "packages/db/src/testing/cluster.ts")).href
);
const { createTestDatabase, prepareTemplate } = await import(
  pathToFileURL(path.join(root, "packages/db/src/testing/template.ts")).href
);
const { APPROVED_STATEMENT_REQUESTS } = await import(
  pathToFileURL(path.join(root, "media/src/tts/plan.ts")).href
);
const cluster = await startTestCluster({ cacheDir: path.join(root, ".codex-scratch", "au2-export") });
try {
  const template = await prepareTemplate(cluster.adminUrl, "au2export");
  let output: string | null = null;
  for (const kind of ["showcase", "judge"] as const) {
    const database = await createTestDatabase(cluster.adminUrl, template, "au2export");
    const connection = createDb(database.url);
    try {
      const world = await loadShowcase(connection.db, { kind });
      const bytes = serializeStatementPlans(
        await exportStatementPlans(connection.db, world, APPROVED_STATEMENT_REQUESTS),
      );
      if (output !== null && output !== bytes) throw new Error("showcase and judge exports differ");
      output = bytes;
    } finally {
      await connection.close();
      await database.drop();
    }
  }
  if (output === null) throw new Error("no statement plans exported");
  writeFileSync(path.join(root, "media", "statement-plans.json"), output);
  console.log("Exported 11 statement requests; showcase and judge are byte-identical.");
} finally {
  await cluster.stop();
}
