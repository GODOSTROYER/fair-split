/**
 * Vitest globalSetup: one real Postgres per test run, one migrated template, provided to every test file as
 * `inject("fsPg")`. Use it from a package's vitest.config.ts:
 *   test: { globalSetup: ["@fairsplit/db/testing/global-setup"] }   (or a relative path inside this package)
 */
import path from "node:path";
import type { TestProject } from "vitest/node";
import { startTestCluster } from "./cluster.js";
import { prepareTemplate } from "./template.js";

export interface ProvidedPg {
  adminUrl: string;
  template: string;
  suite: string;
}

declare module "vitest" {
  export interface ProvidedContext {
    fsPg: ProvidedPg;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const suite = path.basename(project.config.root);
  const cluster = await startTestCluster({ cacheDir: path.join(project.config.root, ".cache") });
  const template = await prepareTemplate(cluster.adminUrl, suite);
  project.provide("fsPg", { adminUrl: cluster.adminUrl, template, suite });
  return async () => {
    await cluster.stop();
  };
}
