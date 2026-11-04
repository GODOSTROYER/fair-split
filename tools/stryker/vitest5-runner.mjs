// StrykerJS plugin: @stryker-mutator/vitest-runner 10.0.0 adapted to Vitest 5 (handoff T3, mutation testing).
//
// The runner limits each mutant to the tests that cover it with a test-name regex built from
// `describe name` + " " + `test name`. Vitest 5 matches that pattern against "describe name > test name", so for
// any test inside a describe the regex matches nothing: no test runs and every covered mutant "survives".
// This plugin is the published runner, unchanged, except that the pattern it hands Vitest accepts either
// separator. It loads the runner from the npx install that runs Stryker, so no dependency is added (base.mjs
// has the command and names this plugin).
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// process.argv[1] is Stryker's own bin (main process) or its child-process worker: both sit in the npx install.
const fromStryker = createRequire(process.argv[1] ?? join(process.cwd(), "noop.js"));
const runnerEntry = fromStryker.resolve("@stryker-mutator/vitest-runner");
const load = (path) => import(pathToFileURL(path).href);

const runnerIndex = await load(runnerEntry);
const { VitestTestRunner } = await load(join(dirname(runnerEntry), "vitest-test-runner.js"));
const { commonTokens, declareFactoryPlugin, PluginKind, tokens } = await load(
  fromStryker.resolve("@stryker-mutator/api/plugin"),
);

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A Stryker test ID is `file#describe test`; Vitest 5 names that test `describe > test`. */
export function vitest5Pattern(testIds) {
  const names = testIds.map((id) => id.split("#").slice(1).join("#"));
  return new RegExp(names.map((n) => escapeRegExp(n).replaceAll(" ", "(?: | > )")).join("|"));
}

class Vitest5TestRunner extends VitestTestRunner {
  #pattern;

  async init() {
    await super.init();
    const start = this.ctx.start.bind(this.ctx);
    this.ctx.start = (files) => {
      if (this.#pattern)
        for (const project of this.ctx.projects) project.config.testNamePattern = this.#pattern;
      return start(files);
    };
  }

  async mutantRun(options) {
    this.#pattern = options.testFilter?.length ? vitest5Pattern(options.testFilter) : undefined;
    try {
      return await super.mutantRun(options);
    } finally {
      this.#pattern = undefined;
    }
  }
}

function createVitest5TestRunner(injector) {
  return injector.provideValue("globalNamespace", "__stryker__").injectClass(Vitest5TestRunner);
}
createVitest5TestRunner.inject = tokens(commonTokens.injector);

export const strykerPlugins = [
  declareFactoryPlugin(PluginKind.TestRunner, "vitest", createVitest5TestRunner),
];
export const strykerValidationSchema = runnerIndex.strykerValidationSchema;
